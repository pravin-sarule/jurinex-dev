"""Stage-1 provenance verification + precomputed bookkeeping tables.

Zero-LLM helpers that run between fact extraction and monolithic drafting:
- verify extracted values appear verbatim in the cited source file
- build interest-pairing tables from AMOUNTS + TERMS
- detect / fix cross-field literal collisions (e.g. Act year ← incorporation date)
"""
from __future__ import annotations

import logging
import re
from typing import Any, Optional

logger = logging.getLogger(__name__)

_SOURCE_TAG_RE = re.compile(r"\[Source:\s*([^\]]+)\]", re.I)
_ACT_YEAR_RE = re.compile(
    r"((?:Companies|Limited Liability Partnership|Partnership|Arbitration|Contract)\s+Act),?\s*(\d{4})",
    re.I,
)
_CLAIM_TOKEN_RES = (
    _ACT_YEAR_RE,
    re.compile(r"[UL]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}"),
    re.compile(r"[A-Z]{5}\d{4}[A-Z]"),
    re.compile(r"\b\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9]\b"),
    re.compile(r"(?:Rs\.?|INR)\s*[\d,]+(?:\.\d{2})?", re.I),
    re.compile(r"\b[A-Z]{2,}[A-Z0-9]*(?:[/-][A-Z0-9]{2,}){2,6}\b"),
)


def _normalize_ws(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "")).strip().lower()


def _doc_texts_by_name(docs: list[dict[str, Any]]) -> dict[str, str]:
    """filename (lower) → extracted plain text. Best-effort; missing files omitted."""
    from app.services.drafting_service import (
        _extract_pdf_text,
        extract_docx_text,
        load_blob,
    )

    out: dict[str, str] = {}
    for doc in docs or []:
        name = str(doc.get("name") or "").strip()
        if not name or not doc.get("gcs_path"):
            continue
        try:
            data = load_blob(doc["gcs_path"])
            mime = (doc.get("mime_type") or "").lower()
            text = ""
            if "pdf" in mime or name.lower().endswith(".pdf"):
                text = _extract_pdf_text(data) or ""
            elif "word" in mime or name.lower().endswith(".docx"):
                try:
                    text = extract_docx_text(data)
                except Exception:
                    text = ""
            else:
                text = data.decode("utf-8", errors="replace")
            if text.strip():
                out[name.lower()] = text
                # also index basename without path
                base = name.split("/")[-1].lower()
                out.setdefault(base, text)
        except Exception as exc:
            logger.debug("Provenance: could not read %s: %s", name, exc)
    return out


def _resolve_source_text(source_name: str, texts: dict[str, str]) -> Optional[str]:
    key = source_name.strip().lower()
    if key in texts:
        return texts[key]
    # fuzzy: substring match on filename
    for k, v in texts.items():
        if key in k or k in key:
            return v
    return None


def _claim_tokens(value: str) -> list[str]:
    """High-risk extracted claims that must appear verbatim in the source."""
    tokens: list[str] = []
    for rx in _CLAIM_TOKEN_RES:
        for m in rx.finditer(value or ""):
            tok = m.group(0).strip()
            if tok and tok not in tokens:
                tokens.append(tok)
    return tokens


def _value_in_source(value: str, source_text: str) -> bool:
    """True if value (or every claim token) is a normalized-whitespace substring."""
    if not value or not source_text:
        return False
    src_n = _normalize_ws(source_text)
    val_n = _normalize_ws(value)
    if len(val_n) >= 12 and val_n in src_n:
        return True
    tokens = _claim_tokens(value)
    if not tokens:
        # fall back: any 20-char window of the value
        for i in range(0, max(0, len(val_n) - 19)):
            window = val_n[i:i + 20]
            if window in src_n:
                return True
        return len(val_n) < 12  # too short to verify — give benefit of doubt
    return all(_normalize_ws(t) in src_n for t in tokens)


