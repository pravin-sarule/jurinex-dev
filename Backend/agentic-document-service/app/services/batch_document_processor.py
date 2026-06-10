"""
Batch Document Processor

Handles PDF processing for Gemini Batch API:
1. Detects if a PDF is scanned (pypdf text-density heuristic)
2. Scanned PDFs: Document AI OCR (parallel page batching) → upload extracted text to Gemini Files API
3. Regular PDFs: upload PDF directly to Gemini Files API (Gemini reads natively)
4. Updates batch_upload_files row with status + gemini_file_name + gemini_file_uri
"""
from __future__ import annotations

import io
import logging
import os
import tempfile

logger = logging.getLogger("agentic_document_service.batch_document_processor")

# If average extractable text per page is below this, treat the PDF as scanned.
_MIN_CHARS_PER_PAGE = 50


def detect_if_scanned(pdf_bytes: bytes) -> tuple[bool, int]:
    """Return (is_scanned, page_count) using pypdf text-density heuristic."""
    try:
        from pypdf import PdfReader  # type: ignore
        reader = PdfReader(io.BytesIO(pdf_bytes))
        pages = len(reader.pages)
        total_text = "".join(page.extract_text() or "" for page in reader.pages)
        chars_per_page = len(total_text) / max(pages, 1)
        is_scanned = chars_per_page < _MIN_CHARS_PER_PAGE
        logger.info(
            "[BatchDocProc] scan detection: pages=%d chars_per_page=%.1f is_scanned=%s",
            pages, chars_per_page, is_scanned,
        )
        return is_scanned, pages
    except Exception as exc:
        logger.warning("[BatchDocProc] pypdf scan detection failed: %s — defaulting to not-scanned", exc)
        return False, 0


def upload_bytes_to_gemini(content: bytes, mime_type: str, display_name: str) -> tuple[str, str]:
    """
    Upload bytes to the Gemini Files API.

    Returns (file_name, file_uri) where:
    - file_name: short resource name like "files/abc123"
    - file_uri:  full URI for use in file_data blocks
    """
    from app.core.config import get_settings
    from google import genai  # type: ignore

    settings = get_settings()
    client = genai.Client(api_key=settings.gemini_api_key)

    suffix = ".txt" if mime_type == "text/plain" else ".pdf"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(content)
        tmp_path = tmp.name

    try:
        resp = client.files.upload(
            file=tmp_path,
            config={"mime_type": mime_type, "display_name": display_name},
        )
        file_name = resp.name  # "files/abc123"
        file_uri = resp.uri   # "https://generativelanguage.googleapis.com/v1beta/files/abc123"
        logger.info("[BatchDocProc] Uploaded to Gemini Files API: name=%s", file_name)
        return file_name, file_uri
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


def _update_file_record(file_id: str, status: str, **fields) -> None:
    from app.services.db import get_db_connection

    if fields:
        set_clause = ", ".join(f"{k} = %s" for k in fields)
        vals = list(fields.values()) + [file_id]
        sql = f"UPDATE batch_upload_files SET status = %s, updated_at = NOW(), {set_clause} WHERE id = %s"
        params = [status] + vals
    else:
        sql = "UPDATE batch_upload_files SET status = %s, updated_at = NOW() WHERE id = %s"
        params = [status, file_id]

    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
        conn.commit()


def process_uploaded_file(file_id: str, gcs_path: str, filename: str) -> None:
    """
    Background task: download PDF from GCS, detect scan status, OCR if needed,
    upload to Gemini Files API, and mark the file record as ready.

    Designed to run in a daemon thread — never raises; logs errors instead.
    """
    from app.services.adapters.gcs import download_bytes
    from app.services.adapters.ocr import extract_text_from_bytes

    try:
        _update_file_record(file_id, "processing")

        pdf_bytes = download_bytes(gcs_path)
        is_scanned, page_count = detect_if_scanned(pdf_bytes)

        if is_scanned:
            logger.info("[BatchDocProc] file_id=%s is scanned — running Document AI OCR", file_id)
            ocr_result = extract_text_from_bytes(pdf_bytes, "application/pdf", filename)
            extracted_text = ocr_result.text or f"[Could not extract text from {filename}]"
            page_count = ocr_result.page_count or page_count

            text_bytes = extracted_text.encode("utf-8")
            gemini_file_name, gemini_file_uri = upload_bytes_to_gemini(
                text_bytes,
                "text/plain",
                f"batch-{file_id[:8]}-extracted.txt",
            )
            _update_file_record(
                file_id,
                "ready",
                is_scanned=True,
                page_count=page_count,
                gemini_file_name=gemini_file_name,
                gemini_file_uri=gemini_file_uri,
                gemini_mime_type="text/plain",
            )
        else:
            logger.info("[BatchDocProc] file_id=%s is text-based — uploading PDF to Gemini", file_id)
            gemini_file_name, gemini_file_uri = upload_bytes_to_gemini(
                pdf_bytes,
                "application/pdf",
                f"batch-{file_id[:8]}.pdf",
            )
            _update_file_record(
                file_id,
                "ready",
                is_scanned=False,
                page_count=page_count,
                gemini_file_name=gemini_file_name,
                gemini_file_uri=gemini_file_uri,
                gemini_mime_type="application/pdf",
            )

        logger.info("[BatchDocProc] file_id=%s processing complete", file_id)

    except Exception as exc:
        logger.error("[BatchDocProc] file_id=%s failed: %s", file_id, exc, exc_info=True)
        try:
            _update_file_record(file_id, "failed", error_message=str(exc)[:500])
        except Exception:
            pass
