"""
Batch API Routes

Endpoints:
  POST   /api/batch/files/generate-upload-url  — get signed GCS URL for PDF upload
  POST   /api/batch/files/complete-upload       — mark upload done, start processing
  GET    /api/batch/files                        — list user's batch files
  GET    /api/batch/files/{file_id}/status       — poll file processing status

  POST   /api/batch/jobs                         — create a new batch job
  GET    /api/batch/jobs                         — list user's batch jobs
  GET    /api/batch/jobs/{job_id}                — get job status (polls Gemini)
  GET    /api/batch/jobs/{job_id}/results        — get results (downloads from Gemini)
  DELETE /api/batch/jobs/{job_id}                — cancel a job
"""
from __future__ import annotations

import logging
import threading
import uuid

from fastapi import APIRouter, Header, HTTPException, Query
from typing import Optional

from app.schemas.batch_schemas import (
    BatchFileCompleteRequest,
    BatchFileInfo,
    BatchFileUploadRequest,
    BatchFileUploadResponse,
    BatchJobConfigResponse,
    BatchJobCreateRequest,
    BatchJobInfo,
    BatchJobResult,
    BatchJobResultsResponse,
    BatchSessionCreate,
    BatchSessionInfo,
)
from app.services import batch_service
from app.services.batch_document_processor import process_uploaded_file
from app.services.adapters import gcs
from app.core.config import get_settings

router = APIRouter(prefix="/api/batch", tags=["batch"])


# ── Session endpoints ──────────────────────────────────────────────────────────

@router.post("/sessions", response_model=BatchSessionInfo)
def create_session(
    body: BatchSessionCreate,
    x_user_id: Optional[str] = Header(None, alias="x-user-id"),
    authorization: Optional[str] = Header(None),
):
    user_id = _require_user(x_user_id, authorization)
    row = batch_service.create_session(user_id, body.name, body.description)
    return _session_row_to_schema(row)


@router.get("/sessions", response_model=list[BatchSessionInfo])
def list_sessions(
    x_user_id: Optional[str] = Header(None, alias="x-user-id"),
    authorization: Optional[str] = Header(None),
):
    user_id = _require_user(x_user_id, authorization)
    rows = batch_service.list_sessions(user_id)
    return [_session_row_to_schema(r) for r in rows]


@router.get("/sessions/{session_id}/jobs", response_model=list[BatchJobInfo])
def list_session_jobs(
    session_id: str,
    x_user_id: Optional[str] = Header(None, alias="x-user-id"),
    authorization: Optional[str] = Header(None),
):
    user_id = _require_user(x_user_id, authorization)
    sess = batch_service.get_session(session_id, user_id)
    if not sess:
        raise HTTPException(status_code=404, detail="Session not found")
    rows = batch_service.list_session_jobs(session_id, user_id)
    return [_job_row_to_schema(r) for r in rows]


@router.patch("/sessions/{session_id}", response_model=BatchSessionInfo)
def rename_session(
    session_id: str,
    body: BatchSessionCreate,
    x_user_id: Optional[str] = Header(None, alias="x-user-id"),
    authorization: Optional[str] = Header(None),
):
    user_id = _require_user(x_user_id, authorization)
    row = batch_service.rename_session(session_id, user_id, body.name)
    if not row:
        raise HTTPException(status_code=404, detail="Session not found")
    return _session_row_to_schema(row)


@router.delete("/sessions/{session_id}")
def delete_session(
    session_id: str,
    x_user_id: Optional[str] = Header(None, alias="x-user-id"),
    authorization: Optional[str] = Header(None),
):
    user_id = _require_user(x_user_id, authorization)
    ok = batch_service.delete_session(session_id, user_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"message": "Session deleted", "session_id": session_id}
logger = logging.getLogger("agentic_document_service.api.batch")

settings = get_settings()

# ── User ID resolution ────────────────────────────────────────────────────────

