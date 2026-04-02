"""
Real Google Cloud Document AI text extraction.

Uses the configured Document AI OCR processor to extract text from
a document stored in GCS (or from raw bytes).

Falls back to pypdf for PDFs and Gemini for text-heavy documents
when Document AI is unavailable.
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass

logger = logging.getLogger("agentic_document_service.document_ai_ocr")


@dataclass
class OcrResult:
    text: str
    page_count: int
    quality_score: float


def extract_text_from_gcs(gs_uri: str, mime_type: str = "application/pdf") -> OcrResult:
    """
    Run Document AI OCR on a file already in GCS and return extracted text.

    Args:
        gs_uri: gs://bucket/path/to/file URI.
        mime_type: MIME type of the document.

    Returns:
        OcrResult with text, page_count, quality_score.
    """
    from app.core.config import get_settings
    settings = get_settings()

    project_id = settings.google_cloud_project
    location = settings.google_cloud_location or "us"
    processor_id = settings.document_ai_processor_id if hasattr(settings, "document_ai_processor_id") else ""

    # Resolve processor_id from env directly as fallback
    import os
    if not processor_id:
        processor_id = os.environ.get("DOCUMENT_AI_PROCESSOR_ID", "")

    if not project_id or not processor_id:
        logger.warning(
            "[DocumentAI OCR] Missing project_id=%s or processor_id=%s — falling back to pypdf",
            project_id, processor_id,
        )
        return _fallback_extract_from_gcs(gs_uri, mime_type)

    try:
        from google.cloud import documentai  # type: ignore
        from app.services.adapters.gcs import download_bytes
        import base64

        raw_bytes = download_bytes(gs_uri)
        client_options = {"api_endpoint": f"{location}-documentai.googleapis.com"}
        client = documentai.DocumentProcessorServiceClient(client_options=client_options)

        processor_name = client.processor_path(project_id, location, processor_id)
        raw_document = documentai.RawDocument(content=raw_bytes, mime_type=mime_type)
        request = documentai.ProcessRequest(name=processor_name, raw_document=raw_document)

        t0 = time.monotonic()
        result = client.process_document(request=request)
        elapsed = time.monotonic() - t0

        document = result.document
        text = document.text or ""
        page_count = len(document.pages)

        # Quality score based on text density
        avg_chars = len(text) / max(page_count, 1)
        quality_score = min(1.0, avg_chars / 500.0)

        logger.info(
            "[DocumentAI OCR] Processed %s pages=%d chars=%d elapsed=%.2fs quality=%.2f",
            gs_uri, page_count, len(text), elapsed, quality_score,
        )
        return OcrResult(text=text, page_count=page_count, quality_score=quality_score)

    except Exception as exc:
        logger.warning("[DocumentAI OCR] Failed for %s: %s — falling back", gs_uri, exc)
        return _fallback_extract_from_gcs(gs_uri, mime_type)


def extract_text_from_bytes(
    data: bytes,
    mime_type: str = "application/pdf",
    filename: str = "document",
) -> OcrResult:
    """
    Run Document AI OCR on raw bytes (without requiring a GCS URI).
    Falls back to pypdf → Gemini if Document AI is unavailable.
    """
    from app.core.config import get_settings
    settings = get_settings()

    project_id = settings.google_cloud_project
    location = settings.google_cloud_location or "us"
    import os
    processor_id = os.environ.get("DOCUMENT_AI_PROCESSOR_ID", "")

    if project_id and processor_id:
        try:
            from google.cloud import documentai  # type: ignore

            client_options = {"api_endpoint": f"{location}-documentai.googleapis.com"}
            client = documentai.DocumentProcessorServiceClient(client_options=client_options)
            processor_name = client.processor_path(project_id, location, processor_id)
            raw_document = documentai.RawDocument(content=data, mime_type=mime_type)
            request = documentai.ProcessRequest(name=processor_name, raw_document=raw_document)
            result = client.process_document(request=request)
            document = result.document
            text = document.text or ""
            page_count = len(document.pages)
            avg_chars = len(text) / max(page_count, 1)
            quality_score = min(1.0, avg_chars / 500.0)
            logger.info("[DocumentAI OCR] bytes extracted pages=%d chars=%d", page_count, len(text))
            return OcrResult(text=text, page_count=page_count, quality_score=quality_score)
        except Exception as exc:
            logger.warning("[DocumentAI OCR] bytes extraction failed: %s", exc)

    return _fallback_extract_from_bytes(data, mime_type)


# ── Fallback extractors ────────────────────────────────────────────────────────

def _fallback_extract_from_gcs(gs_uri: str, mime_type: str) -> OcrResult:
    try:
        from app.services.adapters.gcs import download_bytes
        data = download_bytes(gs_uri)
        return _fallback_extract_from_bytes(data, mime_type)
    except Exception as exc:
        logger.warning("[DocumentAI OCR] GCS download for fallback failed: %s", exc)
        return OcrResult(text="", page_count=0, quality_score=0.0)


def _fallback_extract_from_bytes(data: bytes, mime_type: str) -> OcrResult:
    """Try pypdf first, then raw decode."""
    if mime_type == "application/pdf" or mime_type.endswith("/pdf"):
        try:
            import io
            from pypdf import PdfReader  # type: ignore
            reader = PdfReader(io.BytesIO(data))
            pages_text = []
            for page in reader.pages:
                t = page.extract_text() or ""
                if t.strip():
                    pages_text.append(t)
            text = "\n\n".join(pages_text).strip()
            page_count = len(reader.pages)
            quality_score = min(1.0, len(text) / max(page_count * 500, 1))
            logger.info("[DocumentAI OCR] pypdf fallback pages=%d chars=%d", page_count, len(text))
            return OcrResult(text=text, page_count=page_count, quality_score=quality_score)
        except Exception as exc:
            logger.warning("[DocumentAI OCR] pypdf failed: %s", exc)

    # Last resort: try to decode bytes as UTF-8 text
    try:
        text = data.decode("utf-8", errors="ignore").strip()
        return OcrResult(text=text, page_count=1, quality_score=0.5 if text else 0.0)
    except Exception:
        return OcrResult(text="", page_count=0, quality_score=0.0)
