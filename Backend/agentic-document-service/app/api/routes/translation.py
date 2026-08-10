"""
Translation endpoints backed by the Z.AI Translation Agent
(app/services/zai_translation_service.py).
"""
from __future__ import annotations

import logging
from typing import Any
from urllib.parse import quote

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field

from app.services.document_translation_service import (
    DocumentTranslationError,
    get_job,
    start_document_translation,
)
from app.services.zai_translation_service import (
    SUPPORTED_LANGUAGES,
    SUPPORTED_STRATEGIES,
    TranslationServiceError,
    is_translation_configured,
    translate_text,
)

router = APIRouter(tags=["translation"])
logger = logging.getLogger("agentic_document_service.translation")

_MAX_TEXT_CHARS = 30_000


class TranslationRequest(BaseModel):
    text: str = Field(..., description="Source text to translate.")
    target_lang: str = Field(..., description="Target language code, e.g. 'en', 'hi', 'zh-CN'.")
    source_lang: str = Field(default="auto", description="Source language code; 'auto' detects it.")
    strategy: str = Field(default="general", description=f"One of: {', '.join(sorted(SUPPORTED_STRATEGIES))}.")
    glossary: str | None = Field(default=None, description="Optional Z.AI glossary ID for terminology alignment.")
    suggestion: str | None = Field(default=None, description="Optional style/expert guidance for the translation.")


@router.get("/api/v1/translation/strategies")
async def list_translation_strategies() -> dict[str, Any]:
    """Supported strategies + languages + whether the service is configured (key present)."""
    return {
        "configured": is_translation_configured(),
        "strategies": [
            {"id": key, "description": desc} for key, desc in SUPPORTED_STRATEGIES.items()
        ],
        "languages": SUPPORTED_LANGUAGES,
    }


@router.post("/api/v1/translation/translate")
async def translate(request: TranslationRequest) -> dict[str, Any]:
    if len(request.text) > _MAX_TEXT_CHARS:
        raise HTTPException(
            status_code=413,
            detail=f"Text exceeds the {_MAX_TEXT_CHARS} character limit; split it into smaller parts.",
        )
    try:
        return await translate_text(
            request.text,
            target_lang=request.target_lang,
            source_lang=request.source_lang,
            strategy=request.strategy,
            glossary=request.glossary,
            suggestion=request.suggestion,
        )
    except TranslationServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Translation failed: %s", exc)
        raise HTTPException(status_code=500, detail="Translation failed unexpectedly.") from exc


# ── Document translation (PDF/DOCX → translated DOCX/PDF) ─────────────────────

@router.post("/api/v1/translation/document")
async def translate_document(
    file: UploadFile = File(..., description="PDF or DOCX to translate"),
    target_lang: str = Form(...),
    source_lang: str = Form(default="auto"),
    strategy: str = Form(default="general"),
    output_format: str = Form(default="docx"),
    suggestion: str = Form(default=""),
) -> dict[str, Any]:
    """Start an async document translation job; poll status, then download."""
    if not is_translation_configured():
        raise HTTPException(status_code=503, detail="Translation is not configured on the server.")
    if strategy.strip().lower() not in SUPPORTED_STRATEGIES:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown strategy. Supported: {', '.join(sorted(SUPPORTED_STRATEGIES))}.",
        )
    data = await file.read()
    try:
        job = start_document_translation(
            data,
            file.filename or "document",
            target_lang=target_lang,
            source_lang=source_lang,
            strategy=strategy,
            output_format=output_format,
            suggestion=suggestion,
        )
    except DocumentTranslationError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    return job.public_state()


@router.get("/api/v1/translation/document/{job_id}/status")
async def document_translation_status(job_id: str) -> dict[str, Any]:
    job = get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Unknown or expired translation job.")
    return job.public_state()


@router.get("/api/v1/translation/document/{job_id}/download")
async def download_translated_document(job_id: str) -> Response:
    job = get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Unknown or expired translation job.")
    if job.status == "error":
        raise HTTPException(status_code=422, detail=job.error or "Translation failed.")
    if job.result_bytes is None:
        raise HTTPException(status_code=409, detail="Translation is still in progress.")
    safe_name = job.result_filename.replace('"', "") or "translated-document"
    # Non-ASCII filenames (e.g. Hindi) must ride in RFC 5987 filename*; the plain
    # filename= fallback stays ASCII so the header itself is always encodable.
    ascii_name = safe_name.encode("ascii", "ignore").decode() or "translated-document"
    disposition = (
        f'attachment; filename="{ascii_name}"; '
        f"filename*=UTF-8''{quote(safe_name)}"
    )
    return Response(
        content=job.result_bytes,
        media_type=job.result_mime or "application/octet-stream",
        headers={"Content-Disposition": disposition},
    )
