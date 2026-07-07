"""
Google Cloud Document AI text extraction with parallel page-batch processing.

Document AI has a per-request page limit (default 15 pages for online processing).
For larger documents the PDF is split into batches, each batch is sent to Document AI
in parallel via a ThreadPoolExecutor, and the results are merged in page order.

Progress is reported to the caller via an optional progress_callback(pct: float)
callable where pct is the document-level processing percentage (0-100).

Falls back to pypdf for PDFs and raw UTF-8 decode when Document AI is unavailable.
"""
from __future__ import annotations

import io
import logging
import os
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from typing import Callable

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


def _clean_extracted_text(text: str) -> str:
    """
    Repair deterministic PDF/OCR word-splits (e.g. "St amps" -> "Stamps",
    "De ed" -> "Deed") at extraction time so the stored text, the embeddings,
    and every downstream LLM call (DeepSeek/Claude/Gemini) receive clean input.

    Reuses the shared, SAFE repair from document_ai (number-merge + curated
    dictionary + dictionary-backed rejoiner) — it only joins KNOWN split forms,
    never a blanket short-token merge, so normal prose ("in court", "to do") is
    never corrupted. Best-effort: returns the input unchanged on any error.
    """
    if not text:
        return text
    try:
        from app.services.adapters.document_ai import normalize_ocr_artifacts
        return normalize_ocr_artifacts(text)
    except Exception:
        return text


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

def _build_ocr_process_options():
    """
    Build Document AI ``ProcessOptions`` that suppress space-fragmentation.

    The decisive lever is ``enable_native_pdf_parsing``: for born-digital PDFs
    Document AI reads the embedded Unicode text layer directly instead of
    rasterizing the page and running glyph-level OCR. That bypasses the OCR
    word-segmenter entirely, so spurious intra-word spaces ("Sug riv",
    "18 % p .a .") are never produced in the first place — no dictionary needed.

    ``enable_math_ocr`` / ``enable_symbol`` are premium and only enabled when the
    operator opts in (a basic OCR processor version would reject them otherwise).

    Returns ``None`` on any error so the caller falls back to a plain request.
    """
    try:
        from google.cloud import documentai  # type: ignore
        from app.core.config import get_settings

        s = get_settings()
        native_pdf = bool(getattr(s, "document_ai_enable_native_pdf_parsing", True))
        enable_math = bool(getattr(s, "document_ai_enable_math_ocr", False))
        enable_symbol = bool(getattr(s, "document_ai_enable_symbol", False))

        ocr_config_kwargs: dict = {"enable_native_pdf_parsing": native_pdf}
        if enable_symbol:
            ocr_config_kwargs["enable_symbol"] = True
        if enable_math:
            ocr_config_kwargs["premium_features"] = documentai.OcrConfig.PremiumFeatures(
                enable_math_ocr=True,
            )

        return documentai.ProcessOptions(ocr_config=documentai.OcrConfig(**ocr_config_kwargs))
    except Exception as exc:  # pragma: no cover - defensive
        logger.debug("[DocumentAI OCR] could not build ProcessOptions: %s", exc)
        return None


def _call_document_ai(
    batch_bytes: bytes,
    mime_type: str,
    client,
    processor_name: str,
    process_options=None,
) -> OcrResult:
    """Send a single batch to Document AI and return OcrResult."""
    from google.cloud import documentai  # type: ignore

    raw_doc = documentai.RawDocument(content=batch_bytes, mime_type=mime_type)
    request = documentai.ProcessRequest(
        name=processor_name,
        raw_document=raw_doc,
        process_options=process_options,
    )
    try:
        result = client.process_document(request=request)
    except Exception as exc:
        # A processor version that doesn't support a chosen OCR option (e.g.
        # premium math OCR) raises InvalidArgument. Never drop the batch over a
        # config mismatch — retry once with a plain request.
        if process_options is not None:
            logger.warning(
                "[DocumentAI OCR] process_options rejected (%s) — retrying without options",
                exc,
            )
            plain = documentai.ProcessRequest(name=processor_name, raw_document=raw_doc)
            result = client.process_document(request=plain)
        else:
            raise
    doc = result.document
    text = _clean_extracted_text(doc.text or "")
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


