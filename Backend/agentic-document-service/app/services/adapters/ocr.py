"""
Real Google Cloud Document AI text extraction with parallel page-batch processing.

Document AI has a per-request page limit (default 15 pages for online processing).
For larger documents the PDF is split into batches, each batch is sent to Document AI
in parallel via a ThreadPoolExecutor, and the results are merged in page order.

Falls back to pypdf for PDFs and raw UTF-8 decode when Document AI is unavailable.
"""
from __future__ import annotations

import io
import logging
import os
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass

logger = logging.getLogger("agentic_document_service.document_ai_ocr")

# Document AI online-processing page limit per request.
# Override with DOCUMENT_AI_PAGE_LIMIT env var.
_DEFAULT_PAGE_LIMIT = 15
# Workers used to send page batches to Document AI in parallel.
_DEFAULT_OCR_WORKERS = 4


def _get_page_limit() -> int:
    try:
        return int(os.environ.get("DOCUMENT_AI_PAGE_LIMIT", _DEFAULT_PAGE_LIMIT))
    except (TypeError, ValueError):
        return _DEFAULT_PAGE_LIMIT


def _get_ocr_workers() -> int:
    try:
        from app.core.config import get_settings
        s = get_settings()
        return int(getattr(s, "ocr_parallel_workers", _DEFAULT_OCR_WORKERS))
    except Exception:
        return _DEFAULT_OCR_WORKERS


@dataclass
class OcrResult:
    text: str
    page_count: int
    quality_score: float


# ── PDF page-batch helpers ─────────────────────────────────────────────────────

def _pdf_page_count(data: bytes) -> int:
    """Return the number of pages in a PDF without loading all content."""
    try:
        from pypdf import PdfReader  # type: ignore
        return len(PdfReader(io.BytesIO(data)).pages)
    except Exception:
        return 0


def _split_pdf_into_page_batches(data: bytes, max_pages: int) -> list[bytes]:
    """
    Split PDF bytes into sequential batches of at most max_pages pages.
    Returns a list of PDF bytes (one entry per batch), in page order.
    """
    from pypdf import PdfReader, PdfWriter  # type: ignore

    reader = PdfReader(io.BytesIO(data))
    total = len(reader.pages)
    batches: list[bytes] = []

    for start in range(0, total, max_pages):
        end = min(start + max_pages, total)
        writer = PdfWriter()
        for i in range(start, end):
            writer.add_page(reader.pages[i])
        buf = io.BytesIO()
        writer.write(buf)
        batches.append(buf.getvalue())

    return batches


def _merge_ocr_results(results: list[OcrResult]) -> OcrResult:
    """Merge an ordered list of OcrResult objects (one per batch) into a single result."""
    if not results:
        return OcrResult(text="", page_count=0, quality_score=0.0)
    if len(results) == 1:
        return results[0]
    merged_text = "\n\n".join(r.text for r in results if r.text)
    total_pages = sum(r.page_count for r in results)
    avg_quality = sum(r.quality_score for r in results) / len(results)
    return OcrResult(text=merged_text, page_count=total_pages, quality_score=avg_quality)


# ── Document AI single-batch call ─────────────────────────────────────────────

def _call_document_ai(batch_bytes: bytes, mime_type: str, client, processor_name: str) -> OcrResult:
    """Send a single batch to Document AI and return OcrResult."""
    from google.cloud import documentai  # type: ignore

    raw_doc = documentai.RawDocument(content=batch_bytes, mime_type=mime_type)
    request = documentai.ProcessRequest(name=processor_name, raw_document=raw_doc)
    result = client.process_document(request=request)
    doc = result.document
    text = doc.text or ""
    page_count = len(doc.pages)
    avg_chars = len(text) / max(page_count, 1)
    quality_score = min(1.0, avg_chars / 500.0)
    return OcrResult(text=text, page_count=page_count, quality_score=quality_score)


def _load_google_credentials() -> object | None:
    """
    Load Google credentials for Document AI.

    Prefer service-account credentials from settings (GCS_KEY_BASE64 or
    GOOGLE_APPLICATION_CREDENTIALS) to avoid depending on interactive gcloud ADC
    (which can fail with reauth-required on Windows dev machines).
    """
    try:
        import base64
        import json

        from google.oauth2 import service_account  # type: ignore

        from app.core.config import get_settings

        settings = get_settings()
        scope = "https://www.googleapis.com/auth/cloud-platform"

        key_b64 = (settings.gcs_key_base64 or "").strip()
        if key_b64:
            key_json = base64.b64decode(key_b64).decode("utf-8")
            creds_dict = json.loads(key_json)
            return service_account.Credentials.from_service_account_info(
                creds_dict,
                scopes=[scope],
            )

        cred_path = (settings.google_application_credentials or "").strip()
        if cred_path:
            return service_account.Credentials.from_service_account_file(
                cred_path,
                scopes=[scope],
            )

        # Last resort: ADC (may require `gcloud auth application-default login`)
        import google.auth  # type: ignore

        credentials, _ = google.auth.default(scopes=[scope])
        return credentials
    except Exception:
        return None


