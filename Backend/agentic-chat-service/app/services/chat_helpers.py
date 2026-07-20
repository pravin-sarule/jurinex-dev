from __future__ import annotations

import json
import re
import uuid
from typing import Any

UUID_FILE_ID_REGEX = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I
)


def is_valid_uuid(value: str | None) -> bool:
    return bool(value and UUID_FILE_ID_REGEX.match(str(value)))


def sanitize_one_file_id(raw: Any) -> str | None:
    if raw is None or raw == "":
        return None
    s = str(raw).strip().strip("{}").strip()
    return s if is_valid_uuid(s) else None


def parse_file_ids_from_body(body: dict[str, Any]) -> list[str]:
    ids: list[str] = []
    if isinstance(body.get("file_ids"), list):
        for x in body["file_ids"]:
            fid = sanitize_one_file_id(x)
            if fid:
                ids.append(fid)
    elif body.get("file_id") is not None and str(body.get("file_id")).strip():
        fid = sanitize_one_file_id(body["file_id"])
        if fid:
            ids.append(fid)
    seen: set[str] = set()
    out: list[str] = []
    for fid in ids:
        if fid not in seen:
            seen.add(fid)
            out.append(fid)
    return out


# Request flags that explicitly turn on the web-search judgement finder.
_JUDGEMENT_SEARCH_FLAGS = (
    "web_search",
    "webSearch",
    "find_judgements",
    "findJudgements",
    "find_judgments",
    "use_web_search",
    "judgement_search",
    "judgment_search",
)

# Phrases that signal the user wants us to *find / search* real judgements or
# case law online (as opposed to plain document Q&A). Applied ONLY to short,
# query-like questions: long analysis templates routinely CONTAIN words like
# "precedents" or "similar case" without asking for a web search — matching
# those hijacked ordinary chat into the citation pipeline (and away from the
# admin-configured model).
_JUDGEMENT_INTENT_PHRASES = (
    "find judgement", "find judgment", "find judgements", "find judgments",
    "find a judgement", "find a judgment", "find me judgement", "find me judgment",
    "similar judgement", "similar judgment",
    "related judgement", "related judgment",
    "case law on", "case laws on", "judgements on", "judgments on",
    "find cases", "find case law", "find me cases",
    "search for judgement", "search for judgment", "search judgement",
    "supporting judgement", "supporting judgment",
)

# Intent sniffing applies only to questions at most this long. Anything longer
# is a prompt/template, not a "find me cases" query — the explicit Citation
# toggle (web_search flag) is the way to force the citation pipeline.
_JUDGEMENT_INTENT_MAX_CHARS = 240


def wants_judgement_search(body: dict[str, Any]) -> bool:
    """True when the request asks for web-grounded judgement / case-law research.

    Triggered by an explicit flag (frontend Citation toggle), or by
    judgement-finding intent phrases in a SHORT query-like question.
    """
    if not isinstance(body, dict):
        return False
    for flag in _JUDGEMENT_SEARCH_FLAGS:
        if body.get(flag):
            return True
    question = str(body.get("question") or "").strip().lower()
    if not question or len(question) > _JUDGEMENT_INTENT_MAX_CHARS:
        return False
    return any(phrase in question for phrase in _JUDGEMENT_INTENT_PHRASES)


def sanitize_filename(name: str) -> str:
    s = re.sub(r"[^\w.\- ]+", "_", str(name or "document"))
    s = re.sub(r"\s+", "_", s)
    s = re.sub(r"_+", "_", s)
    return s[:180]


def build_chat_upload_path(user_id: str, filename: str) -> str:
    return f"chat-uploads/{user_id}/{int(__import__('time').time() * 1000)}_{uuid.uuid4()}_{sanitize_filename(filename)}"


def parse_attached_files_cell(raw: Any) -> list[dict[str, Any]] | None:
    if raw is None:
        return None
    if isinstance(raw, list):
        return raw if raw else None
    if isinstance(raw, str):
        try:
            p = json.loads(raw)
            return p if isinstance(p, list) and p else None
        except json.JSONDecodeError:
            return None
    if isinstance(raw, dict):
        return [raw]
    return None


