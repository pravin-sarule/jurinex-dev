"""Drafting Mode routes — /api/chat/draft/*

Explicitly frontend-triggered pipeline (never entered by chat intent detection):

    POST   /api/chat/draft/session                    create a drafting session
    POST   /api/chat/draft/{sid}/template             upload template → async analysis
    GET    /api/chat/draft/{sid}                      poll status / fetch structure & draft
    POST   /api/chat/draft/{sid}/documents            upload supporting documents
    POST   /api/chat/draft/{sid}/generate/stream      SSE section-by-section generation
    GET    /api/chat/draft/{sid}/download             compiled draft (markdown/text)
    DELETE /api/chat/draft/{sid}                      delete session + context cache
"""
from __future__ import annotations

import json
import logging
import uuid
from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import PlainTextResponse, StreamingResponse

from app.core.auth import get_current_user
from app.services import drafting_repository as repo
from app.services import drafting_service as svc
from app.services.drafting_schemas import DraftGenerateRequest

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/chat/draft", tags=["drafting"])


def _sse(obj: Any) -> str:
    if isinstance(obj, str):
        return f"data: {obj}\n\n"
    return f"data: {json.dumps(obj, ensure_ascii=False, default=str)}\n\n"


def _get_owned_session(session_id: str, user: dict) -> dict[str, Any]:
    try:
        uuid.UUID(session_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid session id")
    session = repo.get_session(session_id, user["id"])
    if not session:
        raise HTTPException(status_code=404, detail="Drafting session not found")
    return session


def _session_payload(session: dict[str, Any]) -> dict[str, Any]:
    return {
        "success": True,
        "session_id": str(session["id"]),
        "status": session["status"],
        "model": session.get("model"),
        "template_file": session.get("template_file"),
        "template_structure": session.get("template_structure"),
        "supporting_docs": session.get("supporting_docs") or [],
        "draft_sections": session.get("draft_sections") or [],
        "draft_metadata": session.get("draft_metadata"),
        "review_packet": session.get("review_packet"),
        "error": session.get("error"),
    }


# ── Session lifecycle ──────────────────────────────────────────────────────

@router.post("/session")
async def create_session(request: Request, user: dict = Depends(get_current_user)):
    body: dict[str, Any] = {}
    try:
        body = await request.json()
    except Exception:
        pass
    model = (body or {}).get("llm_name") or (body or {}).get("model")
    session_id = repo.create_session(user["id"], model)
    return {"success": True, "session_id": session_id, "status": "created"}


@router.get("/{session_id}")
async def get_session_status(session_id: str, user: dict = Depends(get_current_user)):
    return _session_payload(_get_owned_session(session_id, user))


@router.delete("/{session_id}")
async def delete_session(session_id: str, user: dict = Depends(get_current_user)):
    session = _get_owned_session(session_id, user)
    if session.get("cache_name"):
        await svc.delete_context_cache(session["cache_name"])
    repo.delete_session(session_id, user["id"])
    return {"success": True}


# ── Uploads ────────────────────────────────────────────────────────────────

@router.post("/{session_id}/template")
async def upload_template(
    session_id: str,
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
):
    """Store the template and kick the async Template Structural Analyst worker."""
    session = _get_owned_session(session_id, user)

    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(data) > svc.MAX_TEMPLATE_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"Template exceeds {svc.MAX_TEMPLATE_BYTES // (1024 * 1024)} MB limit",
        )
    try:
        data, mime = svc.normalize_upload(data, file.filename or "template", file.content_type or "")
    except ValueError as exc:
        raise HTTPException(status_code=415, detail=str(exc))

    gcs_path = f"drafting/{user['id']}/{session_id}/template/{uuid.uuid4().hex}_{file.filename}"
    svc.store_blob(gcs_path, data, mime)

    repo.update_session(
        session_id,
        status="analyzing",
        template_structure=None,
        error=None,
        template_file={
            "name": file.filename,
            "mime_type": mime,
            "size": len(data),
            "gcs_path": gcs_path,
        },
    )
    # Async worker — the response returns immediately; frontend polls GET /{sid}.
    svc.schedule_template_analysis(session_id, user["id"], session.get("model"))
    return {"success": True, "session_id": session_id, "status": "analyzing"}


@router.post("/{session_id}/template/retry")
async def retry_template_analysis(
    session_id: str,
    user: dict = Depends(get_current_user),
):
    """Re-run async analysis on the already-uploaded template (no re-upload needed)."""
    session = _get_owned_session(session_id, user)
    if not session.get("template_file"):
        raise HTTPException(status_code=400, detail="No template uploaded for this session")
    repo.update_session(session_id, status="analyzing", template_structure=None, error=None)
    svc.schedule_template_analysis(session_id, user["id"], session.get("model"))
    return {"success": True, "session_id": session_id, "status": "analyzing"}


