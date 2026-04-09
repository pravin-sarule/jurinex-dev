from __future__ import annotations

import base64
import json
import logging
import time
import uuid

from pathlib import PurePosixPath
from typing import Any, AsyncGenerator

from fastapi import APIRouter, Body, File, Header, HTTPException, Query, Request, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from agents.legal_case_management.agent import (
    answer_case_folder_chat,
    create_case_folder,
    create_case_with_folder,
    delete_case_tool,
    enqueue_case_documents,
    extract_case_fields_from_case_folder,
    get_case_detail,
    list_documents_in_case_folder,
    get_case_processing_status,
    list_case_folders,
    list_cases_tool,
    update_case_tool,
)
from app.schemas.contracts import DocumentReference, FolderChatRequest
from app.core.config import get_settings
from app.services.container import get_folder_service
from app.services.adapters import gcs
from app.services.adapters import google_drive_tool
from app.services.db import get_db_connection, is_db_available
from app.services.llm_chat_config import (
    get_llm_chat_config,
    get_request_upload_ceiling_mb,
    get_streaming_delay_ms,
    merge_folder_chat_request_llm_overrides,
)
from app.services.legal_system_prompt import build_document_qa_system_prompt, build_legal_system_prompt, fetch_full_profile
from app.services.llm_policy_service import assert_upload_allowed
from app.services.secret_manager_api import get_secret_prompt_detail, list_secret_prompts
from app.services.secret_prompt_display import resolve_query_and_display
from app.services.token_usage import (
    enforce_limits,
    estimate_streaming_token_request,
    estimate_tokens_from_text,
    log_llm_usage,
)


router = APIRouter(prefix="/api/files", tags=["files"])
logger = logging.getLogger("agentic_document_service.api.files")


def _split_text_for_sse_stream(text: str, *, max_chunk_chars: int = 48) -> list[str]:
    """Break long model output into small SSE chunks so the UI can render incrementally."""
    text = text or ""
    if not text:
        return []
    chunks: list[str] = []
    for para in text.split("\n"):
        if para == "":
            chunks.append("\n")
            continue
        current: list[str] = []
        size = 0
        for word in para.split():
            add = len(word) + (1 if current else 0)
            if current and size + add > max_chunk_chars:
                chunks.append(" ".join(current) + " ")
                current = [word]
                size = len(word)
            else:
                current.append(word)
                size += add
        if current:
            chunks.append(" ".join(current) + "\n")
    return chunks if chunks else [text]


def _gemini_chunk_text(chunk: Any) -> str:
    raw = getattr(chunk, "text", None)
    if raw is not None and str(raw).strip() != "":
        return str(raw)
    return ""


async def _yield_text_as_streaming_chunks(
    sse_fn,
    text: str,
    *,
    delay_ms: int,
) -> AsyncGenerator[str, None]:
    """Emit type=chunk SSE events; optional delay between chunks from summarization_chat_config."""
    import asyncio

    for piece in _split_text_for_sse_stream(text):
        if piece:
            yield sse_fn({"type": "chunk", "text": piece})
        if delay_ms > 0:
            await asyncio.sleep(delay_ms / 1000.0)


@router.post("/internal/analytics/users")
def get_internal_user_analytics(body: InternalAnalyticsRequest) -> dict[str, Any]:
    normalized_user_ids = _normalize_internal_user_ids(body.userIds)
    req_id = uuid.uuid4().hex[:8]
    started_at = time.perf_counter()
    logger.info(
        "[InternalAnalytics][%s] START users=%s range=%s..%s",
        req_id,
        body.userIds,
        body.startDate,
        body.endDate,
    )
    if not normalized_user_ids:
        logger.info("[InternalAnalytics][%s] DONE users=0 rows=0 elapsed_ms=0", req_id)
        return {"success": True, "data": {}}

    analytics_map = _get_internal_user_analytics_map(
        normalized_user_ids,
        start_date=body.startDate,
        end_date=body.endDate,
        req_id=req_id,
    )
    elapsed_ms = int((time.perf_counter() - started_at) * 1000)
    logger.info(
        "[InternalAnalytics][%s] DONE users=%s rows=%s elapsed_ms=%s",
        req_id,
        len(normalized_user_ids),
        len(analytics_map),
        elapsed_ms,
    )
    return {"success": True, "data": analytics_map}


@router.get("/secrets")
def list_secrets_endpoint(fetch: str | None = Query(None)) -> list[dict[str, Any]]:
    """List secret prompts from `secret_manager` (+ optional GCP values when fetch=true)."""
    try:
        return list_secret_prompts(fetch=fetch)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("[secrets] list failed: %s", exc)
        raise HTTPException(
            status_code=500,
            detail="Failed to fetch secrets: " + str(exc),
        ) from exc


@router.get("/secrets/{secret_id}")
def get_secret_by_id_endpoint(secret_id: str) -> dict[str, Any]:
    """Return one secret’s metadata + value from GCP (same contract as legacy document-service)."""
    try:
        body = get_secret_prompt_detail(secret_id)
        if body is None:
            raise HTTPException(status_code=404, detail="❌ Secret config not found in DB")
        return body
    except HTTPException:
        raise
    except RuntimeError as exc:
        raise HTTPException(
            status_code=500,
            detail="Internal Server Error: " + str(exc),
        ) from exc


class CreateFolderRequest(BaseModel):
    folderName: str
    parentPath: str = ""

class GenerateUploadUrlRequest(BaseModel):
    filename: str
    mimetype: str = "application/octet-stream"
    size: int = 0

class CompleteUploadRequest(BaseModel):
    gcsPath: str
    filename: str
    mimetype: str = "application/octet-stream"
    size: int = 0


class DriveImportRequest(BaseModel):
    file_ids: list[str]

class InternalAnalyticsRequest(BaseModel):
    userIds: list[int | str] = []
    startDate: str | None = None
    endDate: str | None = None


def _user_id_as_int(user_id: str | None) -> int | None:
    """Numeric user id for payment-service token caps (mirrors Node userId)."""
    if not user_id or user_id == "anonymous":
        return None
    try:
        return int(user_id)
    except (TypeError, ValueError):
        return None


def _resolve_user_id(x_user_id: str | None, authorization: str | None) -> str | None:
    if x_user_id:
        return x_user_id
    if not authorization or not authorization.lower().startswith("bearer "):
        return None
    token = authorization.split(" ", 1)[1].strip()
    try:
        parts = token.split(".")
        if len(parts) != 3:
            return None
        payload = parts[1]
        payload += "=" * ((4 - len(payload) % 4) % 4)
        decoded = json.loads(base64.urlsafe_b64decode(payload.encode("utf-8")).decode("utf-8"))
        user_id = decoded.get("id") or decoded.get("userId") or decoded.get("user_id") or decoded.get("sub")
        return str(user_id) if user_id is not None else None
    except Exception:
        return None


def _normalize_internal_user_ids(values: list[int | str] | None) -> list[str]:
    normalized: list[str] = []
    seen: set[str] = set()
    for value in values or []:
        text = str(value).strip()
        if text and text not in seen:
            seen.add(text)
            normalized.append(text)
    return normalized