def build_attached_files_snapshot(
    files: list[dict[str, Any]], bucket_name: str, prepared_files: list[dict[str, Any]] | None = None
) -> list[dict[str, Any]] | None:
    if not files or not bucket_name:
        return None
    prepared_by_uri: dict[str, dict[str, Any]] = {}
    for item in prepared_files or []:
        uri = item.get("source_gcs_uri")
        if uri:
            prepared_by_uri[uri] = item
    out = []
    for f in files:
        gcs_path = f.get("gcs_path")
        source_uri = f"gs://{bucket_name}/{gcs_path}" if gcs_path else None
        prepared = prepared_by_uri.get(source_uri) if source_uri else None
        active = (
            prepared.get("active_gcs_uris")
            if prepared and isinstance(prepared.get("active_gcs_uris"), list) and prepared["active_gcs_uris"]
            else ([source_uri] if source_uri else [])
        )
        out.append(
            {
                "file_id": str(f["id"]) if f.get("id") is not None else None,
                "filename": f.get("originalname") or f.get("filename") or "document",
                "mimetype": f.get("mimetype"),
                "size": int(f.get("size") or 0) if f.get("size") is not None else None,
                "gcs_uri": source_uri,
                "active_gcs_uris": active,
                "split_gcs_uris": prepared.get("split_gcs_uris", []) if prepared else [],
                "was_split": bool(prepared.get("was_split")) if prepared else False,
            }
        )
    return out


def resolve_attached_files_for_session(
    history_rows: list[dict[str, Any]],
    file_row: dict[str, Any] | None,
    primary_file_id: str,
    bucket_name: str,
) -> list[dict[str, Any]] | None:
    if history_rows:
        for row in reversed(history_rows):
            parsed = parse_attached_files_cell(row.get("attached_files"))
            if parsed:
                return parsed
    if file_row and primary_file_id and file_row.get("gcs_path") and bucket_name:
        uri = f"gs://{bucket_name}/{file_row['gcs_path']}"
        return [
            {
                "file_id": primary_file_id,
                "filename": file_row.get("originalname") or "document",
                "mimetype": file_row.get("mimetype"),
                "size": file_row.get("size"),
                "gcs_uri": uri,
                "active_gcs_uris": [uri],
                "split_gcs_uris": [],
                "was_split": False,
            }
        ]
    return None


def build_active_gcs_uris_from_attached(attached_files: list[dict[str, Any]] | None) -> list[str]:
    if not attached_files:
        return []
    uris: list[str] = []
    for file in attached_files:
        if isinstance(file.get("active_gcs_uris"), list) and file["active_gcs_uris"]:
            uris.extend(u for u in file["active_gcs_uris"] if isinstance(u, str) and u.startswith("gs://"))
            continue
        if isinstance(file.get("split_gcs_uris"), list) and file["split_gcs_uris"]:
            uris.extend(u for u in file["split_gcs_uris"] if isinstance(u, str) and u.startswith("gs://"))
            continue
        if isinstance(file.get("gcs_uri"), str) and file["gcs_uri"].startswith("gs://"):
            uris.append(file["gcs_uri"])
    return list(dict.fromkeys(uris))


# Caps for history fed back as LLM context / stored in chat_history jsonb.
# Uncapped, one runaway multi-MB answer poisons every later prompt in the
# session (input token bloat) and bloats every later row's chat_history.
_HISTORY_Q_CAP = 4000
_HISTORY_A_CAP = 8000


def _cap(text: str, limit: int) -> str:
    t = (text or "").strip()
    if len(t) <= limit:
        return t
    return t[:limit] + "\n…[earlier answer truncated for context]"


def format_conversation_history(chats: list[dict[str, Any]]) -> str:
    if not chats:
        return ""
    lines = []
    for i, c in enumerate(chats[-10:], 1):
        q = _cap(c.get("question") or "", _HISTORY_Q_CAP)
        a = _cap(c.get("answer") or "", _HISTORY_A_CAP)
        if q or a:
            lines.append(f"Turn {i}:\nUser: {q}\nAssistant: {a}")
    return "\n\n".join(lines)


def simplify_history(chats: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "id": c.get("id"),
            "question": _cap(c.get("question") or "", _HISTORY_Q_CAP),
            "answer": _cap(c.get("answer") or "", _HISTORY_A_CAP),
            "created_at": c.get("created_at"),
        }
        for c in chats
        if c.get("question") is not None and c.get("answer") is not None
    ][-20:]
