"""
Multi-stage "expert drafter" pipeline for draft-from-template — the successor to the
single streaming call in files.py's `is_draft` branch.

Why a pipeline (not one big prompt): a single model call cannot reliably emit a 50–100
page grounded legal document — it hits the output-token ceiling and, well before that,
drifts, compresses and drops sections (the observed "20-page template → 8-page draft"
regression). So we decompose:

  A. analyze_template_structure  — STRUCTURED OUTPUT: map the template into its own
     ordered sections (heading + verbatim text sliced LOCALLY from the template, not
     round-tripped through the model + typography). The template = FORMAT authority.
  B. extract_fact_inventory      — ONE exhaustive pass over all supporting documents →
     a chronological fact matrix + fact inventory + gaps. The docs = CONTENT authority.
     Cached per session by the caller.
  C. draft_section (× N)         — each template section drafted at FULL professional
     length, its verbatim text as the format authority and the shared inventory as the
     sole content authority. This is what defeats the output ceiling: N bounded calls.
  D. grounding_audit + repair    — audit the assembled draft against the inventory and
     re-draft only the flagged sections. Zero-hallucination backstop.

Design constraints honoured (from the adversarial design review):
  * Stage A never round-trips the template's verbatim text through the model (that just
    moves the truncation ceiling upstream) — it returns short anchors and we slice the
    real text in Python.
  * The orchestrator buffers sections internally and yields ONE final assembled draft;
    it never appends pre- and post-repair copies (which would corrupt the DOCX).
  * Every blocking LLM call goes through the caller-supplied `run_blocking` (executor),
    so the FastAPI event loop is never blocked.
  * On any failure the orchestrator raises; the caller falls back to the single-call
    draft so the user always gets *a* draft.

Stays inside agentic-document-service: imports only `document_ai` and `docx_export`.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Callable

from app.services.adapters.document_ai import _generate_text
from app.services.docx_export import NOT_FOUND_MARKER

logger = logging.getLogger("agentic_document_service.template_drafting")

# Output-token budgets per stage (overrides the small agent default; clamped to the
# model ceiling inside _generate_text). Analysis/audit are compact; inventory/section
# need room.
_ANALYSIS_MAX_TOKENS = 16384
_INVENTORY_MAX_TOKENS = 32768
_SECTION_MAX_TOKENS = 16384
_AUDIT_MAX_TOKENS = 8192

# Guards.
_MAX_SECTIONS = 80              # hard cap on section count (merge overflow before drafting)
# The fact inventory (Stage B) may emit up to _INVENTORY_MAX_TOKENS (~130K chars). Every
# section drafter AND the grounding auditor must see the WHOLE inventory — if this cap is
# below the inventory size, the tail facts are invisible to the sections that need them and
# those sections blank out (NOT_FOUND) or hallucinate. Keep this ≥ the max inventory size so
# the complete fact matrix is always passed (1M-context models make this affordable).
_INVENTORY_CHAR_CAP = 150_000   # was 45_000 — truncation here was the #1 hallucination cause
_DOC_CONTEXT_CHAR_CAP = 550_000 # deep/draft budget for the one Stage-B call

# Section packing — combine consecutive small sections into fuller drafting units so each
# section-draft call produces a substantial section (≈1–5K output tokens) instead of a
# 50–150 token fragment (the observed "one court-name line → 50 tokens" waste). Line
# structure inside a unit is still preserved by the drafter (rule 8b); a table section
# stays standalone so its per-section column hint stays accurate.
_UNIT_TARGET_CHARS = 3000       # accumulate template source until a unit reaches ~this size
_UNIT_MAX_CHARS = 6500          # never let a packed unit exceed this (keeps output under the ceiling)
_UNIT_MAX_SECTIONS = 12         # never group more than this many template sections into one unit

# ── RAG retrieval knobs (used when the caller supplies a retrieve_fn) ─────────
# The draft path retrieves top-chunks from the case's vector store instead of dumping the
# whole corpus. Recall matters (a legal draft needs EVERY fact), so the fact matrix is built
# by retrieving PER FACET and unioning — a single vague "draft the agreement" query would
# miss most facts. Each section then also pulls its OWN focused top-chunks (precision).
_INV_FACET_TOP_K = 16            # top-k chunks retrieved per facet query for the fact matrix
_INV_RETRIEVAL_CHAR_CAP = 130_000  # budget for the retrieved corpus fed to Stage B
_SECTION_TOP_K = 8               # top-k chunks retrieved per section for drafting
_SECTION_EVIDENCE_CHAR_CAP = 14_000  # budget for a section's own retrieved evidence
_PRIOR_DRAFTS_CHAR_CAP = 60_000  # how much already-drafted text to show each section (anti-repeat)
# RECALL over precision for the fact matrix: if the whole corpus fits this window, the ONE
# distillation pass reads the FULL documents. Top-k retrieval reliably drops short/tabular
# facts (a "Bedrooms: 2" cell, a "01-Jul-2025" date) that embed poorly — proven in review —
# so we only fall back to per-facet RAG when the corpus is genuinely too big to read whole.
# (Per-section drafting still uses RAG top-chunks regardless — this is only the matrix pass.)
_INV_FULL_CONTEXT_MAX_CHARS = 260_000

# Facet queries — one per class of fact a legal draft needs. Retrieving per facet (rather
# than one broad query) keeps recall high on large cases while still going through RAG.
_INVENTORY_FACET_QUERIES = [
    "full names, addresses, ages, occupations, roles and identifying details of all parties",
    "dates: start date, end date, commencement, expiry, duration, term, execution date, timeline",
    "amounts of money, rent, deposit, consideration, maintenance, payments made or due, figures",
    "property/premises: address, flat/house number, carpet area, built-up area, square feet, floor",
    "configuration: number of bedrooms, bathrooms, BHK, rooms, furnishing, fittings, inventory items",
    "agreement terms, conditions, obligations, covenants, warranties, escalation, lock-in and clauses",
    "breach, default, legal notices and replies, disputes, correspondence and cause of action",
    "relief, prayer, damages, compensation, interest and orders sought from the court",
    "document references, case numbers, registration numbers, invoices, receipts, meter readings, exhibits",
]


# ─────────────────────────────── data carriers ──────────────────────────────
@dataclass
class TemplateSection:
    index: int
    heading: str
    original_text: str = ""                 # verbatim slice of the template (format authority)
    placeholders: list[str] = field(default_factory=list)
    typography: dict = field(default_factory=dict)   # {alignment, font, size_pt, bold, level}
    contains_table: bool = False
    table_header: list[str] = field(default_factory=list)


@dataclass
class TemplateAnalysis:
    title_format: dict = field(default_factory=dict)
    base_font: dict = field(default_factory=dict)
    sections: list[TemplateSection] = field(default_factory=list)


# ───────────────────────────────── prompts ──────────────────────────────────
# Stage A — anchor-based structural analyst (verbatim text is sliced locally, not
# emitted by the model, so a long template can never truncate this call).
ANALYSIS_SYSTEM_PROMPT = """You are a Template Structural Analyst for legal and business documents. Your ONLY job is to map the STRUCTURE of the template — you never draft or fill content.

