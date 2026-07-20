"""Stage 2 — Grounded Extraction (structured JSON with mandatory citations).

One controlled-generation Gemini call per document batch (``response_schema=
GroundedExtractionResult`` — free-text JSON can silently drop the citation
field; schema-enforced output cannot). The target field schema comes from the
template analysis (placeholders), so extraction answers exactly what the
template needs.

After the model calls, a ZERO-LLM validation step confirms every
``source_snippet`` is an actual substring (whitespace/OCR tolerant) of the
cited document's text. Fields that fail become ``unverified`` and are barred
from the drafter's verified ledger — citation fabrication is caught in code,
without another model call.

Everything except :func:`extract_grounded_fields` is pure Python
(deterministic, unit-testable, no service imports).
"""
from __future__ import annotations

import logging
import os
import re
from typing import Any, Optional

logger = logging.getLogger(__name__)

MAX_TARGET_FIELDS = int(os.environ.get("DRAFT_GROUNDED_MAX_FIELDS", "80"))
GROUNDED_MAX_OUTPUT_TOKENS = 32768

# Fallback when a template exposes no placeholders — the universal minimum a
# legal draft needs grounded.
_DEFAULT_TARGET_FIELDS = [
    {"key": "party_names", "label": "Party names",
     "description": "Full legal names of every party, exactly as written"},
    {"key": "party_addresses", "label": "Party addresses",
     "description": "Registered/office addresses of the parties"},
    {"key": "key_dates", "label": "Key dates",
     "description": "Execution, effective, due and event dates"},
    {"key": "amounts", "label": "Amounts",
     "description": "Every monetary amount with its stated purpose"},
    {"key": "subject_matter", "label": "Subject matter",
     "description": "The property/goods/services the documents concern"},
    {"key": "reference_numbers", "label": "Reference numbers",
     "description": "Invoice/PO/agreement/CIN/PAN/GSTIN and similar identifiers"},
]

_VERDICT_VERIFIED = "verified"
_VERDICT_UNVERIFIED = "unverified"
_VERDICT_UNVERIFIABLE_OCR = "unverifiable_ocr"
_VERDICT_MISSING = "missing"


# ── Target schema from the template analysis ──────────────────────────────

def build_target_fields(structure: dict[str, Any]) -> list[dict[str, str]]:
    """Template placeholders (global + per-section) → Stage-2 target schema."""
    fields: list[dict[str, str]] = []
    seen: set[str] = set()

    def _add(ph: dict[str, Any]) -> None:
        key = str(ph.get("key") or "").strip()
        label = str(ph.get("label") or key).strip()
        if not key:
            key = re.sub(r"[^a-z0-9]+", "_", label.lower()).strip("_")
        if not key or key in seen or len(fields) >= MAX_TARGET_FIELDS:
            return
        seen.add(key)
        fields.append({
            "key": key,
            "label": label or key,
            "description": str(ph.get("description") or "").strip(),
            "data_type": str(ph.get("data_type") or "text"),
        })

    for ph in structure.get("global_placeholders") or []:
        _add(ph)
    for sec in structure.get("sections") or []:
        for ph in sec.get("placeholders") or []:
            _add(ph)
    if not fields:
        fields = [dict(f) for f in _DEFAULT_TARGET_FIELDS]
    return fields


def _target_schema_block(fields: list[dict[str, str]]) -> str:
    lines = [
        f"- {f['key']}: {f['label']}"
        + (f" — {f['description']}" if f.get("description") else "")
        + (f" ({f['data_type']})" if f.get("data_type") else "")
        for f in fields
    ]
    return (
        "TARGET FIELD SCHEMA — return one entry for EVERY field below "
        "(found=false when absent from the documents):\n" + "\n".join(lines)
    )


# ── Merge across batches + conflict detection (pure) ──────────────────────

def _norm_value(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "")).strip().lower()


