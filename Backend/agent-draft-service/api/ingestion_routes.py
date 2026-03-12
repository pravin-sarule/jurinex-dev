"""
Ingestion agent API: direct ingest, orchestrate/upload, upload-multiple (queue), and field extraction.
POST /api/ingest — Direct ingestion (no orchestrator).
POST /api/orchestrate/upload — Orchestrator → Ingestion agent (single file).
POST /api/orchestrate/upload-multiple — Enqueue multiple files for worker processing (queue + worker).
GET /api/ingestion/jobs/{job_id} — Job status.
GET /api/ingestion/batches/{batch_id} — Batch status (query: job_ids=id1,id2,...).
POST /api/extract-fields — InjectionAgent: extract template fields from document text.
"""

from __future__ import annotations

import base64
import logging
from typing import Any, Dict, List, Optional

from pydantic import BaseModel

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile

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


# ---- Field Extraction (InjectionAgent) ------------------------------------

class ExtractFieldsRequest(BaseModel):
    """Request body for POST /api/extract-fields."""
    template_id: str
    draft_session_id: Optional[str] = None
    source_document_id: Optional[str] = None
    raw_text: Optional[str] = None


@router.post("/extract-fields")
async def extract_fields(
    body: ExtractFieldsRequest,
    user_id: int = Depends(require_user_id),
) -> Dict[str, Any]:
    """
    Trigger the InjectionAgent to extract template field values from a document.

    The agent reads the document text (from raw_text or source_document_id),
    extracts ONLY the fields allowed by the template schema, and upserts
    the values into template_user_field_values — never overwriting user-edited
    fields.

    **Returns** the standardized result contract:
    { status, reason, extracted_fields, skipped_fields, errors }
    """
    logger.info(
        "[API] POST /api/extract-fields: template_id=%s, user_id=%s, "
        "draft_session_id=%s, source_document_id=%s, raw_text_len=%s",
        body.template_id, user_id, body.draft_session_id,
        body.source_document_id, len(body.raw_text) if body.raw_text else 0,
    )

    try:
        from agents.ingestion.injection_agent import run_injection_agent

        payload = {
            "template_id": body.template_id,
            "user_id": user_id,
            "draft_session_id": body.draft_session_id,
            "source_document_id": body.source_document_id,
            "raw_text": body.raw_text,
        }
        result = run_injection_agent(payload)

    except Exception as e:
        logger.exception("[API] extract-fields failed unexpectedly")
        raise HTTPException(status_code=500, detail=str(e)) from e

    # Agent never raises on domain errors — it returns a terminated contract
    return result


# ---- Orchestrate Upload ---------------------------------------------------