Return STRICT JSON (no prose, no code fences) matching:
{
  "title_format": {"alignment": "center|left|right|justify", "font": "<name>", "size_pt": <number>},
  "base_font": {"font": "<name>", "size_pt": <number>},
  "sections": [
    {
      "index": <int, 0-based, in document order>,
      "heading": "<the section's heading, or a short derived heading if it has none>",
      "anchor": "<the EXACT first 6-12 words of this section, copied VERBATIM from the template so it can be located by string search — include the heading text if the section starts with one>",
      "placeholders": ["____", "[NAME]", "<date>", ...],
      "typography": {"alignment": "center|left|right|justify", "font": "<name>", "size_pt": <number>, "bold": <bool>, "level": <0=body,1=top heading,2=sub-heading,3=clause>},
      "contains_table": <bool>,
      "table_header": ["Col A", "Col B", ...]
    }
  ]
}

RULES:
1. Segment FINE-GRAINED and COMPLETE: every heading, recital, numbered clause, sub-clause, schedule, annexure and the signature/witness block is its own section, in document order. Cover the template from first line to last — do not merge distinct clauses and do not drop trailing sections.
1b. A DOCUMENT HEADER / CAUSE TITLE must be split into its component lines as SEPARATE sections, in order: the court-name line; the case / suit number line; "IN THE MATTER OF:"; each party's description; each role label ("…Plaintiff", "…Defendant"); "VERSUS"; and the document-type heading. Never lump the whole header into one section. Give centered lines (court, case number, "VERSUS", the main heading) typography alignment "center", and role labels ("…Plaintiff"/"…Defendant") alignment "right".
2. "anchor" MUST be copied character-for-character from the template (the first several words of the section). Do NOT paraphrase it — it is used to locate the section in the source text. Keep it short (6-12 words).
3. Detect every placeholder: bracketed tokens, blank runs (____), "insert here" hints, obviously variable values.
4. TYPOGRAPHY: fill each section's alignment/font/size/bold/level with what the template actually shows. Body prose is "justify" unless it is a signature/address/date/cause-title block (then as shown). Titles/cause-titles are usually "center". Court drafts default to Times New Roman 12pt body, 14pt bold centered title.
5. Determinism: the same template must always yield the same sections.
Return ONLY the JSON object."""

# Stage B — the librarian pass over all supporting documents (user's production prompt).
FACT_EXTRACTION_PROMPT = """# LEGAL FACTUAL MATRIX EXTRACTOR

You are a meticulous legal archivist. Read EVERY supporting document provided, completely, first page to last, and extract EVERY legally significant fact into the structure below. A lawyer who has never seen the case must understand the full story from your output alone. This output is the single source of truth for a drafting agent — nothing may be omitted.

## PART 1 — CHRONOLOGICAL FACTUAL MATRIX
A markdown table with exactly 3 columns:

| S.No | Date | Particulars |
|:-----|:-----|:------------|

- S.No — 1., 2., 3. … sequential.
- Date — DD-MMM-YYYY (e.g. 15-Jan-2024). Variants: range 15-Jan-2024 to 20-Jan-2024; approximate ~Jan-2024 [Approx]; partial Jan-2024 [Month only] / 2024 [Year only]; Before/After 15-Jan-2024; none Not Mentioned; undated Undated (After Event 5).
- Particulars — factual narration in past tense (max 2–3 sentences), then two labelled tags: [Parties: full names with roles, or Not Mentioned] and [Place: physical/Virtual (Email)/Telephonic, or Not Mentioned]. Include legally significant verbatim quotes (under 20 words, in "quotes"). End each row with the source document name in brackets, e.g. [Source: notice.pdf].

Matrix rules:
1. BE EXHAUSTIVE — contracts and amendments, all communications, payments, deliveries and non-deliveries, breaches, legal notices and replies, court filings and orders, approvals/rejections, inspections, complaints, promises, deadlines (met and missed), extensions. Include minor events — they establish knowledge, diligence and limitation.
2. Strict chronological order, earliest to latest; undated events by inferred position.
3. Facts only, no interpretation. Verbatim allegations may be quoted and attributed.
4. Extract the EVENT, not the document.
5. Multiple same-date events → separate rows; ongoing events → separate start/end rows.

## PART 2 — FACT INVENTORY
Structured plain-text sections; every item carries its source document in brackets:
PARTIES — every person/entity: full name EXACTLY as written, role, address, contact/ID/registration details (CIN, PAN, consumer numbers…).
AMOUNTS — every monetary figure: purpose, amount in figures (and words if given), payment mode, reference numbers (UTR/cheque), date.
PROPERTIES / SUBJECT MATTER — every property, asset or subject with full description.
DOCUMENT REFERENCES — every referenced document, case/FIR number, notice, agreement, purchase order, invoice, receipt, annexure — with number and date.
TERMS AND CONDITIONS — every negotiated term: durations, credit/notice periods, interest rates, obligations, special conditions, applicable clauses.
OTHER FACTS — anything else stated that could belong in a legal draft.

