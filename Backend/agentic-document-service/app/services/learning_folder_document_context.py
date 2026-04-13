"""Build Learning Mode `document_context` from folder DB rows (server-side)."""

from __future__ import annotations

import logging
import threading
import time
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from app.services.folder_service import FolderService

logger = logging.getLogger("agentic_document_service.learning_folder_document_context")

MAX_LEARNING_DOC_CONTEXT_CHARS = 250_000
_CACHE_TTL_S = 180.0

_cache_lock = threading.Lock()
_cache: dict[str, dict[str, Any]] = {}


def _processed_ok(file: dict[str, Any]) -> bool:
    st = str(file.get("status") or file.get("processing_status") or "").lower()
    try:
        prog = float(file.get("processing_progress") or file.get("progress") or 0)
    except (TypeError, ValueError):
        prog = 0.0
    return (
        st in ("processed", "complete", "completed", "ready")
        or prog >= 100.0
    )


def _folder_list_signature(files_list: list[dict[str, Any]]) -> str:
    parts: list[str] = []
    for f in files_list:
        fid = f.get("id") or f.get("_id") or f.get("document_id")
        if not fid:
            continue
        st = str(f.get("status") or f.get("processing_status") or "").lower()
        prog = str(f.get("processing_progress") or f.get("progress") or "")
        rev = str(f.get("updated_at") or f.get("updatedAt") or f.get("modified_at") or "")
        parts.append(f"{fid}|{st}|{prog}|{rev}")
    parts.sort()
    return "::".join(parts)


def _build_text_from_rows(rows: list[dict[str, Any]]) -> str:
    parts: list[str] = []
    total = 0
    for row in rows:
        filename = str(row.get("name") or row.get("originalname") or row.get("filename") or "Document")
        text = str(row.get("full_text_content") or row.get("summary") or "").strip()
        if not text:
            continue
        header = f"\n\n===== {filename} =====\n"
        room = MAX_LEARNING_DOC_CONTEXT_CHARS - total - len(header)
        if room < 400:
            break
        body = text if len(text) <= room else f"{text[:room]}\n\n[... truncated ...]"
        block = f"{header}{body}"
        parts.append(block)
        total += len(block)
    return "".join(parts).strip()


def build_learning_folder_document_context(
    folder_service: FolderService,
    folder_name: str,
    user_id: str,
) -> str:
    """
    Load extracted text (or summary) from processed files in the folder.
    Cached briefly by (user_id, folder_name) + list signature.
    """
    name = str(folder_name or "").strip()
    uid = str(user_id or "").strip()
    if not name or not uid:
        return ""

    cache_key = f"{uid}::{name}"

    try:
        docs_result = folder_service.get_documents_in_folder(name, uid)
    except Exception as exc:
        logger.warning(
            "[learning_folder_document_context] get_documents_in_folder failed folder=%s user_id=%s error=%s",
            name,
            uid,
            exc,
        )
        return ""

    documents = docs_result.get("documents") or docs_result.get("files") or []
    if not isinstance(documents, list):
        documents = []

    list_sig = _folder_list_signature(documents)
    now = time.monotonic()

    with _cache_lock:
        hit = _cache.get(cache_key)
        if (
            hit
            and float(hit.get("expires_at") or 0) > now
            and hit.get("list_sig") == list_sig
            and isinstance(hit.get("text"), str)
        ):
            return hit["text"]

    prepared: list[dict[str, Any]] = []
    for f in documents:
        if not isinstance(f, dict):
            continue
        rid = f.get("id") or f.get("_id") or f.get("document_id")
        if not rid or not _processed_ok(f):
            continue
        prepared.append(f)

    prepared.sort(
        key=lambda x: str(x.get("originalname") or x.get("name") or x.get("filename") or "").lower(),
    )

    text = _build_text_from_rows(prepared)

    with _cache_lock:
        _cache[cache_key] = {
            "text": text,
            "list_sig": list_sig,
            "expires_at": time.monotonic() + _CACHE_TTL_S,
        }

    return text


def invalidate_learning_folder_document_context_cache(folder_name: str | None = None, user_id: str | None = None) -> None:
    """Optional: call after upload/delete."""
    with _cache_lock:
        if not folder_name and not user_id:
            _cache.clear()
            return
        uid = str(user_id or "").strip()
        fn = str(folder_name or "").strip()
        if uid and fn:
            _cache.pop(f"{uid}::{fn}", None)
        elif fn:
            for k in list(_cache.keys()):
                if k.endswith(f"::{fn}") or k.split("::", 1)[-1] == fn:
                    _cache.pop(k, None)
