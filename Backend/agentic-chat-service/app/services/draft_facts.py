"""Shared fact-digest and draft-text utilities for the drafting pipeline.

Bottom-layer helpers used by ``drafting_service`` (orchestration),
``draft_repairs`` (deterministic post-draft repairs) and the monolithic
prompt assembly:

- fact-inventory parsing  — chronology-matrix rows, named inventory blocks,
  verbatim anchors extracted from the Stage-1 digest;
- prompt-context builders — exhibit register plan, factual manifest,
  interest-pairing table, field-coverage checklist;
- draft-text utilities    — markdown-artifact stripping and the document
  state register (annexure marks + paragraph numbering seen so far).

No LLM calls and no service imports here — pure deterministic parsing.
"""
from __future__ import annotations

import logging
import re
from typing import Any, Optional

logger = logging.getLogger(__name__)

_MD_ATX_HEADING_RE = re.compile(r"(?m)^([ \t]{0,3})#{1,6}[ \t]+")


_MD_HR_RE = re.compile(r"(?m)^[ \t]{0,3}(?:-{3,}|\*{3,}|_{3,})[ \t]*$")


def _strip_markdown_artifacts(text: str) -> str:
    """Remove ATX '# heading' markers and markdown HRs from court-ready text.

    Claude often prefixes court/suit lines with # / ### even when told not to;
    those must never appear in the filing draft.
    """
    if not text:
        return text or ""
    text = _MD_ATX_HEADING_RE.sub(r"\1", text)
    text = _MD_HR_RE.sub("", text)
    # Collapse accidental blank runs left by HR removal
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text


_PARA_NUM_RE = re.compile(r"(?m)^\s{0,8}(\d{1,3})(?:\.(\d{1,2}))?[.)]\s")


_ANNEXURE_RE = re.compile(r"ANNEXURE\s+([A-Z]{1,2}(?:-\d{1,3})?|\d{1,3}|[A-Z]-\d{1,3})", re.IGNORECASE)


def _build_doc_state(drafted: list[dict[str, Any]]) -> dict[str, Any]:
    """Document-wide state carried between sections so each new section can
    continue numbering, reuse annexure marks and cross-refer instead of
    repeating — the fixes for duplicate numbering / missing exhibits /
    repetition flagged in court-readiness review.
    """
    last_main, last_sub = 0, 0
    annexures: list[dict[str, str]] = []   # [{mark, desc}] — the exhibit register
    seen_annex: set[str] = set()
    headings: list[str] = []
    for s in drafted:
        text = s.get("content") or ""
        headings.append(str(s.get("heading") or "").strip())
        for m in _PARA_NUM_RE.finditer(text):
            main = int(m.group(1))
            sub = int(m.group(2)) if m.group(2) else 0
            if (main, sub) > (last_main, last_sub):
                last_main, last_sub = main, sub
        for m in _ANNEXURE_RE.finditer(text):
            mark = m.group(1).upper()
            if mark not in seen_annex:
                seen_annex.add(mark)
                # Descriptor = the text just before the mark at first occurrence
                # ("…copy of the Purchase Order No. X dated Y (annexed hereto and
                # marked as ANNEXURE P-1)") or the table row it sits in.
                start = max(0, m.start() - 140)
                desc = text[start:m.start()]
                desc = re.sub(r"\(?annexed\s+here(to|with)[^)]*$", "", desc, flags=re.I)
                desc = re.sub(r"marked\s+as\s*$", "", desc, flags=re.I)
                # Keep only the current sentence/cell — drop spill-over from the
                # previous sentence; for table rows fall back to the nearest
                # non-empty cell (the document description column).
                segments = [
                    seg.strip(" |-–—(,.;:") for seg in re.split(r"\)\.\s+|\.\s{2,}|\n|\|", desc)
                ]
                desc = next((seg for seg in reversed(segments) if seg.strip()), "")
                desc = re.sub(r"\s+", " ", desc).strip()
                annexures.append({"mark": mark, "desc": desc[-90:]})
    last_para = f"{last_main}.{last_sub}" if last_sub else (str(last_main) if last_main else "")
    return {"last_para": last_para, "annexures": annexures, "headings": headings}


def _plan_exhibits(facts_digest: str, max_docs: int = 40) -> list[dict[str, str]]:
    """Pre-assign the annexure register (P-1…P-n) from the fact inventory's
    DOCUMENT REFERENCES — up front, deterministically.

    This removes the sequential dependency between sections (every section gets
    the same complete register before generation starts), which is what makes
    parallel generation safe for exhibit mapping — and it maps documents more
    completely than incremental assignment ever did.
    """
    out: list[dict[str, str]] = []
    in_refs = False
    _other_heads = ("TERMS AND CONDITIONS", "OTHER FACTS", "TIMELINE GAPS", "PART 3",
                    "PROPERTIES", "AMOUNTS", "PARTIES", "ADMISSIONS", "COURT AND FORUM",
                    "VERBATIM ANCHORS")
    for raw_line in (facts_digest or "").splitlines():
        # Tolerate markdown decoration around inventory headings (** … **, ##).
        s = raw_line.strip().strip("*#").strip()
        if not s:
            continue
        if not in_refs and "DOCUMENT REFERENCES" in s.upper() and len(s) < 70:
            in_refs = True
            continue
        if in_refs and len(s) < 70 and any(h in s.upper() for h in _other_heads) \
                and s == s.upper():
            break  # next inventory heading
        if in_refs:
            desc = re.sub(r"^\W+", "", s).strip()
            desc = re.sub(r"\[Source:[^\]]*\]", "", desc, flags=re.I).strip(" .;")
            if len(desc) >= 8:
                out.append({"mark": f"P-{len(out) + 1}", "desc": desc[:110]})
            if len(out) >= max_docs:
                break
    # Ensure Company Registration appears when PARTIES has CIN/Act but DOCUMENT
    # REFERENCES omitted the certificate (common extraction gap).
    if len(out) < max_docs:
        parties = _extract_inventory_block(facts_digest, "PARTIES") or ""
        has_reg_row = any(
            re.search(r"registrat|incorporat|master\s+data", e.get("desc", ""), re.I)
            for e in out
        )
        if not has_reg_row and (
            re.search(r"[UL]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}", parties)
            or re.search(r"Companies\s+Act", parties, re.I)
        ):
            out.append({
                "mark": f"P-{len(out) + 1}",
                "desc": "Company Registration / Certificate of Incorporation of the Plaintiff",
            })
    return out