@router.post("/{session_id}/documents")
async def upload_supporting_documents(
    session_id: str,
    files: list[UploadFile] = File(...),
    user: dict = Depends(get_current_user),
):
    """Upload supporting documents whose facts ground the draft."""
    session = _get_owned_session(session_id, user)
    existing = session.get("supporting_docs") or []
    if len(existing) + len(files) > svc.MAX_SUPPORT_DOCS:
        raise HTTPException(
            status_code=400,
            detail=f"At most {svc.MAX_SUPPORT_DOCS} supporting documents per session",
        )

    added = []
    for file in files:
        data = await file.read()
        if not data:
            continue
        if len(data) > svc.MAX_SUPPORT_DOC_BYTES:
            raise HTTPException(
                status_code=413,
                detail=f"'{file.filename}' exceeds "
                       f"{svc.MAX_SUPPORT_DOC_BYTES // (1024 * 1024)} MB limit",
            )
        try:
            data, mime = svc.normalize_upload(data, file.filename or "document", file.content_type or "")
        except ValueError as exc:
            raise HTTPException(status_code=415, detail=str(exc))

        gcs_path = f"drafting/{user['id']}/{session_id}/docs/{uuid.uuid4().hex}_{file.filename}"
        svc.store_blob(gcs_path, data, mime)
        meta = {
            "doc_id": uuid.uuid4().hex,
            "name": file.filename,
            "mime_type": mime,
            "size": len(data),
            "gcs_path": gcs_path,
        }
        repo.append_supporting_doc(session_id, meta)
        added.append(meta)

    # Supporting docs changed → explicit cache AND fact inventory are stale.
    if session.get("cache_name"):
        await svc.delete_context_cache(session["cache_name"])
        repo.update_session(session_id, cache_name=None)
    if added:
        # Fact inventory AND the grounded field extraction are per-document-set.
        repo.update_session(session_id, facts_digest=None, grounded_facts=None)
    # ADK runners prime the session with docs — drop them so the next draft re-primes.
    try:
        from agents.drafting_adk import invalidate_session_runners
        invalidate_session_runners(session_id)
    except Exception:
        logger.debug("ADK runner invalidation skipped", exc_info=True)

    return {"success": True, "session_id": session_id, "added": added}


# ── Generation (SSE) ───────────────────────────────────────────────────────

@router.post("/{session_id}/generate/stream")
async def generate_stream(
    session_id: str,
    request: Request,
    user: dict = Depends(get_current_user),
):
    """Sequential section-by-section draft generation, streamed as SSE.

    Emits typed events (status/section_start/chunk/section_end/usage/done/error)
    and frames each section's text with [START_SECTION_i]…[END_SECTION_i]
    markers inside the chunk stream. Terminates with `data: [DONE]`.
    """
    _get_owned_session(session_id, user)
    raw_body: dict[str, Any] = {}
    try:
        raw_body = await request.json()
        body = DraftGenerateRequest.model_validate(raw_body)
    except Exception as exc:
        logger.warning("Draft generate body parse failed (%s) — using defaults", exc)
        body = DraftGenerateRequest()
    # Honour strategy even if other fields failed validation.
    strategy_override = (raw_body or {}).get("drafting_strategy")
    drafting_strategy = strategy_override or body.drafting_strategy

    origin = request.headers.get("origin")

    async def gen():
        try:
            async for event in svc.generate_draft_loop(
                user_id=user["id"],
                session_id=session_id,
                selected_model=body.llm_name,
                section_ids=body.section_ids,
                user_instructions=body.user_instructions,
                confirmed_facts=body.confirmed_facts,
                max_output_tokens_per_section=body.max_output_tokens_per_section,
                drafting_strategy=drafting_strategy,
            ):
                yield _sse(event)
        except Exception as exc:  # never let the stream die silently
            logger.exception("Draft stream crashed for session %s", session_id)
            yield _sse({"type": "error", "message": f"Draft generation failed: {exc}"})
        finally:
            yield _sse("[DONE]")

    headers = {
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
        "Connection": "keep-alive",
    }
    if origin:
        headers["Access-Control-Allow-Origin"] = origin
        headers["Access-Control-Allow-Credentials"] = "true"
    return StreamingResponse(gen(), media_type="text/event-stream", headers=headers)


# ── Download ───────────────────────────────────────────────────────────────

@router.get("/{session_id}/download")
async def download_draft(
    session_id: str,
    format: str = "markdown",
    user: dict = Depends(get_current_user),
):
    """Compile stored sections into one downloadable document (markdown or plain text)."""
    session = _get_owned_session(session_id, user)
    sections = session.get("draft_sections") or []
    if not sections:
        raise HTTPException(status_code=404, detail="No generated sections to download")

    structure = session.get("template_structure") or {}
    title = structure.get("document_title") or "Draft Document"
    if format == "markdown":
        body = svc.compile_draft_markdown(structure, sections)
        media, ext = "text/markdown", "md"
    else:
        parts: list[str] = [f"{title}\n{'=' * len(title)}\n"]
        for s in sorted(sections, key=lambda x: x.get("index", 0)):
            parts.append(s.get("content", "") + "\n")
        body = "\n".join(parts)
        media, ext = "text/plain", "txt"

    filename = f"{title.strip().replace(' ', '_')[:60] or 'draft'}.{ext}"
    return PlainTextResponse(
        body,
        media_type=media,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
