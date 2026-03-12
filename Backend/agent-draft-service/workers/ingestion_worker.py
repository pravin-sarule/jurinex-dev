"""
Ingestion worker: process one document per job (GCS → Document AI → chunk → embed → DB),
link file to draft, and optionally run InjectionAgent for field extraction.

Used by the in-process queue (services/ingestion_queue.py). No separate worker process or Redis.
"""

from __future__ import annotations

import logging
from typing import Any, Dict

logger = logging.getLogger(__name__)


def process_ingestion_job(payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    Process one ingestion job. Payload must include: user_id, file_content (base64), originalname,
    mimetype, size; optionally draft_id, case_id, template_id, folder_path.

    Returns dict with file_id, raw_text_length, chunks_count, embeddings_count, draft_id (if linked).
    On failure, raises; the in-process queue records the error in job state.
    """
    from agents.ingestion.agent import run_ingestion_agent

    user_id_raw = payload.get("user_id")
    if not user_id_raw:
        raise ValueError("payload.user_id is required")
    user_id = int(user_id_raw) if isinstance(user_id_raw, str) and user_id_raw.isdigit() else user_id_raw
    draft_id = (payload.get("draft_id") or "").strip() or None
    template_id = (payload.get("template_id") or "").strip() or None

    logger.info(
        "Ingestion worker: processing document originalname=%s draft_id=%s",
        payload.get("originalname", "document"),
        draft_id,
    )

    result = run_ingestion_agent(payload)
    error = result.get("error")
    if error:
        raise RuntimeError(f"Ingestion failed: {error}")

    file_id = result.get("file_id")
    raw_text = result.get("raw_text", "")
    chunks = result.get("chunks", [])
    embeddings = result.get("embeddings", [])

    out: Dict[str, Any] = {
        "file_id": file_id,
        "raw_text_length": len(raw_text),
        "chunks_count": len(chunks),
        "embeddings_count": len(embeddings),
    }
    if draft_id:
        out["draft_id"] = draft_id

    # Link file to draft so Librarian uses this document for this draft
    if draft_id and file_id:
        try:
            from services import draft_db as draft_db_service
            original_name = (payload.get("originalname") or "").strip() or None
            draft_db_service.add_uploaded_file_id_to_draft(
                draft_id=draft_id,
                user_id=user_id,
                file_id=file_id,
                file_name=original_name,
            )
            logger.info("Linked file_id=%s to draft_id=%s", file_id, draft_id)
        except Exception as e:
            logger.warning("Could not link file to draft: %s", e)
            # Non-fatal: ingestion succeeded, only linking failed
            out["link_error"] = str(e)

    # Best-effort InjectionAgent when template_id is provided
    if template_id and file_id:
        try:
            from agents.ingestion.injection_agent import run_injection_agent
            injection_payload = {
                "template_id": template_id,
                "user_id": user_id,
                "draft_session_id": draft_id,
                "source_document_id": file_id,
                "raw_text": raw_text if raw_text else None,
            }
            run_injection_agent(injection_payload)
            logger.info("InjectionAgent completed for file_id=%s", file_id)
        except Exception as e:
            logger.warning("InjectionAgent failed (non-blocking): %s", e)
            out["injection_error"] = str(e)

    return out