def verify_fact_provenance(
    digest: str,
    docs: list[dict[str, Any]],
) -> tuple[str, list[dict[str, str]]]:
    """Confirm every [Source: file]-tagged extraction is grounded in that file.

    Soft by default: paraphrased inventory lines are KEPT (dropping them was
    causing source fields to vanish from drafts). Hard-drop ONLY clear
    field-swap Act-year claims (e.g. "Companies Act, 2020") that are not
    present as an Act phrase in the cited source.

    Returns (cleaned_digest, to_be_confirmed).
    """
    if not digest or not docs:
        return digest or "", []

    texts = _doc_texts_by_name(docs)
    if not texts:
        return digest, []

    to_confirm: list[dict[str, str]] = []
    kept_lines: list[str] = []
    for line in digest.splitlines():
        m = _SOURCE_TAG_RE.search(line)
        if not m:
            kept_lines.append(line)
            continue
        source_name = m.group(1).strip()
        value = _SOURCE_TAG_RE.sub("", line).strip()
        if line.strip().startswith("|"):
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            value = _SOURCE_TAG_RE.sub("", cells[-1] if cells else value).strip()
        src = _resolve_source_text(source_name, texts)
        if src is None:
            kept_lines.append(line)
            continue
        if _value_in_source(value, src):
            kept_lines.append(line)
            continue

        # Hard-drop only Act-year field-swaps not present as Act phrases in source
        hard_drop = False
        for am in _ACT_YEAR_RE.finditer(value):
            act_phrase = am.group(0)
            if not _value_in_source(act_phrase, src):
                # Source has the year elsewhere (e.g. incorporation date) but not
                # as this Act phrase → classic field-swap; strip the line.
                hard_drop = True
                to_confirm.append({
                    "value": act_phrase,
                    "source": source_name,
                    "flag": "UNVERIFIED_PROVENANCE",
                    "reason": (
                        "extracted Act year not found as Act phrase in cited source "
                        "(likely field-swap from incorporation/CIN year)."
                    ),
                })
                logger.info(
                    "Provenance hard-drop Act phrase: %r not in %s",
                    act_phrase, source_name,
                )
        if hard_drop:
            continue

        # Soft: keep the line so fields are not lost; flag for QA review
        to_confirm.append({
            "value": value[:160],
            "source": source_name,
            "flag": "UNVERIFIED_PROVENANCE_SOFT",
            "reason": (
                "extracted value not found verbatim in cited source "
                "(kept in inventory — confirm before filing)."
            ),
        })
        kept_lines.append(line)
        logger.info(
            "Provenance soft-flag (kept): %r not verbatim in %s",
            value[:80], source_name,
        )
    cleaned = "\n".join(kept_lines)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned, to_confirm


def build_field_coverage_checklist(facts_digest: str, max_items: int = 80) -> str:
    """Labeled inventory fields that MUST appear somewhere in the draft."""
    if not facts_digest:
        return ""
    items: list[str] = []
    # Labeled sub-fields: "CIN: …", "Law of Incorporation: …", "Registered Office: …"
    for m in re.finditer(
        r"(?m)^[-•*]?\s*((?:Full\s+Name|Name|Role|CIN|PAN|GSTIN|LLPIN|"
        r"Law of Incorporation(?:\s*/\s*Act)?|Act|Date of Incorporation|"
        r"Registered Office(?:\s+Address)?|"
        r"Business(?:\s*/\s*Correspondence)?(?:\s+Address)?|"
        r"Nature of Business|Authorized Signatory(?:\s+Name)?|"
        r"Authorization Document|Board Resolution|Email|Phone|Mobile|"
        r"Jurisdiction|Interest|Credit Period|Due Date|Invoice|UTR|Cheque)"
        r"[^:\n]{0,40})\s*:\s*(.+)$",
        facts_digest,
        re.I,
    ):
        label, val = m.group(1).strip(), m.group(2).strip()
        val = _SOURCE_TAG_RE.sub("", val).strip(" .;")
        if len(val) < 2 or val.lower() in (
            "not mentioned", "n/a", "nil", "-", "required-but-absent", "none", "absent",
        ):
            continue
        items.append(f"- {label}: {val[:120]}")
        if len(items) >= max_items:
            break
    # Amounts lines
    if len(items) < max_items:
        for m in re.finditer(r"(?:Rs\.?|INR)\s*[\d,]+(?:\.\d{2})?", facts_digest, re.I):
            line_start = facts_digest.rfind("\n", 0, m.start()) + 1
            line_end = facts_digest.find("\n", m.end())
            if line_end == -1:
                line_end = len(facts_digest)
            snippet = facts_digest[line_start:line_end].strip()
            snippet = _SOURCE_TAG_RE.sub("", snippet).strip()
            if len(snippet) >= 8:
                entry = f"- AMOUNT: {snippet[:120]}"
                if entry not in items:
                    items.append(entry)
            if len(items) >= max_items:
                break
    if not items:
        return ""
    return (
        "FIELD COVERAGE CHECKLIST (EVERY item below MUST appear in the draft "
        "caption, parties, facts, valuation, or prayer — omission is a defect):\n"
        + "\n".join(items)
        + "\n"
    )


