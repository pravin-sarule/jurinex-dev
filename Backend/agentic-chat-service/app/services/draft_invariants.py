"""Deterministic draft invariants — the regression harness core.

Every defect class reviewers have ever found is encoded here as a pure-Python
assertion over the compiled draft. Used two ways:

1. **Tests** (`tests/test_draft_invariants.py`): golden fixtures + synthetic
   defect-injection cases run on every prompt/rule change — a CI gate that
   converts "did we regress?" from a multi-turn reviewer conversation into
   seconds.
2. **Production telemetry**: `run_all()` executes silently after every real
   generation and logs a per-draft defect scorecard, so defect rates are
   measurable over time instead of anecdotal.

Each check returns a list of human-readable issue strings (empty = pass).
Checks are heuristic-tolerant: they prefer false negatives over false
positives, because a noisy gate gets ignored.
"""
from __future__ import annotations

import re
from typing import Any, Callable, Optional

_PARA_RE = re.compile(r"(?m)^\s{0,8}(\d{1,3})(?:\.(\d{1,2}))?[.)]\s")
_LETTER_RE = re.compile(r"(?m)^\s{0,8}\(([a-z])\)\s")
_ANNEX_RE = re.compile(r"ANNEXURE\s+P-(\d+)", re.I)
_EXHIBIT_RE = re.compile(r"\bEXHIBIT\s+P-?\d+", re.I)