def _get_ocr_processor_version_id() -> str:
    """Return the pinned OCR processor *version* id, if configured."""
    try:
        from app.core.config import get_settings
        return (getattr(get_settings(), "document_ai_ocr_processor_version_id", "") or "").strip()
    except Exception:
        return ""


def _build_document_ai_client(location: str, project_id: str, processor_id: str):
    """
    Build a Document AI client and return (client, processor_name).

    When ``document_ai_ocr_processor_version_id`` is set we target that specific
    processor *version* (``processor_version_path``) so a stronger/newer OCR model
    can be pinned. Otherwise we fall back to the processor's default version
    (``processor_path``).
    """
    from google.cloud import documentai  # type: ignore

    client_options = {"api_endpoint": f"{location}-documentai.googleapis.com"}
    creds = _load_google_credentials()
    client = (
        documentai.DocumentProcessorServiceClient(client_options=client_options, credentials=creds)
        if creds is not None
        else documentai.DocumentProcessorServiceClient(client_options=client_options)
    )

    version_id = _get_ocr_processor_version_id()
    if version_id:
        processor_name = client.processor_version_path(
            project_id, location, processor_id, version_id
        )
        logger.info(
            "[DocumentAI OCR] using pinned processor version: %s", processor_name
        )
    else:
        processor_name = client.processor_path(project_id, location, processor_id)
    return client, processor_name


def _parallel_ocr_bytes(
    data: bytes,
    mime_type: str,
    client,
    processor_name: str,
    *,
    process_options=None,
    progress_callback: Callable[[float], None] | None = None,
    progress_start: float = 22.0,
    progress_end: float = 63.0,
) -> OcrResult:
    """
    Run Document AI OCR with parallel page batching and real-time progress reporting.

    Flow:
      1. Count pages in the PDF.
      2. If total_pages <= page_limit: send as one request (fast path).
      3. Otherwise: split into page batches of at most `page_limit` pages,
         submit every batch concurrently to a ThreadPoolExecutor,
         report progress after each batch completes, merge in page order.

    progress_callback is called with values in [progress_start, progress_end] as
    batches complete so the UI can show real-time OCR progress.
    """
    page_limit = _get_page_limit()
    num_workers = _get_ocr_workers()

    def _report(pct: float) -> None:
        if progress_callback:
            try:
                progress_callback(round(pct, 1))
            except Exception:
                pass

    # ── Single-batch fast path (non-PDF or small PDF) ─────────────────────────
    is_pdf = mime_type == "application/pdf" or mime_type.endswith("/pdf")

    if is_pdf:
        page_count = _pdf_page_count(data)
    else:
        page_count = 0

    if not is_pdf or page_count == 0 or page_count <= page_limit:
        _report(progress_start)
        t0 = time.monotonic()
        result = _call_document_ai(data, mime_type, client, processor_name, process_options)
        elapsed = time.monotonic() - t0
        logger.info(
            "[DocumentAI OCR] single-batch pages=%d chars=%d elapsed=%.2fs quality=%.2f",
            result.page_count, len(result.text), elapsed, result.quality_score,
        )
        _report(progress_end)
        return result

    # ── Large PDF: split → parallel batches → merge in page order ─────────────
    batches = _split_pdf_into_page_batches(data, page_limit)
    n_batches = len(batches)
    logger.info(
        "[DocumentAI OCR] large PDF pages=%d batches=%d (limit=%d/batch) workers=%d",
        page_count, n_batches, page_limit, num_workers,
    )
    _report(progress_start)

    batch_results: list[OcrResult | None] = [None] * n_batches
    completed_count = 0
    t0 = time.monotonic()

    with ThreadPoolExecutor(max_workers=num_workers, thread_name_prefix="ocr-batch") as pool:
        future_to_index = {
            pool.submit(_call_document_ai, batch, mime_type, client, processor_name, process_options): idx
            for idx, batch in enumerate(batches)
        }

        for future in as_completed(future_to_index):
            idx = future_to_index[future]
            try:
                batch_results[idx] = future.result()
            except Exception as exc:
                logger.warning(
                    "[DocumentAI OCR] batch %d/%d failed: %s — using empty result",
                    idx + 1, n_batches, exc,
                )
                batch_results[idx] = OcrResult(text="", page_count=0, quality_score=0.0)
            finally:
                completed_count += 1
                # Report proportional progress as each batch finishes
                progress_pct = progress_start + (completed_count / n_batches) * (progress_end - progress_start)
                _report(progress_pct)
                logger.debug(
                    "[DocumentAI OCR] batch %d/%d done (%.0f%%)",
                    completed_count, n_batches, progress_pct,
                )

    merged = _merge_ocr_results([r for r in batch_results if r is not None])
    elapsed = time.monotonic() - t0
    logger.info(
        "[DocumentAI OCR] parallel-batch done batches=%d pages=%d chars=%d elapsed=%.2fs quality=%.2f",
        n_batches, merged.page_count, len(merged.text), elapsed, merged.quality_score,
    )
    return merged


