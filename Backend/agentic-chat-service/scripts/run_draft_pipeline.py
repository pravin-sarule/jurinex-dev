"""CLI entry point for the 4-stage zero-hallucination drafting pipeline.

Runs the SAME monolithic pipeline the API serves (Stage 1 ingestion check →
Stage 2 grounded extraction → Stage 3 template drafting → Stage 4
verification pass) and writes two separate outputs:

    (a) the draft text            → <out>/draft.md
    (b) the review packet         → <out>/review_packet.json
        (missing fields, conflicts, unverified citations, discrepancy report)

Usage — existing analyzed session (template ID = drafting session ID):

    python scripts/run_draft_pipeline.py --session-id <uuid> --user-id <uid>

Usage — from scratch (template file + supporting documents; documents may be
local paths or gs://bucket/path URIs):

    python scripts/run_draft_pipeline.py --user-id cli \
        --template ./plaint_template.docx \
        --doc gs://my-bucket/case/invoice1.pdf --doc ./agreement.pdf

Needs the same environment as the service (.env: DB, GCS, GEMINI key).
"""
from __future__ import annotations

import argparse
import asyncio
import json
import mimetypes
import pathlib
import sys
import uuid
from urllib.parse import urlparse

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))


def _read_doc(uri: str) -> tuple[bytes, str]:
    """Local path or gs:// URI → (bytes, filename)."""
    if uri.startswith("gs://"):
        from app.services.gcs_service import download_object_buffer
        parsed = urlparse(uri)
        bucket, blob = parsed.netloc, parsed.path.lstrip("/")
        if not bucket or not blob:
            raise SystemExit(f"Invalid GCS URI: {uri}")
        return download_object_buffer(bucket, blob), blob.split("/")[-1]
    path = pathlib.Path(uri)
    if not path.is_file():
        raise SystemExit(f"Document not found: {uri}")
    return path.read_bytes(), path.name


async def _prepare_session(args) -> tuple[str, str]:
    from app.services import drafting_repository as repo
    from app.services import drafting_service as svc

    user_id = args.user_id
    if args.session_id:
        session = repo.get_session(args.session_id, user_id)
        if not session:
            raise SystemExit(f"Session {args.session_id} not found for user {user_id}")
        session_id = args.session_id
    else:
        if not args.template:
            raise SystemExit("Provide --session-id (analyzed template) or --template <file>")
        session_id = repo.create_session(user_id, args.model)
        data, name = _read_doc(args.template)
        mime = mimetypes.guess_type(name)[0] or "application/octet-stream"
        data, mime = svc.normalize_upload(data, name, mime)
        gcs_path = f"drafting/{user_id}/{session_id}/template/{uuid.uuid4().hex}_{name}"
        svc.store_blob(gcs_path, data, mime)
        repo.update_session(session_id, status="analyzing", template_file={
            "name": name, "mime_type": mime, "size": len(data), "gcs_path": gcs_path,
        })
        print(f"[cli] session {session_id} created — analyzing template (Stage 0)…")
        await svc.analyze_template_task(session_id, user_id)

    session = repo.get_session(session_id, user_id)
    if session.get("status") in ("created", "template_uploaded", "analyzing", "analysis_failed"):
        raise SystemExit(
            f"Template analysis not ready (status={session.get('status')}, "
            f"error={session.get('error')})"
        )

    from app.services import drafting_service as svc2
    for uri in args.doc or []:
        data, name = _read_doc(uri)
        mime = mimetypes.guess_type(name)[0] or "application/octet-stream"
        data, mime = svc2.normalize_upload(data, name, mime)
        gcs_path = f"drafting/{user_id}/{session_id}/docs/{uuid.uuid4().hex}_{name}"
        svc2.store_blob(gcs_path, data, mime)
        repo.append_supporting_doc(session_id, {
            "doc_id": uuid.uuid4().hex, "name": name, "mime_type": mime,
            "size": len(data), "gcs_path": gcs_path,
        })
        print(f"[cli] attached supporting document: {name} ({len(data):,} bytes)")
    if args.doc:
        # New documents invalidate the cached inventory + grounded extraction.
        repo.update_session(session_id, facts_digest=None, grounded_facts=None)
    return session_id, user_id


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--session-id", help="Existing analyzed drafting session (template ID)")
    parser.add_argument("--template", help="Template file (local path or gs:// URI)")
    parser.add_argument("--doc", action="append", default=[],
                        help="Supporting document (local path or gs:// URI); repeatable")
    parser.add_argument("--user-id", default="cli", help="Owner user id (default: cli)")
    parser.add_argument("--model", default=None, help="Drafting model, e.g. gemini-3-flash-preview")
    parser.add_argument("--instructions", default=None, help="User draft focus")
    parser.add_argument("--out", default="draft_out", help="Output directory")
    args = parser.parse_args()

    session_id, user_id = await _prepare_session(args)

    from app.services import drafting_service as svc

    out_dir = pathlib.Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    draft_text = ""
    review_packet: dict | None = None
    run_id = None
    async for evt in svc.generate_draft_loop(
        user_id=user_id,
        session_id=session_id,
        selected_model=args.model,
        user_instructions=args.instructions,
        drafting_strategy="monolithic",
    ):
        etype = evt.get("type")
        if etype == "status":
            print(f"[status] {evt.get('message', '')}")
        elif etype == "ingestion_report":
            run_id = evt.get("runId") or run_id
            print(f"[stage1] ok={evt.get('ok')} docs={len(evt.get('documents') or [])} "
                  f"~{evt.get('totalEstTokens', 0):,} tokens, "
                  f"{evt.get('batches', 1)} batch(es), "
                  f"OCR-derived: {evt.get('ocrDerivedDocs') or 'none'}")
        elif etype == "document_end":
            draft_text = evt.get("text") or draft_text
        elif etype in ("document_replace",):
            draft_text = evt.get("text") or draft_text
        elif etype == "discrepancy_report":
            print(f"[stage4] {evt.get('unsupportedCount', 0)} statement(s) with no source support")
        elif etype == "review_packet":
            review_packet = {k: v for k, v in evt.items() if k != "type"}
            run_id = review_packet.get("runId") or run_id
        elif etype == "error":
            print(f"[error] {evt.get('message')}", file=sys.stderr)
        elif etype == "done":
            print(f"[done] status={evt.get('status')}")

    if not draft_text:
        raise SystemExit("No draft was produced — see errors above.")

    draft_path = out_dir / "draft.md"
    draft_path.write_text(draft_text, encoding="utf-8")
    packet_path = out_dir / "review_packet.json"
    packet_path.write_text(
        json.dumps(review_packet or {"warning": "no review packet emitted"},
                   ensure_ascii=False, indent=2, default=str),
        encoding="utf-8",
    )
    print(f"\nrun_id:        {run_id}")
    print(f"session_id:    {session_id}")
    print(f"draft:         {draft_path} ({len(draft_text):,} chars)")
    print(f"review packet: {packet_path}")
    if review_packet:
        f = review_packet.get("fields") or {}
        s = f.get("summary") or {}
        print(f"  fields: {s.get('verified', 0)} verified / {s.get('missing', 0)} missing / "
              f"{s.get('conflicts', 0)} conflicts / {s.get('unverified', 0)} unverified")
        print(f"  discrepancies: {len(review_packet.get('discrepancies') or [])} "
              f"(report-only; draft not auto-modified)")


if __name__ == "__main__":
    asyncio.run(main())
