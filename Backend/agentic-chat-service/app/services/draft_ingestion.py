"""Stage 1 — Document Ingestion Check (zero LLM calls, fail-loud).

Runs at generation time, BEFORE any model call, over every supporting
document of the session:

- each blob must resolve (GCS/local) and its MIME type must be allowed —
  a failure here is FATAL and stops the pipeline loudly, never silently;
- each document is probed for a text layer. Scanned/image-based PDFs and
  images have none: they are routed through Gemini's vision path (raw bytes
  as multimodal parts — the existing behaviour) and flagged ``ocr_derived``
  so downstream validation applies a higher scrutiny bar;
- page and estimated token counts are logged per document. When the corpus
  approaches the extraction model's context budget, documents are split into
  multiple extraction batches instead of being truncated silently.

Returns the report as plain dicts (SSE/jsonb friendly) plus the extracted
text per document, which Stage 2 reuses to verify citations without
re-reading blobs.
"""
from __future__ import annotations

import logging
import math
import os
from typing import Any

logger = logging.getLogger(__name__)

# Gemini bills roughly 258 tokens per document page / image when read visually.
_TOKENS_PER_VISUAL_PAGE = 258
# Rough bytes-per-page for a scanned PDF whose page count cannot be read.
_SCANNED_PDF_BYTES_PER_PAGE = 50_000

# Leave headroom under the extraction model's context window (Flash: 1M).
DEFAULT_EXTRACT_TOKEN_BUDGET = int(
    os.environ.get("DRAFT_EXTRACT_TOKEN_BUDGET", "700000")
)


def _probe_document(doc: dict[str, Any]) -> tuple[dict[str, Any], str]:
    """Inspect ONE supporting document. Returns (record, extracted_text)."""
    # Deferred import — drafting_service imports this module at top level.
    from app.services.drafting_service import (
        ALLOWED_MIME_TYPES,
        _extract_pdf_text,
        extract_docx_text,
        load_blob,
    )

    name = str(doc.get("name") or "document").strip() or "document"
    mime = (doc.get("mime_type") or "").split(";")[0].strip().lower()
    record: dict[str, Any] = {
        "doc_id": doc.get("doc_id") or "",
        "name": name,
        "mime_type": mime,
        "size_bytes": int(doc.get("size") or 0),
        "resolvable": False,
        "mime_ok": mime in ALLOWED_MIME_TYPES,
        "text_extractable": False,
        "ocr_derived": False,
        "pages": None,
        "est_tokens": 0,
        "error": "",
    }

    if not doc.get("gcs_path"):
        record["error"] = "document has no storage path"
        return record, ""
    try:
        data = load_blob(doc["gcs_path"])
    except Exception as exc:
        record["error"] = f"blob does not resolve: {exc}"
        return record, ""
    record["resolvable"] = True
    record["size_bytes"] = record["size_bytes"] or len(data)
    if not record["mime_ok"]:
        record["error"] = f"MIME type '{mime}' is not allowed"
        return record, ""

    text = ""
    if mime.startswith("image/"):
        # Images have no text layer — Gemini reads them visually (OCR path).
        record["ocr_derived"] = True
        record["est_tokens"] = _TOKENS_PER_VISUAL_PAGE
        return record, ""
    if "pdf" in mime or name.lower().endswith(".pdf"):
        try:
            from pypdf import PdfReader
            import io as _io
            record["pages"] = len(PdfReader(_io.BytesIO(data)).pages)
        except Exception:
            record["pages"] = None
        text = _extract_pdf_text(data) or ""
        if not text.strip():
            # Scanned/image-based PDF: no text layer — explicit vision routing,
            # flagged for the higher downstream scrutiny bar.
            record["ocr_derived"] = True
            pages = record["pages"] or max(
                1, record["size_bytes"] // _SCANNED_PDF_BYTES_PER_PAGE
            )
            record["est_tokens"] = pages * _TOKENS_PER_VISUAL_PAGE
            return record, ""
    elif "word" in mime or name.lower().endswith(".docx"):
        try:
            text = extract_docx_text(data)
        except Exception as exc:
            record["error"] = f"docx not readable: {exc}"
            return record, ""
    else:
        text = data.decode("utf-8", errors="replace")

    text = (text or "").strip()
    if not text:
        record["error"] = "no extractable text"
        return record, ""
    record["text_extractable"] = True
    record["est_tokens"] = max(1, math.ceil(len(text) / 4))
    return record, text


def _plan_batches(
    records: list[dict[str, Any]], token_budget: int
) -> list[list[str]]:
    """Greedy split of documents into extraction batches under the budget.

    A single oversized document still gets its own batch (Gemini's real
    context is larger than the budget headroom) — nothing is ever dropped.
    """
    batches: list[list[str]] = []
    current: list[str] = []
    current_tokens = 0
    for rec in records:
        tokens = int(rec.get("est_tokens") or 0)
        if current and current_tokens + tokens > token_budget:
            batches.append(current)
            current, current_tokens = [], 0
        current.append(rec["doc_id"] or rec["name"])
        current_tokens += tokens
    if current:
        batches.append(current)
    return batches or [[]]


def run_ingestion_check(
    docs: list[dict[str, Any]],
    token_budget: int | None = None,
) -> tuple[dict[str, Any], dict[str, str]]:
    """Stage 1 over all supporting documents.

    Returns (report, texts) where ``texts`` maps doc_id → extracted plain
    text (empty string for OCR-only documents). ``report["ok"]`` is False
    when any document fails a FATAL check (unresolvable blob, bad MIME) —
    the caller must stop the pipeline and surface ``report["fatal"]``.
    """
    budget = int(token_budget or DEFAULT_EXTRACT_TOKEN_BUDGET)
    records: list[dict[str, Any]] = []
    texts: dict[str, str] = {}
    fatal: list[str] = []

    for doc in docs or []:
        record, text = _probe_document(doc)
        records.append(record)
        if record["doc_id"]:
            texts[record["doc_id"]] = text
        if not record["resolvable"] or not record["mime_ok"]:
            fatal.append(f"{record['name']}: {record['error'] or 'ingestion failed'}")
        elif record["error"]:
            # Readable blob but no usable content — also fail loudly: a
            # document the model cannot read must never be silently skipped.
            fatal.append(f"{record['name']}: {record['error']}")
        logger.info(
            "Ingestion check doc=%s mime=%s pages=%s est_tokens=%s "
            "text_extractable=%s ocr_derived=%s error=%r",
            record["name"], record["mime_type"], record["pages"],
            record["est_tokens"], record["text_extractable"],
            record["ocr_derived"], record["error"],
        )

    total = sum(int(r.get("est_tokens") or 0) for r in records)
    usable = [r for r in records if r["resolvable"] and r["mime_ok"] and not r["error"]]
    batches = _plan_batches(usable, budget)
    if len(batches) > 1:
        logger.info(
            "Ingestion: corpus ~%s tokens exceeds budget %s — split into %s "
            "extraction batches (no truncation)", total, budget, len(batches),
        )

    report = {
        "ok": not fatal,
        "fatal": fatal,
        "documents": records,
        "total_est_tokens": total,
        "token_budget": budget,
        "batches": batches,
        "ocr_derived_docs": [r["name"] for r in records if r.get("ocr_derived")],
    }
    return report, texts
