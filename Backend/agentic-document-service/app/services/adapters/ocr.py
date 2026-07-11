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
from typing import Any

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
    structured_json: dict[str, Any] | None = None


def _word_ocr_result(
    data: bytes, *, mime_type: str | None, filename: str | None, source: str = ""
) -> OcrResult:
    """Extract text from a Word (.docx/.doc) document via the XML adapter.

    Document AI does not accept Word MIME types, so these files must be handled
    here rather than being sent to OCR (which throws) and dropping through to the
    pypdf / raw-UTF-8 fallback that yields empty or garbage text.
    """
    from app.services.adapters.word import extract_word_text
    try:
        text = (extract_word_text(data, mime_type=mime_type, filename=filename) or "").strip()
    except Exception as exc:
        logger.warning("[Extractor] route=word extraction failed source=%s error=%s", source, exc)
        text = ""
    # DOCX carries no intrinsic page count; estimate ~1800 chars/page for
    # progress/quality reporting only (not used for chunking).
    page_count = max(1, round(len(text) / 1800)) if text else 0
    quality_score = 0.9 if len(text) > 100 else (0.5 if text else 0.0)
    structured_json = _structured_from_page_texts([text] if text else [], source="docx_xml")
    logger.info(
        "[Extractor] route=word method=docx_xml source=%s chars=%d pages~%d",
        source, len(text), page_count,
    )
    return OcrResult(
        text=text,
        page_count=page_count,
        quality_score=quality_score,
        structured_json=structured_json,
    )


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


def _merge_structured_json(results: list[OcrResult], merged_text: str) -> dict[str, Any] | None:
    structured_results = [r.structured_json for r in results if isinstance(r.structured_json, dict)]
    if not structured_results:
        return None

    pages: list[dict[str, Any]] = []
    for payload in structured_results:
        payload_pages = payload.get("pages")
        if isinstance(payload_pages, list):
            pages.extend(page for page in payload_pages if isinstance(page, dict))

    first = structured_results[0]
    return {
        "schemaVersion": 1,
        "source": first.get("source") or "document_ai_ocr",
        "provider": first.get("provider") or "google_document_ai",
        "text": merged_text,
        "pageCount": len(pages) or sum(r.page_count for r in results),
        "pages": pages,
        "batchCount": len(structured_results),
    }


def _merge_ocr_results(results: list[OcrResult]) -> OcrResult:
    """Merge an ordered list of OcrResult objects (one per batch) into a single result."""
    if not results:
        return OcrResult(text="", page_count=0, quality_score=0.0)
    if len(results) == 1:
        return results[0]
    merged_text = "\n\n".join(r.text for r in results if r.text)
    total_pages = sum(r.page_count for r in results)
    avg_quality = sum(r.quality_score for r in results) / len(results)
    return OcrResult(
        text=merged_text,
        page_count=total_pages,
        quality_score=avg_quality,
        structured_json=_merge_structured_json(results, merged_text),
    )


def _text_from_anchor(document_text: str, text_anchor: Any) -> str:
    segments = getattr(text_anchor, "text_segments", None) or []
    parts: list[str] = []
    for segment in segments:
        try:
            start = int(getattr(segment, "start_index", 0) or 0)
            end = int(getattr(segment, "end_index", 0) or 0)
        except (TypeError, ValueError):
            continue
        if end > start:
            parts.append(document_text[start:end])
    return "".join(parts)


def _layout_text(element: Any, document_text: str) -> str:
    layout = getattr(element, "layout", None)
    if not layout:
        return ""
    anchor = getattr(layout, "text_anchor", None)
    if anchor:
        text = _text_from_anchor(document_text, anchor)
        if text:
            return text
    return str(getattr(layout, "content", "") or "")


def _page_dimension(page: Any) -> dict[str, Any]:
    dimension = getattr(page, "dimension", None)
    if not dimension:
        return {"width": None, "height": None, "unit": ""}
    width = getattr(dimension, "width", None)
    height = getattr(dimension, "height", None)
    return {
        "width": float(width) if width is not None else None,
        "height": float(height) if height is not None else None,
        "unit": str(getattr(dimension, "unit", "") or ""),
    }


def _layout_bbox(layout: Any, page_width: float | None = None, page_height: float | None = None) -> dict[str, float] | None:
    poly = getattr(layout, "bounding_poly", None)
    if not poly:
        return None
    vertices = list(getattr(poly, "normalized_vertices", None) or [])
    normalized = True
    if not vertices:
        vertices = list(getattr(poly, "vertices", None) or [])
        normalized = False
    if not vertices:
        return None

    xs: list[float] = []
    ys: list[float] = []
    for vertex in vertices:
        try:
            x = float(getattr(vertex, "x", 0) or 0)
            y = float(getattr(vertex, "y", 0) or 0)
        except (TypeError, ValueError):
            continue
        if not normalized:
            if page_width and page_width > 0:
                x = x / page_width
            if page_height and page_height > 0:
                y = y / page_height
        xs.append(max(0.0, min(1.0, x)))
        ys.append(max(0.0, min(1.0, y)))

    if not xs or not ys:
        return None

    left = min(xs)
    top = min(ys)
    right = max(xs)
    bottom = max(ys)
    return {
        "left": round(left, 6),
        "top": round(top, 6),
        "width": round(max(0.0, right - left), 6),
        "height": round(max(0.0, bottom - top), 6),
    }