def _get_internal_user_analytics_map(
    normalized_user_ids: list[str],
    *,
    start_date: str | None = None,
    end_date: str | None = None,
    req_id: str = "na",
) -> dict[str, dict[str, Any]]:
    logger.info(
        "[InternalAnalytics][%s] PHASE=prepare normalized_user_ids=%s",
        req_id,
        normalized_user_ids,
    )
    analytics_map: dict[str, dict[str, Any]] = {
        user_id: {
            "documentsUploadedCount": 0,
            "uploadedBytes": 0,
            "latestUploadAt": None,
            "casesCreatedCount": 0,
            "assignedCasesCount": 0,
            "createdCases": [],
        }
        for user_id in normalized_user_ids
    }
    if not normalized_user_ids:
        logger.info("[InternalAnalytics][%s] PHASE=prepare empty_user_list", req_id)
        return analytics_map

    filters: list[str] = []
    params: list[Any] = [normalized_user_ids]
    if start_date:
        filters.append("c.created_at >= %s")
        params.append(start_date)
    if end_date:
        filters.append("c.created_at <= %s")
        params.append(end_date)
    created_filter = f" AND {' AND '.join(filters)}" if filters else ""

    logger.info(
        "[InternalAnalytics][%s] PHASE=query-build filters=%s",
        req_id,
        filters,
    )

    created_sql = f"""
        WITH created_cases AS (
          SELECT
            c.id::text AS case_id,
            c.user_id::text AS user_id,
            c.case_title,
            c.status,
            c.created_at,
            folder.originalname AS folder_name,
            folder.folder_path AS parent_folder_path,
            folder.gcs_path AS case_folder_gcs_path,
            CASE
              WHEN folder.id IS NULL THEN NULL
              WHEN COALESCE(folder.folder_path, '') = '' THEN folder.originalname
              WHEN RIGHT(folder.folder_path, LENGTH(folder.originalname)) = folder.originalname THEN folder.folder_path
              ELSE folder.folder_path || '/' || folder.originalname
            END AS case_folder_path
          FROM cases c
          LEFT JOIN user_files folder
            ON folder.id = c.folder_id
           AND folder.is_folder = TRUE
          WHERE c.user_id::text = ANY(%s::text[])
            {created_filter}
        ),
        created_case_docs AS (
          SELECT
            cc.user_id,
            cc.case_id,
            cc.case_title,
            cc.status,
            cc.created_at,
            cc.case_folder_path,
            cc.case_folder_gcs_path,
            COALESCE(case_docs.document_count, 0) AS document_count,
            COALESCE(case_docs.uploaded_bytes, 0) AS uploaded_bytes,
            case_docs.latest_upload_at
          FROM created_cases cc
          LEFT JOIN LATERAL (
            SELECT
              COUNT(*) AS document_count,
              COALESCE(SUM(uf.size), 0) AS uploaded_bytes,
              MAX(uf.created_at) AS latest_upload_at
            FROM user_files uf
            WHERE uf.is_folder = FALSE
              AND (
                (
                  cc.case_folder_gcs_path IS NOT NULL
                  AND uf.gcs_path LIKE cc.case_folder_gcs_path || '%%'
                )
                OR (
                  cc.case_folder_path IS NOT NULL
                  AND (
                    uf.folder_path = cc.case_folder_path
                    OR uf.folder_path LIKE cc.case_folder_path || '/%%'
                  )
                )
              )
          ) AS case_docs ON TRUE
        )
        SELECT
          user_id,
          COUNT(*) AS cases_created_count,
          COALESCE(SUM(document_count), 0) AS document_count,
          COALESCE(SUM(uploaded_bytes), 0) AS uploaded_bytes,
          MAX(latest_upload_at) AS latest_upload_at,
          COALESCE(
            JSON_AGG(
              JSON_BUILD_OBJECT(
                'caseId', case_id,
                'caseTitle', case_title,
                'status', status,
                'createdAt', created_at,
                'caseFolderPath', case_folder_path,
                'caseFolderGcsPath', case_folder_gcs_path,
                'documentsCount', document_count,
                'uploadedBytes', uploaded_bytes,
                'latestUploadAt', latest_upload_at
              )
              ORDER BY created_at DESC
            ),
            '[]'::json
          ) AS created_cases
        FROM created_case_docs
        GROUP BY user_id
    """
    assigned_sql = """
        SELECT
          user_id::text AS user_id,
          COUNT(*) AS assigned_cases_count
        FROM case_assignments
        WHERE user_id::text = ANY(%s::text[])
        GROUP BY user_id::text
    """

    with get_db_connection() as conn:
        try:
            created_result = conn.execute(created_sql, tuple(params)).fetchall()
            logger.info(
                "[InternalAnalytics][%s] PHASE=query-created-cases rows=%s",
                req_id,
                len(created_result),
            )
        except Exception as exc:
            logger.exception(
                "[InternalAnalytics][%s] PHASE=query-created-cases ERROR users=%s start=%s end=%s error=%s",
                req_id,
                normalized_user_ids,
                start_date,
                end_date,
                exc,
            )
            raise

        try:
            assigned_result = conn.execute(assigned_sql, (normalized_user_ids,)).fetchall()
        except Exception as exc:
            logger.warning(
                "[InternalAnalytics][%s] PHASE=query-assigned-cases WARN users=%s error=%s",
                req_id,
                normalized_user_ids,
                exc,
            )
            assigned_result = []

    logger.info(
        "[InternalAnalytics][%s] PHASE=query-merged created_rows=%s assigned_rows=%s",
        req_id,
        len(created_result),
        len(assigned_result),
    )

    for row in created_result:
        uid = str(row.get("user_id"))
        analytics_map[uid] = {
            **(analytics_map.get(uid) or {}),
            "documentsUploadedCount": int(row.get("document_count") or 0),
            "uploadedBytes": int(row.get("uploaded_bytes") or 0),
            "latestUploadAt": row.get("latest_upload_at"),
            "casesCreatedCount": int(row.get("cases_created_count") or 0),
            "createdCases": row.get("created_cases") if isinstance(row.get("created_cases"), list) else [],
        }
    for row in assigned_result:
        uid = str(row.get("user_id"))
        analytics_map[uid] = {
            **(analytics_map.get(uid) or {}),
            "assignedCasesCount": int(row.get("assigned_cases_count") or 0),
        }

    logger.info(
        "[InternalAnalytics][%s] PHASE=assemble users_in_map=%s",
        req_id,
        list(analytics_map.keys()),
    )
    return analytics_map


def _read_inline_text(file_bytes: bytes, upload: UploadFile) -> str | None:
    mime_type = upload.content_type or "application/octet-stream"

    # Audio files must return None so the pipeline downloads from GCS and
    # calls Speech-to-Text instead of treating the filename as document text.
    from app.services.adapters.speech_to_text import is_audio_mime, is_audio_filename
    if is_audio_mime(mime_type) or is_audio_filename(upload.filename or ""):
        return None

    # IMPORTANT: PDF must go through Document AI OCR in the processing pipeline.
    # Returning inline text here would bypass OCR and skip Document AI.
    if mime_type == "application/pdf" or (upload.filename or "").lower().endswith(".pdf"):
        return None

    if mime_type.startswith("text/") or mime_type in {
        "application/json",
        "application/xml",
        "application/javascript",
    }:
        return file_bytes.decode("utf-8", errors="ignore")
    return None


def _build_gcs_object_path(user_id: str, folder_name: str, filename: str) -> str:
    safe_name = (filename or f"upload-{uuid.uuid4().hex[:8]}").replace("\\", "_").replace("/", "_").replace(" ", "_")
    return str(PurePosixPath(user_id) / "documents" / folder_name / f"{uuid.uuid4().hex[:10]}_{safe_name}")


def _normalize_gs_uri_from_record(gcs_path: str | None) -> str | None:
    import re as _re
    raw = str(gcs_path or "").strip()
    if not raw:
        return None

    # Strip gs://bucket/ prefix to work on the object path only
    settings = get_settings()
    bucket_name = settings.gcs_input_bucket_name or settings.gcs_bucket_name or "fileinputbucket"
    if raw.startswith("gs://"):
        object_path = raw[len(f"gs://{bucket_name}/"):]
    else:
        object_path = raw.lstrip("/")

    # Heal doubled prefix: "{uid}/documents/{uid}/cases/{rest}"
    # → "{uid}/documents/{rest}"
    fixed = _re.sub(
        r"^(\d+/documents/)\d+/cases/",
        r"\1",
        object_path,
    )
    # Also heal "{uid}/documents/{uid}/documents/{rest}" → "{uid}/documents/{rest}"
    fixed = _re.sub(
        r"^(\d+/documents/)\d+/documents/",
        r"\1",
        fixed,
    )

    return f"gs://{bucket_name}/{fixed}"