_MONTHS = {m: i + 1 for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"])}
_DATE_RE = re.compile(
    r"\b(\d{1,2})(?:st|nd|rd|th)?[-\s/.]*(?:day of\s+)?"
    r"(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[-\s/.,]*(\d{4})\b",
    re.I,
)

ARGUMENTATIVE_WORDS = ("vague", "unsubstantiated", "malafide", "mala fide",
                       "frivolous", "dishonest", "blatant")
URGENCY_PHRASES = ("defeat the decree", "dissipat", "alienat", "irreparable",
                   "attachment before judgment", "court receiver")


def _heading(s: dict) -> str:
    return str(s.get("heading", "")).lower()


def _body_scope(s: dict) -> bool:
    return not any(k in _heading(s) for k in ("statement of truth", "affidavit", "vakalat"))


def _find_section(sections: list[dict], *keywords: str) -> Optional[dict]:
    for s in sections:
        if any(k in _heading(s) for k in keywords):
            return s
    return None


def _parse_dates(text: str) -> list[tuple[int, int, int]]:
    out = []
    for d, mon, y in _DATE_RE.findall(text or ""):
        try:
            out.append((int(y), _MONTHS[mon.lower()[:3]], int(d)))
        except (KeyError, ValueError):
            continue
    return out


# ── Numbering ──────────────────────────────────────────────────────────────

def check_unique_paragraph_numbers(sections: list[dict], digest: str = "") -> list[str]:
    """No main paragraph number used twice across the body scope."""
    seen: dict[str, str] = {}
    issues = []
    for s in sorted(sections, key=lambda x: x.get("index", 0)):
        if not _body_scope(s):
            continue
        local_seen: set[str] = set()
        for m in _PARA_RE.finditer(s.get("content") or ""):
            token = f"{m.group(1)}.{m.group(2)}" if m.group(2) else m.group(1)
            if token in local_seen:
                continue
            local_seen.add(token)
            if token in seen and seen[token] != s.get("section_id"):
                issues.append(f"paragraph number {token} duplicated across sections")
            seen.setdefault(token, str(s.get("section_id")))
    return issues


def check_attestation_restarts(sections: list[dict], digest: str = "") -> list[str]:
    """Statement of Truth / affidavit numbering restarts at 1."""
    issues = []
    for s in sections:
        if _body_scope(s):
            continue
        nums = [int(m.group(1)) for m in _PARA_RE.finditer(s.get("content") or "")]
        if nums and nums[0] != 1:
            issues.append(f"attestation '{s.get('heading')}' starts numbering at {nums[0]}, not 1")
    return issues


def check_prayer_letters_contiguous(sections: list[dict], digest: str = "") -> list[str]:
    """Lettered sub-clauses run (a),(b),(c)… without gaps."""
    issues = []
    for s in sections:
        letters = _LETTER_RE.findall(s.get("content") or "")
        if len(letters) < 2:
            continue
        ascending = all(letters[i] < letters[i + 1] for i in range(len(letters) - 1))
        expected = [chr(ord("a") + i) for i in range(len(letters))]
        if ascending and letters != expected:
            issues.append(f"'{s.get('heading')}' letters skip: {','.join(letters)}")
    return issues


# ── Exhibits ───────────────────────────────────────────────────────────────

def check_annexure_series_contiguous(sections: list[dict], digest: str = "") -> list[str]:
    nums = set()
    for s in sections:
        nums.update(int(n) for n in _ANNEX_RE.findall(s.get("content") or ""))
    if not nums:
        return []
    missing = [str(n) for n in range(1, max(nums) + 1) if n not in nums]
    return [f"annexure series gaps: missing P-{', P-'.join(missing)}"] if missing else []


def check_single_exhibit_terminology(sections: list[dict], digest: str = "") -> list[str]:
    full = "\n".join(s.get("content") or "" for s in sections)
    if _ANNEX_RE.search(full) and _EXHIBIT_RE.search(full):
        return ["mixed exhibit terminology: both 'ANNEXURE P-#' and 'Exhibit P-#' used"]
    return []


def check_single_mark_per_document(sections: list[dict], digest: str = "") -> list[str]:
    """No strong reference code (invoice/PO number) introduced under two marks."""
    code_re = re.compile(r"\b[A-Z]{2,}[A-Z0-9]*(?:[/-][A-Z0-9]{2,}){1,6}\b")
    code_marks: dict[str, set[int]] = {}
    for s in sorted(sections, key=lambda x: x.get("index", 0)):
        text = s.get("content") or ""
        for m in _ANNEX_RE.finditer(text):
            window = text[max(0, m.start() - 160):m.start()].upper()
            for code in code_re.findall(window):
                if code.startswith(("ANNEXURE", "P-")):
                    continue
                code_marks.setdefault(code, set()).add(int(m.group(1)))
    return [
        f"document '{code}' cited under multiple marks: P-{', P-'.join(map(str, sorted(marks)))}"
        for code, marks in code_marks.items() if len(marks) > 1
    ]


def check_one_document_per_mark(sections: list[dict], digest: str = "") -> list[str]:
    """Each mark is introduced at most once — in prose AND in table exhibit
    columns. Colly exemption is per-context (near the mark), not document-wide."""
    text = "\n\n".join(s.get("content") or "" for s in sections)
    issues: list[str] = []
    firsts = [
        m for m in re.finditer(
            r"(?:marked\s+as|annexed\s+as)\s+(?:\*\*)?(?:ANNEXURE|EXHIBIT)\s+"
            r"([A-Z]{1,2}[-\u2011 ]?\d+)",
            text, re.IGNORECASE,
        )
        if "colly" not in text[m.end():m.end() + 40].lower()
    ]
    norm = [re.sub(r"[\u2011 ]", "-", m.group(1).upper()) for m in firsts]
    issues += [
        f"mark {m} introduces {norm.count(m)} different documents (one document, one mark)"
        for m in sorted({x for x in norm if norm.count(x) > 1})
    ]
    # Table exhibit-column collisions: same mark on >=2 rows with different codes.
    row_mark = re.compile(r"\b(?:ANNEXURE|EXHIBIT)?\s*([A-Z]{1,2}[-\u2011]\d{1,3})\b")
    code_re = re.compile(r"\b[A-Z]{2,}[A-Z0-9]*(?:[/-][A-Z0-9]{2,}){1,6}\b")
    mark_sets: dict[str, list[frozenset]] = {}
    for ln in text.splitlines():
        s = ln.strip()
        if not s.startswith("|") or set(s) <= set("|-: ") or "colly" in s.lower():
            continue
        marks = {m.replace("\u2011", "-").upper() for m in row_mark.findall(s)}
        if not marks:
            continue
        codes = frozenset(c for c in code_re.findall(s.upper())
                          if not re.fullmatch(r"[A-Z]{1,2}-\d{1,3}", c))
        for m in marks:
            mark_sets.setdefault(m, []).append(codes)
    for m, sets in mark_sets.items():
        if len(sets) < 2:
            continue
        nonempty = {s for s in sets if s}
        if len(nonempty) > 1 or (len(nonempty) == 1 and any(not s for s in sets)):
            issues.append(f"mark {m} shared by multiple table rows citing different documents")
    return issues


# ── Tables ─────────────────────────────────────────────────────────────────

def check_no_notice_in_invoice_table(sections: list[dict], digest: str = "") -> list[str]:
    """A legal notice / demand letter must not appear as an invoice-table row."""
    issues = []
    for s in sections:
        text = s.get("content") or ""
        for tbl in re.split(r"\n\s*\n", text):
            lines = [ln for ln in tbl.splitlines() if ln.strip().startswith("|")]
            if len(lines) < 3:
                continue
            header = lines[0].lower()
            if "invoice" in header and "notice" not in header:
                for row in lines[2:]:
                    if "legal notice" in row.lower():
                        issues.append(
                            f"'{s.get('heading')}': legal notice row inside an invoice table"
                        )
    return issues


def check_chronology_neutral(sections: list[dict], digest: str = "") -> list[str]:
    issues = []
    for s in sections:
        if not any(k in _heading(s) for k in ("dates and events", "chronology")):
            continue
        rows = [ln for ln in (s.get("content") or "").splitlines() if ln.strip().startswith("|")]
        for row in rows:
            low = row.lower()
            hits = [w for w in ARGUMENTATIVE_WORDS if w in low]
            if hits:
                issues.append(f"argumentative wording in chronology row: {hits}")
    return issues


def check_no_empty_cells(sections: list[dict], digest: str = "") -> list[str]:
    issues = []
    for s in sections:
        rows = [ln for ln in (s.get("content") or "").splitlines() if ln.strip().startswith("|")]
        for row in rows[2:] if len(rows) > 2 else []:
            cells = [c.strip() for c in row.strip().strip("|").split("|")]
            if any(c == "" for c in cells):
                issues.append(f"'{s.get('heading')}': empty table cell in row: {row.strip()[:60]}")
                break
    return issues


# ── Attestations / legal structure ─────────────────────────────────────────

def _extract_ranges(text: str) -> list[tuple[int, int]]:
    return [(int(a), int(b)) for a, b in
            re.findall(r"paragraphs?\s+(\d+)\s*(?:to|through|-|–)\s*(\d+)", text or "", re.I)]


def check_verification_matches_statement_of_truth(sections: list[dict], digest: str = "") -> list[str]:
    ver = _find_section(sections, "verification")
    sot = _find_section(sections, "statement of truth")
    if not ver or not sot:
        return []
    rv, rs = _extract_ranges(ver.get("content", "")), _extract_ranges(sot.get("content", ""))
    if rv and rs and set(rv) != set(rs):
        return [f"verification ranges {rv} != statement-of-truth ranges {rs}"]
    return []


def check_12a_not_in_cause_of_action(sections: list[dict], digest: str = "") -> list[str]:
    coa = _find_section(sections, "cause of action")
    if not coa:
        return []
    text = coa.get("content", "")
    for m in re.finditer(r"12A", text):
        ctx = text[max(0, m.start() - 200):m.end() + 200].lower()
        # Allowed: limitation-exclusion computation. Forbidden: pleaded as accrual.
        if "cause of action" in ctx and ("arose" in ctx or "accru" in ctx) \
                and "exclu" not in ctx and "limitation" not in ctx:
            return ["Section 12A pleaded as cause-of-action accrual (belongs in maintainability)"]
    return []


def check_interim_relief_coherence(sections: list[dict], digest: str = "") -> list[str]:
    full = "\n".join(s.get("content") or "" for s in sections)
    low = full.lower()
    declines = "no urgent interim relief" in low or "no interim relief is sought" in low or \
               "no interim relief is being sought" in low
    argues = any(p in low for p in URGENCY_PHRASES)
    if declines and argues:
        return ["draft both declines interim relief AND argues for it (urgency/attachment/receiver)"]
    return []


def check_attestation_dates_order(sections: list[dict], digest: str = "") -> list[str]:
    """No verification/attestation may be dated before any document it relies on."""
    doc_dates = _parse_dates(digest)
    if not doc_dates:
        return []
    latest_doc = max(doc_dates)
    issues = []
    for s in sections:
        if _body_scope(s) and "verification" not in _heading(s):
            continue
        att_dates = _parse_dates(s.get("content") or "")
        if att_dates and max(att_dates) < latest_doc:
            issues.append(
                f"attestation '{s.get('heading')}' dated {max(att_dates)} predates the latest "
                f"source document {latest_doc}"
            )
    return issues


def check_no_data_not_provided_for_registered_docs(sections: list[dict], digest: str = "") -> list[str]:
    lod = _find_section(sections, "list of documents", "index of documents", "accompanying")
    if not lod:
        return []
    issues = []
    for ln in (lod.get("content") or "").splitlines():
        if ln.strip().startswith("|") and "data not provided" in ln.lower() \
                and _ANNEX_RE.search(ln) is None and "annexure" in ln.lower():
            issues.append(f"List of Documents row unresolved: {ln.strip()[:70]}")
    return issues


def check_relief_has_placeholders(sections: list[dict], digest: str = "") -> list[str]:
    """Relief/prayer sections must not contain [DATA NOT PROVIDED] markers."""
    relief = _find_section(sections, "prayer", "relief", "order sought", "remedy")
    if not relief:
        return []
    if re.search(r"\[DATA NOT PROVIDED:[^\]]*\]", relief.get("content") or "", re.I):
        return ["relief/prayer contains unresolved [DATA NOT PROVIDED] placeholder(s)"]
    return []


# Backward-compatible alias
check_prayer_has_placeholders = check_relief_has_placeholders


def check_slash_option_menu_unnarrowed(sections: list[dict], digest: str = "") -> list[str]:
    """Slash-separated option menus in caption should be narrowed when relief omits extras."""
    full = "\n".join(s.get("content") or "" for s in sections)
    head = full[:5000]
    if not any(line.count("/") >= 2 for line in head.splitlines()):
        return []
    relief = _find_section(sections, "prayer", "relief", "order sought")
    pl = (relief.get("content") or "").lower() if relief else _relief_zone_from_text(full)
    if not pl:
        return []
    for line in head.splitlines():
        if line.count("/") < 2:
            continue
        parts = [p.strip() for p in line.split("/") if p.strip()]
        if len(parts) < 3:
            continue
        extras = parts[1:]
        if not any(
            any(w in pl for w in re.findall(r"[a-z]{4,}", p.lower()))
            for p in extras
        ):
            return ["slash-separated template option menu not narrowed to this matter"]
    return []


def _relief_zone_from_text(text: str) -> str:
    low = text.lower()
    for marker in ("prayer", "relief", "order sought", "remedy"):
        pos = low.find(marker)
        if pos != -1:
            return text[pos:].lower()
    return ""


# Backward-compatible alias
check_generic_slash_relief_title = check_slash_option_menu_unnarrowed


def check_caption_duplication(sections: list[dict], digest: str = "") -> list[str]:
    """Caption must not repeat VERSUS/AND/BETWEEN separator lines."""
    ct = _find_section(sections, "cause title", "court", "suit no", "caption", "title page")
    text = ct.get("content") or "" if ct else "\n".join(
        (s.get("content") or "")[:2000] for s in sections[:3]
    )
    up = text.upper()
    if up.count("VERSUS") > 1 or up.count(" BETWEEN ") > 1:
        return ["caption repeats party separator — blocks duplicated"]
    return []


# Backward-compatible alias
check_cause_title_duplication = check_caption_duplication


def check_chronology_complete(sections: list[dict], digest: str = "") -> list[str]:
    """Every inventory matrix row should appear in a chronology table."""
    matrix: dict[int, str] = {}
    for m in re.finditer(r"(?m)^\|\s*(\d+)\.?\s*\|(.+)$", digest or ""):
        try:
            matrix[int(m.group(1))] = m.group(0)
        except ValueError:
            continue
    if not matrix:
        return []
    chrono = _find_section(sections, "dates and events", "list of dates", "chronolog", "timeline")
    body = chrono.get("content") or "" if chrono else "\n".join(s.get("content") or "" for s in sections)
    body_l = body.lower()
    missing: list[str] = []
    for sn, row in sorted(matrix.items()):
        cells = [c.strip() for c in row.strip().strip("|").split("|")]
        date_tok = (cells[1] if len(cells) >= 3 else cells[0] if cells else "").lower()
        partic = (cells[2] if len(cells) >= 3 else cells[-1] if cells else "").lower()
        if date_tok and date_tok[:6] in body_l:
            continue
        words = [w for w in re.findall(r"[a-z0-9]{5,}", partic) if w not in ("dated", "party")]
        if words and sum(1 for w in words[:5] if w in body_l) >= min(2, len(words)):
            continue
        missing.append(str(sn))
    if missing:
        tail = "…" if len(missing) > 12 else ""
        return [f"chronology missing inventory events: {', '.join(missing[:12])}{tail}"]
    return []


def check_no_unresolved_placeholders(sections: list[dict], digest: str = "") -> list[str]:
    full = "\n".join(s.get("content") or "" for s in sections)
    n = len(re.findall(r"\[DATA NOT PROVIDED:[^\]]*\]|\[MISSING:[^\]]*\]", full, re.I))
    if n:
        return [f"{n} unresolved [DATA NOT PROVIDED] / [MISSING] marker(s) remain"]
    return []


def check_no_cross_field_literal_collision(sections: list[dict], digest: str = "") -> list[str]:
    """Flag draft literals attached to a different inventory field than their source.

    Classic case: draft says 'Companies Act, 2020' while inventory only has 2020 under
    Date of Incorporation and 2013 under Law of Incorporation / Companies Act.
    """
    if not digest:
        return []
    try:
        from app.services.draft_provenance import detect_cross_field_collisions
    except Exception:
        return []
    full = "\n".join(s.get("content") or "" for s in sections)
    hits = detect_cross_field_collisions(full, digest)
    return [h["problem"] for h in hits]


def check_unsafe_admissions(sections: list[dict], digest: str = "") -> list[str]:
    """Unsafe 'admitted' language when liability/obligations were denied."""
    digest_l = (digest or "").lower()
    denied = any(
        p in digest_l
        for p in (
            "denied liability", "denies liability", "disputed liability",
            "without admitting liability", "denied the claim", "denies the claim",
            "disputed the amount", "denies obligation",
        )
    )
    if not denied:
        return []
    full = "\n".join(s.get("content") or "" for s in sections).lower()
    if re.search(r"\badmitted\s+(dues|amount|liability|obligation)\b", full):
        return ["uses 'admitted' for dues/amount/liability although disputed in source documents"]
    return []


# Backward-compatible alias
check_unsafe_admitted_dues = check_unsafe_admissions


# ── Registry / scorecard ───────────────────────────────────────────────────

ALL_CHECKS: dict[str, Callable[[list[dict], str], list[str]]] = {
    "one_document_per_mark": check_one_document_per_mark,
    "unique_paragraph_numbers": check_unique_paragraph_numbers,
    "attestation_restarts": check_attestation_restarts,
    "prayer_letters_contiguous": check_prayer_letters_contiguous,
    "annexure_series_contiguous": check_annexure_series_contiguous,
    "single_exhibit_terminology": check_single_exhibit_terminology,
    "single_mark_per_document": check_single_mark_per_document,
    "no_notice_in_invoice_table": check_no_notice_in_invoice_table,
    "chronology_neutral": check_chronology_neutral,
    "no_empty_cells": check_no_empty_cells,
    "verification_matches_sot": check_verification_matches_statement_of_truth,
    "12a_not_in_cause_of_action": check_12a_not_in_cause_of_action,
    "interim_relief_coherence": check_interim_relief_coherence,
    "attestation_dates_order": check_attestation_dates_order,
    "lod_rows_resolved": check_no_data_not_provided_for_registered_docs,
    "relief_no_placeholders": check_relief_has_placeholders,
    "option_menu_narrowed": check_slash_option_menu_unnarrowed,
    "caption_no_dup": check_caption_duplication,
    "no_unsafe_admissions": check_unsafe_admissions,
    "chronology_complete": check_chronology_complete,
    "no_unresolved_placeholders": check_no_unresolved_placeholders,
    "no_cross_field_literal_collision": check_no_cross_field_literal_collision,
    # legacy keys (same callables)
    "prayer_no_placeholders": check_relief_has_placeholders,
    "relief_title_narrowed": check_slash_option_menu_unnarrowed,
    "cause_title_no_dup": check_caption_duplication,
    "no_unsafe_admitted_dues": check_unsafe_admissions,
}


def run_all(sections: list[dict[str, Any]], digest: str = "") -> dict[str, Any]:
    """Run every invariant; return the per-draft defect scorecard."""
    results: dict[str, list[str]] = {}
    for name, fn in ALL_CHECKS.items():
        try:
            issues = fn(sections, digest)
        except Exception as exc:  # a broken check must never break a draft
            issues = [f"check crashed: {exc}"]
        if issues:
            results[name] = issues
    return {
        "checks_run": len(ALL_CHECKS),
        "checks_failed": len(results),
        "issues": results,
    }
