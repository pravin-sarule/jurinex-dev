"""Tests for the 4-stage zero-hallucination pipeline (monolithic drafting).

    cd Backend/agentic-chat-service && python -m pytest tests/test_grounded_pipeline.py -q

Covers the deterministic (zero-LLM) layers:
- Stage 1 ingestion check: fail-loud blob/MIME checks, OCR-derived flagging,
  token estimation and batch splitting;
- Stage 2 validation: programmatic source_snippet verification (verbatim,
  whitespace noise, fabricated citations, OCR leniency), cross-batch merge
  with conflict flagging, verified-ledger rendering;
- Stage 3 plumbing: the verified field ledger reaches the monolithic prompt.
"""
from __future__ import annotations

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from app.services.draft_grounded_extraction import (  # noqa: E402
    build_target_fields,
    merge_extracted_fields,
    render_verified_fields_block,
    summarize_field_review,
    validate_extracted_fields,
)


# ── helpers ────────────────────────────────────────────────────────────────

DOCS = [
    {"doc_id": "d1", "name": "invoice.pdf", "mime_type": "application/pdf",
     "gcs_path": "x/d1", "size": 1000},
    {"doc_id": "d2", "name": "scan.pdf", "mime_type": "application/pdf",
     "gcs_path": "x/d2", "size": 1000},
]

TEXTS = {
    "d1": (
        "TAX INVOICE No. NEX/INV/2025/26/041 dated 15 March 2024.\n"
        "Billed to M/s Acme Industries Private Limited for Rs. 12,50,000.00 "
        "payable within thirty (30) days."
    ),
    "d2": "",  # scanned — no text layer
}

INGESTION = {"ocr_derived_docs": ["scan.pdf"]}


def field(name, value="", source="", snippet="", found=True, **kw):
    return {
        "field_name": name, "value": value, "source_document": source,
        "source_snippet": snippet, "confidence": "high", "found": found,
        "conflict": False, "conflicting_value": "", "conflicting_source": "",
        **kw,
    }


# ── Stage 2: snippet validation ────────────────────────────────────────────

def test_verbatim_snippet_verified():
    out = validate_extracted_fields(
        [field("invoice_no", "NEX/INV/2025/26/041", "invoice.pdf",
               "TAX INVOICE No. NEX/INV/2025/26/041 dated 15 March 2024")],
        DOCS, TEXTS, INGESTION,
    )
    assert out[0]["verification"] == "verified"


def test_whitespace_noise_still_verified():
    out = validate_extracted_fields(
        [field("amount", "Rs. 12,50,000.00", "invoice.pdf",
               "for  Rs.   12,50,000.00\npayable within thirty")],
        DOCS, TEXTS, INGESTION,
    )
    assert out[0]["verification"] == "verified"


def test_fabricated_snippet_unverified():
    out = validate_extracted_fields(
        [field("party", "Globex Corporation", "invoice.pdf",
               "Billed to M/s Globex Corporation for services rendered")],
        DOCS, TEXTS, INGESTION,
    )
    assert out[0]["verification"] == "unverified"


def test_found_false_is_missing():
    out = validate_extracted_fields(
        [field("court_name", found=False)], DOCS, TEXTS, INGESTION,
    )
    assert out[0]["verification"] == "missing"


def test_ocr_source_without_text_layer_flagged():
    out = validate_extracted_fields(
        [field("date", "1 April 2024", "scan.pdf", "dated 1 April 2024")],
        DOCS, TEXTS, INGESTION,
    )
    assert out[0]["verification"] == "unverifiable_ocr"


def test_unknown_source_document_unverified():
    out = validate_extracted_fields(
        [field("date", "1 April 2024", "nonexistent.pdf", "dated 1 April 2024")],
        DOCS, TEXTS, INGESTION,
    )
    assert out[0]["verification"] == "unverified"


def test_empty_snippet_with_found_true_unverified():
    out = validate_extracted_fields(
        [field("amount", "Rs. 5", "invoice.pdf", snippet="")],
        DOCS, TEXTS, INGESTION,
    )
    assert out[0]["verification"] == "unverified"