def merge_extracted_fields(
    batch_results: list[list[dict[str, Any]]],
) -> list[dict[str, Any]]:
    """Merge per-batch field lists; same field found with different values in
    two batches becomes a flagged conflict (never silently resolved)."""
    merged: dict[str, dict[str, Any]] = {}
    order: list[str] = []
    for fields in batch_results:
        for f in fields or []:
            key = str(f.get("field_name") or "").strip()
            if not key:
                continue
            prev = merged.get(key)
            if prev is None:
                merged[key] = dict(f)
                order.append(key)
                continue
            if not prev.get("found") and f.get("found"):
                # A later batch found what an earlier one did not.
                merged[key] = dict(f)
            elif (
                prev.get("found") and f.get("found")
                and _norm_value(prev.get("value", "")) != _norm_value(f.get("value", ""))
                and not prev.get("conflict")
            ):
                prev["conflict"] = True
                prev["conflicting_value"] = str(f.get("value") or "")
                prev["conflicting_source"] = str(f.get("source_document") or "")
    return [merged[k] for k in order]


# ── Snippet validation (code, not a model call) ───────────────────────────

def _norm_text(s: str) -> str:
    """Whitespace/quote/dash-tolerant normalization for substring matching."""
    s = (s or "").lower()
    s = s.replace("‘", "'").replace("’", "'")
    s = s.replace("“", '"').replace("”", '"')
    s = re.sub(r"[‐-―]", "-", s)
    return re.sub(r"\s+", " ", s).strip()


def _snippet_in_text(snippet: str, text: str, lenient: bool = False) -> bool:
    """True when the snippet is a (fuzzy) substring of the source text.

    Exact normalized containment first; the lenient path (OCR noise) accepts
    >=85% of the snippet's 3+ char tokens appearing in the text.
    """
    snip_n, text_n = _norm_text(snippet), _norm_text(text)
    if not snip_n or not text_n:
        return False
    if snip_n in text_n:
        return True
    if not lenient:
        # Whitespace noise tolerance for everyone: strip all spacing entirely.
        return snip_n.replace(" ", "") in text_n.replace(" ", "")
    tokens = [t for t in re.findall(r"[a-z0-9]{3,}", snip_n)]
    if not tokens:
        return False
    present = sum(1 for t in tokens if t in text_n)
    return present / len(tokens) >= 0.85


def _resolve_doc(
    source_name: str, docs: list[dict[str, Any]]
) -> Optional[dict[str, Any]]:
    key = (source_name or "").strip().lower()
    if not key:
        return None
    for doc in docs:
        if str(doc.get("name") or "").strip().lower() == key:
            return doc
    for doc in docs:
        name = str(doc.get("name") or "").strip().lower()
        if name and (key in name or name in key):
            return doc
    return None


def validate_extracted_fields(
    fields: list[dict[str, Any]],
    docs: list[dict[str, Any]],
    texts_by_doc_id: dict[str, str],
    ingestion_report: Optional[dict[str, Any]] = None,
) -> list[dict[str, Any]]:
    """Programmatic citation check — sets ``verification`` on every field:

    - ``verified``          snippet confirmed as substring of the cited doc
    - ``unverified``        cited doc has text but the snippet is NOT in it
    - ``unverifiable_ocr``  cited doc is OCR-derived with no text layer —
                            cannot be machine-checked; higher scrutiny bar
    - ``missing``           found=false (nothing to verify)
    """
    ocr_names = {
        str(n).strip().lower()
        for n in (ingestion_report or {}).get("ocr_derived_docs") or []
    }
    out: list[dict[str, Any]] = []
    for f in fields:
        rec = dict(f)
        if not rec.get("found"):
            rec["verification"] = _VERDICT_MISSING
            out.append(rec)
            continue
        doc = _resolve_doc(str(rec.get("source_document") or ""), docs)
        text = texts_by_doc_id.get(str((doc or {}).get("doc_id") or ""), "")
        snippet = str(rec.get("source_snippet") or "")
        src_is_ocr = (
            doc is None
            or str(doc.get("name") or "").strip().lower() in ocr_names
        )
        if not snippet.strip() or doc is None:
            rec["verification"] = _VERDICT_UNVERIFIED
        elif not text.strip():
            # OCR/image source: Gemini read it visually; there is no local
            # text layer to check against — surfaced for human review.
            rec["verification"] = (
                _VERDICT_UNVERIFIABLE_OCR if src_is_ocr else _VERDICT_UNVERIFIED
            )
        elif _snippet_in_text(snippet, text, lenient=src_is_ocr):
            rec["verification"] = _VERDICT_VERIFIED
        else:
            rec["verification"] = _VERDICT_UNVERIFIED
        out.append(rec)
        if rec["verification"] == _VERDICT_UNVERIFIED:
            logger.info(
                "Grounded extraction: citation NOT verified field=%s source=%r "
                "snippet=%r", rec.get("field_name"),
                rec.get("source_document"), snippet[:80],
            )
    return out