# ── Audio / Speech-to-Text extraction ─────────────────────────────────────────

def extract_text_from_audio_gcs(
    gs_uri: str,
    mime_type: str,
    *,
    filename: str | None = None,
    progress_callback: Callable[[float], None] | None = None,
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
    filename = filename or os.path.basename(gs_uri.rstrip("/"))
    mime_type = stt.resolve_media_mime_type(mime_type, filename)

    logger.info("[SpeechToText] transcribing audio uri=%s mime=%s", gs_uri, mime_type)
    try:
        # ── Primary (audio): Gemini 2.5 Flash directly from GCS URI ─────────────
        # Do NOT download the audio file unless we need to fall back to STT/inline.
        gemini_primary = ""
        if stt.is_gemini_primary_audio_mime(mime_type, filename):
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
    filename: str | None = None,
    progress_callback: Callable[[float], None] | None = None,
    progress_start: float = 22.0,
    progress_end: float = 63.0,
) -> OcrResult:
    """
    Run Document AI OCR on a file already in GCS.
    Large PDFs are split into page batches and processed in parallel.
    Audio files are routed to Speech-to-Text with real-time progress reporting.

    Args:
        gs_uri: gs://bucket/path/to/file URI.
        mime_type: MIME type of the document.
        progress_callback: Optional callable(pct: float) for real-time progress.
        progress_start: Lower bound of the progress range reported (default 22).
        progress_end: Upper bound of the progress range reported (default 63).
    """
    # Route audio files to Speech-to-Text instead of Document AI OCR
    from app.services.adapters.speech_to_text import is_audio_filename, is_audio_mime, resolve_media_mime_type
    resolved_mime_type = resolve_media_mime_type(mime_type, filename)
    if is_audio_mime(resolved_mime_type) or is_audio_filename(filename or ""):
        logger.info(
            "[Extractor] route=audio method=gemini_gcs_uri_then_stt uri=%s mime=%s",
            gs_uri,
            resolved_mime_type,
        )
        return extract_text_from_audio_gcs(
            gs_uri,
            resolved_mime_type,
            filename=filename,
            progress_callback=progress_callback,
        )

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
        return _fallback_extract_from_gcs(gs_uri, mime_type, progress_callback=progress_callback,
                                          progress_start=progress_start, progress_end=progress_end)

    try:
        logger.info(
            "[Extractor] route=document method=document_ai_ocr uri=%s mime=%s project=%s location=%s processor_id=%s",
            gs_uri,
            resolved_mime_type,
            project_id,
            location,
            processor_id,
        )
        from app.services.adapters.gcs import download_bytes
        raw_bytes = download_bytes(gs_uri)
        client, processor_name = _build_document_ai_client(location, project_id, processor_id)
        process_options = _build_ocr_process_options()
        result = _parallel_ocr_bytes(
            raw_bytes,
            resolved_mime_type,
            client,
            processor_name,
            process_options=process_options,
            progress_callback=progress_callback,
            progress_start=progress_start,
            progress_end=progress_end,
        )
        logger.info(
            "[DocumentAI OCR] Processed %s pages=%d chars=%d quality=%.2f",
            gs_uri, result.page_count, len(result.text), result.quality_score,
        )
        return result
    except Exception as exc:
        logger.warning("[DocumentAI OCR] Failed for %s: %s — falling back", gs_uri, exc)
        return _fallback_extract_from_gcs(gs_uri, resolved_mime_type, progress_callback=progress_callback,
                                          progress_start=progress_start, progress_end=progress_end)