# ── Stage 2: cross-batch merge + conflicts ─────────────────────────────────

def test_merge_conflict_flagged_not_silently_resolved():
    merged = merge_extracted_fields([
        [field("due_date", "15 April 2024", "invoice.pdf", "due on 15 April 2024")],
        [field("due_date", "30 April 2024", "agreement.pdf", "due on 30 April 2024")],
    ])
    assert len(merged) == 1
    f = merged[0]
    assert f["conflict"] is True
    assert f["value"] == "15 April 2024"
    assert f["conflicting_value"] == "30 April 2024"
    assert f["conflicting_source"] == "agreement.pdf"


def test_merge_later_batch_fills_missing():
    merged = merge_extracted_fields([
        [field("cin", found=False)],
        [field("cin", "U12345MH2020PTC123456", "roc.pdf", "CIN U12345MH2020PTC123456")],
    ])
    assert merged[0]["found"] is True
    assert merged[0]["value"] == "U12345MH2020PTC123456"
    assert not merged[0]["conflict"]


def test_merge_same_value_no_conflict():
    merged = merge_extracted_fields([
        [field("party", "Acme Ltd", "a.pdf", "Acme Ltd")],
        [field("party", "acme  ltd", "b.pdf", "acme ltd")],
    ])
    assert merged[0]["conflict"] is False


# ── Ledger rendering + review summary ──────────────────────────────────────

def _validated_sample():
    return validate_extracted_fields(
        [
            field("invoice_no", "NEX/INV/2025/26/041", "invoice.pdf",
                  "TAX INVOICE No. NEX/INV/2025/26/041"),
            field("court_name", found=False),
            field("party", "Globex Corporation", "invoice.pdf", "M/s Globex Corporation"),
            {**field("due_date", "15 April 2024", "invoice.pdf", "payable within thirty"),
             "conflict": True, "conflicting_value": "30 April 2024",
             "conflicting_source": "agreement.pdf"},
        ],
        DOCS, TEXTS, INGESTION,
    )


def test_render_ledger_sections():
    block = render_verified_fields_block(_validated_sample())
    assert "VERIFIED (copy character-for-character):" in block
    assert "invoice_no = NEX/INV/2025/26/041" in block
    assert "MISSING" in block and "court_name" in block
    assert "CONFLICT" in block and "30 April 2024" in block
    assert "UNVERIFIED CITATION" in block and "Globex" in block


def test_summary_counts():
    s = summarize_field_review(_validated_sample())
    assert s["total"] == 4
    assert s["verified"] == 1
    assert s["missing"] == 1
    assert s["conflicts"] == 1
    assert s["unverified"] == 1
    assert s["conflictFields"][0]["conflictingValue"] == "30 April 2024"


def test_target_fields_from_template_and_fallback():
    structure = {
        "global_placeholders": [
            {"key": "party_1_name", "label": "First Party", "description": "x",
             "data_type": "name"},
        ],
        "sections": [
            {"placeholders": [
                {"key": "party_1_name", "label": "dup ignored"},
                {"key": "suit_amount", "label": "Suit amount", "data_type": "currency"},
            ]},
        ],
    }
    fields = build_target_fields(structure)
    keys = [f["key"] for f in fields]
    assert keys == ["party_1_name", "suit_amount"]
    # Template without placeholders falls back to the universal core set.
    assert any(f["key"] == "party_names" for f in build_target_fields({"sections": []}))


# ── Stage 1: ingestion check ───────────────────────────────────────────────

def _run_ingestion(monkeypatch, blobs, docs, **kw):
    import app.services.drafting_service as svc
    from app.services.draft_ingestion import run_ingestion_check

    def fake_load(path):
        if path not in blobs:
            raise FileNotFoundError(path)
        return blobs[path]

    monkeypatch.setattr(svc, "load_blob", fake_load)
    return run_ingestion_check(docs, **kw)


