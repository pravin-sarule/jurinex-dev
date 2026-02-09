"""
Ingestion agent API: direct ingest and orchestrate/upload.
POST /api/ingest — Direct ingestion (no orchestrator).
POST /api/orchestrate/upload — Orchestrator → Ingestion agent (GCS, Document AI, chunk, embed, DB).
"""

from __future__ import annotations

import base64
import logging
from typing import Any, Dict

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from api.deps import require_user_id
from api.orchestrator_helpers import get_orchestrator

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["Ingestion"])


@router.post("/ingest")
async def ingest_document(
    user_id: int = Depends(require_user_id),
    file: UploadFile = File(...),
    folder_path: str = Form(""),
) -> Dict[str, Any]:
    """
    Upload a document and run the ingestion pipeline only (no orchestrator).
    User-specific: user_id from JWT. GCS → Document AI (OCR) → chunk → embed → store in DB.
    **Body (form-data):** file (File), optional folder_path.
    """
    try:
        content = await file.read()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to read file: {e}") from e

    if not content:
        raise HTTPException(status_code=400, detail="File is empty")

    payload = {
        "user_id": str(user_id),
        "file_content": base64.b64encode(content).decode("utf-8"),
        "originalname": file.filename or "document",
        "mimetype": file.content_type or "application/pdf",
        "size": len(content),
        "folder_path": folder_path,
    }

    try:
        from agents.ingestion.agent import run_ingestion_agent
        result = run_ingestion_agent(payload)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e

    if result.get("error"):
        raise HTTPException(status_code=500, detail=result["error"])

    raw_text = result.get("raw_text", "")
    chunks = result.get("chunks", [])
    embeddings = result.get("embeddings", [])

    return {
        "success": True,
        "file_id": result.get("file_id"),
        "raw_text_length": len(raw_text),
        "raw_text_preview": raw_text[:500] + "..." if len(raw_text) > 500 else raw_text,
        "chunks_count": len(chunks),
        "embeddings_count": len(embeddings),
        "message": "Document uploaded to GCS, OCR via Document AI, chunked, embedded, and stored in DB.",
    }


@router.post("/orchestrate/upload")
async def orchestrate_upload(
    user_id: int = Depends(require_user_id),
    file: UploadFile = File(...),
    folder_path: str = Form(""),
    draft_id: str = Form(""),
    case_id: str = Form(""),
) -> Dict[str, Any]:
    """
    Upload a document; the orchestrator runs and triggers the Ingestion agent.
    User-specific: user_id from JWT. Optional draft_id/case_id link the file to a draft or case.
    **Body (form-data):** file (File), optional folder_path, draft_id, case_id.
    """
    try:
        content = await file.read()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to read file: {e}") from e

    if not content:
        raise HTTPException(status_code=400, detail="File is empty")

    upload_payload: Dict[str, Any] = {
        "user_id": str(user_id),
        "file_content": base64.b64encode(content).decode("utf-8"),
        "originalname": file.filename or "document",
        "mimetype": file.content_type or "application/pdf",
        "size": len(content),
        "folder_path": folder_path,
    }
    if draft_id and draft_id.strip():
        upload_payload["draft_id"] = draft_id.strip()
    if case_id and case_id.strip():
        upload_payload["case_id"] = case_id.strip()

    logger.info(
        "Orchestrate upload: file=%s, draft_id=%s, case_id=%s → Orchestrator → Ingestion",
        upload_payload.get("originalname", ""),
        upload_payload.get("draft_id") or "(none)",
        upload_payload.get("case_id") or "(none)",
    )

    try:
        orchestrator = get_orchestrator()
        result = orchestrator.run(user_input="upload document", upload_payload=upload_payload)
        logger.info("Orchestrator run completed. Agent tasks: %s", result.get("agent_tasks", []))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e

    state = result.get("state", {})
    final_document = result.get("final_document", "")
    agent_tasks = result.get("agent_tasks", [])
    file_id = state.get("file_id")

    # Link uploaded file to draft so Librarian only retrieves this draft's context
    draft_id_from_upload = upload_payload.get("draft_id")
    if draft_id_from_upload and file_id:
        try:
            from services import draft_db as draft_db_service
            draft_db_service.add_uploaded_file_id_to_draft(
                draft_id=draft_id_from_upload,
                user_id=user_id,
                file_id=file_id,
            )
            logger.info("Linked file_id=%s to draft_id=%s for draft-scoped retrieve", file_id, draft_id_from_upload)
        except Exception as e:
            logger.warning("Could not link file to draft: %s", e)

    if not final_document and state.get("chunks_count", 0) > 0:
        out: Dict[str, Any] = {
            "success": True,
            "ingestion_only": True,
            "file_id": file_id,
            "raw_text_length": len(state.get("raw_text") or ""),
            "chunks_count": state.get("chunks_count", 0),
            "embeddings_count": state.get("embeddings_count", 0),
            "state": state,
            "agent_tasks": agent_tasks,
            "message": "Orchestrator ran ingestion only: GCS → Document AI → chunk → embed → DB.",
        }
        if upload_payload.get("draft_id"):
            out["draft_id"] = upload_payload["draft_id"]
        if upload_payload.get("case_id"):
            out["case_id"] = upload_payload["case_id"]
        return out

    return {
        "success": True,
        "file_id": file_id,
        "final_document": final_document,
        "state": state,
        "agent_tasks": agent_tasks,
        "message": "Orchestrator pipeline completed.",
    }