def build_interest_pairing_table(facts_digest: str) -> str:
    """Per-invoice interest pairing from AMOUNTS + TERMS — injected into Stage 2."""
    if not facts_digest:
        return ""
    from app.services.draft_facts import _extract_inventory_block

    amounts = _extract_inventory_block(facts_digest, "AMOUNTS")
    terms = _extract_inventory_block(facts_digest, "TERMS AND CONDITIONS")
    rate_m = re.search(
        r"(\d+(?:\.\d+)?)\s*%\s*(?:p\.?a\.?|per\s+annum|per\s+year)?",
        terms or facts_digest,
        re.I,
    )
    rate = rate_m.group(0).strip() if rate_m else ""
    rows: list[str] = []
    for line in (amounts or "").splitlines():
        line = line.strip()
        if not line or len(line) < 8:
            continue
        amt_m = re.search(r"((?:Rs\.?|INR)\s*[\d,]+(?:\.\d{2})?)", line, re.I)
        if not amt_m:
            continue
        # Prefer explicit due/from dates over any date
        date_m = re.search(
            r"(?:due|from|accrual|payable)\s*(?:date|on|from)?\s*:?\s*"
            r"(\d{1,2}[-/\s]\w{3,}[-/\s,]*\d{4}|\d{1,2}\s+\w+\s+\d{4})",
            line,
            re.I,
        ) or re.search(
            r"(\d{1,2}[-/]\w{3}[-/]\d{4}|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4})",
            line,
            re.I,
        )
        inv_m = re.search(
            r"((?:Invoice|Inv\.?|PO|Purchase Order)\s*(?:No\.?\s*)?[A-Z0-9/.-]+)",
            line,
            re.I,
        )
        component = inv_m.group(1).strip() if inv_m else line[:60].rstrip(" .;")
        principal = amt_m.group(1).strip()
        from_date = date_m.group(1).strip() if date_m else "[per invoice due date — see inventory]"
        rate_cell = rate or "[rate from TERMS]"
        rows.append(f"| {component[:50]} | {principal} | {rate_cell} | {from_date} |")
    if not rows:
        return ""
    return (
        "INTEREST PAIRING TABLE (authoritative — interest on EACH component from its OWN "
        "due/from date; NEVER blend onto a single earliest date):\n"
        "| Component | Principal | Rate | From date |\n"
        "|:----------|:----------|:-----|:----------|\n"
        + "\n".join(rows)
        + "\n"
    )


