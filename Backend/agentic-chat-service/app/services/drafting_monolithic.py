"""Monolithic (one-shot) drafting strategy — the whole document in ONE call.

Everything specific to single-pass drafting lives here, cleanly separated
from the section-wise engine:

- ``build_monolithic_prompt``      — assembles the single user turn (template
  skeletons + fact inventory + exhibit register + manifests + user focus);
- ``MonolithicDraftingStrategy``   — streams the draft with continuation
  stitching, a degenerate-output circuit breaker and live tag/flood cleaning;
- ``MonolithicDraftContext``       — dependencies injected by
  ``drafting_service`` (keeps this module free of service imports);
- ``_iter_claude_chunks``          — Anthropic streaming with the same item
  protocol as the Gemini iterator.

The system prompt for this strategy is
``app.services.drafting_prompts.MONOLITHIC_DRAFTING_SYSTEM_PROMPT`` — the
zero-hallucination renderer contract. It reaches the model either via the
Gemini explicit context cache or as ``system_instruction``; the service
injects it through ``MonolithicDraftContext.drafting_system_prompt``.
"""
from __future__ import annotations

import logging
import os
import re
import time
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Callable, Optional

from app.services.drafting_strategy_base import (
    MONOLITHIC_DOCUMENT_ID,
    DraftingStrategy,
    DraftMetadata,
    _sha256,
)

logger = logging.getLogger(__name__)

_SECTION_TAG_RE = re.compile(
    r"\[SECTION\s+([^\]]+)\]\s*(.*?)\s*\[/SECTION\s+\1\]",
    re.DOTALL | re.IGNORECASE,
)

# Template blocks that often sit at the end and get dropped when the model
# stops early after the prayer/body — completeness continuation targets these.
_TAIL_CRITICAL_RE = re.compile(
    r"verification|statement of truth|list of documents|index of documents|"
    r"accompanying|annexure|exhibit|schedule|signature|affidavit|"
    r"vakalatnama|certificate|place\s*:|dated\s*at|advocate for|"
    r"through\s+counsel|memo of parties",
    re.IGNORECASE,
)


def _section_search_markers(sec: dict[str, Any]) -> list[str]:
    """Distinctive phrases used to detect whether a template section appears in the draft."""
    markers: list[str] = []
    heading = (sec.get("heading") or "").strip()
    if heading and sec.get("heading_verbatim", True):
        core = re.sub(r"^[\dIVXLCDM]+[.)]\s*", "", heading, flags=re.I).strip()
        if len(core) >= 4:
            markers.append(core)
        if len(heading) >= 4 and heading not in markers:
            markers.append(heading)
    skel = sec.get("original_text") or ""
    for line in skel.splitlines():
        line = re.sub(r"^\*{1,2}|\*{1,2}$", "", line.strip()).strip()
        if not line or line.startswith("|") or line.startswith("#"):
            continue
        if re.fullmatch(r"[\s_.\-\[\]<>A-Za-z/:]{0,60}", line) and ("_" in line or "____" in line):
            # Mostly blank tokens — not a stable marker
            if not _TAIL_CRITICAL_RE.search(line):
                continue
        core = re.sub(r"^[\dIVXLCDM]+[.)]\s*", "", line, flags=re.I).strip()
        # Prefer short ALL-CAPS / title-like lines and critical legal phrases
        if _TAIL_CRITICAL_RE.search(core) or (
            len(core) >= 8 and (core.isupper() or core[:1].isupper())
        ):
            markers.append(core[:96])
            break
        if len(core) >= 16:
            markers.append(core[:96])
            break
    # Deduplicate, longest-first so specific phrases win
    seen: set[str] = set()
    out: list[str] = []
    for m in sorted(markers, key=len, reverse=True):
        key = m.lower()
        if key in seen or len(m) < 4:
            continue
        seen.add(key)
        out.append(m)
    return out


_MATCH_NORM_RE = re.compile(r"[^a-z0-9]+")


def _norm_match(s: str) -> str:
    """Alphanumeric-normalized text for tolerant containment checks — immune
    to case, punctuation, `**bold**` markers, line wraps and whitespace runs."""
    return _MATCH_NORM_RE.sub(" ", (s or "").lower()).strip()