def summarize_field_review(fields: list[dict[str, Any]]) -> dict[str, Any]:
    """Counts + the lists the review packet surfaces to the human reviewer."""
    missing = [f for f in fields if f.get("verification") == _VERDICT_MISSING]
    conflicts = [f for f in fields if f.get("conflict")]
    unverified = [
        f for f in fields
        if f.get("verification") in (_VERDICT_UNVERIFIED, _VERDICT_UNVERIFIABLE_OCR)
        and not f.get("conflict")
    ]
    # A conflicted field is never usable-verified, even when its own citation
    # checks out — sources disagree, so it needs human resolution.
    verified = [
        f for f in fields
        if f.get("verification") == _VERDICT_VERIFIED and not f.get("conflict")
    ]
    return {
        "total": len(fields),
        "verified": len(verified),
        "missing": len(missing),
        "conflicts": len(conflicts),
        "unverified": len(unverified),
        "missingFields": [
            {"field": f.get("field_name", "")} for f in missing
        ],
        "conflictFields": [
            {
                "field": f.get("field_name", ""),
                "value": str(f.get("value") or "")[:160],
                "source": f.get("source_document", ""),
                "conflictingValue": str(f.get("conflicting_value") or "")[:160],
                "conflictingSource": f.get("conflicting_source", ""),
            }
            for f in conflicts
        ],
        "unverifiedCitations": [
            {
                "field": f.get("field_name", ""),
                "value": str(f.get("value") or "")[:160],
                "source": f.get("source_document", ""),
                "snippet": str(f.get("source_snippet") or "")[:200],
                "flag": f.get("verification", _VERDICT_UNVERIFIED),
            }
            for f in unverified
        ],
    }


# ── Verified ledger for the Stage-3 drafter prompt (pure) ─────────────────

def render_verified_fields_block(fields: list[dict[str, Any]]) -> str:
    """The drafter-facing ledger: verified values verbatim; missing, conflict
    and unverified fields listed explicitly so the drafter cannot 'helpfully'
    fill them."""
    if not fields:
        return ""
    verified, missing, conflicts, unverified = [], [], [], []
    for f in fields:
        name = str(f.get("field_name") or "?")
        status = f.get("verification") or ""
        if f.get("conflict"):
            conflicts.append(
                f"- {name}: \"{f.get('value', '')}\" ({f.get('source_document', '?')}) "
                f"vs \"{f.get('conflicting_value', '')}\" ({f.get('conflicting_source', '?')})"
            )
        elif status == _VERDICT_VERIFIED:
            verified.append(
                f"- {name} = {f.get('value', '')}  [source: {f.get('source_document', '?')}]"
            )
        elif status == _VERDICT_MISSING:
            missing.append(f"- {name}")
        else:
            unverified.append(
                f"- {name}: \"{f.get('value', '')}\" (citation could not be machine-verified)"
            )
    parts: list[str] = []
    if verified:
        parts.append("VERIFIED (copy character-for-character):\n" + "\n".join(verified))
    if missing:
        parts.append(
            "MISSING — found in NO source document (never guess; keep the "
            "skeleton blank token or [DATA NOT PROVIDED: <field>]):\n"
            + "\n".join(missing)
        )
    if conflicts:
        parts.append(
            "CONFLICT — sources disagree (never silently pick one; use the "
            "value the FACT INVENTORY confirms, else treat as missing):\n"
            + "\n".join(conflicts)
        )
    if unverified:
        parts.append(
            "UNVERIFIED CITATION — treat as missing unless the FACT INVENTORY "
            "independently states the value:\n" + "\n".join(unverified)
        )
    return "\n".join(parts)