def inventory_literal_labels(facts_digest: str) -> dict[str, set[str]]:
    """Map numeric/year literals → inventory field labels that contain them."""
    labels: dict[str, set[str]] = {}
    if not facts_digest:
        return labels
    current_label = "GENERAL"
    for line in facts_digest.splitlines():
        head = re.match(r"^([A-Z][A-Z0-9 /&()\-]{2,58})\s*—", line)
        if head:
            current_label = head.group(1).strip()
            continue
        # Labeled sub-fields: "Law of Incorporation: …", "Date of Incorporation: …"
        sub = re.match(r"^[-•*]?\s*([A-Za-z][A-Za-z0-9 /&()\-]{2,40})\s*:\s*(.+)$", line.strip())
        label = current_label
        body = line
        if sub:
            label = f"{current_label}/{sub.group(1).strip()}"
            body = sub.group(2)
        for m in re.finditer(r"\b((?:19|20)\d{2})\b", body):
            labels.setdefault(m.group(1), set()).add(label)
        for m in re.finditer(r"(?:Rs\.?|INR)\s*([\d,]+(?:\.\d{2})?)", body, re.I):
            labels.setdefault(_normalize_ws(m.group(0)), set()).add(label)
    return labels


def detect_cross_field_collisions(draft_text: str, facts_digest: str) -> list[dict[str, str]]:
    """Find draft literals attached to the wrong inventory field label."""
    if not draft_text or not facts_digest:
        return []
    inv = inventory_literal_labels(facts_digest)
    issues: list[dict[str, str]] = []
    # Companies Act, YYYY attached in draft
    for m in _ACT_YEAR_RE.finditer(draft_text):
        act, year = m.group(1), m.group(2)
        quote = m.group(0)
        inv_labels = inv.get(year, set())
        if not inv_labels:
            continue
        # Year is OK for Act if any inventory label mentions Act / Law of Incorporation
        ok = any(
            re.search(r"act|incorporation\s*law|law\s+of\s+incorporation|statute", lb, re.I)
            for lb in inv_labels
        )
        # Or the exact phrase exists in digest
        if re.search(re.escape(f"{act}, {year}") + r"|" + re.escape(f"{act},{year}"),
                     facts_digest, re.I):
            ok = True
        if ok:
            continue
        # Year only under date-of-incorporation / CIN → collision
        date_only = all(
            re.search(r"date|cin|registration\s*no|incorporated\s+on", lb, re.I)
            for lb in inv_labels
        ) or any(
            re.search(r"date\s+of\s+incorporation|incorporation\s+date", lb, re.I)
            for lb in inv_labels
        )
        if date_only or not any("act" in lb.lower() for lb in inv_labels):
            # Find correct Act year from inventory
            correct = None
            for am in _ACT_YEAR_RE.finditer(facts_digest):
                if am.group(1).lower() == act.lower():
                    correct = am.group(2)
                    break
            issues.append({
                "quote": quote,
                "year": year,
                "correct_year": correct or "",
                "inventory_labels": ", ".join(sorted(inv_labels))[:120],
                "problem": (
                    f"'{quote}' attaches year {year} to {act}, but inventory only has "
                    f"{year} under: {', '.join(sorted(inv_labels))[:80]}"
                ),
            })
    return issues


def fix_cross_field_act_years(text: str, facts_digest: str) -> tuple[str, list[str]]:
    """Deterministically replace wrong Act years when inventory is unambiguous."""
    collisions = detect_cross_field_collisions(text, facts_digest)
    if not collisions:
        return text, []
    # Build Act → correct year from inventory (first authoritative Act phrase)
    act_years: dict[str, str] = {}
    for m in _ACT_YEAR_RE.finditer(facts_digest or ""):
        key = m.group(1).strip().lower()
        act_years.setdefault(key, m.group(2))
    if not act_years:
        return text, []
    fixed: list[str] = []
    new = text

    def _sub(m: re.Match[str]) -> str:
        act, year = m.group(1), m.group(2)
        correct = act_years.get(act.strip().lower())
        if correct and correct != year:
            # Only rewrite if this year is a known collision
            if any(c["year"] == year and act.lower() in c["quote"].lower() for c in collisions):
                fixed.append(f"{act}, {year} → {act}, {correct}")
                return f"{m.group(1)}, {correct}"
        return m.group(0)

    new = _ACT_YEAR_RE.sub(_sub, new)
    return new, fixed