def _interest_pairing_for_prompt(facts_digest: str) -> str:
    if not facts_digest:
        return ""
    try:
        from app.services.draft_provenance import build_interest_pairing_table
        return build_interest_pairing_table(facts_digest)
    except Exception as exc:
        logger.debug("Interest pairing table skipped: %s", exc)
        return ""


def _field_coverage_for_prompt(facts_digest: str) -> str:
    if not facts_digest:
        return ""
    try:
        from app.services.draft_provenance import build_field_coverage_checklist
        return build_field_coverage_checklist(facts_digest)
    except Exception as exc:
        logger.debug("Field coverage checklist skipped: %s", exc)
        return ""


_MATRIX_ROW_RE = re.compile(r"(?m)^\|\s*(\d+)\.?\s*\|(.+)$")


def _extract_matrix_rows(facts_digest: str) -> dict[int, str]:
    """S.No → full matrix row text from the chronological factual matrix."""
    rows: dict[int, str] = {}
    for m in _MATRIX_ROW_RE.finditer(facts_digest or ""):
        try:
            rows[int(m.group(1))] = m.group(0).strip()
        except ValueError:
            continue
    return rows


_INVENTORY_BLOCK_RE = re.compile(
    r"^([A-Z][A-Z0-9 /&()\-]{2,58})\s*—",
    re.MULTILINE,
)


def _extract_inventory_block(facts_digest: str, block_name: str) -> str:
    """Return body text of a named PART 2 inventory subsection."""
    digest = facts_digest or ""
    start = None
    for m in _INVENTORY_BLOCK_RE.finditer(digest):
        if block_name.upper() in m.group(1).upper():
            start = m.end()
            break
    if start is None:
        return ""
    end = len(digest)
    for m in _INVENTORY_BLOCK_RE.finditer(digest, start):
        end = m.start()
        break
    for marker in ("## PART ", "CHRONOLOGICAL FACTUAL MATRIX", "| S.No |"):
        pos = digest.find(marker, start)
        if pos != -1 and pos < end:
            end = pos
    return digest[start:end].strip()


def _extract_verbatim_anchors(facts_digest: str) -> list[str]:
    """Pull drafting-critical identifiers from digest for the factual manifest."""
    anchors: list[str] = []
    seen: set[str] = set()
    patterns = (
        r"[UL]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}",          # CIN
        r"[A-Z]{5}\d{4}[A-Z]",                          # PAN
        r"\b\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9]\b",  # GSTIN
        r"(?:Rs\.?|INR)\s*[\d,]+(?:\.\d{2})?",          # amounts
        r"\b[A-Z]{2,}[A-Z0-9]*(?:[/-][A-Z0-9]{2,}){2,6}\b",  # invoice/PO refs
        r"\bUTR[:\s]*[A-Z0-9]{8,20}\b",
    )
    for pat in patterns:
        for hit in re.findall(pat, facts_digest or "", re.I):
            tok = hit.strip()
            key = tok.upper()
            if key not in seen and len(tok) >= 4:
                seen.add(key)
                anchors.append(tok)
    # PART 5 verbatim anchors section if extractor produced it
    part5 = re.search(r"PART\s+5\s*—\s*VERBATIM ANCHORS(.*)", facts_digest or "", re.I | re.S)
    if part5:
        for ln in part5.group(1).splitlines():
            ln = ln.strip().lstrip("-•*").strip()
            if ln and len(ln) > 6 and ln not in seen:
                seen.add(ln[:40])
                anchors.append(ln[:160])
    return anchors[:80]


def _build_factual_manifest(facts_digest: str, max_chars: int = 14000) -> str:
    """Compact authoritative fact block injected into the monolithic prompt."""
    if not facts_digest:
        return ""
    blocks: list[str] = []
    for name in (
        "PARTIES", "AMOUNTS", "DOCUMENT REFERENCES", "ADMISSIONS AND DENIALS",
        "TERMS AND CONDITIONS", "COURT AND FORUM", "PROPERTIES / SUBJECT MATTER",
    ):
        body = _extract_inventory_block(facts_digest, name)
        if body:
            blocks.append(f"{name} —\n{body}")
    anchors = _extract_verbatim_anchors(facts_digest)
    if anchors:
        blocks.append(
            "VERBATIM ANCHORS (copy character-for-character):\n"
            + "\n".join(f"- {a}" for a in anchors)
        )
    out = "\n\n".join(blocks)
    if len(out) > max_chars:
        out = out[:max_chars] + "\n… [manifest truncated — full inventory in cache]"
    return out


def _digits_only(s: str) -> str:
    return re.sub(r"\D", "", s or "")


def _ws_norm(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "")).strip().lower()