def find_missing_template_sections(
    sections: list[dict[str, Any]],
    draft_text: str,
) -> list[dict[str, Any]]:
    """Return template sections that do not appear in the draft (esp. the tail).

    Used to drive completeness continuations when the model stops after the
    body/prayer and skips verification, signatures, list of documents, etc.
    Matching is alnum-normalized: a heading the model bolded, re-cased or
    wrapped across lines is still FOUND — a false 'missing' here triggers a
    continuation call that can duplicate already-drafted content.
    """
    if not sections:
        return []
    text_l = _norm_match(draft_text or "")
    if not text_l.strip():
        return list(sections)
    n = len(sections)
    # Last third of the template (at least last 3 blocks) is the critical tail.
    tail_start = max(0, n - max(3, (n + 2) // 3))
    missing: list[dict[str, Any]] = []
    for i, sec in enumerate(sections):
        markers = _section_search_markers(sec)
        if not markers:
            continue
        present = any((mn := _norm_match(m)) and mn in text_l for m in markers)
        if present:
            continue
        heading_l = (sec.get("heading") or "").lower()
        skel_head = (sec.get("original_text") or "")[:400]
        is_tail = i >= tail_start
        is_critical = bool(_TAIL_CRITICAL_RE.search(heading_l) or _TAIL_CRITICAL_RE.search(skel_head))
        if is_tail or is_critical:
            missing.append(sec)
    return missing


def _completeness_continuation_prompt(
    partial_text: str,
    missing_sections: list[dict[str, Any]],
    facts_digest: str = "",
    digest_cached: bool = False,
    verified_fields_block: str = "",
    has_docs: bool = True,
) -> str:
    """APPEND-ONLY user turn for the missing template tail.

    Deliberately NOT the full drafting prompt: re-sending the whole
    'draft the COMPLETE filing-ready document' instruction is what made
    models restart from the caption and duplicate the entire draft below
    itself. This turn carries only the grounding context, the missing
    skeletons and the tail of what is already drafted.
    """
    blocks: list[str] = []
    for s in missing_sections:
        sid = s.get("section_id", "")
        heading = (s.get("heading") or "").strip() or sid
        skeleton = re.sub(r"-{4,}", "---", s.get("original_text", "") or "")
        skeleton = re.sub(r"_{25,}", "_" * 12, skeleton)
        blocks.append(
            f"### MISSING: {heading} (section_id={sid})\n"
            f"Template skeleton (reproduce format; fill from inventory only):\n"
            f"<<<{skeleton}>>>"
        )
    names = ", ".join(
        (s.get("heading") or s.get("section_id") or "?").strip() for s in missing_sections
    )
    facts_block = ""
    if digest_cached:
        facts_block = (
            "Use the FACT INVENTORY provided in the cached context — every "
            "substantive statement comes from it.\n"
        )
    elif facts_digest:
        facts_block = (
            f"FACT INVENTORY (sole content authority):\n<<<FACTS\n{facts_digest}\nFACTS>>>\n"
        )
    elif has_docs:
        # Single-call mode (no pre-extracted digest): the raw supporting
        # documents are re-attached to this request.
        facts_block = (
            "The supporting documents are ATTACHED to this request. Use ONLY "
            "what they state as your fact source — nothing invented or "
            "inferred beyond them.\n"
        )
    else:
        facts_block = (
            "No supporting documents — keep every template blank token exactly "
            "(____, brackets); never invent facts.\n"
        )
    ledger_block = ""
    if verified_fields_block:
        ledger_block = (
            f"VERIFIED FIELD LEDGER:\n<<<LEDGER\n{verified_fields_block}\nLEDGER>>>\n"
        )
    return (
        "COMPLETENESS CONTINUATION — APPEND-ONLY TASK.\n"
        "A court-ready document has ALREADY been drafted; its final portion is "
        "inside <<<PARTIAL … PARTIAL>>> below. The template sections listed as "
        f"MISSING ({names}) are the ONLY thing left to write.\n"
        "HARD RULES:\n"
        "- Do NOT restart, re-draft, repeat or summarize ANY earlier part of the "
        "document.\n"
        "- Do NOT output the court caption / cause title / party blocks again.\n"
        "- Your output starts DIRECTLY with the first MISSING section's text and "
        "ends after the last MISSING section — nothing before it, nothing after "
        "it, no commentary.\n"
        "- Fill facts ONLY from the fact inventory"
        + (" / verified ledger" if verified_fields_block else "")
        + "; missing values keep the skeleton's blank token or "
        "[DATA NOT PROVIDED: <what>].\n"
        "- Continue the existing paragraph numbering and annexure marks — never "
        "renumber or restate earlier content.\n\n"
        f"{facts_block}{ledger_block}\n"
        + "\n\n".join(blocks)
        + "\n\n<<<PARTIAL\n"
        + (partial_text[-8000:] if partial_text else "")
        + "\nPARTIAL>>>"
    )


def _dedupe_continuation(existing: str, continuation: str) -> str:
    """Strip from ``continuation`` leading/trailing runs that repeat ``existing``.

    Models asked to 'continue' or 'append the missing tail' sometimes restart
    the document from the caption instead — appending that verbatim duplicates
    the whole draft below itself (the observed defect). Leading blocks already
    present in the existing text are dropped: exact alnum-normalized
    containment, or ≥80 % 8-word-shingle containment for lightly reworded
    replays. Short ambiguous blocks (VERSUS, blanks, bare headings) are held
    and resolved by the next definitive block. From the first genuinely new
    block through the last, content is kept; a trailing replay run after that
    (e.g. re-emitted PRAYER/VERIFICATION past a missing section) is also
    dropped when it contains at least one long containment-confirmed replay.
    Returns '' when nothing new remains; when nothing is dropped the
    continuation is returned byte-identical.
    """
    cont = (continuation or "").strip("\n")
    if not cont.strip():
        return ""
    if not (existing or "").strip():
        return continuation
    exist_n = _norm_match(existing)

    def _is_replay(block_n: str) -> bool:
        if len(block_n) >= 20 and block_n in exist_n:
            return True
        words = block_n.split()
        if len(words) >= 12:
            shingles = [" ".join(words[i:i + 8]) for i in range(0, len(words) - 7, 4)]
            if shingles:
                hits = sum(1 for s in shingles if s in exist_n)
                return hits / len(shingles) >= 0.8
        return False

    blocks = re.split(r"\n{2,}", cont)
    # duplicate flags: True (replay), False (new), None (too short to decide)
    flags: list[Optional[bool]] = []
    for block in blocks:
        bn = _norm_match(block)
        if not bn:
            flags.append(None)
        elif len(bn) >= 20:
            flags.append(_is_replay(bn))
        else:
            flags.append(True if bn in exist_n else False)
    # First definitively-new block starts the kept tail; ambiguous/short blocks
    # directly before it (e.g. its heading) are kept with it. A short "new"
    # block whose following long blocks are ALL replays is treated as a
    # lightly-reworded caption line inside a restart (e.g. filled blank /
    # case number) — keep searching so we do not commit the whole replay.
    keep_from: Optional[int] = None
    for i, flag in enumerate(flags):
        if flag is not False:
            continue
        if len(_norm_match(blocks[i])) < 20:
            long_ahead = [
                flags[j]
                for j in range(i + 1, min(i + 6, len(flags)))
                if flags[j] is not None and len(_norm_match(blocks[j])) >= 20
            ]
            if long_ahead and all(x is True for x in long_ahead):
                continue
        keep_from = i
        break
    if keep_from is None:
        return ""
    while keep_from > 0 and flags[keep_from - 1] is None:
        keep_from -= 1
    # Symmetric trailing pass: drop a trailing run of replayed blocks after the
    # last definitive new block (model over-continues past a missing section and
    # re-emits already-present PRAYER / VERIFICATION). Only trim when the run
    # contains at least one long containment-confirmed replay — short Place:/
    # Dated: lines that normalize to earlier prose must not be clipped alone.
    last_new = max(
        (i for i, f in enumerate(flags) if f is False and i >= keep_from),
        default=keep_from,
    )
    keep_to = len(blocks)
    j = len(flags) - 1
    while j > last_new and flags[j] is not False:
        if flags[j] is True or (flags[j] is None and keep_to == j + 1):
            keep_to = j
        j -= 1
    if keep_to < len(blocks) and not any(
        flags[k] is True and len(_norm_match(blocks[k])) >= 20
        for k in range(keep_to, len(blocks))
    ):
        keep_to = len(blocks)
    if keep_from == 0 and keep_to == len(blocks):
        return continuation  # nothing dropped — preserve formatting exactly
    return "\n\n".join(blocks[keep_from:keep_to]).strip("\n")


def _trim_overlap(existing: str, new_part: str, max_window: int = 400) -> str:
    """Drop a short head of ``new_part`` that verbatim-repeats the tail of
    ``existing`` — models often re-emit the last few words before continuing
    mid-sentence. Only a significant overlap (≥12 normalized chars AND ≥3
    words) is trimmed, so a new sentence that merely opens with a common
    two-word phrase ("The Plaintiff …") is never mangled."""
    if not existing or not new_part:
        return new_part
    e_tail = _norm_match(existing[-2000:])
    best = 0
    for k in range(12, min(max_window, len(new_part)) + 1):
        head_n = _norm_match(new_part[:k])
        if (
            len(head_n) >= 12
            and head_n.count(" ") >= 2
            and e_tail.endswith(head_n)
        ):
            best = k
    return new_part[best:].lstrip(" \t") if best else new_part


def _join_continuation(existing: str, new_part: str) -> str:
    """Stitch a deduplicated continuation onto the draft — with a space when it
    resumes mid-sentence, otherwise as a new paragraph."""
    if not (existing or "").strip():
        return new_part
    if not (new_part or "").strip():
        return existing
    e = existing.rstrip()
    n = new_part.strip("\n")
    first = n.lstrip()
    # Table continuation: rejoin rows with a single newline — a blank line
    # would terminate the markdown table and orphan the remaining rows.
    if e.endswith("|") and first.startswith("|"):
        return e + "\n" + first
    mid_sentence = (
        first
        and not re.search(r'[.:;!?|"”\)\]]\s*$', e)
        and (first[0].islower() or first[0] in ",;)")
    )
    if mid_sentence:
        return e + " " + first
    return e + "\n\n" + n


def split_monolithic_output(text: str, sections: list[dict[str, Any]]) -> dict[str, str]:
    """Parse one-shot model output into per-section bodies (structural join only)."""
    text = (text or "").strip()
    by_id: dict[str, str] = {}

    tagged = _SECTION_TAG_RE.findall(text)
    if tagged:
        for sid, body in tagged:
            by_id[sid.strip()] = body.strip()
        return by_id

    # Fallback: slice by template headings in order.
    cursor = 0
    for i, sec in enumerate(sections):
        heading = (sec.get("heading") or "").strip()
        sid = sec.get("section_id", "")
        if not heading:
            continue
        pos = text.find(heading, cursor)
        if pos == -1:
            pattern = r"\s*".join(re.escape(tok) for tok in heading.split())
            m = re.search(pattern, text[cursor:], re.IGNORECASE)
            pos = cursor + m.start() if m else -1
        if pos == -1:
            continue
        next_pos = len(text)
        for later in sections[i + 1:]:
            h2 = (later.get("heading") or "").strip()
            if not h2:
                continue
            p2 = text.find(h2, pos + len(heading))
            if p2 != -1:
                next_pos = p2
                break
        by_id[sid] = text[pos:next_pos].strip()
        cursor = next_pos
    return by_id


def build_monolithic_prompt(
    structure: dict[str, Any],
    sections: list[dict[str, Any]],
    facts_digest: str,
    user_instructions: Optional[str],
    has_docs: bool,
    digest_cached: bool = False,
    min_total_words: int = 0,
    exhibit_register: Optional[list[dict[str, str]]] = None,
    factual_manifest: str = "",
    interest_pairing_table: str = "",
    field_coverage_checklist: str = "",
    source_docs_text: str = "",
    verified_fields_block: str = "",
) -> str:
    """Single user turn for one-shot drafting."""
    title = structure.get("document_title") or "Draft Document"
    sec_blocks: list[str] = []
    for s in sections:
        sid = s.get("section_id", "")
        phs = s.get("placeholders") or []
        ph_detail = "\n".join(
            f"    - `{p.get('original_token') or '____'}`: {p.get('label', p.get('key', ''))}"
            " — fill from inventory ONLY; if absent, output the token verbatim"
            for p in phs
        ) or "    - (none)"
        heading = (s.get("heading") or "").strip()
        directives: list[str] = []
        if s.get("heading_verbatim", True) and heading:
            directives.append(
                f'HEADING: the template prints this heading — reproduce it character-for-character: "{heading}" '
                "(keep its exact case, punctuation and bolding)."
            )
        else:
            directives.append(
                "HEADING: derived navigation label only — the template block has NO printed "
                "heading; output NO heading line, start directly with the content."
            )
        if s.get("is_boilerplate"):
            directives.append(
                "BOILERPLATE: keep the template wording; fill in only THIS matter's particulars."
            )
        if s.get("contains_table"):
            directives.append(
                "TABLE: this section contains a data table — output a GitHub markdown table "
                "with the template's EXACT column headers, fully populated: a chronology "
                "transfers EVERY row of the fact inventory's CHRONOLOGICAL FACTUAL MATRIX "
                "in order; other tables take one row per genuinely matching fact (an item of "
                "a different type never gets forced into the table — plead it in text). "
                "Never compute a cell value; missing cell → [DATA NOT PROVIDED: <what>]. "
                "Status columns always filled ('Filed herewith', 'Annexed as ANNEXURE P-#'). "
                "Drop template example rows with no matching fact."
            )
        if "verification" in heading.lower():
            directives.append(
                "VERIFICATION: use the statutory split form with this draft's ACTUAL "
                "paragraph numbers, in three categories — (a) personal knowledge, "
                "(b) business records, (c) legal advice — covering every paragraph exactly "
                "once (no gaps, no overlaps); any Statement of Truth must mirror these ranges."
            )
        hl = heading.lower()
        skel_l = (s.get("original_text") or "").lower()
        if any(k in hl for k in (
            "cause title", "court", "suit no", "case no", "caption", "title page",
            "parties", "tribunal", "forum",
        )) or "versus" in hl or re.search(r"\bversus\b", skel_l):
            directives.append(
                "CAPTION: render each party/forum block and separator line (VERSUS/AND/BETWEEN) "
                "ONCE as the skeleton shows — never duplicate. Fill forum/court from inventory "
                "when stated. If the skeleton shows slash-separated title/relief options, output "
                "ONLY the option(s) this matter actually uses."
            )
        if any(k in hl for k in (
            "prayer", "relief", "order sought", "prayers", "remedy",
        )) or "prays" in skel_l:
            directives.append(
                "RELIEF/PRAYER: include ONLY reliefs/orders argued in the body and supported "
                "by inventory. ZERO [DATA NOT PROVIDED] — omit a sub-clause if particulars are "
                "absent. If body declares no interim relief sought, delete interim clauses."
            )
        if any(k in hl for k in (
            "list of documents", "index of documents", "accompanying", "annexure",
            "exhibit", "schedule of documents",
        )):
            directives.append(
                "DOCUMENT REGISTER: one row per relied-on document with its mark exactly as "
                "used in the body (per template terminology — ANNEXURE/Exhibit/Schedule). "
                "Never a bare status without the mark when annexed in the body."
            )
        if any(k in hl for k in (
            "dates and events", "chronology", "list of dates", "timeline",
        )) or s.get("contains_table") and "date" in hl:
            directives.append(
                "CHRONOLOGY: transfer EVERY row of the inventory's CHRONOLOGICAL FACTUAL MATRIX "
                "in order — no omitted events."
            )
        if any(k in hl for k in (
            "statement of truth", "affidavit", "verification", "declaration",
        )):
            directives.append(
                "SWORN/ATTESTATION: use this draft's ACTUAL paragraph numbers; split per "
                "template/statutory form; signatory particulars from inventory or skeleton "
                "blank only — never [DATA NOT PROVIDED] in executed clauses."
            )
        if "/" in skel_l and any(
            k in skel_l for k in ("relief", "remedy", "prayer", "injunction", "declaration")
        ):
            directives.append(
                "OPTION MENU: this skeleton shows alternative reliefs/options — output ONLY "
                "those selected for this matter, not the full slash-separated list."
            )
        directive_txt = "\n".join(f"  • {d}" for d in directives)
        # Sanitize the skeleton: page-width dash rules in templates make a
        # temperature-0 model echo thousands of dash tokens (minutes of
        # apparent stall). Collapse them before they enter the prompt.
        skeleton = re.sub(r"-{4,}", "---", s.get("original_text", "") or "")
        skeleton = re.sub(r"_{25,}", "_" * 12, skeleton)
        sec_blocks.append(
            f"### Section {s.get('index', 0) + 1}: {heading} "
            f"(section_id={sid})\n"
            f"{directive_txt}\n"
            f"Template skeleton (FORMAT GUIDE ONLY — copy its structure, numbering style, "
            f"bolding, line breaks and procedural phrasing; replace every case-specific "
            f"sample with THIS matter's facts):\n<<<{skeleton}>>>\n"
            f"Placeholders:\n{ph_detail}"
        )
    facts_block = ""
    if has_docs and facts_digest and digest_cached:
        # COST: the inventory lives in the cached prefix — never inline it twice.
        facts_block = (
            "\nUse the FACT INVENTORY provided in the cached context (complete "
            "extraction of the supporting documents). Every substantive statement "
            "comes from it.\n"
        )
    elif has_docs and facts_digest:
        facts_block = (
            f"\nFACT INVENTORY (primary content authority — every substantive statement "
            f"comes from here):\n<<<FACTS\n{facts_digest}\nFACTS>>>\n"
        )
    elif has_docs:
        # SINGLE-CALL MODE: no pre-extracted digest — the supporting documents
        # are ATTACHED to this same request. Read them completely yourself and
        # draft from them directly in this one pass.
        facts_block = (
            "\nThe supporting documents are ATTACHED to this request (no separate "
            "extraction pass was run — this is a single-call draft). Read every "
            "attached document completely, first page to last, including schedules, "
            "annexures, tables and signature blocks, and use ONLY what they state as "
            "your fact source. Nothing may be invented or inferred beyond them.\n"
        )
    elif not has_docs:
        facts_block = (
            "\nNo supporting documents — keep every template blank token exactly "
            "(____, brackets, underscores). Use a plain blank (____) for narrative "
            "gaps; never invent facts.\n"
        )
    verified_block = ""
    if verified_fields_block:
        verified_block = (
            "\nVERIFIED FIELD LEDGER (Stage-2 grounded extraction — every VERIFIED "
            "value below was programmatically matched verbatim against its cited "
            "source document):\n"
            f"<<<LEDGER\n{verified_fields_block}\nLEDGER>>>\n"
            "LEDGER RULES:\n"
            "- VERIFIED values fill their template slots character-for-character.\n"
            "- MISSING fields: never guess — keep the skeleton blank token or "
            "[DATA NOT PROVIDED: <field>] per the missing-value algorithm.\n"
            "- CONFLICT fields: never silently pick one — use the value the FACT "
            "INVENTORY confirms; if still unresolved, treat as missing.\n"
            "- UNVERIFIED citations: treat as missing unless the FACT INVENTORY "
            "independently states the value.\n"
            "- Never print ledger provenance ([source: …]) into the draft.\n"
        )
    source_block = ""
    if source_docs_text:
        source_block = (
            "\nSOURCE DOCUMENTS (verbatim extracts of the user's uploads — secondary "
            "authority for verification only):\n"
            "- FACT INVENTORY above is primary. If a field is in the inventory, copy it.\n"
            "- If the inventory is missing a field that appears in these extracts, "
            "COPY it character-for-character into the draft (do not invent).\n"
            "- If neither inventory nor extracts state a value, use ____ / omit — "
            "NEVER invent, NEVER copy sample values from the template skeleton.\n"
            f"<<<SOURCE_DOCS\n{source_docs_text}\nSOURCE_DOCS>>>\n"
        )
    exhibit_block = ""
    if exhibit_register:
        reg_lines = "\n".join(
            f"  ANNEXURE {e['mark']} = {e.get('desc', '?')}" for e in exhibit_register
        )
        exhibit_block = (
            "\nPRE-ASSIGNED EXHIBIT REGISTER (use these marks exactly — one document, "
            "one mark; cite inline at every body mention; List of Documents must match):\n"
            f"{reg_lines}\n"
        )
    chrono_block = ""
    matrix_rows = re.findall(r"(?m)^\|\s*\d+\.?\s*\|.+$", facts_digest or "")
    if matrix_rows:
        chrono_block = (
            "\nCHRONOLOGY MANIFEST (EVERY row below MUST appear as its own row in the "
            "list-of-dates / chronology table AND be narrated in the factual body — "
            "omission = factual defect):\n"
            + "\n".join(matrix_rows)
            + "\n"
        )
    factual_block = ""
    if factual_manifest:
        factual_block = (
            "\nFACTUAL MANIFEST (authoritative content — reproduce exactly; this is what "
            "makes the draft factually strong):\n<<<MANIFEST\n"
            f"{factual_manifest}\nMANIFEST>>>\n"
        )
    interest_block = ""
    if interest_pairing_table:
        interest_block = f"\n{interest_pairing_table}\n"
    coverage_block = ""
    if field_coverage_checklist:
        coverage_block = (
            f"\n{field_coverage_checklist}\n"
            "FIELD COVERAGE MANDATE: for EVERY checklist item above, the draft MUST contain "
            "that exact value (or a character-faithful copy) in the caption, party "
            "introduction, facts, valuation, or prayer. Skipping a listed address, CIN, "
            "GSTIN, Act year, incorporation date, nature of business, signatory, invoice "
            "amount, or UTR because the template skeleton is short is a defect — expand "
            "the party/facts paragraphs to hold every listed field.\n"
        )
    doc_type = structure.get("document_type") or ""
    jurisdiction = structure.get("jurisdiction_or_domain") or ""
    type_block = ""
    if doc_type or jurisdiction:
        type_block = (
            f"\nDOCUMENT TYPE (from template analysis): {doc_type or 'unspecified'}"
            + (f" | Domain: {jurisdiction}" if jurisdiction else "")
            + "\nAdapt party designations, statutory forms, relief terminology and register "
            "to THIS document type — do not impose conventions from a different document class.\n"
        )
    blank_rules = (
        "\nZERO-HALLUCINATION RULES (mandatory — any template, any legal domain):\n"
        "- EVERY substantive statement comes ONLY from the fact inventory / supporting documents.\n"
        "- Missing values: skeleton blank token → keep EXACT token; filing numbers → customary "
        "blanks per skeleton; narrative gaps → [DATA NOT PROVIDED: <what>]. NEVER use "
        "[DATA NOT PROVIDED] inside relief/prayer/sworn clauses — omit the sub-clause instead.\n"
        "- NEVER invent facts or copy sample values from template skeletons (contamination).\n"
        "- NEVER copy [Source: filename] tags, uploaded file names, or inventory provenance "
        "notes into the draft — those are internal only. Cite documents by description + "
        "ANNEXURE/EXHIBIT mark only.\n"
        "\nTEMPLATE-DRIVEN ACCURACY (universal — applies to every document type):\n"
        "- Caption/front-matter: each block rendered ONCE; forum/court filled from inventory.\n"
        "- Option menus (slash-separated reliefs/causes in skeleton): output ONLY what this "
        "matter and the USER DRAFT FOCUS use — never the full menu (e.g. money recovery only "
        "→ 'FOR RECOVERY OF MONEY', not DAMAGES/DECLARATION/INJUNCTION/…).\n"
        "- Do NOT add headings, sections, tables or prayers the template does not contain.\n"
        "- Do NOT skip any template section — cover every skeleton block through the LAST "
        "one (verification, list of documents, signature/place-date when present).\n"
        "- Capture EVERY source-document field that belongs in a template slot "
        "(party particulars, amounts, dates, IDs, exhibits) — omission is a defect.\n"
        "- Party/entity descriptions: inventory wording verbatim; never infer from names.\n"
        "- Statute references: exact Act and year from source when stating incorporation/law.\n"
        "- Admissions language: 'admitted' only for express admissions; disputed → neutral terms.\n"
        "- Authorization: only types evidenced in inventory.\n"
        "- Relief/prayer: mirror body only; coherent interim position; no placeholders.\n"
        "- Chronology: every inventory matrix row transferred.\n"
        "- Document register: each row carries its exhibit/annexure mark per template style.\n"
        "- Pending-proceedings clauses: resolved from inventory or negative averment.\n"
        "- Multi-component amounts: each component's own accrual/due date unless inventory says otherwise.\n"
        "\nFORMAT FIDELITY (whole document):\n"
        "- Mark bold text with **double asterisks** exactly where the template shows bold "
        "(headings, party names in the cause title, defined terms, amounts in prayers).\n"
        "- Preserve each skeleton's line breaks, spacing, case (UPPERCASE headings stay "
        "UPPERCASE), punctuation and numbering style (1./1.1/(a)/(i)) exactly.\n"
        "- Body paragraphs are numbered CONTINUOUSLY across all body sections (attestation "
        "blocks restart at 1); prayer clauses letter (a), (b), (c)… without gaps.\n"
        "- Data tables are GitHub markdown tables (| col | col |) — never prose, never "
        "tab-separated text. Separator rows use EXACTLY three dashes per column "
        "(|:---|:---|); NEVER draw long runs of dashes, hyphens or page-width rule "
        "lines anywhere in the document.\n"
        "- Party designations align as the template shows them (e.g. '…PLAINTIFF' / "
        "'…DEFENDANT' on their own right-hand lines).\n"
    )
    extra = ""
    if user_instructions and str(user_instructions).strip():
        extra = (
            "\n═══════════════════════════════════════════════════════════\n"
            "USER DRAFT FOCUS (PRIMARY EMPHASIS — the user typed this; the draft "
            "must centre on it while staying inside the template + inventory):\n"
            f"{user_instructions.strip()}\n"
            "Apply this focus to: title/relief narrowing, prayer emphasis, which "
            "optional clauses to develop, party roles, and narrative priority. "
            "Do NOT invent facts to satisfy the focus; do NOT add template-foreign "
            "sections; do NOT ignore inventory fields that the focus does not mention.\n"
            "═══════════════════════════════════════════════════════════\n"
        )
    length_block = ""
    if min_total_words and has_docs and facts_digest:
        n_events = len(re.findall(r"^\|\s*\d+\.?\s*\|", facts_digest, re.MULTILINE))
        events_line = (
            f"The inventory's chronological matrix has {n_events} events: the factual "
            f"narration must contain one fully-developed numbered paragraph for EACH of "
            f"them (who, what, when, where, amounts, consequence — 80 to 150 words each), "
            if n_events
            else "Narrate every chronology event as its own fully-developed numbered paragraph, "
        )
        length_block = (
            f"\nLENGTH (hard requirement): a court-ready LONG draft of AT LEAST "
            f"{min_total_words} words (~20+ pages). This length comes ONLY from coverage "
            f"depth, never padding: {events_line}"
            "fully set out every material clause and term of each agreement/document in "
            "the section where it belongs, introduce every party with COMPLETE formal "
            "particulars (full name, both addresses if given, nature of business, CIN/PAN/"
            "GSTIN, Act + year, incorporation date, authorized signatory + authorization "
            "document — every field present in the FIELD COVERAGE CHECKLIST / PARTIES "
            "inventory), and develop each ground/submission as its own reasoned paragraph. "
            "Never summarize where the inventory supports full narration; never repeat or "
            "invent to reach the number. Legal-ingredient sections (cause of action, "
            "limitation, jurisdiction, valuation) stay concise and cross-refer.\n"
        )
    # Explicit ordered checklist so the model cannot "finish" before the template ends.
    coverage_lines: list[str] = []
    for s in sections:
        heading = (s.get("heading") or "").strip() or s.get("section_id", "?")
        coverage_lines.append(f"  {int(s.get('index', 0)) + 1}. {heading}")
    section_coverage_block = ""
    if coverage_lines:
        section_coverage_block = (
            "\nTEMPLATE SECTION COVERAGE (mandatory — every line below MUST appear in "
            "the draft, in this order; stopping before the last line is a defect):\n"
            + "\n".join(coverage_lines)
            + "\nThe document is NOT complete until the LAST item above is fully written "
            "(verification / statement of truth / list of documents / signature blocks "
            "when present in the template — never omit the tail).\n"
        )
    return (
        f"Draft the COMPLETE filing-ready document.\n"
        f"(Internal label only — do NOT print this as a cover title: {title})\n"
        f"Document type: {doc_type or structure.get('document_type', '')}\n"
        f"{type_block}{facts_block}{verified_block}{source_block}{factual_block}{coverage_block}"
        f"{exhibit_block}{interest_block}{chrono_block}{section_coverage_block}"
        f"{blank_rules}{length_block}{extra}\n"
        "TEMPLATE SECTIONS (reproduce each section's format exactly; fill from the inventory only):\n"
        + "\n\n".join(sec_blocks)
        + "\n\nOUTPUT: ONE continuous court-ready document in template order — pure "
        "document text only. Start with the FIRST template skeleton's printed text "
        "(court/cause-title/parties/etc.) — NEVER invent or prepend a standalone "
        "document title/cover line that is not inside a TEMPLATE SECTION skeleton. "
        "Cover EVERY template section through the LAST one (do not stop after the "
        "prayer/body — finish verification, statement of truth, list of documents, "
        "schedules and signature blocks when the template has them). "
        "No commentary, no markdown fences, no section tags, "
        "NO ATX markdown headings (never write lines starting with #, ##, or ### — "
        "court/suit lines are plain bold/uppercase text only), no [Source: …] "
        "provenance tags, and no uploaded source filenames."
    )


def _is_degenerate_tail(text: str) -> bool:
    """True when the last 600 emitted chars are ~all table-frame/rule chars —
    the temp-0 'dash attractor' loop. Cheap; checked once per chunk."""
    if len(text) < 600:
        return False
    tail = text[-600:]
    junk = sum(tail.count(c) for c in "-_=|+*. \n\t:")
    return junk >= 560


def _is_claude_model(model: str) -> bool:
    return (model or "").strip().lower().startswith("claude")


def _anthropic_api_key() -> str:
    """ANTHROPIC_API_KEY from the process env, falling back to the service's
    .env file — pydantic settings read .env internally without exporting it
    to os.environ, so the Anthropic SDK would otherwise never see the key."""
    key = (os.environ.get("ANTHROPIC_API_KEY") or "").strip()
    if key:
        return key
    try:
        from dotenv import dotenv_values
        key = (dotenv_values(".env").get("ANTHROPIC_API_KEY") or "").strip()
        if key:
            os.environ["ANTHROPIC_API_KEY"] = key
    except Exception:
        key = ""
    return key


async def _iter_claude_chunks(
    model: str,
    system_prompt: str,
    prompt_text: str,
    max_output_tokens: int,
) -> AsyncIterator[dict[str, Any]]:
    """Stream a draft from the Anthropic API with the same item protocol as the
    Gemini iterator ({kind: chunk|done}). No Gemini context cache here — the
    caller inlines the fact inventory into the prompt for Claude models."""
    from anthropic import AsyncAnthropic

    api_key = _anthropic_api_key()
    if not api_key:
        raise RuntimeError(
            "ANTHROPIC_API_KEY is not set — add it to "
            "Backend/agentic-chat-service/.env to use Claude models"
        )
    client = AsyncAnthropic(api_key=api_key)
    # No sampling params: non-default temperature/top_p 400s on Sonnet 5 and
    # Opus 4.8/4.7. thinking is explicitly disabled — Sonnet 5 runs ADAPTIVE
    # thinking when the field is omitted, which would burn minutes before the
    # first token; drafting wants minimum thinking and fastest streaming.
    async with client.messages.stream(
        model=model,
        max_tokens=min(int(max_output_tokens), 64000),
        thinking={"type": "disabled"},
        system=system_prompt,
        messages=[{"role": "user", "content": prompt_text}],
    ) as stream:
        async for text in stream.text_stream:
            if text:
                yield {"kind": "chunk", "text": text}
        final = await stream.get_final_message()
        in_tok = int(getattr(final.usage, "input_tokens", 0) or 0)
        out_tok = int(getattr(final.usage, "output_tokens", 0) or 0)
        yield {
            "kind": "done",
            "usage": {
                "inputTokens": in_tok,
                "outputTokens": out_tok,
                "totalTokens": in_tok + out_tok,
            },
            "finish_reason": "MAX_TOKENS" if final.stop_reason == "max_tokens" else (final.stop_reason or ""),
        }


class _TagStreamCleaner:
    """Strips [SECTION id] / [/SECTION id] framing from a live stream without
    ever emitting a partial tag (holds back a trailing unclosed '[' fragment).
    Also collapses pathological dash floods (a model drawing page-width rule
    lines burns thousands of output tokens) down to a plain '---'."""

    _TAG_RE = re.compile(r"\[/?SECTION[^\]]*\]\n?", re.IGNORECASE)
    _DASH_FLOOD_RE = re.compile(r"-{20,}")
    _UNDERSCORE_FLOOD_RE = re.compile(r"_{25,}")
    _ATX_HEADING_RE = re.compile(r"(?m)^([ \t]{0,3})#{1,6}[ \t]+")

    def __init__(self) -> None:
        self._pending = ""

    def _collapse(self, text: str) -> str:
        text = self._DASH_FLOOD_RE.sub("---", text)
        text = self._UNDERSCORE_FLOOD_RE.sub("_" * 12, text)
        # Strip ATX markdown headings Claude emits (# IN THE COURT…)
        text = self._ATX_HEADING_RE.sub(r"\1", text)
        return text

    def feed(self, chunk: str) -> str:
        self._pending += chunk
        cleaned = self._TAG_RE.sub("", self._pending)
        cleaned = self._collapse(cleaned)
        # Hold back a possible partial tag at the very end of the buffer.
        tail_open = cleaned.rfind("[")
        if tail_open != -1 and "]" not in cleaned[tail_open:] and len(cleaned) - tail_open <= 40:
            out, self._pending = cleaned[:tail_open], cleaned[tail_open:]
        else:
            out, self._pending = cleaned, ""
            # Hold back a trailing dash/underscore run so a flood split across
            # chunks still collapses to a single '---' / short blank.
            m = re.search(r"[-_]{3,}$", out)
            if m:
                out, self._pending = out[: m.start()], m.group(0)
        return out

    def flush(self) -> str:
        out = self._TAG_RE.sub("", self._pending)
        out = self._collapse(out)
        self._pending = ""
        return out


@dataclass
class MonolithicDraftContext:
    """Dependencies injected from drafting_service (avoids circular imports)."""

    loop: Any
    client: Any
    model: str
    model_chain: list[str]
    session_id: str
    user_id: str
    structure: dict[str, Any]
    sections: list[dict[str, Any]]
    facts_digest: str
    has_docs: bool
    user_instructions: Optional[str]
    cache_name: Optional[str]
    inline_parts: Optional[list[Any]]
    max_output_tokens: int
    total_usage: dict[str, int]
    call_ledger: list[dict[str, Any]]
    iter_chunks: Callable[..., AsyncIterator[dict[str, Any]]]
    strip_markers: Callable[[str], str]
    record_call: Callable[..., None]
    add_usage: Callable[..., None]
    log_usage: Callable[..., Any]
    save_section: Callable[..., Any]
    thinking_cfg: Callable[[], dict[str, Any]]
    drafting_system_prompt: str
    digest_cached: bool = False
    min_total_words: int = 0
    # Pre-computed bookkeeping (Layer I.3/I.4 of the renderer contract):
    # the model LOOKS UP marks, interest rows and key facts instead of
    # tracking them across an 8k-word autoregressive pass.
    exhibit_register: list[dict[str, str]] = field(default_factory=list)
    factual_manifest: str = ""
    interest_pairing_table: str = ""
    field_coverage_checklist: str = ""
    source_docs_text: str = ""
    # Stage-2 grounded extraction ledger (verified/missing/conflict/unverified).
    verified_fields_block: str = ""


class MonolithicDraftingStrategy(DraftingStrategy):
    """One-shot draft — faster/cheaper; whole document depends on one call."""

    async def draft(self, ctx: MonolithicDraftContext) -> AsyncIterator[dict[str, Any]]:
        from google.genai import types as gt

        prompt = build_monolithic_prompt(
            ctx.structure, ctx.sections, ctx.facts_digest,
            ctx.user_instructions, ctx.has_docs,
            digest_cached=ctx.digest_cached,
            min_total_words=ctx.min_total_words,
            exhibit_register=ctx.exhibit_register or None,
            factual_manifest=ctx.factual_manifest or "",
            interest_pairing_table=ctx.interest_pairing_table or "",
            field_coverage_checklist=ctx.field_coverage_checklist or "",
            source_docs_text=ctx.source_docs_text or "",
            verified_fields_block=ctx.verified_fields_block or "",
        )
        input_hash = _sha256(prompt)
        started = time.monotonic()
        full_text = ""
        last_usage: dict[str, int] = {}
        last_err: Exception | None = None

        yield {
            "type": "draft_start",
            "mode": "monolithic",
            "drafting_strategy": "monolithic",
        }
        yield {"type": "status", "message": "Drafting entire document in one pass (monolithic)…"}

        # temp 0 + top_p 0.1 is a repetition trap: after "|:" the dash token
        # dominates the tiny nucleus and the model can loop for thousands of
        # tokens (the observed INDEX-table stall). A wider nucleus dissolves
        # the attractor; the degeneracy circuit breaker is the hard guarantee.
        # NO penalty params — gemini-2.5-flash rejects them with 400
        # ("Penalty is not enabled"), which would fail the whole model chain.
        config_kwargs: dict[str, Any] = {
            "temperature": 0.1,
            "top_p": 0.95,
            "max_output_tokens": ctx.max_output_tokens,
            **ctx.thinking_cfg(),
        }
        if ctx.cache_name:
            config_kwargs["cached_content"] = ctx.cache_name
        else:
            config_kwargs["system_instruction"] = ctx.drafting_system_prompt
        config = gt.GenerateContentConfig(**config_kwargs)

        cleaner = _TagStreamCleaner()
        finish_reason = None
        succeeded = False
        degen_trips = 0

        # Continuation attempts stitch the tail when a pass hits the output
        # ceiling, trips the degeneracy breaker, or the stream dies mid-way —
        # a draft is never truncated and a runaway loop is cut, not billed out.
        #
        # DUPLICATION GUARDS (the "document repeats itself below" defect):
        # - continuation output is BUFFERED, deduplicated against the existing
        #   text and only the genuinely new tail is appended/streamed — a
        #   model that restarts from the caption contributes nothing instead
        #   of doubling the draft;
        # - a mid-stream failure after substantial streamed text NEVER reruns
        #   the full prompt on the next model in the chain (the next model
        #   would re-draft from the top on top of the partial) — it resumes
        #   through a buffered continuation attempt instead.
        stalls = 0
        for attempt in range(6):
            is_continuation = attempt > 0
            prompt_text = prompt if not is_continuation else (
                f"{prompt}\n\nYou already produced the beginning of the document below; "
                "continue EXACTLY where it stops (mid-sentence if necessary), without "
                "repeating anything:\n"
                f"<<<PARTIAL\n{full_text[-6000:]}\nPARTIAL>>>"
            )
            parts = [gt.Part(text=prompt_text)]
            if ctx.inline_parts:
                parts = [*ctx.inline_parts, gt.Part(text=prompt_text)]
            contents = [gt.Content(role="user", parts=parts)]

            attempt_ok = False
            degenerate = False
            mid_stream_cut = False
            cont_buffer = ""
            for draft_model in ctx.model_chain:
                cont_buffer = ""            # a failed model's partial never leaks
                attempt_base_len = len(full_text)
                try:
                    stream = (
                        _iter_claude_chunks(
                            draft_model, ctx.drafting_system_prompt,
                            prompt_text, ctx.max_output_tokens,
                        )
                        if _is_claude_model(draft_model)
                        else ctx.iter_chunks(ctx.loop, ctx.client, draft_model, contents, config)
                    )
                    async for item in stream:
                        if item["kind"] == "chunk":
                            raw = ctx.strip_markers(item["text"])
                            if is_continuation:
                                # Buffer — appended only after deduplication.
                                cont_buffer += raw
                                if _is_degenerate_tail(full_text + cont_buffer):
                                    degenerate = True
                                    break
                            else:
                                full_text += raw
                                if _is_degenerate_tail(full_text):
                                    # Abort the stream (stops token billing) and
                                    # resume from the last good text.
                                    degenerate = True
                                    break
                                clean = cleaner.feed(raw)
                                if clean:
                                    yield {"type": "document_chunk", "text": clean}
                        elif item["kind"] == "done":
                            usage = item.get("usage") or {}
                            finish_reason = item.get("finish_reason")
                            if usage:
                                ctx.add_usage(ctx.total_usage, usage)
                                ctx.record_call(
                                    ctx.call_ledger, "drafting",
                                    "Monolithic: full document"
                                    + (" (continuation)" if attempt else " (one-shot)"),
                                    draft_model, usage,
                                )
                                for k in ("inputTokens", "outputTokens", "totalTokens"):
                                    last_usage[k] = last_usage.get(k, 0) + usage.get(k, 0)
                    ctx.model = draft_model
                    attempt_ok = True
                    break
                except Exception as exc:
                    last_err = exc
                    logger.warning("Monolithic draft model %s failed: %s", draft_model, exc)
                    if not is_continuation:
                        if len(full_text) - attempt_base_len > 800:
                            # Substantial text already streamed to the user:
                            # the next model must CONTINUE it, never restart it.
                            mid_stream_cut = True
                            break
                        # Tiny partial from the failed model: discard it so the
                        # next model's fresh draft doesn't stack on top of it
                        # (document_end carries the clean text either way).
                        full_text = full_text[:attempt_base_len]

            # Append a continuation attempt's buffer — deduplicated first.
            progressed = not is_continuation
            if is_continuation and cont_buffer:
                if degenerate:
                    cont_buffer = re.sub(r"[-_=|+.:\s]{120,}$", "\n", cont_buffer)
                new_part = _trim_overlap(
                    full_text, _dedupe_continuation(full_text, cont_buffer)
                )
                if new_part.strip():
                    progressed = True
                    base = full_text.rstrip()
                    full_text = _join_continuation(full_text, new_part)
                    emitted = full_text[len(base):]
                    local_cleaner = _TagStreamCleaner()
                    clean = local_cleaner.feed(emitted) + local_cleaner.flush()
                    if clean:
                        yield {"type": "document_chunk", "text": clean}
                else:
                    logger.warning(
                        "Monolithic continuation returned only duplicate content "
                        "(%s chars discarded)", len(cont_buffer),
                    )

            if not attempt_ok:
                if mid_stream_cut and attempt < 5:
                    yield {"type": "status",
                           "message": "Stream interrupted mid-draft — resuming from the last good text…"}
                    continue
                if attempt == 0 and len(full_text.strip()) < 800:
                    yield {"type": "error", "message": f"Monolithic draft failed: {last_err}"}
                    return
                break
            succeeded = True
            if degenerate and degen_trips < 2:
                degen_trips += 1
                if not is_continuation:
                    full_text = re.sub(r"[-_=|+.:\s]{120,}$", "\n", full_text)
                yield {"type": "status",
                       "message": "Repetition detected — resuming from the last good text…"}
                continue
            if str(finish_reason) in ("FinishReason.MAX_TOKENS", "MAX_TOKENS") and attempt < 5:
                if not progressed:
                    stalls += 1
                    if stalls >= 2:
                        logger.warning("Monolithic continuations stalled twice — stopping.")
                        break
                else:
                    stalls = 0
                yield {"type": "status",
                       "message": "Output limit reached — continuing the document…"}
                continue
            break

        # A mid-stream cut on the final allowed attempt (or exhausted chain)
        # leaves a substantial partial draft — keep it and let the
        # completeness pass append whatever template tail is still missing.
        if not succeeded and len(full_text.strip()) >= 800:
            succeeded = True
            yield {"type": "status",
                   "message": "Draft stream ended early — keeping the drafted text and "
                              "appending any missing template sections…"}

        # Completeness continuations: if the model stopped early (common after
        # prayer/body), append the missing template tail sections. Output is
        # BUFFERED and deduplicated — a model that re-drafts the document
        # instead of appending the tail contributes only the new sections, and
        # a continuation that adds nothing new stops the loop (this was the
        # "same content repeats again and again" defect).
        for comp_attempt in range(3):
            missing = find_missing_template_sections(ctx.sections, full_text)
            if not missing:
                break
            names = ", ".join(
                (s.get("heading") or s.get("section_id") or "?")[:48] for s in missing[:6]
            )
            yield {
                "type": "status",
                "message": (
                    f"Template incomplete — appending missing section(s): {names}"
                    + ("…" if len(missing) > 6 else "")
                ),
            }
            prompt_text = _completeness_continuation_prompt(
                full_text, missing,
                facts_digest=ctx.facts_digest if (ctx.has_docs and not ctx.digest_cached) else "",
                digest_cached=ctx.digest_cached,
                verified_fields_block=ctx.verified_fields_block or "",
                has_docs=ctx.has_docs,
            )
            parts = [gt.Part(text=prompt_text)]
            if ctx.inline_parts:
                parts = [*ctx.inline_parts, gt.Part(text=prompt_text)]
            contents = [gt.Content(role="user", parts=parts)]
            attempt_ok = False
            degenerate = False
            cont_buffer = ""
            for draft_model in ctx.model_chain:
                cont_buffer = ""            # a failed model's partial never leaks
                try:
                    stream = (
                        _iter_claude_chunks(
                            draft_model, ctx.drafting_system_prompt,
                            prompt_text, ctx.max_output_tokens,
                        )
                        if _is_claude_model(draft_model)
                        else ctx.iter_chunks(ctx.loop, ctx.client, draft_model, contents, config)
                    )
                    async for item in stream:
                        if item["kind"] == "chunk":
                            raw = ctx.strip_markers(item["text"])
                            cont_buffer += raw
                            if _is_degenerate_tail(full_text + cont_buffer):
                                degenerate = True
                                break
                        elif item["kind"] == "done":
                            usage = item.get("usage") or {}
                            finish_reason = item.get("finish_reason")
                            if usage:
                                ctx.add_usage(ctx.total_usage, usage)
                                ctx.record_call(
                                    ctx.call_ledger, "drafting",
                                    f"Monolithic: completeness continuation "
                                    f"({len(missing)} missing section(s))",
                                    draft_model, usage,
                                )
                                for k in ("inputTokens", "outputTokens", "totalTokens"):
                                    last_usage[k] = last_usage.get(k, 0) + usage.get(k, 0)
                    ctx.model = draft_model
                    attempt_ok = True
                    break
                except Exception as exc:
                    last_err = exc
                    logger.warning(
                        "Monolithic completeness continuation model %s failed: %s",
                        draft_model, exc,
                    )
            if not attempt_ok:
                logger.warning(
                    "Completeness continuation aborted after failures; "
                    "missing sections remain: %s",
                    [s.get("heading") or s.get("section_id") for s in missing],
                )
                break
            if degenerate:
                cont_buffer = re.sub(r"[-_=|+.:\s]{120,}$", "\n", cont_buffer)
            new_part = _trim_overlap(
                full_text, _dedupe_continuation(full_text, cont_buffer)
            )
            if not new_part.strip():
                logger.warning(
                    "Completeness continuation returned only duplicate content "
                    "(%s chars discarded) — stopping to avoid repeating the "
                    "document; still missing: %s",
                    len(cont_buffer),
                    [s.get("heading") or s.get("section_id") for s in missing],
                )
                yield {"type": "status",
                       "message": "Completeness pass returned no new content — "
                                  "stopped to avoid duplicating the draft."}
                break
            base = full_text.rstrip()
            full_text = _join_continuation(full_text, new_part)
            emitted = full_text[len(base):]
            local_cleaner = _TagStreamCleaner()
            clean = local_cleaner.feed(emitted) + local_cleaner.flush()
            if clean:
                yield {"type": "document_chunk", "text": clean}
            if degenerate:
                continue
            if str(finish_reason) in ("FinishReason.MAX_TOKENS", "MAX_TOKENS"):
                continue
            # Re-check on next loop iteration; stop when nothing missing.

        still_missing = find_missing_template_sections(ctx.sections, full_text)
        if still_missing:
            logger.warning(
                "Monolithic draft still missing %s template section(s) after "
                "completeness passes: %s",
                len(still_missing),
                [s.get("heading") or s.get("section_id") for s in still_missing],
            )
            yield {
                "type": "status",
                "message": (
                    f"Warning: {len(still_missing)} template section(s) may still be "
                    "incomplete — check the end of the draft."
                ),
            }

        tail = cleaner.flush()
        if tail:
            yield {"type": "document_chunk", "text": tail}
        if not succeeded:
            yield {"type": "error", "message": f"Monolithic draft failed: {last_err}"}
            return

        latency_ms = int((time.monotonic() - started) * 1000)
        if last_usage:
            await ctx.log_usage(
                ctx.user_id, ctx.model, last_usage,
                "/api/chat/draft/generate/stream", ctx.session_id,
            )

        logger.info(
            "Monolithic draft complete session=%s latency_ms=%s in=%s out=%s "
            "input_hash=%s output_hash=%s",
            ctx.session_id, latency_ms,
            last_usage.get("inputTokens", 0), last_usage.get("outputTokens", 0),
            input_hash, _sha256(full_text),
        )

        # FINAL DUPLICATION NET: if a full second copy of the document still
        # slipped through (restarted stream, model ignoring append-only
        # instructions), cut everything from the point where the document
        # verbatim-restarts. document_end/document_replace carry this clean
        # text, so the frontend recovers even if duplicates streamed live.
        try:
            from app.services.draft_repairs import _strip_restarted_document
            full_text, _restarts = _strip_restarted_document(full_text)
            if _restarts:
                yield {"type": "status",
                       "message": "Removed duplicated re-drafted content that was "
                                  "appended after the document end."}
        except Exception:
            logger.debug("Restart-strip net skipped", exc_info=True)

        # Persisted output gets the same cleanup as the live stream: dash-flood
        # collapse plus stray tag stripping (belt-and-braces — tags are no
        # longer requested from the model).
        full_text = re.sub(r"-{20,}", "---", full_text)
        full_text = re.sub(r"_{25,}", "_" * 12, full_text)
        clean_text = re.sub(r"\[/?SECTION[^\]]*\]\n?", "", full_text, flags=re.I).strip()

        # SINGLE-RESPONSE MODE: the draft is ONE document — no section split.
        # The template drives formatting inside the prompt; one record holds
        # the whole document for history, verification and re-download.
        record = {
            "section_id": MONOLITHIC_DOCUMENT_ID,
            "index": 0,
            "heading": ctx.structure.get("document_title") or "Draft Document",
            "heading_level": 1,
            "heading_verbatim": False,
            "content": clean_text,
            "truncated": False,
        }
        await ctx.save_section(ctx.session_id, record)
        drafted: list[dict[str, Any]] = [record]
        completed = 1

        yield {
            "type": "document_end",
            "chars": len(clean_text),
            "sections_parsed": 1,
            "sections_total": 1,
            "text": clean_text,
        }

        yield {
            "type": "_monolithic_result",
            "drafted_records": drafted,
            "completed": completed,
            "metadata": DraftMetadata(
                drafting_strategy="monolithic",
                model=ctx.model,
                monolithic_latency_ms=latency_ms,
                monolithic_input_tokens=int(last_usage.get("inputTokens", 0)),
                monolithic_output_tokens=int(last_usage.get("outputTokens", 0)),
            ),
        }

