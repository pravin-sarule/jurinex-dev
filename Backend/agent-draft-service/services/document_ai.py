"""Document AI text extraction. Mirrors document-service documentAiService (inline process)."""

from __future__ import annotations

import base64
import io
import json
import logging
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Dict, List, Tuple

from google.cloud.documentai_v1 import DocumentProcessorServiceClient  # type: ignore
from google.cloud.documentai_v1.types import ProcessRequest, RawDocument  # type: ignore
from google.oauth2 import service_account  # type: ignore
from pypdf import PdfReader, PdfWriter

logger = logging.getLogger(__name__)

# Document AI per-request page limit (non-imageless). Large PDFs are split into chunks of this size and processed in parallel.
DOCUMENT_AI_PAGE_LIMIT = 15
# Max workers for parallel batch processing (avoid overwhelming Document AI).
MAX_PARALLEL_WORKERS = 6


def _get_credentials():
    """Use GCS_KEY_BASE64 (service account JSON) or GOOGLE_APPLICATION_CREDENTIALS. Same as storage.py."""
    if os.environ.get("GCS_KEY_BASE64"):
        content = base64.b64decode(os.environ["GCS_KEY_BASE64"]).decode("utf-8")
        info = json.loads(content)
        return service_account.Credentials.from_service_account_info(info)
    return None


def _get_client() -> DocumentProcessorServiceClient:
    creds = _get_credentials()
    if creds is not None:
        return DocumentProcessorServiceClient(credentials=creds)
    return DocumentProcessorServiceClient()


def _extract_text_from_document(doc: Any) -> List[Dict[str, Any]]:
    """
    Extract page-wise text from Document AI document. Mirrors Node extractText.
    Returns list of {"text": str, "page_start": int, "page_end": int}.
    """
    if not doc:
        return []

    page_texts: List[Dict[str, Any]] = []
    if doc.pages:
        for i, page in enumerate(doc.pages):
            page_num = getattr(page, "page_number", None)
            if page_num is None:
                page_num = i + 1
            page_text = None

            # Paragraphs
            if hasattr(page, "paragraphs") and page.paragraphs:
                parts = []
                for p in page.paragraphs:
                    content = _text_from_layout(p)
                    if content:
                        parts.append(content)
                if parts:
                    page_text = "\n".join(parts)

            # Lines
            if not page_text and hasattr(page, "lines") and page.lines:
                parts = []
                for line in page.lines:
                    content = _text_from_layout(line)
                    if content:
                        parts.append(content)
                if parts:
                    page_text = "\n".join(parts)

            # Blocks
            if not page_text and hasattr(page, "blocks") and page.blocks:
                parts = []
                for b in page.blocks:
                    content = _text_from_layout(b)
                    if content:
                        parts.append(content)
                if parts:
                    page_text = "\n".join(parts)

            # Tokens
            if not page_text and hasattr(page, "tokens") and page.tokens:
                parts = []
                for t in page.tokens:
                    content = _text_from_layout(t)
                    if content:
                        parts.append(content)
                if parts:
                    page_text = " ".join(parts)

            if page_text and page_text.strip():
                page_texts.append({
                    "text": page_text.strip(),
                    "page_start": int(page_num),
                    "page_end": int(page_num),
                })

    if page_texts:
        return page_texts

    # Fallback: root text
    if hasattr(doc, "text") and doc.text and doc.text.strip():
        return [{"text": doc.text.strip(), "page_start": 1, "page_end": 1}]

    return []


def _text_from_layout(element: Any) -> str:
    """Get text from layout.text_anchor or layout.content (Document AI)."""
    if hasattr(element, "layout") and element.layout:
        layout = element.layout
        if hasattr(layout, "text_anchor") and layout.text_anchor:
            return _text_from_anchor(layout.text_anchor, getattr(element, "_document_text", ""))
        if hasattr(layout, "content") and layout.content:
            return layout.content
    return ""


def _text_from_anchor(anchor: Any, full_text: str) -> str:
    """Extract substring using text_anchor segments (start_index/end_index)."""
    if not full_text and hasattr(anchor, "content"):
        return getattr(anchor, "content", "") or ""
    if not hasattr(anchor, "text_segments"):
        return ""
    out = []
    for seg in anchor.text_segments:
        start = getattr(seg, "start_index", 0) or 0
        end = getattr(seg, "end_index", 0) or 0
        if end > start:
            out.append(full_text[start:end])
    return "".join(out)