def extract_text_from_bytes(
    data: bytes,
    mime_type: str = "application/pdf",
    filename: str = "document",
    *,
    progress_callback: Callable[[float], None] | None = None,
    progress_start: float = 22.0,
    progress_end: float = 63.0,
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
            process_options = _build_ocr_process_options()
            result = _parallel_ocr_bytes(
                data,
                mime_type,
                client,
                processor_name,
                process_options=process_options,
                progress_callback=progress_callback,
                progress_start=progress_start,
                progress_end=progress_end,
            )
            logger.info(
                "[DocumentAI OCR] bytes extracted pages=%d chars=%d quality=%.2f",
                result.page_count, len(result.text), result.quality_score,
            )
            return result
        except Exception as exc:
            logger.warning("[DocumentAI OCR] bytes extraction failed: %s — falling back", exc)

    return _fallback_extract_from_bytes(data, mime_type,
                                        progress_callback=progress_callback,
                                        progress_start=progress_start,
                                        progress_end=progress_end)


# ── Fallback extractors ────────────────────────────────────────────────────────

def _fallback_extract_from_gcs(
    gs_uri: str,
    mime_type: str,
    *,
    progress_callback: Callable[[float], None] | None = None,
    progress_start: float = 22.0,
    progress_end: float = 63.0,
) -> OcrResult:
    try:
        from app.services.adapters.gcs import download_bytes
        data = download_bytes(gs_uri)
        return _fallback_extract_from_bytes(data, mime_type, progress_callback=progress_callback,
                                            progress_start=progress_start, progress_end=progress_end)
    except Exception as exc:
        logger.warning("[DocumentAI OCR] GCS download for fallback failed: %s", exc)
        return OcrResult(text="", page_count=0, quality_score=0.0)


def _fallback_extract_from_bytes(
    data: bytes,
    mime_type: str,
    *,
    progress_callback: Callable[[float], None] | None = None,
    progress_start: float = 22.0,
    progress_end: float = 63.0,
) -> OcrResult:
    """Try pypdf first (page-by-page with per-page progress), then raw decode."""

    def _report(pct: float) -> None:
        if progress_callback:
            try:
                progress_callback(round(pct, 1))
            except Exception:
                pass

    if mime_type == "application/pdf" or mime_type.endswith("/pdf"):
        try:
            from pypdf import PdfReader  # type: ignore
            reader = PdfReader(io.BytesIO(data))
            total_pages = len(reader.pages)
            pages_text: list[str] = []
            for page_idx, page in enumerate(reader.pages):
                t = page.extract_text() or ""
                if t.strip():
                    pages_text.append(t)
                # Report per-page progress for fallback extraction
                if total_pages > 0:
                    pct = progress_start + ((page_idx + 1) / total_pages) * (progress_end - progress_start)
                    _report(pct)
            text = _clean_extracted_text("\n\n".join(pages_text).strip())
            page_count = total_pages
            quality_score = min(1.0, len(text) / max(page_count * 500, 1))
            logger.info("[DocumentAI OCR] pypdf fallback pages=%d chars=%d", page_count, len(text))
            return OcrResult(text=text, page_count=page_count, quality_score=quality_score)
        except Exception as exc:
            logger.warning("[DocumentAI OCR] pypdf failed: %s", exc)

    # Last resort: decode bytes as UTF-8
    _report(progress_start + (progress_end - progress_start) * 0.5)
    try:
        text = data.decode("utf-8", errors="ignore").strip()
        _report(progress_end)
        return OcrResult(text=text, page_count=1, quality_score=0.5 if text else 0.0)
    except Exception:
        return OcrResult(text="", page_count=0, quality_score=0.0)