def _get_file_record_for_user(file_id: str, user_id: str) -> dict[str, Any] | None:
    if not is_db_available():
        return None
    accessible_user_ids = get_folder_service()._get_accessible_user_ids(user_id)
    if not accessible_user_ids:
        return None
    with get_db_connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, user_id, originalname, mimetype, size, gcs_path, status, created_at
            FROM user_files
            WHERE id::text = %s
              AND is_folder = false
              AND user_id::text = ANY(%s::text[])
            LIMIT 1
            """,
            [str(file_id), accessible_user_ids],
        )
        return cur.fetchone()


def _get_file_processing_status_payload(file_id: str, user_id: str) -> dict[str, Any] | None:
    """
    Build the same shape the legacy document-service GET /files/status/:file_id returns
    (used by AnalysisPage polling and document preview).
    """
    if not is_db_available():
        return None
    accessible = get_folder_service()._get_accessible_user_ids(user_id)
    if not accessible:
        return None
    fid = str(file_id).strip()
    if not fid:
        return None
    try:
        with get_db_connection() as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, user_id, originalname, mimetype, size, gcs_path, status,
                       processing_progress, current_operation, summary, updated_at, processed_at,
                       full_text_content
                FROM user_files
                WHERE id::text = %s
                  AND COALESCE(is_folder, false) = false
                  AND user_id::text = ANY(%s::text[])
                LIMIT 1
                """,
                (fid, accessible),
            )
            row = cur.fetchone()
            if not row:
                return None
            chunk_count = 0
            try:
                cur.execute(
                    "SELECT COUNT(*)::int AS c FROM file_chunks WHERE file_id::text = %s",
                    (fid,),
                )
                cr = cur.fetchone()
                if cr:
                    chunk_count = int(cr.get("c") or 0)
            except Exception:
                pass
    except Exception as exc:
        logger.warning("[files.status] file_id=%s lookup error: %s", fid, exc)
        return None

    st = str(row.get("status") or "unknown")
    prog = float(row.get("processing_progress") or 0)
    updated = row.get("updated_at")
    last_updated = updated.isoformat() if hasattr(updated, "isoformat") else str(updated or "")
    proc_at = row.get("processed_at")
    processed_at = proc_at.isoformat() if proc_at is not None and hasattr(proc_at, "isoformat") else proc_at

    out: dict[str, Any] = {
        "document_id": str(row.get("id") or fid),
        "filename": row.get("originalname") or "",
        "status": st,
        "processing_progress": prog,
        "current_operation": str(row.get("current_operation") or ""),
        "chunk_count": chunk_count,
        "last_updated": last_updated,
        "summary": row.get("summary"),
        "processed_at": processed_at,
        "mime_type": row.get("mimetype") or "",
        "file_size": int(row.get("size") or 0),
        "job_error": None,
        "job_status": "unknown",
        "embeddings_generated": 0,
        "embeddings_total": 0,
        "chunks_saved": chunk_count,
        "estimated_pages": None,
        "chunking_method": None,
    }
    ftc = row.get("full_text_content")
    if ftc:
        out["full_text_content"] = ftc
    return out


async def _upload_to_gcs_and_build_document(user_id: str, folder_name: str, upload: UploadFile) -> DocumentReference:
    file_bytes = await upload.read()
    mimetype = upload.content_type or "application/octet-stream"
    filename = upload.filename or f"upload-{uuid.uuid4().hex[:8]}"
    gcs_path = _build_gcs_object_path(user_id, folder_name, filename)
    gs_uri = gcs.upload_bytes(file_bytes, gcs_path, mimetype, bucket_type="input")
    inline_text = _read_inline_text(file_bytes, upload)
    return DocumentReference(
        document_name=filename,
        mime_type=mimetype,
        document_uri=gs_uri,
        inline_text=inline_text,
        metadata={
            "size": len(file_bytes),
            "original_name": filename,
            "gcs_path": gs_uri,
        },
    )


def _upload_drive_bytes_and_build_document(
    user_id: str,
    folder_name: str,
    *,
    filename: str,
    mime_type: str,
    data: bytes,
    source_file_id: str,
) -> DocumentReference:
    gcs_path = _build_gcs_object_path(user_id, folder_name, filename)
    gs_uri = gcs.upload_bytes(data, gcs_path, mime_type, bucket_type="input")
    return DocumentReference(
        document_name=filename,
        mime_type=mime_type or "application/octet-stream",
        document_uri=gs_uri,
        inline_text=None,
        metadata={
            "size": len(data),
            "original_name": filename,
            "gcs_path": gs_uri,
            "source": "google_drive",
            "google_drive_file_id": source_file_id,
        },
    )