def _resolve_user_id(
    x_user_id: Optional[str],
    authorization: Optional[str],
) -> Optional[str]:
    if x_user_id:
        return x_user_id
    if not authorization:
        return None
    token = authorization.removeprefix("Bearer ").strip()
    if not token:
        return None
    try:
        import jwt as pyjwt  # type: ignore
        secret = settings.jwt_secret
        if secret:
            payload = pyjwt.decode(token, secret, algorithms=["HS256"])
        else:
            import base64, json as _json
            padded = token.split(".")[1] + "=="
            payload = _json.loads(base64.urlsafe_b64decode(padded))
        uid = payload.get("id") or payload.get("userId") or payload.get("user_id") or payload.get("sub")
        return str(uid) if uid is not None else None
    except Exception:
        return None


def _require_user(x_user_id: Optional[str], authorization: Optional[str]) -> str:
    uid = _resolve_user_id(x_user_id, authorization)
    if not uid:
        raise HTTPException(status_code=401, detail="Authentication required")
    return uid


# ── File upload endpoints ─────────────────────────────────────────────────────

@router.post("/files/generate-upload-url", response_model=BatchFileUploadResponse)
def generate_upload_url(
    body: BatchFileUploadRequest,
    x_user_id: Optional[str] = Header(None, alias="x-user-id"),
    authorization: Optional[str] = Header(None),
):
    """Generate a GCS signed URL for direct PDF upload from the browser."""
    user_id = _require_user(x_user_id, authorization)

    if not body.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported for batch processing")

    file_id = str(uuid.uuid4())
    gcs_path = f"batch-uploads/{user_id}/{file_id}/{body.filename}"

    try:
        upload_url = gcs.signed_upload_url(
            destination_path=gcs_path,
            content_type=body.content_type or "application/pdf",
            expiration_minutes=15,
            bucket_type="input",
        )
    except Exception as exc:
        logger.error("[BatchAPI] signed URL generation failed: %s", exc)
        raise HTTPException(status_code=500, detail=f"Could not generate upload URL: {exc}")

    bucket = settings.gcs_input_bucket_name or settings.gcs_bucket_name or "fileinputbucket"
    full_gcs_path = f"gs://{bucket}/{gcs_path}"

    # Pre-create the DB record so complete-upload can reference it
    batch_service.create_batch_upload_record(file_id, user_id, body.filename, full_gcs_path, 0)

    return BatchFileUploadResponse(
        file_id=file_id,
        upload_url=upload_url,
        gcs_path=full_gcs_path,
        expires_in_seconds=900,
    )


@router.post("/files/complete-upload")
def complete_upload(
    body: BatchFileCompleteRequest,
    x_user_id: Optional[str] = Header(None, alias="x-user-id"),
    authorization: Optional[str] = Header(None),
):
    """
    Called after the browser finishes the direct-to-GCS upload.
    Triggers background document processing (OCR if scanned, then Gemini Files API upload).
    """
    user_id = _require_user(x_user_id, authorization)

    file_row = batch_service.get_batch_file(body.file_id, user_id)
    if not file_row:
        raise HTTPException(status_code=404, detail="File record not found")

    # Update file size now that we know it
    from app.services.db import get_db_connection
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE batch_upload_files SET file_size_bytes = %s, updated_at = NOW() WHERE id = %s",
                [body.file_size_bytes, body.file_id],
            )
        conn.commit()

    # Start background processing
    t = threading.Thread(
        target=process_uploaded_file,
        args=(body.file_id, file_row["gcs_path"], body.filename),
        daemon=True,
    )
    t.start()
    logger.info("[BatchAPI] Started background processing for file_id=%s", body.file_id)

    return {"message": "File upload complete. Processing started.", "file_id": body.file_id}


@router.get("/files", response_model=list[BatchFileInfo])
def list_batch_files(
    x_user_id: Optional[str] = Header(None, alias="x-user-id"),
    authorization: Optional[str] = Header(None),
):
    user_id = _require_user(x_user_id, authorization)
    rows = batch_service.list_batch_files(user_id)
    return [
        BatchFileInfo(
            file_id=str(r["id"]),
            status=r.get("status", "unknown"),
            original_filename=r.get("original_filename", ""),
            is_scanned=bool(r.get("is_scanned", False)),
            page_count=r.get("page_count") or 0,
            file_size_bytes=r.get("file_size_bytes") or 0,
            gemini_file_name=r.get("gemini_file_name"),
            error_message=r.get("error_message"),
            created_at=r["created_at"],
            updated_at=r["updated_at"],
        )
        for r in rows
    ]