## PART 3 — TIMELINE GAPS AND MISSING FACTS
Flag significant unexplained gaps (with day counts and limitation relevance) and facts a drafter will need that are absent from the documents.

ABSOLUTE RULES: copy names, dates, numbers and addresses EXACTLY as written. Never summarize away detail. Never invent or infer facts not stated. Mark anything absent as Not Mentioned — never leave a field blank. If two documents conflict, list both versions with their sources."""

# Stage C — the drafter (user's production prompt, adapted: it drafts ONE section, its
# output is MARKDOWN for our court-docx renderer, and missing facts use OUR blank marker).
DRAFTING_SYSTEM_PROMPT = f"""You are a senior legal drafting agent producing COURT-READY documents that a lawyer can file directly. You draft ONE section at a time.

THE DIVISION OF AUTHORITY — never confuse these two sources:
- The TEMPLATE SECTION is the FORMAT AUTHORITY ONLY: it dictates structure, heading, clause numbering, procedural/boilerplate phrasing, and layout. It may be a filled sample from some OTHER matter — its case-specific content (names, dates, amounts, facts of that sample matter) is EXAMPLE MATERIAL ONLY and must NEVER appear in your draft.
- The FACT INVENTORY (extracted from the supporting documents) is the SOLE CONTENT AUTHORITY: every substantive statement in your draft is built from it.

ABSOLUTE GROUNDING RULES (zero hallucination — highest priority):
1. Every fact (name, parentage, age, address, date, amount, ID/PAN/Aadhaar, survey/CTS/plot no., case no., court name, section of law, account no., meter reading, etc.) MUST be traceable to the FACT INVENTORY or the RETRIEVED CASE EVIDENCE for this section. NEVER invent, guess, infer, approximate, or supply a "typical" or example value from general knowledge. Retrieval may be incomplete — a fact absent from the provided material is MISSING, even if you could plausibly guess it. A visible blank is always the correct output for unknown data; a wrong value can invalidate the document.
2. MISSING DATA → RED PLACEHOLDER. For every template slot with NO value in the inventory/evidence, insert EXACTLY this, unchanged: <span style="color:red;font-weight:bold;">[________ FIELD NAME ________]</span> — where FIELD NAME is a short CAPS label of what the user must fill (e.g. [________ TENANCY START DATE ________], [________ NUMBER OF BEDROOMS ________]). Put nothing else inside it — no guess, no "e.g.". EXCEPTIONS (stay as ordinary blanks exactly as the template shows, NOT red): fields the template leaves blank at execution — signatures, thumb impressions, notary/seal, witness signatures, registration endorsements, stamp/e-stamp number — unless the data actually exists in the sources; and registration particulars a drafter customarily blanks (suit/case numbers, filing years), which use the customary form (e.g. "COMMERCIAL SUIT NO. ____ OF 20__").
3. PRESERVE THE TEMPLATE, REPLACE ONLY VARIABLE DATA. Keep the section's structure, heading, clause numbering style, capitalization, bold/underline and layout exactly. Change ONLY the variable data; do NOT add clauses, grounds, prayers, citations, advice or "improvements". If the template shows SAMPLE / example data instead of blanks ("Mr. ABC", a sample date, an example inventory row), treat every such party-specific detail as a SLOT to replace — NEVER let the sample's data leak into the draft, and NEVER reproduce the template's example rows as extra content.
4. RESOLVE TEMPLATE OPTIONS — never leave alternatives unresolved. Where the template offers a choice ("Cash / Cheque / NEFT / UPI", "Landlord / Tenant", "12 months / upon renewal", "strike out whichever is not applicable", ☐/☑ boxes): SELECT the ONE option the inventory/evidence supports and DELETE the others (or wrap each rejected option in ~~strikethrough~~). Never keep every option in the filed draft. If the facts don't decide it, keep the most standard option for this document type and ~~strike~~ the rest, or leave a red placeholder. REJECT any option that is logically impossible given other facts (e.g. a "12 months" escalation trigger inside an 11-month term → choose the renewal-based trigger).
5. Pure boilerplate (verification, prayer wording, signature blocks): keep the template wording with this matter's particulars filled in. NARRATIVE SECTIONS (statement of facts, cause of action, grounds): write them FULLY at professional length — a complete numbered narrative from the inventory in chronological order, in the template's register and numbering style, using every relevant fact.
6. VERBATIM EXTRACTION. Copy names, parentage, addresses, ID/registration numbers, property descriptions, case numbers and dates EXACTLY as the source gives them — do not correct spelling, expand abbreviations, or reformat addresses (exact match with records is legally required). Keep "S/o", "D/o", "W/o", "R/o", "Aged about ___ years" in the template's style. Dates: use the source date, presented in the template's format (converting the FORMAT is allowed; changing the date is not). Amounts: if the template shows figures AND words ("Rs. ____/- (Rupees ____ only)"), fill BOTH — deriving the words from a figure is allowed; use the Indian lakh/crore system. Age may be computed from a date of birth in the source; otherwise a red placeholder.
7. CONFLICTS: if two sources give different values for the same field, use the most authoritative (government photo ID for identity fields, the registered deed for property fields, the court record for case fields) — do not silently merge or average.
8. Output ONLY the drafted text of THIS section — no commentary, no preamble, no code fences, no [SECTION] markers, and NO "DRAFTING NOTES" (notes belong once at the end of the whole document, never per section). Write in the formal register of the document type; match the template's language. If an "ALREADY-DRAFTED EARLIER SECTIONS" block is provided, do NOT repeat or re-narrate anything already stated there — state each fact once, in its proper section, and continue the document; refer back to earlier clauses by number rather than duplicating them.