def _build_document_ai_client(location: str, project_id: str, processor_id: str):
    """Build a Document AI client and return (client, processor_name)."""
    from google.cloud import documentai  # type: ignore

    client_options = {"api_endpoint": f"{location}-documentai.googleapis.com"}
    creds = _load_google_credentials()
    client = (
        documentai.DocumentProcessorServiceClient(client_options=client_options, credentials=creds)
        if creds is not None
        else documentai.DocumentProcessorServiceClient(client_options=client_options)
    )
    processor_name = client.processor_path(project_id, location, processor_id)
    return client, processor_name


def _parallel_ocr_bytes(
    data: bytes,
    mime_type: str,
    client,
    processor_name: str,
) -> OcrResult:
    """
    Run Document AI OCR with parallel page batching.

    1. Count pages in the PDF.
    2. If total_pages <= page_limit: send as one request (fast path).
    3. Otherwise: split into batches, submit each batch to a thread pool,
       collect results in page order, merge.
    """
    page_limit = _get_page_limit()
    num_workers = _get_ocr_workers()

    # Fast path: small document fits in a single request
    if mime_type == "application/pdf" or mime_type.endswith("/pdf"):
        page_count = _pdf_page_count(data)
        if page_count == 0 or page_count <= page_limit:
            # Single call — no batching needed
            t0 = time.monotonic()
            result = _call_document_ai(data, mime_type, client, processor_name)
            logger.info(
                "[DocumentAI OCR] single-batch pages=%d chars=%d elapsed=%.2fs quality=%.2f",
                result.page_count, len(result.text), time.monotonic() - t0, result.quality_score,
            )
            return result

        # Large document: split and process in parallel
        logger.info(
            "[DocumentAI OCR] large PDF pages=%d > limit=%d — splitting into parallel batches workers=%d",
            page_count, page_limit, num_workers,
        )
        batches = _split_pdf_into_page_batches(data, page_limit)
        batch_results: list[OcrResult | None] = [None] * len(batches)

        t0 = time.monotonic()
        with ThreadPoolExecutor(max_workers=num_workers, thread_name_prefix="ocr-batch") as pool:
            future_to_index = {
                pool.submit(_call_document_ai, batch, mime_type, client, processor_name): idx
                for idx, batch in enumerate(batches)
            }
            for future in as_completed(future_to_index):
                idx = future_to_index[future]
                try:
                    batch_results[idx] = future.result()
                except Exception as exc:
                    logger.warning(
                        "[DocumentAI OCR] batch %d/%d failed: %s — using empty result",
                        idx + 1, len(batches), exc,
                    )
                    batch_results[idx] = OcrResult(text="", page_count=0, quality_score=0.0)

        merged = _merge_ocr_results([r for r in batch_results if r is not None])
        logger.info(
            "[DocumentAI OCR] parallel-batch done batches=%d pages=%d chars=%d elapsed=%.2fs quality=%.2f",
            len(batches), merged.page_count, len(merged.text), time.monotonic() - t0, merged.quality_score,
        )
        return merged

    # Non-PDF: single call
    return _call_document_ai(data, mime_type, client, processor_name)


# ── Audio / Speech-to-Text extraction ─────────────────────────────────────────

def extract_text_from_audio_gcs(
    gs_uri: str,
    mime_type: str,
    *,
    progress_callback=None,
) -> OcrResult:
    """
    Transcribe an audio file stored in GCS.

    Delegates to ``speech_to_text.transcribe()``: Gemini 2.5 Flash (``gs://`` URI)
    first, then Google Speech-to-Text if that returns nothing, then Gemini recovery
    if STT quality is poor.

    Never raises on empty/low-quality output — returns whatever is available so
    the pipeline always stores *something* for the file.  Only raises on hard
    API / network failures where the call itself could not complete.
    """
    import os
    from app.services.adapters import speech_to_text as stt
    from app.services.adapters.gcs import download_bytes
    from app.services.audio_processing import AudioProcessingError

    # Extract filename from GCS URI for Gemini context
    filename = os.path.basename(gs_uri.rstrip("/"))

    logger.info("[SpeechToText] transcribing audio uri=%s mime=%s", gs_uri, mime_type)
    try:
        # ── Primary (audio): Gemini 2.5 Flash directly from GCS URI ─────────────
        # Do NOT download the audio file unless we need to fall back to STT/inline.
        gemini_primary = ""
        try:
            gemini_primary = (stt._transcribe_gcs_with_gemini(  # type: ignore[attr-defined]
                gs_uri,
                mime_type,
                filename=filename or "",
                model_names=[getattr(stt, "_GEMINI_PRIMARY_MODEL", "gemini-2.5-flash")],
            ) or "").strip()
        except Exception:
            gemini_primary = ""

        if gemini_primary:
            text = gemini_primary
        else:
            # Fallback: download bytes for STT paths (and possible inline-Gemini recovery).
            audio_bytes = download_bytes(gs_uri)
            text = stt.transcribe(
                gs_uri,
                audio_bytes,
                mime_type,
                progress_callback=progress_callback,
                filename=filename or "",
                skip_gemini_primary=True,  # already attempted above
            )
    except AudioProcessingError:
        raise
    except TimeoutError as exc:
        raise AudioProcessingError(f"Speech-to-Text timed out for {gs_uri}") from exc
    except Exception as exc:
        logger.error("[SpeechToText] transcription failed for %s: %s", gs_uri, exc)
        raise AudioProcessingError(f"Speech-to-Text failed for {gs_uri}: {exc}") from exc

    text = (text or "").strip()
    if not text:
        # Do not fail — store a placeholder so the file record is complete and
        # the user gets an informative response rather than a processing error.
        text = f"[Audio file: {filename}]\nNo transcribable speech or lyrics detected."
        logger.warning("[SpeechToText] empty transcript — stored placeholder for %s", gs_uri)

    quality = min(1.0, len(text) / 1000.0)
    logger.info("[SpeechToText] done — chars=%d quality=%.2f uri=%s", len(text), quality, gs_uri)
    return OcrResult(text=text, page_count=1, quality_score=quality)