def _layout_confidence(layout: Any) -> float | None:
    value = getattr(layout, "confidence", None)
    if value is None:
        return None
    try:
        return round(float(value), 4)
    except (TypeError, ValueError):
        return None


def _layout_item(
    element: Any,
    document_text: str,
    *,
    item_type: str,
    page_width: float | None,
    page_height: float | None,
) -> dict[str, Any] | None:
    text = _layout_text(element, document_text).strip()
    if not text:
        return None

    layout = getattr(element, "layout", None)
    item: dict[str, Any] = {"type": item_type, "text": text}
    if layout:
        bbox = _layout_bbox(layout, page_width, page_height)
        if bbox:
            item["boundingBox"] = bbox
        confidence = _layout_confidence(layout)
        if confidence is not None:
            item["confidence"] = confidence
        orientation = str(getattr(layout, "orientation", "") or "")
        if orientation:
            item["orientation"] = orientation
    return item


def _layout_items(
    page: Any,
    attr: str,
    document_text: str,
    *,
    page_width: float | None,
    page_height: float | None,
) -> list[dict[str, Any]]:
    elements = getattr(page, attr, None) or []
    singular = attr[:-1] if attr.endswith("s") else attr
    items: list[dict[str, Any]] = []
    for element in elements:
        item = _layout_item(
            element,
            document_text,
            item_type=singular,
            page_width=page_width,
            page_height=page_height,
        )
        if item:
            items.append(item)
    return items


def _table_cell_to_dict(cell: Any, document_text: str, page_width: float | None, page_height: float | None) -> dict[str, Any]:
    layout = getattr(cell, "layout", None)
    out: dict[str, Any] = {
        "text": _layout_text(cell, document_text).strip(),
        "rowSpan": int(getattr(cell, "row_span", 1) or 1),
        "colSpan": int(getattr(cell, "col_span", 1) or 1),
    }
    if layout:
        bbox = _layout_bbox(layout, page_width, page_height)
        if bbox:
            out["boundingBox"] = bbox
        confidence = _layout_confidence(layout)
        if confidence is not None:
            out["confidence"] = confidence
    return out


def _table_rows_to_list(rows: Any, document_text: str, page_width: float | None, page_height: float | None) -> list[list[dict[str, Any]]]:
    result: list[list[dict[str, Any]]] = []
    for row in rows or []:
        result.append([
            _table_cell_to_dict(cell, document_text, page_width, page_height)
            for cell in (getattr(row, "cells", None) or [])
        ])
    return result


def _tables_to_dicts(page: Any, document_text: str, page_width: float | None, page_height: float | None) -> list[dict[str, Any]]:
    tables: list[dict[str, Any]] = []
    for table in getattr(page, "tables", None) or []:
        layout = getattr(table, "layout", None)
        item: dict[str, Any] = {
            "text": _layout_text(table, document_text).strip(),
            "headerRows": _table_rows_to_list(getattr(table, "header_rows", None), document_text, page_width, page_height),
            "bodyRows": _table_rows_to_list(getattr(table, "body_rows", None), document_text, page_width, page_height),
        }
        if layout:
            bbox = _layout_bbox(layout, page_width, page_height)
            if bbox:
                item["boundingBox"] = bbox
        tables.append(item)
    return tables


def _document_to_structured_json(doc: Any, *, page_offset: int = 0, processor_name: str = "") -> dict[str, Any]:
    document_text = str(getattr(doc, "text", "") or "")
    pages: list[dict[str, Any]] = []
    for index, page in enumerate(getattr(doc, "pages", None) or []):
        dimension = _page_dimension(page)
        page_width = dimension.get("width")
        page_height = dimension.get("height")
        page_text = _layout_text(page, document_text).strip()
        blocks = _layout_items(page, "blocks", document_text, page_width=page_width, page_height=page_height)
        paragraphs = _layout_items(page, "paragraphs", document_text, page_width=page_width, page_height=page_height)
        lines = _layout_items(page, "lines", document_text, page_width=page_width, page_height=page_height)
        if not page_text:
            preferred = lines or paragraphs or blocks
            page_text = "\n".join(item.get("text", "") for item in preferred if item.get("text")).strip()
        pages.append(
            {
                "pageNumber": page_offset + index + 1,
                "dimension": dimension,
                "text": page_text,
                "blocks": blocks,
                "paragraphs": paragraphs,
                "lines": lines,
                "tables": _tables_to_dicts(page, document_text, page_width, page_height),
            }
        )

    return {
        "schemaVersion": 1,
        "source": "document_ai_ocr",
        "provider": "google_document_ai",
        "processorName": processor_name,
        "text": document_text,
        "pageCount": len(pages),
        "pages": pages,
    }