def test_ingestion_text_doc_ok(monkeypatch):
    report, texts = _run_ingestion(
        monkeypatch,
        {"p/a": b"AGREEMENT dated 15 March 2024 between Acme and Globex." * 5},
        [{"doc_id": "a", "name": "a.txt", "mime_type": "text/plain",
          "gcs_path": "p/a", "size": 100}],
    )
    assert report["ok"] is True
    rec = report["documents"][0]
    assert rec["text_extractable"] and not rec["ocr_derived"]
    assert rec["est_tokens"] > 0
    assert "AGREEMENT" in texts["a"]


def test_ingestion_scanned_pdf_flagged_ocr(monkeypatch):
    report, texts = _run_ingestion(
        monkeypatch,
        {"p/s": b"%PDF-1.4 not-really-parseable-scan-bytes" + b"\x00" * 200},
        [{"doc_id": "s", "name": "scan.pdf", "mime_type": "application/pdf",
          "gcs_path": "p/s", "size": 240}],
    )
    assert report["ok"] is True
    rec = report["documents"][0]
    assert rec["ocr_derived"] is True
    assert rec["text_extractable"] is False
    assert "scan.pdf" in report["ocr_derived_docs"]
    assert texts["s"] == ""


def test_ingestion_missing_blob_is_fatal(monkeypatch):
    report, _ = _run_ingestion(
        monkeypatch, {},
        [{"doc_id": "m", "name": "gone.pdf", "mime_type": "application/pdf",
          "gcs_path": "p/missing", "size": 10}],
    )
    assert report["ok"] is False
    assert "gone.pdf" in report["fatal"][0]


def test_ingestion_bad_mime_is_fatal(monkeypatch):
    report, _ = _run_ingestion(
        monkeypatch, {"p/z": b"MZ\x90\x00"},
        [{"doc_id": "z", "name": "app.exe", "mime_type": "application/x-msdownload",
          "gcs_path": "p/z", "size": 4}],
    )
    assert report["ok"] is False
    assert "MIME" in report["fatal"][0]


def test_ingestion_batch_split_over_budget(monkeypatch):
    big = b"word " * 4000  # ~5k tokens each
    docs = [
        {"doc_id": f"d{i}", "name": f"d{i}.txt", "mime_type": "text/plain",
         "gcs_path": f"p/{i}", "size": len(big)}
        for i in range(4)
    ]
    report, _ = _run_ingestion(
        monkeypatch, {f"p/{i}": big for i in range(4)}, docs,
        token_budget=9000,
    )
    assert report["ok"] is True
    assert len(report["batches"]) >= 2
    # every doc appears in exactly one batch — nothing truncated or dropped
    flat = [d for b in report["batches"] for d in b]
    assert sorted(flat) == ["d0", "d1", "d2", "d3"]


# ── Stage 3 plumbing: ledger reaches the drafting prompt ───────────────────

def test_monolithic_prompt_carries_verified_ledger():
    from app.services.drafting_monolithic import build_monolithic_prompt

    ledger = render_verified_fields_block(_validated_sample())
    prompt = build_monolithic_prompt(
        structure={"document_title": "Plaint", "document_type": "Suit"},
        sections=[{"section_id": "s1", "index": 0, "heading": "FACTS",
                   "original_text": "1. ____", "placeholders": []}],
        facts_digest="| 1. | 15 March 2024 | Invoice raised |",
        user_instructions=None,
        has_docs=True,
        verified_fields_block=ledger,
    )
    assert "VERIFIED FIELD LEDGER" in prompt
    assert "NEX/INV/2025/26/041" in prompt
    assert "LEDGER RULES:" in prompt
    # Ledger off → block absent
    prompt2 = build_monolithic_prompt(
        structure={"document_title": "Plaint", "document_type": "Suit"},
        sections=[{"section_id": "s1", "index": 0, "heading": "FACTS",
                   "original_text": "1. ____", "placeholders": []}],
        facts_digest="x", user_instructions=None, has_docs=True,
    )
    assert "VERIFIED FIELD LEDGER" not in prompt2