# ── Public API ─────────────────────────────────────────────────────────────────

def extract_text_from_gcs(
    gs_uri: str,
    mime_type: str = "application/pdf",
    *,
    progress_callback=None,
) -> OcrResult:
    """
    Run Document AI OCR on a file already in GCS.
    Large PDFs are split into page batches and processed in parallel.
    Audio files are routed to Speech-to-Text with real-time progress reporting.

    Args:
        gs_uri: gs://bucket/path/to/file URI.
        mime_type: MIME type of the document.
        progress_callback: Optional callable(pct: float) for real-time progress.
    """
    # Route audio files to Speech-to-Text instead of Document AI OCR
    from app.services.adapters.speech_to_text import is_audio_mime
    if is_audio_mime(mime_type):
        logger.info(
            "[Extractor] route=audio method=gemini_gcs_uri_then_stt uri=%s mime=%s",
            gs_uri,
            mime_type,
        )
        return extract_text_from_audio_gcs(gs_uri, mime_type, progress_callback=progress_callback)

    from app.core.config import get_settings
    settings = get_settings()

    project_id = settings.google_cloud_project
    location = settings.google_cloud_location or "us"
    processor_id = (getattr(settings, "document_ai_processor_id", "") or "").strip()

    if not project_id or not processor_id:
        logger.warning(
            "[DocumentAI OCR] Missing project_id=%s or processor_id=%s — falling back to pypdf",
            project_id, processor_id,
        )
        return _fallback_extract_from_gcs(gs_uri, mime_type)

    try:
        # Explicitly log that PDFs/docs use Document AI (not Gemini).
        logger.info(
            "[Extractor] route=document method=document_ai_ocr uri=%s mime=%s project=%s location=%s processor_id=%s",
            gs_uri,
            mime_type,
            project_id,
            location,
            processor_id,
        )
        from app.services.adapters.gcs import download_bytes
        raw_bytes = download_bytes(gs_uri)
        client, processor_name = _build_document_ai_client(location, project_id, processor_id)
        result = _parallel_ocr_bytes(raw_bytes, mime_type, client, processor_name)
        logger.info(
            "[DocumentAI OCR] Processed %s pages=%d chars=%d quality=%.2f",
            gs_uri, result.page_count, len(result.text), result.quality_score,
        )
        return result
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
    Large PDFs are split into page batches and processed in parallel.
    Falls back to pypdf → UTF-8 if Document AI is unavailable.
    """
    from app.core.config import get_settings
    settings = get_settings()

    project_id = settings.google_cloud_project
    location = settings.google_cloud_location or "us"
    processor_id = (getattr(settings, "document_ai_processor_id", "") or "").strip()

    if project_id and processor_id:
        try:
            client, processor_name = _build_document_ai_client(location, project_id, processor_id)
            result = _parallel_ocr_bytes(data, mime_type, client, processor_name)
            logger.info(
                "[DocumentAI OCR] bytes extracted pages=%d chars=%d quality=%.2f",
                result.page_count, len(result.text), result.quality_score,
            )
            return result
        except Exception as exc:
            logger.warning("[DocumentAI OCR] bytes extraction failed: %s — falling back", exc)

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

    # Last resort: decode bytes as UTF-8
    try:
        text = data.decode("utf-8", errors="ignore").strip()
        return OcrResult(text=text, page_count=1, quality_score=0.5 if text else 0.0)
    except Exception:
        return OcrResult(text="", page_count=0, quality_score=0.0)