@router.get("/files/{file_id}/status", response_model=BatchFileInfo)
def get_file_status(
    file_id: str,
    x_user_id: Optional[str] = Header(None, alias="x-user-id"),
    authorization: Optional[str] = Header(None),
):
    user_id = _require_user(x_user_id, authorization)
    row = batch_service.get_batch_file(file_id, user_id)
    if not row:
        raise HTTPException(status_code=404, detail="File not found")
    return BatchFileInfo(
        file_id=str(row["id"]),
        status=row.get("status", "unknown"),
        original_filename=row.get("original_filename", ""),
        is_scanned=bool(row.get("is_scanned", False)),
        page_count=row.get("page_count") or 0,
        file_size_bytes=row.get("file_size_bytes") or 0,
        gemini_file_name=row.get("gemini_file_name"),
        error_message=row.get("error_message"),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


# ── Job endpoints ─────────────────────────────────────────────────────────────

@router.post("/jobs", response_model=BatchJobInfo)
def create_batch_job(
    body: BatchJobCreateRequest,
    x_user_id: Optional[str] = Header(None, alias="x-user-id"),
    authorization: Optional[str] = Header(None),
):
    """
    Submit a new batch job to the Gemini Batch API.
    Supports up to 200,000 queries, with optional document context.
    """
    user_id = _require_user(x_user_id, authorization)

    if not body.queries:
        raise HTTPException(status_code=400, detail="queries list must not be empty")

    # Validate file if provided
    if body.file_id:
        file_row = batch_service.get_batch_file(body.file_id, user_id)
        if not file_row:
            raise HTTPException(status_code=404, detail="Batch file not found")
        if file_row.get("status") != "ready":
            raise HTTPException(
                status_code=400,
                detail=f"File is not ready for use (current status: {file_row.get('status')}). Please wait for processing to complete.",
            )

    job_id = str(uuid.uuid4())
    try:
        result = batch_service.create_batch_job(
            job_id=job_id,
            user_id=user_id,
            display_name=body.display_name,
            queries=body.queries,
            model=body.model,
            system_instruction=body.system_instruction,
            batch_file_id=body.file_id,
            session_id=body.session_id,
        )
    except Exception as exc:
        logger.error("[BatchAPI] Batch job creation failed: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to create batch job: {exc}")

    job = batch_service.get_batch_job(job_id, user_id)
    if not job:
        raise HTTPException(status_code=500, detail="Job created but record not found")

    return _job_row_to_schema(job)


@router.get("/jobs", response_model=list[BatchJobInfo])
def list_batch_jobs(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    x_user_id: Optional[str] = Header(None, alias="x-user-id"),
    authorization: Optional[str] = Header(None),
):
    user_id = _require_user(x_user_id, authorization)
    rows = batch_service.list_batch_jobs(user_id, limit=limit, offset=offset)
    return [_job_row_to_schema(r) for r in rows]


@router.get("/jobs/{job_id}", response_model=BatchJobInfo)
def get_batch_job(
    job_id: str,
    x_user_id: Optional[str] = Header(None, alias="x-user-id"),
    authorization: Optional[str] = Header(None),
):
    user_id = _require_user(x_user_id, authorization)
    job = batch_service.get_batch_job(job_id, user_id)
    if not job:
        raise HTTPException(status_code=404, detail="Batch job not found")
    return _job_row_to_schema(job)


@router.get("/jobs/{job_id}/config", response_model=BatchJobConfigResponse)
def get_batch_job_config(
    job_id: str,
    x_user_id: Optional[str] = Header(None, alias="x-user-id"),
    authorization: Optional[str] = Header(None),
):
    """Return full reusable config for a job: queries, model, system_instruction, file info."""
    user_id = _require_user(x_user_id, authorization)
    data = batch_service.get_batch_job_config(job_id, user_id)
    if not data:
        raise HTTPException(status_code=404, detail="Batch job not found")
    return BatchJobConfigResponse(**{k: v for k, v in data.items() if k != "created_at"})


@router.get("/jobs/{job_id}/results", response_model=BatchJobResultsResponse)
def get_batch_job_results(
    job_id: str,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    text_limit: int = Query(0, ge=0, le=500_000, description="Max chars per query/response (0 = no limit)"),
    query_offset: int = Query(0, ge=0, description="Character offset into query text"),
    response_offset: int = Query(0, ge=0, description="Character offset into response text"),
    fields: str = Query("both", description="Which text fields to return: both, query, or response"),
    request_key: Optional[str] = Query(None, description="Return a single result by key"),
    include_text: bool = Query(True, description="When false, omit query/response text (metadata only)"),
    x_user_id: Optional[str] = Header(None, alias="x-user-id"),
    authorization: Optional[str] = Header(None),
):
    user_id = _require_user(x_user_id, authorization)
    data = batch_service.get_batch_job_results(
        job_id,
        user_id,
        limit=limit,
        offset=offset,
        text_limit=text_limit,
        request_key=request_key,
        include_text=include_text,
        query_offset=query_offset,
        response_offset=response_offset,
        fields=fields if fields in ("both", "query", "response") else "both",
    )
    if not data:
        raise HTTPException(status_code=404, detail="Batch job not found")
    return BatchJobResultsResponse(
        job_id=data["job_id"],
        display_name=data.get("display_name"),
        status=data["status"],
        model=data.get("model"),
        request_count=data.get("request_count", 0),
        total_count=data.get("total_count", 0),
        caching=data.get("caching", False),
        total_input_tokens=data.get("total_input_tokens", 0),
        total_output_tokens=data.get("total_output_tokens", 0),
        total_tokens=data.get("total_tokens", 0),
        results=[
            BatchJobResult(
                request_key=r.get("request_key", ""),
                query_text=r.get("query_text"),
                response_text=r.get("response_text"),
                status=r.get("status", "completed"),
                input_tokens=r.get("input_tokens", 0),
                output_tokens=r.get("output_tokens", 0),
                query_truncated=bool(r.get("query_truncated")),
                response_truncated=bool(r.get("response_truncated")),
                query_length=int(r.get("query_length") or 0),
                response_length=int(r.get("response_length") or 0),
            )
            for r in data.get("results", [])
        ],
    )


@router.delete("/jobs/{job_id}")
def cancel_batch_job(
    job_id: str,
    x_user_id: Optional[str] = Header(None, alias="x-user-id"),
    authorization: Optional[str] = Header(None),
):
    user_id = _require_user(x_user_id, authorization)
    ok = batch_service.cancel_batch_job(job_id, user_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Batch job not found")
    return {"message": "Job cancellation requested", "job_id": job_id}


# ── Schema helper ─────────────────────────────────────────────────────────────

def _session_row_to_schema(row: dict) -> BatchSessionInfo:
    return BatchSessionInfo(
        session_id=str(row["id"]),
        name=row["name"],
        description=row.get("description"),
        job_count=int(row.get("job_count") or 0),
        completed_count=int(row.get("completed_count") or 0),
        total_tokens=int(row.get("total_tokens") or 0),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _job_row_to_schema(row: dict) -> BatchJobInfo:
    # Resolve original filename from linked file (best-effort)
    original_filename = None
    if row.get("batch_file_id"):
        try:
            f = batch_service.get_batch_file(str(row["batch_file_id"]), row.get("user_id", ""))
            if f:
                original_filename = f.get("original_filename")
        except Exception:
            pass
    return BatchJobInfo(
        job_id=str(row["id"]),
        display_name=row.get("display_name"),
        status=row.get("status", "UNKNOWN"),
        request_count=row.get("request_count") or 0,
        model=row.get("model"),
        batch_file_id=str(row["batch_file_id"]) if row.get("batch_file_id") else None,
        original_filename=original_filename,
        session_id=str(row["session_id"]) if row.get("session_id") else None,
        gemini_job_name=row.get("gemini_job_name"),
        error_message=row.get("error_message"),
        total_input_tokens=int(row.get("total_input_tokens") or 0),
        total_output_tokens=int(row.get("total_output_tokens") or 0),
        total_tokens=int(row.get("total_tokens") or 0),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        completed_at=row.get("completed_at"),
    )