@router.get("/chat-sessions")
async def get_analysis_chat_sessions(
    page: int = 1,
    limit: int = 20,
    x_user_id: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict:
    """Return paginated analysis chat sessions (chat_type = 'analysis') for the current user."""
    user_id = _resolve_user_id(x_user_id, authorization)
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")

    if not is_db_available():
        raise HTTPException(status_code=503, detail="Database not configured")

    offset = (page - 1) * limit
    with get_db_connection() as conn:
        rows = conn.execute(
            """
            SELECT id, user_id, question, answer, used_chunk_ids, created_at,
                   session_id, file_id, used_secret_prompt, prompt_label, chat_history
            FROM file_chats
            WHERE user_id = %s AND (chat_type = 'analysis' OR (chat_type IS NULL AND file_id IS NOT NULL))
            ORDER BY created_at DESC
            LIMIT %s OFFSET %s
            """,
            (user_id, limit, offset),
        ).fetchall()

    return [dict(r) for r in rows]


@router.get("/file/{file_id}/view")
async def view_file(
    file_id: str,
    page: int | None = None,
    x_user_id: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    user_id = _resolve_user_id(x_user_id, authorization)
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")

    record = _get_file_record_for_user(file_id, user_id)
    if not record:
        raise HTTPException(status_code=404, detail="Document not found")

    gs_uri = _normalize_gs_uri_from_record(record.get("gcs_path"))
    if not gs_uri:
        raise HTTPException(status_code=404, detail="Document storage path is missing")

    try:
        signed_url = gcs.signed_read_url(gs_uri, expiration_minutes=60)
    except Exception as exc:
        logger.exception("[Route:view_file] file_id=%s failed to sign read URL: %s", file_id, exc)
        raise HTTPException(status_code=500, detail="Could not generate document view URL") from exc

    page_number = max(1, int(page or 1))
    return {
        "success": True,
        "document": {
            "id": str(record.get("id") or file_id),
            "name": record.get("originalname") or "document",
            "mimetype": record.get("mimetype") or "application/octet-stream",
            "size": int(record.get("size") or 0),
            "status": record.get("status") or "",
        },
        "signedUrl": signed_url,
        "viewUrl": signed_url,
        "viewUrlWithPage": f"{signed_url}#page={page_number}",
        "page": page_number,
    }


@router.get("/llm-limits")
async def get_llm_limits_for_client(
    x_user_id: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    """Upload caps from `summarization_chat_config` (same source as assert_upload_allowed)."""
    user_id = _resolve_user_id(x_user_id, authorization)
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required")
    cfg = get_llm_chat_config()
    ceiling = get_request_upload_ceiling_mb(cfg)
    return {
        "success": True,
        "data": {
            "max_file_size_mb": cfg.get("max_file_size_mb"),
            "max_document_size_mb": cfg.get("max_document_size_mb"),
            "max_upload_mb": ceiling,
            "max_upload_bytes": int(ceiling * 1024 * 1024),
            "max_upload_files": cfg.get("max_upload_files"),
            "max_file_upload_per_day": cfg.get("max_file_upload_per_day"),
            "max_document_pages": cfg.get("max_document_pages"),
        },
    }


@router.get("/user-usage-and-plan/{user_id}")
def get_user_usage_and_plan_for_payment(
    user_id: int,
    x_user_id: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    """
    Backward-compatible contract for payment-service:
    GET /api/files/user-usage-and-plan/:userId
    """
    actor_user_id = _resolve_user_id(x_user_id, authorization)
    logger.info(
        "[Route:user_usage_and_plan] request received actor_user_id=%s target_user_id=%s has_auth=%s",
        actor_user_id,
        user_id,
        bool(authorization),
    )

    usage = {
        "user_id": user_id,
        "tokens_used": 0,
        "documents_used": 0,
        "ai_analysis_used": 0,
        "storage_used_gb": 0,
        "carry_over_tokens": 0,
    }
    plan = {
        "name": "Unlimited",
        "type": "firm",
        "token_limit": 999999999,
        "document_limit": 999999,
        "ai_analysis_limit": 999999,
        "storage_limit_gb": 100,
        "token_renew_interval_hours": 24,
    }
    logger.info(
        "[Route:user_usage_and_plan] response sent actor_user_id=%s target_user_id=%s tokens_used=%s documents_used=%s",
        actor_user_id,
        user_id,
        usage["tokens_used"],
        usage["documents_used"],
    )
    return {"success": True, "data": {"usage": usage, "plan": plan, "timeLeft": 0}}


@router.get("/queue/status")
async def get_queue_status(
    x_user_id: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    """Return current document processing queue depth and worker stats."""
    user_id = _resolve_user_id(x_user_id, authorization)
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required")
    return {
        "success": True,
        "queue": get_folder_service().get_queue_status(),
    }


@router.get("/status/{file_id}")
async def get_file_processing_status(
    file_id: str,
    x_user_id: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    """
    Per-file processing status (parity with legacy document-service GET /files/status/:file_id).

    The analysis UI polls this for progress; document preview also depends on a successful status
    lookup for the same file id in user_files.
    """
    user_id = _resolve_user_id(x_user_id, authorization)
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required")
    payload = _get_file_processing_status_payload(file_id, user_id)
    if not payload:
        raise HTTPException(status_code=404, detail="Document not found")
    logger.info(
        "[Route:file_status] file_id=%s user_id=%s status=%s progress=%s",
        file_id,
        user_id,
        payload.get("status"),
        payload.get("processing_progress"),
    )
    return payload


@router.post("/upload-for-processing")
async def upload_for_processing(
    files: list[UploadFile] = File(...),
    x_user_id: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict:
    user_id = _resolve_user_id(x_user_id, authorization) or "anonymous"
    llm_config = get_llm_chat_config()
    # Keep temp folder style aligned with document-service uploadForProcessing flow.
    folder_name = f"temp-{uuid.uuid4().hex[:12]}"
    logger.info(
        "[Route:upload_for_processing] status=received user_id=%s folder=%s files=%s",
        user_id,
        folder_name,
        len(files),
    )
    documents: list[DocumentReference] = []
    for upload in files:
        file_bytes = await upload.read()
        upload.file.seek(0)
        check = assert_upload_allowed(
            user_id,
            llm_config,
            files_count=len(files),
            size_bytes=len(file_bytes),
            buffer=file_bytes,
            mimetype=upload.content_type,
            originalname=upload.filename,
        )
        if not check.get("ok"):
            raise HTTPException(status_code=429, detail=check)
        documents.append(await _upload_to_gcs_and_build_document(user_id, folder_name, upload))
    return enqueue_case_documents(
        user_id=user_id,
        folder_name=folder_name,
        documents=[document.model_dump(mode="json") for document in documents],
    )


@router.post("/{folder_name}/upload")
async def upload_documents_to_folder(
    folder_name: str,
    files: list[UploadFile] = File(...),
    x_user_id: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict:
    user_id = _resolve_user_id(x_user_id, authorization) or "anonymous"
    llm_config = get_llm_chat_config()
    logger.info(
        "[Route:upload_documents_to_folder] status=received user_id=%s folder=%s files=%s",
        user_id,
        folder_name,
        len(files),
    )
    documents: list[DocumentReference] = []
    for upload in files:
        file_bytes = await upload.read()
        upload.file.seek(0)
        check = assert_upload_allowed(
            user_id,
            llm_config,
            files_count=len(files),
            size_bytes=len(file_bytes),
            buffer=file_bytes,
            mimetype=upload.content_type,
            originalname=upload.filename,
        )
        if not check.get("ok"):
            raise HTTPException(status_code=429, detail=check)
        documents.append(await _upload_to_gcs_and_build_document(user_id, folder_name, upload))
    return enqueue_case_documents(
        user_id=user_id,
        folder_name=folder_name,
        documents=[document.model_dump(mode="json") for document in documents],
    )


@router.post("/{folder_name}/google-drive/import")
def import_google_drive_documents(
    folder_name: str,
    request: DriveImportRequest,
    x_google_access_token: str | None = Header(default=None, alias="X-Google-Access-Token"),
    x_user_id: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict:
    user_id = _resolve_user_id(x_user_id, authorization) or "anonymous"
    llm_config = get_llm_chat_config()
    file_ids = [str(item).strip() for item in (request.file_ids or []) if str(item).strip()]
    if not file_ids:
        raise HTTPException(status_code=400, detail="file_ids is required")
    if not x_google_access_token:
        raise HTTPException(status_code=401, detail="X-Google-Access-Token header is required")

    logger.info(
        "[Route:import_google_drive_documents] status=received user_id=%s folder=%s files=%d",
        user_id,
        folder_name,
        len(file_ids),
    )

    documents: list[DocumentReference] = []
    failed: list[dict[str, str]] = []
    for file_id in file_ids:
        try:
            data, filename, mime_type = google_drive_tool.download_file_bytes(
                x_google_access_token, file_id
            )
            check = assert_upload_allowed(
                user_id,
                llm_config,
                files_count=len(file_ids),
                size_bytes=len(data),
                buffer=data,
                mimetype=mime_type,
                originalname=filename,
            )
            if not check.get("ok"):
                failed.append({"file_id": file_id, "error": check.get("message", "Upload restricted by policy")})
                continue
            documents.append(
                _upload_drive_bytes_and_build_document(
                    user_id=user_id,
                    folder_name=folder_name,
                    filename=filename,
                    mime_type=mime_type,
                    data=data,
                    source_file_id=file_id,
                )
            )
        except Exception as exc:
            logger.exception(
                "[Route:import_google_drive_documents] status=file_failed folder=%s file_id=%s error=%s",
                folder_name,
                file_id,
                exc,
            )
            failed.append({"file_id": file_id, "error": str(exc)})

    if not documents:
        raise HTTPException(
            status_code=502,
            detail={"message": "Failed to import files from Google Drive", "failed": failed},
        )

    queue_result = enqueue_case_documents(
        user_id=user_id,
        folder_name=folder_name,
        documents=[document.model_dump(mode="json") for document in documents],
    )
    queue_result["google_drive"] = {
        "requested_count": len(file_ids),
        "imported_count": len(documents),
        "failed_count": len(failed),
        "failed": failed,
    }
    return queue_result


def _build_signed_upload(user_id: str, folder_name: str, request: GenerateUploadUrlRequest) -> dict[str, Any]:
    safe_name = (request.filename or f"upload-{uuid.uuid4().hex[:8]}").replace("\\", "_").replace("/", "_")
    object_path = str(PurePosixPath(user_id) / "documents" / folder_name / f"{uuid.uuid4().hex[:10]}_{safe_name}")
    signed_url = gcs.signed_upload_url(
        destination_path=object_path,
        content_type=request.mimetype or "application/octet-stream",
        bucket_type="input",
    )
    llm_config = get_llm_chat_config()
    settings = get_settings()
    bucket_name = settings.gcs_input_bucket_name or settings.gcs_bucket_name or "fileinputbucket"
    return {
        "success": True,
        "signedUrl": signed_url,
        "gcsPath": f"gs://{bucket_name}/{object_path}",
        "filename": safe_name,
        "maxAllowedSizeMb": get_request_upload_ceiling_mb(llm_config),
    }


@router.post("/{folder_name}/generate-upload-url")
def generate_upload_url_for_folder(
    folder_name: str,
    request: GenerateUploadUrlRequest,
    x_user_id: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    user_id = _resolve_user_id(x_user_id, authorization) or "anonymous"
    try:
        check = assert_upload_allowed(
            user_id,
            get_llm_chat_config(),
            files_count=1,
            size_bytes=int(request.size or 0),
            mimetype=request.mimetype,
            originalname=request.filename,
        )
        if not check.get("ok"):
            raise HTTPException(status_code=429, detail=check)
        return _build_signed_upload(user_id, folder_name, request)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("[Route:generate_upload_url] folder=%s error=%s", folder_name, exc)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/{folder_name}/complete-upload")
def complete_upload_for_folder(
    folder_name: str,
    request: CompleteUploadRequest,
    x_user_id: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    user_id = _resolve_user_id(x_user_id, authorization) or "anonymous"
    try:
        check = assert_upload_allowed(
            user_id,
            get_llm_chat_config(),
            files_count=1,
            size_bytes=int(request.size or 0),
            mimetype=request.mimetype,
            originalname=request.filename,
        )
        if not check.get("ok"):
            raise HTTPException(status_code=429, detail=check)
        payload = enqueue_case_documents(
            user_id=user_id,
            folder_name=folder_name,
            documents=[
                DocumentReference(
                    document_name=request.filename or f"upload-{uuid.uuid4().hex[:8]}",
                    mime_type=request.mimetype or "application/octet-stream",
                    document_uri=request.gcsPath,
                    metadata={
                        "size": int(request.size or 0),
                        "original_name": request.filename or "",
                        "gcs_path": request.gcsPath,
                    },
                ).model_dump(mode="json")
            ],
        )
        return {
            "success": True,
            "message": "Upload completed and document queued for processing.",
            "folderName": folder_name,
            "document": payload,
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("[Route:complete_upload] folder=%s error=%s", folder_name, exc)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/generate-upload-url")
def generate_upload_url_default(
    request: GenerateUploadUrlRequest,
    x_user_id: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    user_id = _resolve_user_id(x_user_id, authorization) or "anonymous"
    default_folder = f"case_{uuid.uuid4().hex[:8]}"
    try:
        payload = _build_signed_upload(user_id, default_folder, request)
        payload["folderName"] = default_folder
        return payload
    except Exception as exc:
        logger.exception("[Route:generate_upload_url_default] error=%s", exc)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/complete-upload")
def complete_upload_default(
    request: CompleteUploadRequest,
    x_user_id: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    user_id = _resolve_user_id(x_user_id, authorization) or "anonymous"
    folder_name = f"case_{uuid.uuid4().hex[:8]}"
    try:
        return complete_upload_for_folder(folder_name, request, x_user_id=x_user_id, authorization=authorization)
    except Exception as exc:
        logger.exception("[Route:complete_upload_default] error=%s", exc)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/create-folder")
def create_folder(
    request: CreateFolderRequest,
    x_user_id: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict:
    user_id = _resolve_user_id(x_user_id, authorization) or "anonymous"
    return create_case_folder(user_id, request.folderName, request.parentPath)


@router.post("/create")
def create_case(
    request: dict[str, Any] = Body(...),
    x_user_id: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict:
    user_id = _resolve_user_id(x_user_id, authorization) or "anonymous"
    try:
        return create_case_with_folder(user_id, request)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("[Route:create_case] user_id=%s error=%s", user_id, exc)
        raise HTTPException(status_code=500, detail=f"Case creation failed: {exc}") from exc


@router.get("/folders")
def list_folders(
    x_user_id: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict:
    user_id = _resolve_user_id(x_user_id, authorization)
    logger.info("[Route:list_folders] status=received user_id=%s", user_id)
    return list_case_folders(user_id)


@router.get("/cases")
def list_cases(
    x_user_id: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict:
    user_id = _resolve_user_id(x_user_id, authorization)
    logger.info("[Route:list_cases] status=received user_id=%s", user_id)
    return list_cases_tool(user_id)


@router.get("/cases/{case_id}")
def get_case(
    case_id: str,
    x_user_id: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict:
    user_id = _resolve_user_id(x_user_id, authorization)
    try:
        return get_case_detail(case_id, user_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.put("/cases/{case_id}")
def update_case(
    case_id: str,
    request: dict[str, Any] = Body(...),
    x_user_id: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict:
    user_id = _resolve_user_id(x_user_id, authorization) or "anonymous"
    try:
        return update_case_tool(case_id, user_id, request)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete("/cases/{case_id}")
def delete_case(
    case_id: str,
    x_user_id: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict:
    user_id = _resolve_user_id(x_user_id, authorization)
    return delete_case_tool(case_id, user_id)


@router.delete("/{file_id}")
def delete_file(
    file_id: str,
    x_user_id: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict:
    """Delete a single file by its DB UUID — removes DB rows, chunks, vectors, and GCS object."""
    user_id = _resolve_user_id(x_user_id, authorization)
    logger.info("[Route:delete_file] file_id=%s user_id=%s", file_id, user_id)
    try:
        return get_folder_service().delete_file(file_id, user_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/{folder_name}/files")
def get_documents_in_folder(
    folder_name: str,
    x_user_id: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict:
    user_id = _resolve_user_id(x_user_id, authorization)
    logger.info("[Route:get_documents_in_folder] status=received user_id=%s folder=%s", user_id, folder_name)
    return list_documents_in_case_folder(folder_name, user_id)


@router.get("/{folder_name}/status")
def get_folder_status(
    folder_name: str,
    x_user_id: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict:
    user_id = _resolve_user_id(x_user_id, authorization)
    try:
        return get_case_processing_status(folder_name, user_id=user_id)
    except ValueError:
        return {
            "folderName": folder_name,
            "case_id": folder_name,
            "job_id": None,
            "status": "queued",
            "progress": 0.0,
            "total_documents": 0,
            "processed_documents": 0,
            "failed_documents": 0,
            "documents": [],
        }
    except Exception:
        return {
            "folderName": folder_name,
            "case_id": folder_name,
            "job_id": None,
            "status": "queued",
            "progress": 0.0,
            "total_documents": 0,
            "processed_documents": 0,
            "failed_documents": 0,
            "documents": [],
        }


@router.post("/{folder_name}/extract-case-fields")
def extract_case_fields(folder_name: str) -> dict:
    try:
        return extract_case_fields_from_case_folder(folder_name)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/{folder_name}/intelligent-chat")
def intelligent_chat(
    folder_name: str,
    request: FolderChatRequest,
    x_user_id: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict:
    user_id = _resolve_user_id(x_user_id, authorization) or "anonymous"
    q = (request.question or "").strip()
    sid = (request.secret_id or "").strip()
    if not q and not sid:
        raise HTTPException(status_code=400, detail="question or secret_id is required")

    uid_int = _user_id_as_int(user_id)
    cap_est = estimate_streaming_token_request(q, has_secret_prompt=bool(sid))
    cap_enf = enforce_limits(uid_int, {"tokens": cap_est["estimated_total_tokens"]})
    logger.info(
        "[FolderChat TOKEN CAP] Enforcement result userId=%s folder=%s requestedTokens=%s allowed=%s message=%s",
        uid_int,
        folder_name,
        cap_est["estimated_total_tokens"],
        cap_enf.get("allowed"),
        cap_enf.get("message"),
    )
    if not cap_enf.get("allowed"):
        raise HTTPException(
            status_code=403,
            detail=f"{cap_enf.get('message', '')} {cap_enf.get('details', '')}".strip(),
        )

    logger.info(
        "[Route:intelligent_chat] status=received folder=%s session_id=%s",
        folder_name,
        request.session_id,
    )
    try:
        result = answer_case_folder_chat(
            user_id=user_id,
            folder_name=folder_name,
            request=request,
            authorization=authorization,
        )
        model_name = str((get_llm_chat_config(user_id=user_id, force_refresh=False) or {}).get("llm_model") or "unknown")
        answer_text = str(result.get("answer") or "")
        request_id = uuid.uuid4().hex[:12]
        log_llm_usage(
            user_id=uid_int,
            model_name=model_name,
            input_tokens=estimate_tokens_from_text(q),
            output_tokens=estimate_tokens_from_text(answer_text),
            endpoint="/api/files/{folder}/intelligent-chat",
            request_id=request_id,
            session_id=str(result.get("session_id") or request.session_id or ""),
        )
        return result
    except ValueError as exc:
        logger.exception("[Route:intelligent_chat] folder=%s validation_error=%s", folder_name, exc)
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("[Route:intelligent_chat] folder=%s unexpected_error=%s", folder_name, exc)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/{folder_name}/intelligent-chat/stream")
async def intelligent_chat_stream(
    folder_name: str,
    request: FolderChatRequest,
    fastapi_request: Request,
    x_user_id: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> StreamingResponse:
    """
    SSE endpoint that the frontend useIntelligentFolderChat hook calls.
    Emits: metadata → chunk (one per answer segment) → done (with citations) | error
    """
    user_id = _resolve_user_id(x_user_id, authorization) or "anonymous"
    logger.info(
        "[Route:intelligent_chat_stream] status=received folder=%s session_id=%s user_id=%s",
        folder_name,
        request.session_id,
        user_id,
    )

    async def _event_generator() -> AsyncGenerator[str, None]:
        def _sse(payload: dict) -> str:
            return f"data: {json.dumps(payload)}\n\n"

        import asyncio
        from app.services.adapters.document_ai import _call_gemini_for_qa, gemini_stream_config_for_folder_chat

        async def _run_blocking(func, *, timeout_s: float, timeout_message: str):
            try:
                return await asyncio.wait_for(
                    loop.run_in_executor(None, func),
                    timeout=timeout_s,
                )
            except asyncio.TimeoutError as exc:
                logger.warning(
                    "[Route:intelligent_chat_stream] folder=%s timeout=%ss step=%s",
                    folder_name,
                    timeout_s,
                    timeout_message,
                )
                raise TimeoutError(timeout_message) from exc

        # Emit immediately so the frontend does not look stuck while we gather profile/config context.
        yield _sse({"type": "status", "status": "initializing", "message": "Preparing legal assistant context..."})
        yield _sse({"type": "thinking", "text": "Loading legal prompt and profile context...\n"})

        loop = asyncio.get_running_loop()
        llm_config = getattr(fastapi_request.state, "llm_chat_config", None) or get_llm_chat_config()
        llm_config = merge_folder_chat_request_llm_overrides(llm_config, request)
        try:
            user_profile = await _run_blocking(
                lambda: fetch_full_profile(user_id, authorization),
                timeout_s=3.0,
                timeout_message="profile_fetch",
            )
        except Exception:
            logger.warning(
                "[Route:intelligent_chat_stream] folder=%s user_id=%s profile fetch timed out, using empty profile",
                folder_name,
                user_id,
            )
            user_profile = {}
        system_instruction = build_document_qa_system_prompt(user_profile)
        logger.info(
            "[Route:intelligent_chat_stream] system_prompt_chars=%s user_id=%s folder=%s",
            len(system_instruction),
            user_id,
            folder_name,
        )
        try:
            query_text, display_question = resolve_query_and_display(
                question=request.question,
                secret_id=request.secret_id,
                prompt_label=request.prompt_label,
                authorization=authorization,
            )
        except ValueError as exc:
            yield _sse({"type": "error", "message": str(exc)})
            return
        if not query_text:
            yield _sse({"type": "error", "message": "Please enter a question."})
            return

        uid_int = _user_id_as_int(user_id)
        has_secret_id = bool((request.secret_id or "").strip())
        cap_est = estimate_streaming_token_request(
            query_text,
            has_secret_prompt=has_secret_id,
        )
        cap_enf = enforce_limits(uid_int, {"tokens": cap_est["estimated_total_tokens"]})
        logger.info(
            "[STREAMING TOKEN CAP] Dataflow start userId=%s folder=%s hasSecretId=%s estimate=%s",
            uid_int,
            folder_name,
            has_secret_id,
            cap_est,
        )
        logger.info(
            "[STREAMING TOKEN CAP] Enforcement result userId=%s folder=%s requestedTokens=%s "
            "allowed=%s remainingTokens=%s message=%s capStatus=%s",
            uid_int,
            folder_name,
            cap_est["estimated_total_tokens"],
            cap_enf.get("allowed"),
            cap_enf.get("remainingTokens"),
            cap_enf.get("message"),
            cap_enf.get("capStatus"),
        )
        if not cap_enf.get("allowed"):
            logger.warning(
                "[STREAMING TOKEN CAP] Request blocked before folder processing userId=%s folder=%s",
                uid_int,
                folder_name,
            )
            yield _sse(
                {
                    "type": "error",
                    "message": cap_enf.get("message")
                    or "Your token quota has been exceeded. Please talk to your firm admin.",
                    "details": cap_enf.get("details") or "",
                }
            )
            return

        resolved_chat_request = request.model_copy(
            update={
                "question": query_text,
                "prompt_label": display_question,
            }
        )

        # Conversation continuity: include last N Q/A pairs (case-wise) when configured.
        # The vector path (answer_case_folder_chat → FolderService.answer_folder_chat) already
        # applies this. The DB+Gemini fallback path below must do it explicitly too.
        folder_service = get_folder_service()
        effective_query_text = query_text
        try:
            effective_query_text = folder_service._build_query_with_recent_history(  # noqa: SLF001
                user_id=user_id,
                folder_name=folder_name,
                session_id=request.session_id,
                query_text=query_text,
                max_history=int(llm_config.get("max_conversation_history") or 0),
            )
        except Exception:
            effective_query_text = query_text

        # ── Step 1: emit status so the frontend shows "Analyzing..." ──
        yield _sse({"type": "status", "status": "analyzing", "message": "Analyzing query intent..."})
        yield _sse({"type": "thinking", "text": "Understanding your question and selecting the best answer path...\n"})

        # ── Step 2: try the in-memory vector store path ──
        vector_result = None
        vector_error: str | None = None
        vector_timeout_s = 3.0
        try:
            vector_result = await asyncio.wait_for(
                loop.run_in_executor(
                    None,
                    lambda: answer_case_folder_chat(
                        user_id=user_id,
                        folder_name=folder_name,
                        request=resolved_chat_request,
                        authorization=authorization,
                    ),
                ),
                timeout=vector_timeout_s,
            )
        except asyncio.TimeoutError:
            vector_error = f"vector path timed out after {vector_timeout_s:.1f}s"
            logger.info(
                "[Route:intelligent_chat_stream] vector path timeout folder=%s timeout=%.1fs — falling back to DB+Gemini",
                folder_name,
                vector_timeout_s,
            )
            yield _sse({"type": "thinking", "text": "Vector search is slow, switching to direct generation for faster output...\n"})
        except Exception as exc:
            vector_error = str(exc)
            logger.info(
                "[Route:intelligent_chat_stream] vector_store miss folder=%s error=%s — falling back to DB+Gemini",
                folder_name,
                exc,
            )
            yield _sse({"type": "thinking", "text": "Vector retrieval is unavailable, using direct document reasoning...\n"})

        # ── Step 3: if vector path succeeded and has a real answer, stream it ──
        if vector_result is not None:
            answer_segments = vector_result.get("answer_segments") or []
            full_answer = vector_result.get("answer") or ""
            has_real_content = bool(answer_segments) or bool(full_answer.strip())

            if has_real_content:
                yield _sse({"type": "thinking", "text": "Found relevant chunks. Drafting grounded answer...\n"})
                session_id = vector_result.get("session_id") or request.session_id or ""
                yield _sse({
                    "type": "metadata",
                    "session_id": session_id,
                    "method": "grounded_retrieval",
                    "routing_decision": "vector_search",
                })
                if answer_segments:
                    vector_answer_text = "\n".join(
                        (
                            segment.get("statement", "")
                            if isinstance(segment, dict)
                            else getattr(segment, "statement", "")
                        )
                        for segment in answer_segments
                    ).strip()
                else:
                    vector_answer_text = (full_answer or "").strip()

                request_id = uuid.uuid4().hex[:12]
                model_name = str((llm_config or {}).get("llm_model") or "unknown")
                log_llm_usage(
                    user_id=uid_int,
                    model_name=model_name,
                    input_tokens=estimate_tokens_from_text(query_text),
                    output_tokens=estimate_tokens_from_text(vector_answer_text),
                    endpoint="/api/files/{folder}/intelligent-chat/stream",
                    request_id=request_id,
                    session_id=str(session_id or ""),
                )

                # Pipeline often returns one large segment; split into many SSE chunks for real-time UI.
                stream_delay_ms = get_streaming_delay_ms(llm_config)
                async for sse_line in _yield_text_as_streaming_chunks(
                    _sse,
                    vector_answer_text,
                    delay_ms=stream_delay_ms,
                ):
                    yield sse_line

                citations = vector_result.get("citations") or []
                serialized_citations = []
                for c in citations:
                    if isinstance(c, dict):
                        serialized_citations.append(c)
                    else:
                        try:
                            serialized_citations.append(c.model_dump(mode="json"))
                        except Exception:
                            serialized_citations.append({"document_name": str(c)})

                yield _sse({
                    "type": "done",
                    "session_id": session_id,
                    "method": "grounded_retrieval",
                    "routing_decision": "vector_search",
                    "answer": vector_answer_text,
                    "citations": serialized_citations,
                    "used_chunk_ids": [c.get("chunk_id", "") for c in serialized_citations if isinstance(c, dict)],
                })
                return  # done via vector path

        yield _sse(
            {
                "type": "status",
                "status": "fallback",
                "message": "Using direct generation for faster response...",
            }
        )

        # ── Step 4: DB + Gemini fallback ──
        yield _sse({"type": "status", "status": "searching", "message": "Searching documents..."})
        yield _sse({"type": "thinking", "text": "Reading available document text from this case...\n"})

        try:
            # Fetch all documents for this folder (DB path)
            docs_result = await _run_blocking(
                lambda: folder_service.get_documents_in_folder(folder_name, user_id),
                timeout_s=10.0,
                timeout_message="folder_documents_fetch",
            )
            documents = docs_result.get("documents") or docs_result.get("files") or []

            # Build list of {name, text} for Gemini
            max_context_documents = max(1, int(llm_config.get("max_context_documents") or 8))
            doc_texts = [
                {
                    "name": d.get("name") or d.get("originalname") or "document",
                    "text": d.get("full_text_content") or d.get("summary") or "",
                    "file_id": d.get("id"),
                }
                for d in documents
                if d.get("full_text_content") or d.get("summary")
            ][:max_context_documents]

            if not doc_texts:
                # No text available at all
                if vector_error and "not found" in vector_error.lower():
                    msg = (
                        "This case's documents are not yet indexed for chat. "
                        "Please upload and process the documents first, then try again."
                    )
                else:
                    msg = "No document text is available for this case yet. Please wait for processing to complete."
                yield _sse({"type": "error", "message": msg})
                return

            yield _sse({"type": "status", "status": "generating", "message": "Generating answer from documents..."})
            yield _sse({"type": "thinking", "text": f"Loaded {len(doc_texts)} document(s). Generating answer now...\n"})

            non_stream_timeout_s = min(
                180.0,
                max(
                    60.0,
                    30.0
                    + (len(doc_texts) * 8.0)
                    + (float(llm_config.get("max_summarization_output_tokens") or llm_config.get("max_output_tokens") or 15000) / 400.0),
                ),
            )

            # Real-time Gemini streaming: emit chunk events as text is generated.
            answer_parts: list[str] = []
            source_names: list[str] = [str(d.get("name") or "document").strip() for d in doc_texts if d.get("name")]
            citations_payload: list[dict[str, Any]] = []
            streamed = False
            stream_delay_ms = get_streaming_delay_ms(llm_config)
            try:
                from google import genai  # type: ignore

                settings = get_settings()
                if settings.gemini_api_key:
                    context_parts = []
                    running_chars = 0
                    char_limit = 80000
                    for doc in doc_texts:
                        name = doc.get("name", "document")
                        text = (doc.get("text") or "").strip()
                        if not text:
                            continue
                        block = f"[Document: {name}]\n{text}"
                        if running_chars + len(block) > char_limit:
                            block = block[: max(0, char_limit - running_chars)]
                            if block:
                                context_parts.append(block)
                            break
                        context_parts.append(block)
                        running_chars += len(block)

                    context = "\n\n---\n\n".join(context_parts)
                    prompt = (
                        f"SYSTEM INSTRUCTION:\n{system_instruction}\n\n"
                        "Answer the user's question based ONLY on the "
                        "following legal documents. Be concise and factual. If the answer is not in the "
                        "documents, say so clearly.\n\n"
                        f"=== DOCUMENTS ===\n{context}\n\n"
                        f"=== QUESTION ===\n{effective_query_text}\n\n"
                        "=== ANSWER ==="
                    )
                    client = genai.Client(api_key=settings.gemini_api_key)
                    stream_bundle = gemini_stream_config_for_folder_chat(
                        for_summary=True,
                        summarization_llm_config=llm_config,
                    )
                    if stream_bundle is None:
                        raise RuntimeError("folder_chat_stream_requires_gemini_model")
                    model_name, gemini_config = stream_bundle
                    stream_iter = client.models.generate_content_stream(
                        model=model_name,
                        contents=prompt,
                        config=gemini_config,
                    )
                    # Generous limits: short per-chunk timeouts were stopping the stream mid-answer
                    # when the model paused between chunks, producing truncated UI responses.
                    first_chunk_timeout_s = min(180.0, max(90.0, non_stream_timeout_s / 2.0))
                    next_chunk_timeout_s = 600.0
                    agg_full = ""
                    while True:
                        chunk_timeout_s = first_chunk_timeout_s if not streamed else next_chunk_timeout_s
                        try:
                            chunk = await asyncio.wait_for(
                                loop.run_in_executor(None, lambda it=stream_iter: next(it, None)),
                                timeout=chunk_timeout_s,
                            )
                        except asyncio.TimeoutError:
                            if streamed:
                                logger.warning(
                                    "[Route:intelligent_chat_stream] folder=%s gemini stream stalled after partial output; finalizing partial answer",
                                    folder_name,
                                )
                                break
                            raise TimeoutError("gemini_stream_first_chunk_timeout")
                        if chunk is None:
                            break
                        piece = _gemini_chunk_text(chunk)
                        if not piece:
                            continue
                        if not agg_full:
                            delta = piece
                            agg_full = piece
                        elif piece.startswith(agg_full):
                            delta = piece[len(agg_full) :]
                            agg_full = piece
                        else:
                            delta = piece
                            agg_full = agg_full + piece
                        if not delta:
                            continue
                        streamed = True
                        answer_parts.append(delta)
                        async for sse_line in _yield_text_as_streaming_chunks(
                            _sse, delta, delay_ms=stream_delay_ms
                        ):
                            yield sse_line
                    if streamed:
                        yield _sse({"type": "thinking", "text": "Finalizing response and citations...\n"})
            except Exception as stream_exc:
                logger.info(
                    "[Route:intelligent_chat_stream] folder=%s streaming unavailable, using non-stream fallback: %s",
                    folder_name,
                    stream_exc,
                )
                yield _sse({"type": "thinking", "text": "Live stream unavailable, sending complete response...\n"})

            if not streamed:
                logger.info(
                    "[Route:intelligent_chat_stream] folder=%s using non-stream Gemini fallback timeout=%ss doc_count=%s max_output_tokens=%s",
                    folder_name,
                    non_stream_timeout_s,
                    len(doc_texts),
                    llm_config.get("max_summarization_output_tokens") or llm_config.get("max_output_tokens") or 15000,
                )
                qa_result = await _run_blocking(
                    lambda: _call_gemini_for_qa(
                        effective_query_text,
                        doc_texts,
                        query_intent="summary",
                        output_format="structured",
                        system_instruction=system_instruction,
                        summarization_llm_config=llm_config,
                    ),
                    timeout_s=non_stream_timeout_s,
                    timeout_message="gemini_non_stream_generation",
                )
                answer = (qa_result.get("answer") or "").strip()
                if not answer:
                    yield _sse({"type": "error", "message": "Could not generate an answer. Please try rephrasing your question."})
                    return
                source_docs = qa_result.get("source_documents", "")
                if source_docs:
                    source_names = [item.strip() for item in source_docs.split(",") if item.strip()]
                answer_parts = [answer]
                async for sse_line in _yield_text_as_streaming_chunks(
                    _sse, answer, delay_ms=stream_delay_ms
                ):
                    yield sse_line
                yield _sse({"type": "thinking", "text": "Response generated. Preparing final metadata...\n"})

            answer = "".join(answer_parts).strip()
            if not answer:
                yield _sse({"type": "error", "message": "Could not generate an answer. Please try rephrasing your question."})
                return

            # Try to create a session entry in the folder service
            session_id = request.session_id or ""
            try:
                session_id = await loop.run_in_executor(
                    None,
                    lambda: folder_service._get_or_create_session(
                        user_id, folder_name, request.session_id, display_question
                    ).id,
                )
                await loop.run_in_executor(None, lambda: folder_service._append_message(
                    folder_service._sessions.get(folder_name, {}).get(session_id),
                    "user", display_question,
                ) if folder_service._sessions.get(folder_name, {}).get(session_id) else None)
                await loop.run_in_executor(None, lambda: folder_service._append_message(
                    folder_service._sessions.get(folder_name, {}).get(session_id),
                    "assistant", answer,
                ) if folder_service._sessions.get(folder_name, {}).get(session_id) else None)
                sec_id = (request.secret_id or "").strip() or None

                # Build stable citations payload for persistence + UI.
                source_by_name: dict[str, dict[str, Any]] = {}
                for d in doc_texts:
                    nm = str(d.get("name") or "").strip()
                    if not nm:
                        continue
                    source_by_name[nm.lower()] = {
                        "document_name": nm,
                        "filename": nm,
                        "file_id": str(d.get("file_id")) if d.get("file_id") else None,
                        "document_id": str(d.get("file_id")) if d.get("file_id") else None,
                    }
                ordered_names = [s for s in source_names if s]
                seen_keys: set[str] = set()
                for nm in ordered_names:
                    key = nm.strip().lower()
                    if not key or key in seen_keys:
                        continue
                    seen_keys.add(key)
                    base = source_by_name.get(key, {"document_name": nm, "filename": nm})
                    citations_payload.append(base)

                def _persist_stream_chat() -> None:
                    folder_service._save_folder_chat_to_db(
                        user_id=user_id,
                        folder_name=folder_name,
                        question=display_question,
                        answer=answer,
                        session_id=session_id,
                        citations=citations_payload,
                        used_secret_prompt=bool(sec_id),
                        prompt_label=display_question if sec_id else None,
                        secret_id=sec_id,
                    )

                await loop.run_in_executor(None, _persist_stream_chat)
            except Exception:
                pass  # session bookkeeping is non-critical

            yield _sse({
                "type": "metadata",
                "session_id": session_id,
                "method": "gemini_direct",
                "routing_decision": "db_text_fallback",
                "prompt_label": display_question if (request.secret_id or "").strip() else None,
                "used_secret_prompt": bool((request.secret_id or "").strip()),
            })
            request_id = uuid.uuid4().hex[:12]
            model_name = str((llm_config or {}).get("llm_model") or "unknown")
            log_llm_usage(
                user_id=uid_int,
                model_name=model_name,
                input_tokens=estimate_tokens_from_text(query_text),
                output_tokens=estimate_tokens_from_text(answer),
                endpoint="/api/files/{folder}/intelligent-chat/stream",
                request_id=request_id,
                session_id=str(session_id or ""),
            )
            yield _sse({
                "type": "done",
                "session_id": session_id,
                "method": "gemini_direct",
                "routing_decision": "db_text_fallback",
                "answer": answer,
                "citations": citations_payload,
                "used_chunk_ids": [],
                "prompt_label": display_question if (request.secret_id or "").strip() else None,
                "used_secret_prompt": bool((request.secret_id or "").strip()),
            })

        except Exception as exc:
            logger.exception("[Route:intelligent_chat_stream] folder=%s DB-Gemini fallback failed: %s", folder_name, exc)
            yield _sse({"type": "error", "message": str(exc)})

    return StreamingResponse(
        _event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )



@router.get("/{folder_name}/sessions")
def list_sessions(folder_name: str) -> list[dict]:
    return [item.model_dump(mode="json") for item in get_folder_service().list_sessions(folder_name)]


@router.get("/{folder_name}/chats")
def list_folder_chats(
    folder_name: str,
    x_user_id: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict:
    user_id = _resolve_user_id(x_user_id, authorization)
    chats: list[dict[str, Any]] = []

    # Primary source: persisted folder_chats rows so refresh survives app reloads.
    if is_db_available():
        try:
            with get_db_connection() as conn, conn.cursor() as cur:
                if user_id:
                    cur.execute(
                        """
                        SELECT
                            id,
                            question,
                            answer,
                            session_id,
                            citations,
                            used_chunk_ids,
                            used_secret_prompt,
                            prompt_label,
                            secret_id,
                            created_at
                        FROM folder_chats
                        WHERE folder_name = %s
                          AND user_id::text = %s
                        ORDER BY created_at ASC
                        """,
                        [folder_name, str(user_id)],
                    )
                else:
                    cur.execute(
                        """
                        SELECT
                            id,
                            question,
                            answer,
                            session_id,
                            citations,
                            used_chunk_ids,
                            used_secret_prompt,
                            prompt_label,
                            secret_id,
                            created_at
                        FROM folder_chats
                        WHERE folder_name = %s
                        ORDER BY created_at ASC
                        """,
                        [folder_name],
                    )
                rows = list(cur.fetchall())

            for row in rows:
                citations = row.get("citations")
                used_chunk_ids = row.get("used_chunk_ids")
                chats.append(
                    {
                        "id": str(row.get("session_id") or row.get("id")),
                        "chat_id": str(row.get("id")),
                        "session_id": str(row.get("session_id")) if row.get("session_id") else None,
                        "question": row.get("question") or row.get("prompt_label") or "Untitled",
                        "answer": row.get("answer") or "",
                        "response": row.get("answer") or "",
                        "message": row.get("answer") or "",
                        "citations": citations if isinstance(citations, list) else [],
                        "used_chunk_ids": [str(item) for item in (used_chunk_ids or [])],
                        "used_secret_prompt": bool(row.get("used_secret_prompt")),
                        "prompt_label": row.get("prompt_label"),
                        "secret_id": str(row.get("secret_id")) if row.get("secret_id") else None,
                        "created_at": row.get("created_at").isoformat() if row.get("created_at") else None,
                    }
                )
            return {"chats": chats}
        except Exception as exc:
            logger.exception(
                "[Route:list_folder_chats] DB read failed folder=%s user_id=%s error=%s",
                folder_name,
                user_id,
                exc,
            )

    # Fallback: in-memory sessions.
    sessions = get_folder_service().list_sessions(folder_name)
    for session in sessions:
        assistant_messages = [message for message in session.messages if message.role == "assistant"]
        user_messages = [message for message in session.messages if message.role == "user"]
        latest_assistant = assistant_messages[-1] if assistant_messages else None
        latest_user = user_messages[-1] if user_messages else None
        chats.append(
            {
                "id": session.id,
                "session_id": session.id,
                "question": latest_user.content if latest_user else session.title,
                "answer": latest_assistant.content if latest_assistant else "",
                "response": latest_assistant.content if latest_assistant else "",
                "message": latest_assistant.content if latest_assistant else "",
                "created_at": session.created_at,
                "updated_at": session.updated_at,
                "messages": [message.model_dump(mode="json") for message in session.messages],
            }
        )
    return {"chats": chats}


@router.get("/{folder_name}/sessions/{session_id}")
def get_session(folder_name: str, session_id: str) -> dict:
    try:
        return get_folder_service().get_session(folder_name, session_id).model_dump(mode="json")
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/{folder_name}/sessions/{session_id}/continue")
def continue_session(
    folder_name: str,
    session_id: str,
    request: FolderChatRequest,
    x_user_id: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict:
    user_id = _resolve_user_id(x_user_id, authorization) or "anonymous"
    try:
        continued_request = request.model_copy(update={"session_id": session_id})
        return answer_case_folder_chat(
            user_id=user_id,
            folder_name=folder_name,
            request=continued_request,
            authorization=authorization,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete("/{folder_name}/sessions/{session_id}")
def delete_session(folder_name: str, session_id: str) -> dict:
    try:
        return get_folder_service().delete_session(folder_name, session_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete("/{folder_name}/chat/{session_id}")
def delete_single_folder_chat(folder_name: str, session_id: str) -> dict:
    try:
        return get_folder_service().delete_session(folder_name, session_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete("/{folder_name}/chats")
def delete_all_folder_chats(folder_name: str) -> dict:
    return get_folder_service().delete_all_sessions(folder_name)