def _structured_from_page_texts(page_texts: list[str], *, source: str) -> dict[str, Any]:
    pages: list[dict[str, Any]] = []
    for index, text in enumerate(page_texts):
        lines = [
            {"type": "line", "text": line.strip()}
            for line in str(text or "").splitlines()
            if line.strip()
        ]
        pages.append(
            {
                "pageNumber": index + 1,
                "dimension": {"width": None, "height": None, "unit": ""},
                "text": str(text or "").strip(),
                "blocks": [],
                "paragraphs": [],
                "lines": lines,
                "tables": [],
            }
        )
    full_text = "\n\n".join(page.get("text", "") for page in pages if page.get("text")).strip()
    return {
        "schemaVersion": 1,
        "source": source,
        "provider": source,
        "text": full_text,
        "pageCount": len(pages),
        "pages": pages,
    }


# ── Document AI single-batch call ─────────────────────────────────────────────

def _call_document_ai(
    batch_bytes: bytes,
    mime_type: str,
    client,
    processor_name: str,
    page_offset: int = 0,
) -> OcrResult:
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
    structured_json = _document_to_structured_json(
        doc,
        page_offset=page_offset,
        processor_name=processor_name,
    )
    return OcrResult(
        text=text,
        page_count=page_count,
        quality_score=quality_score,
        structured_json=structured_json,
    )


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
                pool.submit(_call_document_ai, batch, mime_type, client, processor_name, idx * page_limit): idx
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
    filename: str | None = None,
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
    structured_json = _structured_from_page_texts([text], source="speech_to_text")
    logger.info("[SpeechToText] done — chars=%d quality=%.2f uri=%s", len(text), quality, gs_uri)
    return OcrResult(text=text, page_count=1, quality_score=quality, structured_json=structured_json)


# ── Public API ─────────────────────────────────────────────────────────────────

def extract_text_from_gcs(
    gs_uri: str,
    mime_type: str = "application/pdf",
    *,
    filename: str | None = None,
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

    # Route Word documents (.docx/.doc) to the XML text extractor. Document AI
    # rejects Word MIME types, so without this they fall through to the pypdf /
    # UTF-8 fallback and yield empty/garbage text.
    from app.services.adapters.word import is_word_filename, is_word_mime
    if is_word_mime(resolved_mime_type) or is_word_filename(filename or ""):
        from app.services.adapters.gcs import download_bytes
        return _word_ocr_result(
            download_bytes(gs_uri), mime_type=resolved_mime_type, filename=filename, source=gs_uri,
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
        return _fallback_extract_from_gcs(gs_uri, mime_type)

    try:
        # Explicitly log that PDFs/docs use Document AI (not Gemini).
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
        result = _parallel_ocr_bytes(raw_bytes, resolved_mime_type, client, processor_name)
        logger.info(
            "[DocumentAI OCR] Processed %s pages=%d chars=%d quality=%.2f",
            gs_uri, result.page_count, len(result.text), result.quality_score,
        )
        return result
    except Exception as exc:
        logger.warning("[DocumentAI OCR] Failed for %s: %s — falling back", gs_uri, exc)
        return _fallback_extract_from_gcs(gs_uri, resolved_mime_type)


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
    # Word documents (.docx/.doc) are not accepted by Document AI — extract via XML.
    from app.services.adapters.word import is_word_filename, is_word_mime
    if is_word_mime(mime_type) or is_word_filename(filename or ""):
        return _word_ocr_result(data, mime_type=mime_type, filename=filename, source=filename or "bytes")

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
                pages_text.append(t)
            text = "\n\n".join(t for t in pages_text if t.strip()).strip()
            page_count = len(reader.pages)
            quality_score = min(1.0, len(text) / max(page_count * 500, 1))
            logger.info("[DocumentAI OCR] pypdf fallback pages=%d chars=%d", page_count, len(text))
            return OcrResult(
                text=text,
                page_count=page_count,
                quality_score=quality_score,
                structured_json=_structured_from_page_texts(pages_text, source="pypdf"),
            )
        except Exception as exc:
            logger.warning("[DocumentAI OCR] pypdf failed: %s", exc)

    # Last resort: decode bytes as UTF-8
    try:
        text = data.decode("utf-8", errors="ignore").strip()
        return OcrResult(
            text=text,
            page_count=1 if text else 0,
            quality_score=0.5 if text else 0.0,
            structured_json=_structured_from_page_texts([text] if text else [], source="utf8_decode"),
        )
    except Exception:
        return OcrResult(text="", page_count=0, quality_score=0.0)