# ── The Stage-2 model call (one per batch) ─────────────────────────────────

async def extract_grounded_fields(
    docs: list[dict[str, Any]],
    batches: list[list[str]],
    structure: dict[str, Any],
    model: str,
    usage_sink: Optional[dict[str, int]] = None,
) -> list[dict[str, Any]]:
    """Run the controlled-generation extraction per batch and merge.

    temperature 0 / top_p 0.1 per the pipeline spec — this is verbatim value
    copying, not prose (the drafting stage keeps its own documented sampling
    params; the dash-attractor issue does not apply to schema-bound JSON).
    """
    import asyncio

    from google.genai import types as gt

    from app.services.drafting_prompts import GROUNDED_EXTRACTION_PROMPT
    from app.services.drafting_schemas import GroundedExtractionResult
    from app.services.drafting_service import (
        _add_usage,
        _doc_parts,
        _gemini_models,
        _get_client,
        _usage_from_response,
    )

    if not docs:
        return []
    target_fields = build_target_fields(structure)
    schema_block = _target_schema_block(target_fields)
    by_id = {str(d.get("doc_id") or ""): d for d in docs}
    by_name = {str(d.get("name") or "").strip().lower(): d for d in docs}

    loop = asyncio.get_event_loop()
    client = _get_client()
    config = gt.GenerateContentConfig(
        system_instruction=GROUNDED_EXTRACTION_PROMPT,
        temperature=0.0,
        top_p=0.1,
        max_output_tokens=GROUNDED_MAX_OUTPUT_TOKENS,
        response_mime_type="application/json",
        response_schema=GroundedExtractionResult,
    )

    batch_results: list[list[dict[str, Any]]] = []
    for batch_no, batch_ids in enumerate(batches or [[]], start=1):
        batch_docs = [
            by_id.get(str(i)) or by_name.get(str(i).strip().lower())
            for i in (batch_ids or [])
        ]
        batch_docs = [d for d in batch_docs if d]
        if not batch_docs:
            batch_docs = docs if len(batches) == 1 else []
        if not batch_docs:
            continue
        parts = await loop.run_in_executor(None, _doc_parts, batch_docs)
        parts.append(gt.Part(text=(
            f"{schema_block}\n\n"
            f"Extract the target fields from the {len(batch_docs)} document(s) "
            "above. Return JSON only."
        )))
        contents = [gt.Content(role="user", parts=parts)]

        parsed: Optional[GroundedExtractionResult] = None
        last_err: Exception | None = None
        for m in _gemini_models(model)[:2]:
            try:
                resp = await loop.run_in_executor(
                    None,
                    lambda mm=m: client.models.generate_content(
                        model=mm, contents=contents, config=config
                    ),
                )
                _add_usage(usage_sink, _usage_from_response(resp))
                maybe = getattr(resp, "parsed", None)
                if isinstance(maybe, GroundedExtractionResult):
                    parsed = maybe
                else:
                    parsed = GroundedExtractionResult.model_validate_json(resp.text or "")
                break
            except Exception as exc:
                last_err = exc
                logger.warning(
                    "Grounded extraction batch %s model %s failed: %s",
                    batch_no, m, exc,
                )
        if parsed is None:
            raise RuntimeError(
                f"grounded extraction failed for batch {batch_no}: {last_err}"
            )
        batch_results.append([f.model_dump() for f in parsed.fields])
        logger.info(
            "Grounded extraction batch %s/%s: %s field entries from %s doc(s)",
            batch_no, len(batches), len(parsed.fields), len(batch_docs),
        )
    return merge_extracted_fields(batch_results)