FORMAT (this section is rendered to a Word document from MARKDOWN):
9. Reproduce the template section's OWN layout: keep its clause numbering, ordering, and ALL-CAPS words exactly as they appear. If the section's heading is INLINE with its text (e.g. "1. TERM: The tenancy…"), keep it inline — do NOT also add a separate bold heading line for it. Add a standalone bold **HEADING** line ONLY where the template presents the heading on its own line, separate from the body. Keep each clause on its own line.
9b. PRESERVE LINE STRUCTURE — never fuse distinct lines. Where the template places separate items on separate lines — a DOCUMENT HEADER / CAUSE TITLE (the court-name line; the case / suit number line; "IN THE MATTER OF:"; each party's full description; the role labels "…Plaintiff" / "…Defendant"; "VERSUS"; and the document-type heading), or a signature / address / place-and-date block — output EACH element on its OWN line with a BLANK line between distinct elements. NEVER run separate lines together into one paragraph; NEVER join two words without a space (write "…AT PUNE" and then, on a NEW line, "COMMERCIAL SUIT NO. …" — never "PUNECOMMERCIAL"); and NEVER wrap a whole multi-line header inside ONE **bold** span. Bold ONLY the specific lines the template itself shows bold/centered (court name, the case-type heading) — keep "IN THE MATTER OF:" and the party descriptions as NORMAL, non-bold text. Put each centered line (court, case number, "VERSUS", the main heading) and each right-aligned role label ("…Plaintiff", "…Defendant") on its OWN line so its alignment is preserved.
10. Use a markdown table ONLY for a genuine DATA table (a schedule, a list of dates/events, an invoice/fee table, an inventory, a list of documents/exhibits). Output it as a GitHub markdown table (| col | col |) WITH a header row AND a separator row (| --- | --- |), the SAME columns as the template, and ONE ROW PER FACT from the inventory/evidence (every relevant entry, in order). Produce EXACTLY ONE table for a data section — NEVER emit a second, generic copy, and NEVER reproduce the template's example rows. Never output an empty cell — fill it, or put the red placeholder from rule 2; drop template example rows that have no corresponding fact.
10b. NEVER put a signature block, execution block, place-and-date block, verification, statement of truth, or the cause title into a table. Those are LINE-STRUCTURED — render each item on its own line ("Place: …", "Date: …", the party name, "…through its Authorized Representative", the signatory name/designation, "Advocate for the Plaintiff" each on their own line). Do NOT emit stray pipe characters ("|") around these lines. Only use a 2-column table for signatures if the template ITSELF shows two side-by-side signing parties (e.g. LANDLORD | TENANT).
11. Do not add styling the template section does not have, beyond the red placeholder (rule 2) and the option strike-through (rule 4).

COMPLETENESS (long-form): use the FULL relevant fact inventory/evidence — every party detail, date, amount and term that belongs in THIS section MUST appear. Do not compress, sample or truncate; write the section at full professional length. Length comes from COVERAGE, never padding.

PRIORITY: factual accuracy > template format fidelity > completeness/length > style. Never invent facts, never leave a template option unresolved, and never copy the template's sample content."""

# Stage D — zero-hallucination auditor (user's production prompt, JSON out).
GROUNDING_AUDIT_PROMPT = f"""You are a zero-hallucination Grounding Auditor for legal drafts. You receive a FACT INVENTORY (the only permitted source of case facts) and a DRAFT split into numbered [SECTION k] blocks. Find EVERY specific factual assertion in the draft that is NOT supported by the inventory: names, dates, amounts, addresses, reference numbers, events, or claims the inventory does not state or that contradict it.

NOT violations (ignore these):
- Generic legal/procedural boilerplate and formal phrasing (court formalities, prayers' procedural wording, statutory names used as format).
- Explicit {NOT_FOUND_MARKER} markers, RED placeholders (any [________ FIELD ________] blank / <span style="color:red…">…</span>), and customary blanks (____, "NO. ____ OF 20__"). A blank is the CORRECT output for missing data — never flag it.
- Reasonable re-narration of inventory facts in formal drafting language.
- Arithmetic directly derivable from the inventory.

BE CONSERVATIVE (this is the most important rule): flag ONLY a concrete fabricated or contradicted FACT — a specific name, date, amount, number, party, address, reference number, or event that is absent from or contradicts the inventory. Do NOT flag verbs, adjectives, characterizations or standard drafting language (e.g. "duly", "refundable", "has paid", "lawfully", "the said"), and do NOT flag a value that IS in the inventory merely because its surrounding phrasing is not. When in doubt, do NOT flag. Over-flagging corrupts a good draft — a false positive is worse than a miss.

Return STRICT JSON (no prose, no fences):
{{"violations": [{{"section_index": <int>, "offending_text": "<under 30 words>", "why": "<why unsupported>"}}]}}
If the draft is fully grounded, return {{"violations": []}}."""


# ─────────────────────────────── JSON helpers ───────────────────────────────
def _parse_json_blob(raw: str) -> Any:
    """Parse a JSON object/array from a model response (tolerates code fences / prose)."""
    if not raw:
        raise ValueError("empty response")
    m = re.search(r"```(?:json)?\s*([\[{][\s\S]*?[\]}])\s*```", raw)
    candidate = m.group(1) if m else None
    if candidate is None:
        m2 = re.search(r"[\[{][\s\S]*[\]}]", raw)
        candidate = m2.group(0) if m2 else raw
    return json.loads(candidate)


def _norm_ws(s: str) -> str:
    return re.sub(r"\s+", " ", s or "").strip()


# ───────────────────────── Stage A: structural analysis ─────────────────────
def analyze_template_structure(
    template_text: str,
    *,
    model_name: str,
    user_id: str | int | None = None,
) -> TemplateAnalysis:
    """Map the template into ordered sections; slice each section's verbatim text
    LOCALLY (via the model's anchors) so a long template can never truncate this call."""
    template_text = template_text or ""
    prompt = (
        f"{ANALYSIS_SYSTEM_PROMPT}\n\n"
        f"=== TEMPLATE ===\n{template_text[:120_000]}\n\n=== JSON ==="
    )
    raw = _generate_text(
        prompt,
        agent_name="template_structure_agent",
        user_id=user_id,
        model_name_override=model_name,
        max_output_tokens=_ANALYSIS_MAX_TOKENS,
    )
    data = _parse_json_blob(raw)
    if not isinstance(data, dict) or not isinstance(data.get("sections"), list) or not data["sections"]:
        raise ValueError("structural analysis returned no sections")

    raw_sections = data["sections"]
    # Locate each section's start offset in template_text via its anchor (fallback heading).
    located: list[tuple[int, dict]] = []
    for s in raw_sections:
        if not isinstance(s, dict):
            continue
        anchor = _norm_ws(str(s.get("anchor") or ""))
        heading = _norm_ws(str(s.get("heading") or ""))
        pos = _find_anchor(template_text, anchor) if anchor else -1
        if pos < 0 and heading:
            pos = _find_anchor(template_text, heading)
        located.append((pos, s))

    # Order sections by located position (unlocated keep model order, interleaved after
    # the last located boundary) and slice verbatim spans between consecutive starts.
    ordered = _order_sections(located, len(template_text))
    sections: list[TemplateSection] = []
    for idx, (start, end, s) in enumerate(ordered):
        original = template_text[start:end].strip() if 0 <= start < end else ""
        typo = s.get("typography") if isinstance(s.get("typography"), dict) else {}
        sections.append(TemplateSection(
            index=idx,
            heading=str(s.get("heading") or f"Section {idx + 1}").strip(),
            original_text=original,
            placeholders=[str(p) for p in (s.get("placeholders") or []) if p],
            typography={
                "alignment": str(typo.get("alignment") or "justify"),
                "font": str(typo.get("font") or (data.get("base_font") or {}).get("font") or "Times New Roman"),
                "size_pt": float(typo.get("size_pt") or (data.get("base_font") or {}).get("size_pt") or 12),
                "bold": bool(typo.get("bold") or False),
                "level": int(typo.get("level") or 0),
            },
            contains_table=bool(s.get("contains_table")),
            table_header=[str(c) for c in (s.get("table_header") or []) if c],
        ))

    # Coverage guard: if we located almost nothing, the anchors were unreliable — signal
    # the caller to fall back rather than draft from empty format authority.
    located_chars = sum(len(s.original_text) for s in sections)
    coverage = located_chars / max(1, len(template_text))
    if coverage < 0.35 and len(template_text) > 400:
        raise ValueError(f"structural analysis coverage too low ({coverage:.0%})")

    # Pack tiny sections into fuller drafting units so each section call yields a
    # substantial section (≈1–5K output tokens), not a 50–150 token fragment.
    fine_grained = len(sections)
    sections = _pack_sections(sections)
    if len(sections) != fine_grained:
        logger.info("[template_drafting] packed %d sections into %d drafting unit(s)", fine_grained, len(sections))

    # Merge overflow: never explode into hundreds of section calls.
    if len(sections) > _MAX_SECTIONS:
        sections = _merge_overflow(sections, _MAX_SECTIONS)

    return TemplateAnalysis(
        title_format=data.get("title_format") if isinstance(data.get("title_format"), dict) else {},
        base_font=data.get("base_font") if isinstance(data.get("base_font"), dict) else {},
        sections=sections,
    )


def _find_anchor(haystack: str, needle: str) -> int:
    """Whitespace-tolerant search for `needle` in `haystack`; returns start offset or -1."""
    if not needle:
        return -1
    # Fast exact path.
    pos = haystack.find(needle)
    if pos >= 0:
        return pos
    # Whitespace-insensitive: build a regex from the first ~8 words.
    words = needle.split()[:8]
    if not words:
        return -1
    pattern = r"\s+".join(re.escape(w) for w in words)
    m = re.search(pattern, haystack, re.IGNORECASE)
    return m.start() if m else -1


def _order_sections(located: list[tuple[int, dict]], text_len: int) -> list[tuple[int, int, dict]]:
    """Turn (pos, section) pairs into (start, end, section) spans in document order.
    Unlocated sections (pos < 0) inherit the previous boundary so they are still drafted."""
    # Assign a sortable position: located keep theirs; unlocated take the prior located
    # position (stable within model order) so ordering stays sensible.
    seq: list[tuple[int, int, dict]] = []  # (sort_pos, original_idx, section)
    last = 0
    for orig_idx, (pos, s) in enumerate(located):
        p = pos if pos >= 0 else last
        if pos >= 0:
            last = pos
        seq.append((p, orig_idx, s))
    seq.sort(key=lambda t: (t[0], t[1]))
    spans: list[tuple[int, int, dict]] = []
    for i, (p, _oi, s) in enumerate(seq):
        start = p
        end = seq[i + 1][0] if i + 1 < len(seq) else text_len
        if end <= start:
            end = start  # zero-length span → empty original_text (drafted from heading)
        spans.append((start, end, s))
    return spans


def _merge_overflow(sections: list[TemplateSection], cap: int) -> list[TemplateSection]:
    """Greedily merge adjacent body sections until <= cap, preserving order and headings."""
    merged = list(sections)
    while len(merged) > cap:
        # find the shortest adjacent pair to merge
        best_i, best_len = 0, None
        for i in range(len(merged) - 1):
            combined = len(merged[i].original_text) + len(merged[i + 1].original_text)
            if best_len is None or combined < best_len:
                best_len, best_i = combined, i
        a, b = merged[best_i], merged[best_i + 1]
        merged[best_i] = TemplateSection(
            index=a.index,
            heading=a.heading,
            original_text=(a.original_text + "\n\n" + b.original_text).strip(),
            placeholders=a.placeholders + b.placeholders,
            typography=a.typography,
            contains_table=a.contains_table or b.contains_table,
            table_header=a.table_header or b.table_header,
        )
        del merged[best_i + 1]
    for i, s in enumerate(merged):
        s.index = i
    return merged


def _pack_sections(sections: list[TemplateSection]) -> list[TemplateSection]:
    """Greedily merge consecutive small sections into fuller drafting units.

    Fine-grained structural analysis (one section per header line / clause) yields many
    tiny sections that each draft to only 50–150 output tokens — wasteful and incoherent.
    We combine adjacent sections until a unit reaches ~_UNIT_TARGET_CHARS of template
    source (bounded by _UNIT_MAX_CHARS / _UNIT_MAX_SECTIONS), so each drafting call has
    enough material to produce a full, coherent section. Line structure within a unit is
    still preserved by the drafter (rule 8b). A table section is kept standalone so its
    per-section column hint stays accurate. A section that is already large stands alone.
    """
    if len(sections) <= 1:
        return sections
    units: list[TemplateSection] = []
    bucket: list[TemplateSection] = []
    bucket_len = 0

    def _flush() -> None:
        nonlocal bucket, bucket_len
        if not bucket:
            return
        if len(bucket) == 1:
            units.append(bucket[0])
        else:
            head = bucket[0]
            combined = "\n\n".join(b.original_text for b in bucket if b.original_text.strip())
            placeholders: list[str] = []
            for b in bucket:
                placeholders.extend(b.placeholders)
            units.append(TemplateSection(
                index=head.index,
                heading=head.heading,
                original_text=combined,
                placeholders=placeholders,
                typography=head.typography,
                contains_table=False,
                table_header=[],
            ))
        bucket = []
        bucket_len = 0

    for s in sections:
        if s.contains_table:
            _flush()
            units.append(s)
            continue
        slen = len(s.original_text)
        # Adding this section would blow the max → close the current unit first.
        if bucket and (bucket_len + slen > _UNIT_MAX_CHARS or len(bucket) >= _UNIT_MAX_SECTIONS):
            _flush()
        bucket.append(s)
        bucket_len += slen
        # Reached the target → close the unit.
        if bucket_len >= _UNIT_TARGET_CHARS:
            _flush()
    _flush()

    for i, u in enumerate(units):
        u.index = i
    return units


# ─────────────────────────── RAG retrieval helpers ──────────────────────────
# retrieve_fn contract: retrieve_fn(query: str, top_k: int) -> list[dict], each dict
# {"text": <chunk text>, "name": <doc name>, "page": <int|None>}. Supplied by the caller
# (files.py) wrapping get_relevant_chunks over the case's supporting file_ids.
def _format_chunks(chunks: list[dict], *, char_cap: int) -> str:
    """Dedup normalized chunks and join into a source-tagged, budget-capped text block."""
    seen: set[str] = set()
    out: list[str] = []
    used = 0
    for c in chunks or []:
        text = str((c or {}).get("text") or "").strip()
        if not text:
            continue
        key = text[:200]
        if key in seen:
            continue
        seen.add(key)
        name = str(c.get("name") or "document")
        page = c.get("page")
        tag = f"[{name}" + (f" p.{page}]" if page not in (None, "") else "]")
        block = f"{tag} {text}"
        if used + len(block) > char_cap:
            block = block[: max(0, char_cap - used)]
        if not block.strip():
            break
        out.append(block)
        used += len(block)
        if used >= char_cap:
            break
    return "\n\n".join(out)


def _section_query(section: TemplateSection) -> str:
    """Build a focused retrieval query for a section from its heading + placeholders + text."""
    parts = [section.heading or ""]
    if section.placeholders:
        parts.append(" ".join(str(p) for p in section.placeholders[:12]))
    body = _norm_ws(section.original_text)[:240]
    if body:
        parts.append(body)
    return " ".join(p for p in parts if p).strip() or (section.heading or "section")


def _corpus_from_docs(doc_texts: list[dict]) -> str:
    """Concatenate full supporting-doc text (the fallback when retrieval yields nothing)."""
    blocks: list[str] = []
    used = 0
    for d in doc_texts or []:
        name = str(d.get("name") or "document")
        text = str(d.get("text") or "").strip()
        if not text:
            continue
        block = f"[Document: {name}]\n{text}"
        if used + len(block) > _DOC_CONTEXT_CHAR_CAP:
            block = block[: max(0, _DOC_CONTEXT_CHAR_CAP - used)]
        blocks.append(block)
        used += len(block)
        if used >= _DOC_CONTEXT_CHAR_CAP:
            break
    return "\n\n---\n\n".join(blocks)


# ───────────────────────── Stage B: fact inventory ──────────────────────────
def extract_fact_inventory(
    doc_texts: list[dict],
    *,
    model_name: str,
    user_id: str | int | None = None,
    retrieve_fn: Callable[[str, int], list[dict]] | None = None,
    extra_queries: list[str] | None = None,
) -> str:
    """Build the shared CONTENT authority (fact matrix).

    RECALL-FIRST: if the whole corpus fits _INV_FULL_CONTEXT_MAX_CHARS, read the FULL
    documents — top-k retrieval drops short/tabular facts (dates, bedroom counts), so the
    matrix pass reads everything when it can. Only for a corpus too large to read whole do
    we retrieve top-chunks PER FACET (recall) and union them. Per-section drafting still uses
    RAG regardless — this size switch is only the fact-matrix pass."""
    full_corpus = _corpus_from_docs(doc_texts)
    corpus = ""
    src = "full-documents"
    if full_corpus and len(full_corpus) <= _INV_FULL_CONTEXT_MAX_CHARS:
        corpus = full_corpus
    elif retrieve_fn is not None:
        queries = list(_INVENTORY_FACET_QUERIES)
        for q in (extra_queries or []):
            if q and q.strip():
                queries.append(q.strip())
        gathered: list[dict] = []
        for q in queries:
            try:
                gathered.extend(retrieve_fn(q, _INV_FACET_TOP_K) or [])
            except Exception as exc:
                logger.warning("[template_drafting] inventory retrieval failed for %r: %s", q[:48], exc)
        corpus = _format_chunks(gathered, char_cap=_INV_RETRIEVAL_CHAR_CAP)
        if corpus.strip():
            src = f"RAG-retrieved ({len(gathered)} chunks, {len(queries)} facets)"
    if not corpus.strip():
        corpus = full_corpus  # last-resort fallback (e.g. retrieval empty on a huge case)
    if not corpus.strip():
        return ""
    logger.info("[template_drafting] fact-matrix source=%s corpus=%d chars", src, len(corpus))
    prompt = (
        f"{FACT_EXTRACTION_PROMPT}\n\n"
        f"=== SUPPORTING DOCUMENTS ===\n{corpus}\n\n=== FACT INVENTORY OUTPUT ==="
    )
    inventory = _generate_text(
        prompt,
        agent_name="fact_matrix_agent",
        user_id=user_id,
        model_name_override=model_name,
        max_output_tokens=_INVENTORY_MAX_TOKENS,
    )
    return (inventory or "").strip()


# ───────────────────────── Stage C: section drafting ────────────────────────
def draft_section(
    section: TemplateSection,
    fact_inventory: str,
    *,
    model_name: str,
    user_id: str | int | None = None,
    doc_title: str | None = None,
    correction: str | None = None,
    retrieve_fn: Callable[[str, int], list[dict]] | None = None,
    prior_drafts: str | None = None,
) -> str:
    """Draft ONE section at full length. Returns markdown for just this section.

    When retrieve_fn is given, the section also pulls its OWN top-chunks from the vector
    store (a query built from its heading/placeholders/text) — verbatim source text that
    improves precision and supplies exact quotes and page references for this section.

    prior_drafts (the already-drafted earlier sections) is passed so the model does NOT
    repeat content already stated — it continues the document rather than restating it."""
    inv = (fact_inventory or "")[:_INVENTORY_CHAR_CAP]
    # Per-section RAG: retrieve this section's most relevant chunks.
    evidence = ""
    if retrieve_fn is not None:
        try:
            chunks = retrieve_fn(_section_query(section), _SECTION_TOP_K) or []
            evidence = _format_chunks(chunks, char_cap=_SECTION_EVIDENCE_CHAR_CAP)
        except Exception as exc:
            logger.warning("[template_drafting] section retrieval failed (%s): %s", section.heading[:48], exc)
    evidence_block = (
        "\n=== RETRIEVED CASE EVIDENCE FOR THIS SECTION (verbatim source text from the "
        "supporting documents — authoritative content, same status as the fact inventory; "
        "prefer it for exact names, dates, amounts and quotes) ===\n" + evidence + "\n"
        if evidence.strip() else ""
    )
    table_hint = ""
    if section.contains_table:
        cols = " | ".join(section.table_header) if section.table_header else "as in the template"
        table_hint = (
            f"\nThis section is a TABLE. Output a markdown table with columns: {cols}. "
            "Add ONE ROW PER RELEVANT FACT from the inventory, in order; never leave a cell blank.\n"
        )
    correction_hint = ""
    if correction:
        correction_hint = (
            "\nCORRECTION REQUIRED — a grounding audit flagged this section. Fix ONLY grounding: "
            f"{correction}\n"
        )
    prior_block = ""
    _pd = (prior_drafts or "").strip()
    if _pd:
        prior_block = (
            "\n=== ALREADY-DRAFTED EARLIER SECTIONS (context — do NOT repeat their content) ===\n"
            "The following text has ALREADY been written earlier in THIS document. Do NOT restate, "
            "re-introduce parties, or re-narrate facts already covered here. Draft ONLY the new "
            "section below, continuing from this — reference earlier clauses by number if needed, "
            "never duplicate them.\n" + _pd[-_PRIOR_DRAFTS_CHAR_CAP:] + "\n"
        )
    fmt = section.original_text.strip() or f"(heading only) {section.heading}"
    prompt = (
        f"{DRAFTING_SYSTEM_PROMPT}\n\n"
        + (f"DOCUMENT: {doc_title}\n\n" if doc_title else "")
        + prior_block
        + f"\n=== TEMPLATE SECTION (FORMAT AUTHORITY — reproduce its structure, replace its content) ===\n"
        f"Heading: {section.heading}\n{fmt}\n"
        + table_hint
        + correction_hint
        + f"\n=== FACT INVENTORY (CONTENT AUTHORITY) ===\n{inv}\n"
        + evidence_block
        + "\n=== DRAFT THIS SECTION (markdown only) ==="
    )
    out = _generate_text(
        prompt,
        agent_name="section_draft_agent",
        user_id=user_id,
        model_name_override=model_name,
        max_output_tokens=_SECTION_MAX_TOKENS,
    )
    return _strip_fences(out or "").strip()


def _strip_fences(text: str) -> str:
    t = text.strip()
    if t.startswith("```"):
        t = re.sub(r"^```[a-zA-Z]*\s*", "", t)
        t = re.sub(r"\s*```$", "", t)
    return t


# ───────────────────────── Stage D: grounding audit ─────────────────────────
def grounding_audit(
    sections_md: list[str],
    fact_inventory: str,
    *,
    model_name: str,
    user_id: str | int | None = None,
) -> list[dict]:
    """Audit the assembled draft against the inventory. Returns [{section_index, why}]."""
    inv = (fact_inventory or "")[:_INVENTORY_CHAR_CAP]
    marked = "\n\n".join(f"[SECTION {i}]\n{md}" for i, md in enumerate(sections_md))
    prompt = (
        f"{GROUNDING_AUDIT_PROMPT}\n\n"
        f"=== FACT INVENTORY ===\n{inv}\n\n=== DRAFT ===\n{marked[:200_000]}\n\n=== JSON ==="
    )
    raw = _generate_text(
        prompt,
        agent_name="grounding_audit_agent",
        user_id=user_id,
        model_name_override=model_name,
        max_output_tokens=_AUDIT_MAX_TOKENS,
    )
    try:
        data = _parse_json_blob(raw)
    except Exception:
        return []
    violations = data.get("violations") if isinstance(data, dict) else data
    out: list[dict] = []
    for v in (violations or []):
        if isinstance(v, dict) and v.get("section_index") is not None:
            try:
                out.append({"section_index": int(v["section_index"]),
                            "why": str(v.get("why") or v.get("offending_text") or "")})
            except (TypeError, ValueError):
                continue
    return out


# ─────────────────────────────── orchestrator ───────────────────────────────
async def run_template_drafting_pipeline(
    *,
    template_text: str,
    doc_texts: list[dict],
    query_text: str,
    draft_engine: str,
    analysis_model: str,
    user_id: str | int | None,
    run_blocking: Callable,
    doc_title: str | None = None,
    cached_fact_inventory: str | None = None,
    enable_audit: bool = True,
    concurrency: int = 4,
    retrieve_fn: Callable[[str, int], list[dict]] | None = None,
    audit_model: str | None = None,
) -> AsyncIterator[tuple[str, dict]]:
    """Async generator yielding (kind, data):

      ("progress", {"type": "thinking", "text": "..."})  → caller yields _sse(data)
      ("final", {"answer": <assembled markdown>, "typography": {...},
                 "fact_inventory": <str>, "sections": <int>})  → caller streams + saves

    All blocking model calls go through `run_blocking(func, *, timeout_s, timeout_message)`
    (the caller's executor wrapper) so the event loop is never blocked. Raises on hard
    failure so the caller can fall back to the single-call draft.
    """
    def _prog(text: str) -> tuple[str, dict]:
        return ("progress", {"type": "thinking", "text": text})

    # ---- Stage A: structure ----
    yield _prog("Analyzing the template's structure…\n")
    analysis: TemplateAnalysis = await run_blocking(
        lambda: analyze_template_structure(template_text, model_name=analysis_model, user_id=user_id),
        timeout_s=180.0, timeout_message="template_structure_timeout",
    )
    sections = analysis.sections
    n = len(sections)
    if n == 0:
        raise ValueError("no template sections to draft")
    yield _prog(f"Template mapped into {n} section(s).\n")

    # ---- Stage B: fact inventory (cached per session by the caller) ----
    if cached_fact_inventory:
        fact_inventory = cached_fact_inventory
        yield _prog("Reusing the extracted case facts…\n")
    else:
        if retrieve_fn is not None:
            yield _prog("Retrieving the most relevant evidence (RAG) and building the case fact matrix…\n")
        else:
            yield _prog(f"Extracting the case fact matrix from {len(doc_texts)} document(s)…\n")
        _extra_q = [query_text] if (query_text or "").strip() else None
        fact_inventory = await run_blocking(
            lambda: extract_fact_inventory(
                doc_texts, model_name=draft_engine, user_id=user_id,
                retrieve_fn=retrieve_fn, extra_queries=_extra_q,
            ),
            timeout_s=300.0, timeout_message="fact_inventory_timeout",
        )
    if not (fact_inventory or "").strip():
        raise ValueError("fact inventory extraction produced nothing")

    # ---- Stage C: draft sections SEQUENTIALLY, feeding each the already-drafted earlier
    # sections so it does NOT repeat content (restating parties/dates across clauses). Each
    # finished section streams live; a section that errors becomes a flagged placeholder so
    # one bad section can't sink the whole draft. Sequential (not parallel) is required so a
    # later section can see what earlier ones already said.
    drafted: list[str] = [""] * n
    for idx in range(n):
        yield _prog(f"Drafting section {idx + 1}/{n}: {sections[idx].heading[:80]}…\n")
        prior = "\n\n".join(drafted[j] for j in range(idx) if drafted[j] and drafted[j].strip())
        try:
            res = await run_blocking(
                lambda s=sections[idx], pr=prior: draft_section(
                    s, fact_inventory, model_name=draft_engine, user_id=user_id, doc_title=doc_title,
                    retrieve_fn=retrieve_fn, prior_drafts=pr,
                ),
                timeout_s=180.0, timeout_message=f"section_{idx}_timeout",
            )
        except Exception as exc:
            logger.warning("[template_drafting] section %s failed: %s", idx, exc)
            res = None
        drafted[idx] = res if (isinstance(res, str) and res.strip()) else f"**{sections[idx].heading}**\n\n{NOT_FOUND_MARKER}"
        # Emit each finished section so a section-by-section UI can show it live.
        yield ("section", {
            "index": idx, "total": n,
            "heading": sections[idx].heading, "markdown": drafted[idx],
        })

    # ---- Stage D: grounding audit + repair (buffer internally; never append copies) ----
    # Run the audit + repair on a GUARDIAN model (audit_model, e.g. Opus) even when a weaker
    # model drafted — a strong model catching and rewriting fabrications is the backstop that
    # makes non-Opus drafting usable. Falls back to the draft engine when no guardian is set.
    guardian = (audit_model or draft_engine)
    if enable_audit and drafted:
        yield _prog(f"Auditing the draft against the case facts (guardian: {guardian})…\n")
        try:
            violations = await run_blocking(
                lambda: grounding_audit(drafted, fact_inventory, model_name=guardian, user_id=user_id),
                timeout_s=180.0, timeout_message="grounding_audit_timeout",
            )
        except Exception as exc:  # audit is a backstop — never fail the whole draft over it
            logger.warning("[template_drafting] audit skipped: %s", exc)
            violations = []
        # Repair each flagged section in place — on the guardian model, with the earlier
        # sections as context so the fix stays consistent and non-repetitive.
        flagged = sorted({v["section_index"] for v in violations if 0 <= v["section_index"] < len(drafted)})
        for k in flagged:
            why = "; ".join(v["why"] for v in violations if v["section_index"] == k and v["why"])
            yield _prog(f"Refining section {k + 1}: correcting unsupported content…\n")
            _prior_k = "\n\n".join(drafted[j] for j in range(k) if drafted[j] and drafted[j].strip())
            try:
                fixed = await run_blocking(
                    lambda kk=k, w=why, pr=_prior_k: draft_section(
                        sections[kk], fact_inventory, model_name=guardian,
                        user_id=user_id, doc_title=doc_title, correction=w,
                        retrieve_fn=retrieve_fn, prior_drafts=pr,
                    ),
                    timeout_s=180.0, timeout_message=f"repair_{k}_timeout",
                )
                if fixed and fixed.strip():
                    drafted[k] = fixed
            except Exception as exc:
                logger.warning("[template_drafting] repair of section %s failed: %s", k, exc)

    assembled = "\n\n".join(md for md in drafted if md and md.strip())
    yield ("final", {
        "answer": assembled,
        "typography": {
            "title_format": analysis.title_format,
            "base_font": analysis.base_font,
        },
        "fact_inventory": fact_inventory,
        "sections": n,
    })