@router.post("/orchestrate/upload")
async def orchestrate_upload(
    user_id: int = Depends(require_user_id),
    file: UploadFile = File(...),
    folder_path: str = Form(""),
    draft_id: str = Form(""),
    case_id: str = Form(""),
    template_id: str = Form(""),
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

    # --- Best-effort InjectionAgent: auto-extract fields if template_id given ---
    template_id_val = upload_payload.get("template_id") or (template_id.strip() if template_id else "")
    if template_id_val and file_id:
        try:
            from agents.ingestion.injection_agent import run_injection_agent

            raw_text = (state.get("raw_text") or "").strip()
            injection_payload = {
                "template_id": template_id_val,
                "user_id": user_id,
                "draft_session_id": draft_id_from_upload,
                "source_document_id": file_id,
                "raw_text": raw_text if raw_text else None,
            }
            injection_result = run_injection_agent(injection_payload)
            logger.info(
                "InjectionAgent completed: status=%s, extracted=%d fields",
                injection_result.get("status"),
                len(injection_result.get("extracted_fields") or {}),
            )
        except Exception as e:
            # Best-effort: failure must NOT block the upload
            logger.warning("InjectionAgent failed (non-blocking): %s", e)

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


# ---- Multi-document upload (queue + worker) ------------------------------------

@router.post("/orchestrate/upload-multiple")
async def orchestrate_upload_multiple(
    user_id: int = Depends(require_user_id),
    files: List[UploadFile] = File(..., description="One or more documents to ingest for the draft"),
    folder_path: str = Form(""),
    draft_id: str = Form(""),
    case_id: str = Form(""),
    template_id: str = Form(""),
) -> Dict[str, Any]:
    """
    Upload N documents for a draft. Creates 1 Draft Job (parent) and N Document Jobs (queue).
    Parallel workers process each document: OCR → chunking → embeddings → store chunks.
    When ALL document jobs complete, the draft job is marked COMPLETE. Then draft generation
    can retrieve ALL chunks across ALL docs and generate the final draft.

    **Body (form-data):** files (multiple File), optional folder_path, draft_id, case_id, template_id.
    **Returns:** draft_job_id, job_ids[]; poll GET /api/ingestion/draft-jobs/{draft_job_id} for status.
    """
    from services.ingestion_queue import enqueue_draft_job

    if not files:
        raise HTTPException(status_code=400, detail="At least one file is required")

    draft_id_val = (draft_id or "").strip()
    if not draft_id_val:
        raise HTTPException(status_code=400, detail="draft_id is required for multi-document upload")

    payloads: List[Dict[str, Any]] = []
    for file in files:
        try:
            content = await file.read()
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Failed to read file {file.filename or '?'}: {e}") from e
        if not content:
            continue
        upload_payload: Dict[str, Any] = {
            "user_id": str(user_id),
            "file_content": base64.b64encode(content).decode("utf-8"),
            "originalname": file.filename or "document",
            "mimetype": file.content_type or "application/pdf",
            "size": len(content),
            "folder_path": folder_path,
        }
        upload_payload["draft_id"] = draft_id_val
        if case_id and case_id.strip():
            upload_payload["case_id"] = case_id.strip()
        if template_id and template_id.strip():
            upload_payload["template_id"] = template_id.strip()
        payloads.append(upload_payload)

    if not payloads:
        raise HTTPException(status_code=400, detail="No valid file content to upload")

    try:
        result = enqueue_draft_job(
            draft_id=draft_id_val,
            user_id=user_id,
            payloads=payloads,
            template_id=template_id.strip() if template_id and template_id.strip() else None,
        )
    except Exception as e:
        logger.exception("Failed to enqueue draft job for draft_id=%s", draft_id_val)
        raise HTTPException(status_code=500, detail=str(e)) from e

    draft_job_id = result["draft_job_id"]
    job_ids = result["job_ids"]
    logger.info(
        "Upload-multiple: draft_job_id=%s, draft_id=%s, %s document job(s) enqueued (parallel workers)",
        draft_job_id,
        draft_id_val,
        len(job_ids),
    )

    return {
        "success": True,
        "draft_job_id": draft_job_id,
        "batch_id": draft_job_id,
        "job_ids": job_ids,
        "total": len(job_ids),
        "draft_id": draft_id_val,
        "message": "Draft job created. N document jobs queued for parallel processing (OCR → chunk → embed → store). Poll GET /api/ingestion/draft-jobs/{draft_job_id} until status is complete. Then all chunks are available for draft generation.",
    }


@router.get("/ingestion/jobs/{job_id}")
async def get_ingestion_job_status(job_id: str) -> Dict[str, Any]:
    """Return status of a single ingestion job (queued, started, finished, failed)."""
    from services.ingestion_queue import get_job_status
    return get_job_status(job_id)


@router.get("/ingestion/draft-jobs/{draft_job_id}")
async def get_draft_job_status(draft_job_id: str) -> Dict[str, Any]:
    """Return draft job status (parent). When status is 'complete', all document jobs are done and chunks are ready for draft generation."""
    from services.ingestion_queue import get_draft_job_status as get_draft_job
    return get_draft_job(draft_job_id)


@router.get("/ingestion/batches/{batch_id}")
async def get_ingestion_batch_status(
    batch_id: str,
    job_ids: Optional[str] = Query(None, description="Optional comma-separated job IDs (batch_id is draft_job_id; job_ids can be omitted)"),
) -> Dict[str, Any]:
    """Return draft job / batch status. batch_id is the draft_job_id; job_ids optional (stored on draft job)."""
    from services.ingestion_queue import get_draft_job_status, get_batch_status_for_job_ids
    if job_ids:
        ids = [j.strip() for j in job_ids.split(",") if j.strip()]
        if ids:
            return get_batch_status_for_job_ids(batch_id, ids)
    return get_draft_job_status(batch_id)