def _process_single_buffer(file_buffer: bytes, mime_type: str) -> List[Dict[str, Any]]:
    """Send one document buffer to Document AI and return page texts (page_start/page_end are 1-based within that buffer)."""
    project_id = os.environ.get("GCLOUD_PROJECT_ID")
    location = os.environ.get("DOCUMENT_AI_LOCATION", "us")
    processor_id = os.environ.get("DOCUMENT_AI_PROCESSOR_ID")
    if not project_id or not processor_id:
        raise ValueError("GCLOUD_PROJECT_ID and DOCUMENT_AI_PROCESSOR_ID must be set")

    name = f"projects/{project_id}/locations/{location}/processors/{processor_id}"
    client = _get_client()

    raw_doc = RawDocument(
        content=file_buffer,
        mime_type=mime_type,
    )
    request = ProcessRequest(
        name=name,
        raw_document=raw_doc,
    )
    result = client.process_document(request=request)
    doc = result.document
    if hasattr(doc, "text") and doc.text:
        full_text = doc.text
        for page in getattr(doc, "pages", []) or []:
            for block in getattr(page, "paragraphs", []) or []:
                block._document_text = full_text  # type: ignore
            for block in getattr(page, "lines", []) or []:
                block._document_text = full_text  # type: ignore
            for block in getattr(page, "blocks", []) or []:
                block._document_text = full_text  # type: ignore
            for block in getattr(page, "tokens", []) or []:
                block._document_text = full_text  # type: ignore
    return _extract_text_from_document(doc)


def _split_pdf_into_batches(file_buffer: bytes, page_limit: int) -> List[Tuple[bytes, int]]:
    """
    Split a PDF into sub-PDFs of at most page_limit pages.
    Returns list of (sub_pdf_bytes, page_offset) where page_offset is 1-based start page in original.
    """
    reader = PdfReader(io.BytesIO(file_buffer))
    total_pages = len(reader.pages)
    if total_pages <= 0:
        return []
    batches: List[Tuple[bytes, int]] = []
    start = 0
    while start < total_pages:
        end = min(start + page_limit, total_pages)
        writer = PdfWriter()
        for i in range(start, end):
            writer.add_page(reader.pages[i])
        buf = io.BytesIO()
        writer.write(buf)
        buf.seek(0)
        batches.append((buf.read(), start + 1))
        start = end
    return batches


def _process_one_batch(args: Tuple[bytes, int, str]) -> List[Dict[str, Any]]:
    """Process a single batch (sub_buffer, page_offset, mime_type). Returns page texts with original doc page numbers."""
    sub_buffer, page_offset, mime_type = args
    page_texts = _process_single_buffer(sub_buffer, mime_type)
    return [
        {
            "text": p.get("text", ""),
            "page_start": (p.get("page_start") or 0) + page_offset - 1,
            "page_end": (p.get("page_end") or 0) + page_offset - 1,
        }
        for p in page_texts
    ]


def extract_text_from_document(file_buffer: bytes, mime_type: str) -> List[Dict[str, Any]]:
    """
    Process document with Document AI. For large PDFs (over DOCUMENT_AI_PAGE_LIMIT pages),
    splits into chunks and processes them in parallel, then merges results.
    """
    mime = (mime_type or "").lower()
    if mime not in ("application/pdf", "application/x-pdf") or len(file_buffer) == 0:
        return _process_single_buffer(file_buffer, mime_type)

    try:
        reader = PdfReader(io.BytesIO(file_buffer))
        page_count = len(reader.pages)
    except Exception as e:
        logger.warning("Could not get PDF page count, will try single request: %s", e)
        return _process_single_buffer(file_buffer, mime_type)

    if page_count <= DOCUMENT_AI_PAGE_LIMIT:
        return _process_single_buffer(file_buffer, mime_type)

    batches = _split_pdf_into_batches(file_buffer, DOCUMENT_AI_PAGE_LIMIT)
    logger.info(
        "Document has %s pages; processing %s batches in parallel (max_workers=%s)",
        page_count,
        len(batches),
        min(MAX_PARALLEL_WORKERS, len(batches)),
    )
    task_args = [(buf, offset, mime_type) for buf, offset in batches]
    all_page_texts: List[Dict[str, Any]] = []
    workers = min(MAX_PARALLEL_WORKERS, len(batches))
    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {executor.submit(_process_one_batch, a): a for a in task_args}
        for future in as_completed(futures):
            args = futures[future]
            try:
                batch_result = future.result()
                all_page_texts.extend(batch_result)
            except Exception as e:
                page_offset = args[1]
                logger.exception("Parallel batch failed (pages %s+): %s", page_offset, e)
                raise
    # Sort by page_start so merged order is stable
    all_page_texts.sort(key=lambda p: (p.get("page_start") or 0, p.get("page_end") or 0))
    return all_page_texts
