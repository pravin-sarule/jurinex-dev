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
  D. grounding_audit + format_audit + repair — TWO parallel critics on the GUARDIAN
     model (a fact critic and a layout critic); only flagged sections are re-drafted.
     Zero-hallucination + layout-fidelity backstop that makes non-Opus drafting usable.
  E. recover_section_slots       — completeness critic: every red placeholder left in
     the draft gets its OWN targeted retrieval; the guardian fills it if (and only if)
     the value actually exists in the sources.

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
from app.services.tiptap_render import render_document_tiptap, render_section_tiptap

logger = logging.getLogger("agentic_document_service.template_drafting")

# Output-token budgets per stage (overrides the small agent default; clamped to the
# model ceiling inside _generate_text). We request up to gemma-4's hard output ceiling
# (32768 tokens — the same value _model_max_output_tokens clamps gemma to); on a big template
# this gives the structure JSON and each section the full 32k so they can't truncate mid-JSON
# and abort the pipeline to the section-less single-call fallback. Higher-ceiling engines
# (gemini/claude) stay clamped to their own real limits, not to these numbers.
_ANALYSIS_MAX_TOKENS = 32768
_INVENTORY_MAX_TOKENS = 32768
_SECTION_MAX_TOKENS = 32768
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

# Section packing — combine consecutive small sections into drafting units sized off the
# TEMPLATE PAGE COUNT: ~2-3 units per page, so a 4-page rent agreement drafts in ~8-12
# calls — never 31 one-line calls (each call is wall-clock latency + an API charge, and
# tiny units are what caused repetition across sections). Clause fidelity inside a bigger
# unit is protected by the coverage checklist + rule 9b, not by making units tiny.
_CHARS_PER_PAGE = 2800          # rough extracted-text chars per template page
_UNITS_PER_PAGE = 2.5           # target drafting units per template page (2-3/page)
_UNIT_MAX_SECTIONS = 10         # never group more than this many template sections into one unit
# Hard ceiling on DRAFTING units = pages x this. Every unit is one model call, so on a paced
# free-tier engine this is the single biggest lever on draft wall-clock and cost. 3/page means
# a 12-page pleading drafts in ~36 calls instead of the 80 the fine-grained pleading splitter
# produces. Override with DRAFT_UNITS_PER_PAGE in .env.
_DEFAULT_UNITS_PER_PAGE_CAP = 3.0


def _template_pages(template_text: str, template_layout: dict | None) -> tuple[float, str]:
    """Template page count — MEASURED from the layout when we have it, estimated otherwise.

    Estimating pages from character count (len/_CHARS_PER_PAGE) badly undercounts a legal
    template: they are sparse (short centred headings, blank fill-in lines, ruled tables), so a
    real 3-page pleading came out as 1.3 "pages" and the drafting-unit cap collapsed to 4 —
    merging away genuine sections. The layout lines carry their true page number, so use it.
    """
    lines = (template_layout or {}).get("lines") if isinstance(template_layout, dict) else None
    if isinstance(lines, list) and lines:
        pages = [int(ln.get("page") or 0) for ln in lines if isinstance(ln, dict)]
        real = max(pages) if pages else 0
        if real >= 1:
            return float(real), "measured"
    return max(1.0, len(template_text) / _CHARS_PER_PAGE), "estimated"


def _units_per_page() -> float:
    """Drafting units allowed per template page (DRAFT_UNITS_PER_PAGE, clamped 1–8)."""
    try:
        from app.core.config import get_settings

        raw = float(getattr(get_settings(), "draft_units_per_page", 0) or 0)
    except Exception:  # noqa: BLE001 — config must never break structural analysis
        raw = 0.0
    if raw <= 0:
        raw = _DEFAULT_UNITS_PER_PAGE_CAP
    return max(1.0, min(raw, 8.0))

# ── RAG retrieval knobs (used when the caller supplies a retrieve_fn) ─────────
# The draft path retrieves top-chunks from the case's vector store instead of dumping the
# whole corpus. Recall matters (a legal draft needs EVERY fact), so the fact matrix is built
# by retrieving PER FACET and unioning — a single vague "draft the agreement" query would
# miss most facts. Each section then also pulls its OWN focused top-chunks (precision).
_INV_FACET_TOP_K = 16            # top-k chunks retrieved per facet query for the fact matrix
_INV_RETRIEVAL_CHAR_CAP = 130_000  # budget for the retrieved corpus fed to Stage B
_SECTION_TOP_K = 20              # top-k chunks retrieved per section for drafting
_SECTION_EVIDENCE_CHAR_CAP = 30_000  # budget for a section's own retrieved evidence
_PRIOR_DRAFTS_CHAR_CAP = 60_000  # legacy blob cap (used only when no ledger is supplied)
_PRIOR_TAIL_CHAR_CAP = 2_000     # verbatim tail kept for local continuity alongside the ledger
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
    "payment details: bank name, account number, account no, IFSC code, UPI ID, cheque number, NEFT, RTGS and transfer references",
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
0. DETECT THE DOCUMENT FAMILY FIRST — court pleading (plaint / petition / application / appeal / complaint), agreement / contract / deed, affidavit / declaration, notice / reply / formal letter, corporate or personal instrument (resolution / power of attorney / MOU / will), or fill-in form — and segment by THAT family's own conventions. Rules 1b-1d below are a convention LIBRARY, not a fixed target: apply the one matching what THIS template actually shows, and never force another family's layout onto it.
1. Segment FINE-GRAINED and COMPLETE: every heading, recital, numbered clause, sub-clause, schedule, annexure and the signature/witness block is its own section, in document order. Cover the template from first line to last — do not merge distinct clauses and do not drop trailing sections.
1b. COURT PLEADINGS ONLY — the document header / cause title must be split into its component lines as SEPARATE sections, in order: the court-name line; the case / suit number line; "IN THE MATTER OF:"; each party's description; each role label ("…Plaintiff", "…Defendant"); "VERSUS"; and the document-type heading. Never lump the whole header into one section. Give centered lines (court, case number, "VERSUS", the main heading) typography alignment "center", and role labels ("…Plaintiff"/"…Defendant") alignment "right".
1c. AGREEMENTS / DEEDS / MOUs — the title; the execution date/place line; EACH party's description in the parties block; the recitals ("WHEREAS …"); each numbered operative clause; the testimonium ("IN WITNESS WHEREOF …"); each schedule / annexure; and the signature & witness blocks are each their own section.
1d. NOTICES / LETTERS / AFFIDAVITS / FORMS — the letterhead or sender block; date and reference lines; the addressee block; the subject line; the salutation; each numbered paragraph, demand or deposition; and the closing / signature / verification block are each their own section. In a fill-in form, a run of "Label: ____" lines is one section per labelled group.
2. "anchor" MUST be copied character-for-character from the template (the first several words of the section). Do NOT paraphrase it — it is used to locate the section in the source text. Keep it short (6-12 words).
3. Detect every placeholder: bracketed tokens, blank runs (____), "insert here" hints, obviously variable values.
4. TYPOGRAPHY: fill each section's alignment/font/size/bold/level with what the template actually shows FOR ITS FAMILY. Body prose is "justify" unless it is a signature/address/date/cause-title block (then as shown). Titles are usually "center" in pleadings, agreements, deeds and affidavits; letters/notices are usually left-aligned with a bold subject line; forms follow their label layout. Only when the template gives no signal, default to Times New Roman 12pt body with a 14pt bold title.
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
2. MISSING DATA → RED PLACEHOLDER. For every template slot with NO value in the inventory/evidence, insert EXACTLY this, unchanged: <span style="color:red;font-weight:bold;">[________ FIELD NAME ________]</span> — where FIELD NAME is a short CAPS label of what the user must fill (e.g. [________ TENANCY START DATE ________], [________ NUMBER OF BEDROOMS ________]). Put nothing else inside it — no guess, no "e.g.". NEVER invent masked/sample-looking values (XXXX-XXXX-1234, ABCDE1234F, example@example.com, 98XXXXXXXX, [ACCOUNT NUMBER], [IFSC CODE], [BANK NAME]) from your own head. BUT if the fact inventory/evidence ITSELF states such a value for the field — test/dummy case files often do ("Aadhaar No. (Dummy): XXXX-XXXX-7890", "PAN: ABCDE1234F") — that IS the source's value: COPY IT VERBATIM per rule 6, do NOT replace it with a placeholder. EXCEPTIONS (stay as ordinary blanks exactly as the template shows, NOT red): fields the template leaves blank at execution — signatures, thumb impressions, notary/seal, witness signatures, registration endorsements, stamp/e-stamp number — unless the data actually exists in the sources; and registration particulars a drafter customarily blanks (suit/case numbers, filing years), which use the customary form (e.g. "COMMERCIAL SUIT NO. ____ OF 20__").
3. PRESERVE THE TEMPLATE, REPLACE ONLY VARIABLE DATA. Keep the section's structure, heading, clause numbering style, capitalization, bold/underline and layout exactly. Change ONLY the variable data; do NOT add clauses, grounds, prayers, citations, advice or "improvements". If the template shows SAMPLE / example data instead of blanks ("Mr. ABC", a sample date, an example inventory row), treat every such party-specific detail as a SLOT to replace — NEVER let the sample's data leak into the draft, and NEVER reproduce the template's example rows as extra content.
3b. TEMPLATE INSTRUCTIONS ARE SLOTS, NOT CONTENT. Parenthetical or inline instructions such as "List all items...", "e.g.", "insert", "specify", "mention", "attach photographs", "whichever is applicable", "strike out", "as applicable", or "if any" must NEVER be copied into the draft. Fill that slot from the fact inventory/evidence. If the evidence does not contain the needed value, replace the instruction with a red placeholder from rule 2.
4. RESOLVE TEMPLATE OPTIONS — never leave alternatives unresolved. Where the template offers a choice ("Cash / Cheque / NEFT / UPI", "Mr./Mrs./Ms.", "S/o / D/o / W/o", "sq. ft. / sq. mtr.", "Landlord / Tenant", "strike out whichever is not applicable", ☐/☑ boxes): SELECT the ONE option the inventory/evidence supports and DELETE the others ENTIRELY — output clean final text ("Mr. Ramesh…", "850 sq. ft. (Carpet area)"). NEVER output ~~strikethrough~~, and never keep every option in the filed draft. If the facts don't decide it, keep the most standard option for this document type and delete the rest, or leave a red placeholder. REJECT any option that is logically impossible given other facts (e.g. a "12 months" escalation trigger inside an 11-month term → choose the renewal-based trigger).
5. Pure boilerplate (verification, prayer wording, signature blocks): keep the template wording with this matter's particulars filled in. NARRATIVE SECTIONS (statement of facts, cause of action, grounds): write them FULLY at professional length — a complete numbered narrative from the inventory in chronological order, in the template's register and numbering style, using every relevant fact.
5b. PROFESSIONAL INTELLIGENCE (allowed knowledge): you MAY use your standard Indian legal drafting knowledge — correct terminology and register for this document type, standard clause phrasing, statutory names the template itself invokes, amounts-in-words in the lakh/crore system, date formatting — to write polished professional prose and to resolve template options sensibly. You may NEVER use general knowledge to supply case-specific data: names, dates, amounts, IDs, addresses and property details come ONLY from the inventory/evidence (rule 1).
6. VERBATIM EXTRACTION. Copy names, parentage, addresses, ID/registration numbers, property descriptions, case numbers and dates EXACTLY as the source gives them — do not correct spelling, expand abbreviations, or reformat addresses (exact match with records is legally required). Keep "S/o", "D/o", "W/o", "R/o", "Aged about ___ years" in the template's style. Dates: use the source date, presented in the template's format (converting the FORMAT is allowed; changing the date is not). Amounts: if the template shows figures AND words ("Rs. ____/- (Rupees ____ only)"), fill BOTH — deriving the words from a figure is allowed; use the Indian lakh/crore system. Age may be computed from a date of birth in the source; otherwise a red placeholder.
7. CONFLICTS: if two sources give different values for the same field, use the most authoritative (government photo ID for identity fields, the registered deed for property fields, the court record for case fields) — do not silently merge or average.
8. Output ONLY the drafted text of THIS section — no commentary, no preamble, no code fences, no [SECTION] markers, and NO "DRAFTING NOTES" (notes belong once at the end of the whole document, never per section). Write in the formal register of the document type; match the template's language. If an "ALREADY-DRAFTED EARLIER SECTIONS" block is provided, do NOT repeat or re-narrate anything already stated there — state each fact once, in its proper section, and continue the document; refer back to earlier clauses by number rather than duplicating them. You will also receive a MANDATORY TEMPLATE COVERAGE CHECKLIST; every item on that checklist must appear in your output in the same order, filled from evidence or red-placeholdered.

FORMAT (this section is rendered to a Word document from MARKDOWN):
9. Reproduce the template section's OWN layout: keep its clause numbering, ordering, and ALL-CAPS words exactly as they appear. If the section's heading is INLINE with its text (e.g. "1. TERM: The tenancy…"), keep it inline — do NOT also add a separate bold heading line for it. Add a standalone bold **HEADING** line ONLY where the template presents the heading on its own line, separate from the body. Keep each clause on its own line. NOTE: the template text you receive is EXTRACTED PLAIN TEXT — the original bold/underline styling is lost in extraction. Restore standard drafting convention: standalone ALL-CAPS heading/label lines (the document title, SIGNATURES, LANDLORD / LESSOR, TENANT / LESSEE, WITNESSES:, ANNEXURE-A …, VERSUS) are written **bold**.
9c. KEEP THE TEMPLATE'S PARAGRAPH NUMBERS IN THE TEXT. A plaint/petition/agreement paragraph that begins with a number in the template ("1.", "2.", "29.") MUST begin with the SAME number in your draft — never strip the number, never renumber, never move it into a heading. Lettered lists ("a.", "b.") likewise keep their letters. Bold lead-in lines the template conventionally bolds ("The Plaintiff above named states as follows:", "NOW THIS AGREEMENT WITNESSETH AS FOLLOWS:") stay **bold**.
9b. PRESERVE LINE STRUCTURE — never fuse distinct lines. Where the template places separate items on separate lines — a DOCUMENT HEADER / CAUSE TITLE (the court-name line; the case / suit number line; "IN THE MATTER OF:"; each party's full description; the role labels "…Plaintiff" / "…Defendant"; "VERSUS"; and the document-type heading), or a signature / address / place-and-date block — output EACH element on its OWN line with a BLANK line between distinct elements. NEVER run separate lines together into one paragraph; NEVER join two words without a space (write "…AT PUNE" and then, on a NEW line, "COMMERCIAL SUIT NO. …" — never "PUNECOMMERCIAL"); and NEVER wrap a whole multi-line header inside ONE **bold** span. Bold ONLY the specific lines the template itself shows bold/centered (court name, the case-type heading) — keep "IN THE MATTER OF:" and the party descriptions as NORMAL, non-bold text. Put each centered line (court, case number, "VERSUS", the main heading) and each right-aligned role label ("…Plaintiff", "…Defendant") on its OWN line so its alignment is preserved.
10. Use a markdown table ONLY for a genuine DATA table (a schedule, a list of dates/events, an invoice/fee table, an inventory, a list of documents/exhibits). Output it as a GitHub markdown table (| col | col |) WITH a header row AND a separator row (| --- | --- |), the SAME columns as the template, and ONE ROW PER FACT from the inventory/evidence (every relevant entry, in order). Produce EXACTLY ONE table for a data section — NEVER emit a second, generic copy, and NEVER reproduce the template's example rows. Never output an empty cell — fill it, or put the red placeholder from rule 2; drop template example rows that have no corresponding fact.
10b. NEVER put a signature block, execution block, place-and-date block, verification, statement of truth, or the cause title into a table unless the template itself uses a side-by-side layout. Otherwise those are LINE-STRUCTURED — render each item on its own line ("Place: …", "Date: …", the party name, "…through its Authorized Representative", the signatory name/designation, "Advocate for the Plaintiff" each on their own line). Do NOT emit stray pipe characters ("|") around these lines. Use a 2-column table only when the template shows side-by-side signing parties or side-by-side witnesses (e.g. LANDLORD | TENANT, WITNESS 1 | WITNESS 2).
11. Do not add styling the template section does not have, beyond the red placeholder (rule 2).

FORMAT EXAMPLE TO COPY EXACTLY WHEN APPLICABLE:
Bad single-line output:
LANDLORD / LESSOR Signature: ______ Name: Mr. Ramesh Krishnarao Desai Date: 01/07/2025 Witness Name: Sunita Prakash Patil Address: Plot 7, Aundh, Pune 411007 ID Proof No.: PAN No. ABCDE1111A Signature: ______

Correct line-structured output:
LANDLORD / LESSOR Signature: ______

Name: Mr. Ramesh Krishnarao Desai

Date: 01/07/2025

Witness Name: Sunita Prakash Patil

Address: Plot 7, Aundh, Pune 411007

ID Proof No.: PAN No. ABCDE1111A

Signature: ______

Bad template-instruction leak:
(List all items handed over along with the premises, e.g., fans, geysers, wardrobes, modular kitchen, AC units, curtains, lights, etc. Attach photographs where possible.)

Correct output when facts are available:
| S.No. | Item | Quantity/Details |
| --- | --- | --- |
| 1 | Ceiling fans | 4 |
| 2 | Geyser | 1 |

Correct output when facts are missing:
<span style="color:red;font-weight:bold;">[________ INVENTORY ITEMS ________]</span>

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

FORMAT_AUDIT_PROMPT = """You are a Format and Completeness Auditor for legal drafts. You receive a DRAFT split into numbered [SECTION k] blocks. Do NOT fact-check names, dates, or amounts here; another auditor handles grounding. Your job is to find concrete structure defects that make a draft unusable even if the facts are correct.

Flag ONLY these defects:
1. A signature, execution, witness, place/date, ID proof, or address block crams multiple labelled fields onto one physical line. Labels include Signature:, Name:, Date:, Place:, Address:, Witness Name:, ID Proof No.:, PAN No.:, and Aadhaar No.
2. Template instructional/example text leaked into the draft, including parentheticals or lines containing e.g., for example, list all, insert, specify, mention, attach photographs, whichever is applicable, strike out, as applicable, if any, delete as applicable, or fill in.
3. A markdown horizontal rule (---, ***, ___) appears between signature/witness/execution block lines.
4. A template option instruction remains unresolved, such as Cash / Cheque / NEFT / UPI all being retained, honorific/unit option lists left unchosen (Mr./Mrs./Ms., sq. ft. / sq. mtr.), ~~strikethrough~~ remnants, or text saying strike out whichever is not applicable.
5. A required item from the TEMPLATE COVERAGE CHECKLIST is missing from that section's draft, especially a numbered clause, table, signature/witness block, party block, or slot-bearing line.
6. A template LABEL leftover remains where a value should be, such as [BANK NAME], [ACCOUNT NUMBER], [IFSC CODE], or [UPI ID]. Do NOT flag masked-looking data values (XXXX-XXXX-7890, ABCDE1234F, 98XXXXXXXX) — test/dummy case files legitimately contain them, and the grounding auditor (who can see the sources) owns that check.
7. Internal helper labels or section-analysis metadata appear as content, such as "Heading: ...", "Landlord Signature Block", "Tenant Signature Block", "Witnesses Block", "Agreement Introduction", or "Recital 1".
8. The same data table appears twice in the same section or in adjacent final output, even if the second table has slightly different column names.

Do NOT flag:
- Proper markdown data tables with header and separator rows.
- Ordinary legal boilerplate, headings, or blanks/red placeholders.
- A line simply because it is long, unless it contains multiple labelled execution fields.

Return STRICT JSON (no prose, no fences):
{"violations": [{"section_index": <int>, "issue": "crammed_execution|instruction_leak|stray_hr|unresolved_option|missing_template_item|fake_value|metadata_label|duplicate_table", "why": "<specific repair instruction>"}]}
If the draft has no concrete format defects, return {"violations": []}."""


# ─────────────────────────────── JSON helpers ───────────────────────────────
def _repair_json(s: str) -> str:
    """Repair the JSON defects LLMs most often emit, so a single stray character can't
    collapse the whole draft pipeline into the section-less single-call fallback:
      • a trailing comma before a closer ( ",}" -> "}" , ",]" -> "]" )
      • a missing comma between sibling objects/arrays ( "}{" -> "},{" )
    Structural only — it never invents or alters a field value. An unescaped quote inside a
    string, or a truncated reply, is not safely repairable here and is left for the caller's
    one-shot strict-JSON re-ask (analyze_template_structure)."""
    if not s:
        return s
    out = re.sub(r",(\s*[}\]])", r"\1", s)     # trailing comma:  ,}  ->  }
    out = re.sub(r"}(\s*)\{", r"},\1{", out)   # missing comma:   }{  ->  },{
    out = re.sub(r"](\s*)\[", r"],\1[", out)   # missing comma:   ][  ->  ],[
    return out


def _parse_json_blob(raw: str) -> Any:
    """Parse a JSON object/array from a model response (tolerates code fences / prose).
    Retries once through _repair_json so a stray trailing/missing comma can't abort the
    pipeline; genuinely malformed output (unescaped quote, truncation) still raises so the
    caller can re-ask the model for strict JSON."""
    if not raw:
        raise ValueError("empty response")
    m = re.search(r"```(?:json)?\s*([\[{][\s\S]*?[\]}])\s*```", raw)
    candidate = m.group(1) if m else None
    if candidate is None:
        m2 = re.search(r"[\[{][\s\S]*[\]}]", raw)
        candidate = m2.group(0) if m2 else raw
    try:
        return json.loads(candidate)
    except json.JSONDecodeError:
        return json.loads(_repair_json(candidate))


def _norm_ws(s: str) -> str:
    return re.sub(r"\s+", " ", s or "").strip()


# ───────────────────────── Stage A: structural analysis ─────────────────────
def analyze_template_structure(
    template_text: str,
    *,
    model_name: str,
    user_id: str | int | None = None,
    template_layout: dict | None = None,
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
    try:
        data = _parse_json_blob(raw)
    except (ValueError, json.JSONDecodeError) as _je:
        # The tolerant parser couldn't recover it (typically an unescaped double-quote inside
        # a string value, or a truncated reply). Re-ask the SAME model ONCE with an explicit
        # strict-JSON reminder before the whole pipeline drops to the section-less single-call
        # fallback (which loses the per-section red-placeholder rules).
        logger.warning(
            "[template_drafting] structure JSON parse failed (%s) — re-asking %s for strict JSON",
            _je, model_name,
        )
        raw = _generate_text(
            f"{prompt}\n\n=== FIX ===\nYour previous reply was NOT valid JSON: {_je}. "
            "Return ONLY strict, valid JSON for the schema above — no prose, no code fences. "
            'Escape every double-quote inside a string value as \\", and do not truncate.',
            agent_name="template_structure_agent",
            user_id=user_id,
            model_name_override=model_name,
            max_output_tokens=_ANALYSIS_MAX_TOKENS,
        )
        data = _parse_json_blob(raw)
    if not isinstance(data, dict) or not isinstance(data.get("sections"), list) or not data["sections"]:
        raise ValueError("structural analysis returned no sections")

    def _locate_and_slice(payload: dict) -> tuple[list[TemplateSection], float]:
        """Locate each section's anchor, slice contiguous verbatim spans, and return the
        sections plus the fraction of anchors that actually located — the structure-accuracy
        signal (an unlocated anchor means that boundary was inherited, not measured)."""
        base_font = payload.get("base_font") if isinstance(payload.get("base_font"), dict) else {}
        located: list[tuple[int, dict]] = []
        for s in payload["sections"]:
            if not isinstance(s, dict):
                continue
            anchor = _norm_ws(str(s.get("anchor") or ""))
            heading = _norm_ws(str(s.get("heading") or ""))
            pos = _find_anchor(template_text, anchor) if anchor else -1
            if pos < 0 and heading:
                pos = _find_anchor(template_text, heading)
            located.append((pos, s))
        frac = (sum(1 for p, _ in located if p >= 0) / len(located)) if located else 0.0

        # Order sections by located position (unlocated keep model order, interleaved after
        # the last located boundary) and slice verbatim spans between consecutive starts.
        ordered = _order_sections(located, len(template_text))
        built: list[TemplateSection] = []
        for idx, (start, end, s) in enumerate(ordered):
            original = template_text[start:end].strip() if 0 <= start < end else ""
            typo = s.get("typography") if isinstance(s.get("typography"), dict) else {}
            built.append(TemplateSection(
                index=idx,
                heading=str(s.get("heading") or f"Section {idx + 1}").strip(),
                original_text=original,
                placeholders=[str(p) for p in (s.get("placeholders") or []) if p],
                typography={
                    "alignment": str(typo.get("alignment") or "justify"),
                    "font": str(typo.get("font") or base_font.get("font") or "Times New Roman"),
                    "size_pt": float(typo.get("size_pt") or base_font.get("size_pt") or 12),
                    "bold": bool(typo.get("bold") or False),
                    "level": int(typo.get("level") or 0),
                },
                contains_table=bool(s.get("contains_table")),
                table_header=[str(c) for c in (s.get("table_header") or []) if c],
            ))

        # Head recovery: template text BEFORE the first located anchor (a letterhead, court
        # name or title whose own section failed to locate) would otherwise silently vanish
        # from the format authority. Surface it as its own leading section.
        lead_end = ordered[0][0] if ordered else 0
        lead = template_text[:lead_end].strip() if lead_end > 0 else ""
        # Any real content counts — the most common lost head is a SHORT centered title line
        # ("RENT AGREEMENT", "AFFIDAVIT") whose own section the model forgot to emit.
        if len(lead) >= 4:
            first_line = next((ln.strip() for ln in lead.splitlines() if ln.strip()), "Preamble")
            title_like = first_line.isupper() and len(first_line) <= 60
            built.insert(0, TemplateSection(
                index=0,
                heading=first_line[:80],
                original_text=lead,
                typography={
                    "alignment": "center" if title_like else "left",
                    "font": str(base_font.get("font") or "Times New Roman"),
                    "size_pt": float(base_font.get("size_pt") or 12),
                    "bold": title_like,
                    "level": 1 if title_like else 0,
                },
            ))
            for i, sec in enumerate(built):
                sec.index = i
        return built, frac

    sections, located_frac = _locate_and_slice(data)

    # Anchor-quality gate: located_frac measures how much of the section map was MEASURED
    # (anchor found verbatim in the template) versus guessed. Below 70%, re-ask the SAME
    # model once with an explicit copy-verbatim reminder; still below 50% after that, raise —
    # the caller's escalation chain then retries this stage on a stronger model instead of
    # drafting from a mislocated map.
    if located_frac < 0.7 and len(template_text) > 400:
        logger.warning(
            "[template_drafting] only %.0f%% of structure anchors located — re-asking %s for verbatim anchors",
            located_frac * 100, model_name,
        )
        try:
            raw2 = _generate_text(
                f"{prompt}\n\n=== FIX ===\nYour previous JSON was parseable but its \"anchor\" values "
                f"did NOT match the template (only {located_frac:.0%} could be found by string search). "
                "Regenerate the SAME JSON, copying every \"anchor\" CHARACTER-FOR-CHARACTER from the "
                "template text above — the exact first 6-12 words of that section as they appear, no "
                "paraphrase, no re-spacing, no case changes.",
                agent_name="template_structure_agent",
                user_id=user_id,
                model_name_override=model_name,
                max_output_tokens=_ANALYSIS_MAX_TOKENS,
            )
            data2 = _parse_json_blob(raw2)
            if isinstance(data2, dict) and isinstance(data2.get("sections"), list) and data2["sections"]:
                sections2, frac2 = _locate_and_slice(data2)
                if frac2 > located_frac:
                    sections, located_frac, data = sections2, frac2, data2
        except Exception as _re_exc:
            logger.warning("[template_drafting] anchor re-ask failed (%s) — keeping first pass", _re_exc)
    if located_frac < 0.5 and len(template_text) > 400:
        raise ValueError(f"structural analysis anchors unreliable ({located_frac:.0%} located)")

    # Coverage guard: if we located almost nothing, the anchors were unreliable — signal
    # the caller to fall back rather than draft from empty format authority.
    located_chars = sum(len(s.original_text) for s in sections)
    coverage = located_chars / max(1, len(template_text))
    if coverage < 0.35 and len(template_text) > 400:
        raise ValueError(f"structural analysis coverage too low ({coverage:.0%})")
    logger.info(
        "[template_drafting] structure map: %d fine-grained section(s), %.0f%% anchors located, %.0f%% text coverage",
        len(sections), located_frac * 100, coverage * 100,
    )

    is_court_pleading = _is_court_pleading_template(template_text)

    # Re-split spans where a failed anchor buried a major part heading (PRAYER,
    # VERIFICATION …) inside the previous section's verbatim text.
    resplit = _resplit_at_major_parts(sections)
    if len(resplit) != len(sections):
        logger.info("[template_drafting] re-split %d section(s) at buried part headings",
                    len(resplit) - len(sections))
        sections = resplit

    if is_court_pleading:
        before = len(sections)
        sections = _resplit_court_pleading_header(sections)
        sections = _resplit_numbered_pleading_sections(sections)
        if len(sections) != before:
            logger.info("[template_drafting] court pleading structural repair: %d -> %d section(s)", before, len(sections))

    sections = _apply_measured_template_layout(sections, template_layout)

    # Pack tiny sections into page-proportional drafting units (~2-3 per template page)
    # so each section call yields a substantial section, not a 50–150 token fragment.
    fine_grained = len(sections)
    sections = _pack_sections(sections, template_len=len(template_text), preserve_pleading_units=is_court_pleading)
    if len(sections) != fine_grained:
        logger.info("[template_drafting] packed %d sections into %d drafting unit(s)", fine_grained, len(sections))

    # Hard page-proportional cap: even when table flags or slot-dense blocks defeat greedy
    # packing, a template must never explode into one drafting call per line — each call is
    # wall-clock latency + an API charge, and on a paced free-tier engine 80 calls is over
    # ten minutes of pure throttling.
    #
    # This applies to COURT PLEADINGS TOO. Pleadings used to be exempt, which is what let a
    # 12-page commercial suit hit the 80-section hard ceiling: the pleading re-splitters give
    # every numbered paragraph, every cause-title line and every prayer clause its own unit,
    # and _is_protected_pleading_unit then blocks packing from recombining any of them.
    # Splitting that finely is a LAYOUT concern (so each line keeps its own alignment), not a
    # DRAFTING concern — and layout survives merging, because _merged_typography carries each
    # packed part's own alignment/bold through in its `parts` map, and _merge_overflow refuses
    # to merge across a major-part boundary. So pleadings get the SAME page-proportional budget
    # as every other family; their integrity is protected by the boundary guard, not by a
    # bigger budget. Tune with DRAFT_UNITS_PER_PAGE in .env.
    est_pages, page_src = _template_pages(template_text, template_layout)
    dyn_cap = min(_MAX_SECTIONS, max(4, round(est_pages * _units_per_page())))
    if len(sections) > dyn_cap:
        logger.info(
            "[template_drafting] merging %d unit(s) down to page cap %d "
            "(%.1f pages [%s] x %.1f units/page, pleading=%s)",
            len(sections), dyn_cap, est_pages, page_src, _units_per_page(), is_court_pleading,
        )
        sections = _merge_overflow(sections, dyn_cap)

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
    # Case-insensitive exact (regex, so returned offsets stay valid for any Unicode).
    m0 = re.search(re.escape(needle), haystack, re.IGNORECASE)
    if m0:
        return m0.start()
    words = needle.split()
    if not words:
        return -1
    # Progressive whitespace-insensitive search: models copy the HEAD of a section verbatim
    # but drift near the tail (normalised spacing, dropped punctuation, OCR noise), so retry
    # with progressively shorter word prefixes before giving up. Floor of 3 consecutive
    # words keeps false positives unlikely.
    tried: set[int] = set()
    for k in (8, 6, 4, 3):
        kk = min(k, len(words))
        if kk < 3 or kk in tried:
            continue
        tried.add(kk)
        pattern = r"\s+".join(re.escape(w) for w in words[:kk])
        m = re.search(pattern, haystack, re.IGNORECASE)
        if m:
            return m.start()
    return -1


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


_VALID_TEMPLATE_ALIGN = {"left", "center", "right", "justify"}


def _layout_line_signature(text: str) -> str:
    """Stable match key for a template/generated line whose values may be replaced.

    Clause numbers and structural labels survive drafting even when names/dates/amounts are
    replaced, so use them as the primary layout key. Fallback to a normalized prefix.
    """
    plain = _norm_ws(_boundary_plain(text)).strip(" :")
    if not plain:
        return ""
    m = re.match(r"^(?P<num>\d{1,3}[.)])\s*(?P<label>[A-Z][A-Z0-9 /&().,'-]{2,90}?)(?::|\s{2,}|$)", plain)
    if m:
        return _norm_ws(f"{m.group('num')} {m.group('label')}").lower().strip(" :")
    m = re.match(r"^(?P<label>[A-Z][A-Z0-9 /&().,'-]{2,90})(?::)?$", plain)
    if m and len(plain) <= 120:
        return _norm_ws(m.group("label")).lower().strip(" :")
    words = re.sub(r"[^A-Za-z0-9]+", " ", plain).lower().split()
    return " ".join(words[:10])


def _layout_line_level(text: str, align: str, fallback_level: int = 0) -> int:
    plain = _norm_ws(_boundary_plain(text))
    if not plain or re.match(r"^\d{1,3}[.)]\s+", plain):
        return 0
    if align == "center" and len(plain) <= 140:
        return max(1, int(fallback_level or 1))
    return 0


def _layout_lines(template_layout: dict | None) -> list[dict]:
    raw = (template_layout or {}).get("lines") if isinstance(template_layout, dict) else None
    out: list[dict] = []
    for item in raw or []:
        if not isinstance(item, dict):
            continue
        text = _norm_ws(str(item.get("text") or ""))
        if not text:
            continue
        align = str(item.get("alignment") or "left").strip().lower()
        if align not in _VALID_TEMPLATE_ALIGN:
            align = "left"
        out.append({
            "text": text,
            "norm": _norm_ws(_boundary_plain(text)).lower(),
            "signature": _layout_line_signature(text),
            "alignment": align,
            "bold": bool(item.get("bold")),
            "size_pt": item.get("size_pt"),
            "page": item.get("page"),
            "level": _layout_line_level(text, align, int(item.get("level") or 0)),
        })
    return out


def _match_layout_line(line: str, layout: list[dict]) -> dict | None:
    if not layout:
        return None
    norm = _norm_ws(_boundary_plain(line)).lower()
    sig = _layout_line_signature(line)
    if not norm and not sig:
        return None
    for item in layout:
        if norm and item.get("norm") == norm:
            return item
    if sig:
        for item in layout:
            if item.get("signature") and item.get("signature") == sig:
                return item
    # Fallback: enough shared prefix for title/lead-in lines whose placeholders changed.
    for item in layout:
        item_norm = str(item.get("norm") or "")
        if len(norm) >= 24 and len(item_norm) >= 24 and (norm.startswith(item_norm[:24]) or item_norm.startswith(norm[:24])):
            return item
    return None


def _apply_measured_template_layout(sections: list[TemplateSection], template_layout: dict | None) -> list[TemplateSection]:
    layout = _layout_lines(template_layout)
    if not layout:
        return sections
    matched = 0
    for section in sections:
        entries: list[dict] = []
        candidate_lines = [ln for ln in (section.original_text or section.heading or "").split("\n") if ln.strip()]
        for raw in candidate_lines:
            item = _match_layout_line(raw, layout)
            if not item:
                continue
            matched += 1
            entries.append({
                "text": _norm_ws(_boundary_plain(raw)),
                "signature": _layout_line_signature(raw),
                "alignment": item.get("alignment") or "left",
                "bold": bool(item.get("bold")),
                "size_pt": item.get("size_pt"),
                "level": item.get("level") or 0,
            })
        if not entries:
            continue
        first = entries[0]
        typo = dict(section.typography or {})
        typo.update({
            "alignment": first.get("alignment") or typo.get("alignment") or "left",
            "bold": bool(first.get("bold")),
            "level": int(first.get("level") or 0),
            "layout_source": "template",
            "lines": entries[:120],
        })
        if first.get("size_pt"):
            typo["size_pt"] = first.get("size_pt")
        section.typography = typo
    if matched:
        logger.info("[template_drafting] applied measured template layout to %d line(s)", matched)
    return _apply_measured_template_tables(sections, template_layout)


def _apply_measured_template_tables(
    sections: list[TemplateSection], template_layout: dict | None
) -> list[TemplateSection]:
    """Bind each table recovered from the template's RULING LINES onto the section that holds it.

    Stage A cannot see a table in extracted text: a grid flattens to a vertical dump, and a cell
    that is BLANK in the template leaves no glyphs at all. So a LIST OF DOCUMENTS schedule looked
    exactly like a numbered list and got drafted as one, losing its heading and its empty
    "Original / Copy" / "Annexure / Exhibit" columns. template_layout["tables"] carries the true
    grid (from pdfplumber); here we mark the owning section contains_table and give it the REAL
    column header, so draft_section emits a markdown table with every column — including the ones
    the advocate is meant to fill in by hand.
    """
    tables = (template_layout or {}).get("tables") if isinstance(template_layout, dict) else None
    if not isinstance(tables, list) or not tables:
        return sections

    out = list(sections)
    bound = 0
    for table in tables:
        header = [str(c or "").strip() for c in (table.get("header") or [])]
        rows = table.get("rows") or []
        if not header or not rows:
            continue
        # Probe on each row's first non-serial cell — the stable part of a legal schedule
        # ("Board Resolution / Power of Attorney", "Vakalatnama", …).
        probes = [
            _norm_ws(str(r[1] if len(r) > 1 and str(r[1] or "").strip() else r[0])).lower()
            for r in rows
            if any(str(c or "").strip() for c in r)
        ]
        probes = [p for p in probes if len(p) >= 6][:12]
        if not probes:
            continue
        need = max(2, len(probes) // 2)

        # Stage A slices a table into MANY tiny sections — often one per row — so no single
        # section holds enough of the grid to be recognised as its owner. Find instead the
        # SMALLEST CONTIGUOUS RUN of sections whose combined text covers the rows, and collapse
        # that run into ONE atomic table section. Doing it here (before packing and before the
        # page cap) is what lets the downstream guards protect it: they key off contains_table,
        # which does not exist until this runs.
        span = _find_table_span(out, probes, need)
        if span is None:
            logger.info(
                "[template_drafting] recovered table %dx%d matched no section run (need %d/%d probes)",
                len(rows), len(header), need, len(probes),
            )
            continue

        i, j = span  # inclusive
        # Pull the table's own HEADING into the span. Stage A slices "LIST OF DOCUMENTS" off as
        # its own tiny section, so the span found above starts at the first ROW — which would
        # leave the heading stranded in a separate drafting unit, detached from its grid.
        if i > 0:
            prev = out[i - 1]
            prev_text = _norm_ws(prev.original_text or "")
            if len(prev_text) <= 120 and _is_major_part_line(_section_first_line(prev)):
                i -= 1

        run = out[i:j + 1]
        head = run[0]
        merged = TemplateSection(
            index=head.index,
            heading=head.heading,
            original_text="\n\n".join(s.original_text for s in run if (s.original_text or "").strip()),
            placeholders=[p for s in run for p in s.placeholders],
            typography=_merged_typography(run),
            contains_table=True,
            table_header=header,
        )
        typo = dict(merged.typography or {})
        typo["table"] = {"header": header, "rows": rows[:60]}
        merged.typography = typo
        out[i:j + 1] = [merged]
        bound += 1
        logger.info(
            "[template_drafting] bound template table %dx%d to section '%s' (collapsed %d fine section(s))",
            len(rows), len(header), (merged.heading or "")[:48], len(run),
        )

    # Measured tables are GROUND TRUTH for this template. Stage A's model also guesses
    # contains_table, and it flags things that are not tables at all — it marked the bare
    # "LIST OF DOCUMENTS" heading line (17 chars, no rows) as a table. Such a section carries no
    # header and no grid, so draft_section would fall through to the "output a markdown table
    # with columns: as in the template" hint and the model would INVENT a table out of a
    # heading. Since the ruling lines told us exactly which sections are tables, drop any flag
    # that did not survive binding.
    phantom = 0
    for s in out:
        if s.contains_table and not (s.typography or {}).get("table"):
            s.contains_table = False
            s.table_header = []
            phantom += 1
    if phantom:
        logger.info(
            "[template_drafting] cleared %d unmeasured contains_table flag(s) — the template's "
            "%d real table(s) were measured from its ruling lines", phantom, bound,
        )

    if bound:
        for k, s in enumerate(out):
            s.index = k
        logger.info("[template_drafting] %d template table(s) bound from measured layout", bound)
    return out


def _find_table_span(
    sections: list[TemplateSection], probes: list[str], need: int
) -> tuple[int, int] | None:
    """Smallest contiguous [i, j] whose combined text covers >= `need` of the table's row probes."""
    n = len(sections)
    bodies = [_norm_ws(s.original_text or "").lower() for s in sections]
    best: tuple[int, int] | None = None
    best_width = None
    for i in range(n):
        joined = ""
        for j in range(i, min(n, i + 24)):   # a table never spans more than a couple dozen slices
            joined += " " + bodies[j]
            hits = sum(1 for p in probes if p[:40] in joined)
            if hits >= need:
                width = j - i
                if best_width is None or width < best_width:
                    best, best_width = (i, j), width
                break
    return best


def _merge_overflow(sections: list[TemplateSection], cap: int) -> list[TemplateSection]:
    """Greedily merge adjacent body sections until <= cap, preserving order and headings.

    NEVER merges across a MAJOR PART boundary (PRAYER / VERIFICATION / SCHEDULE / ANNEXURE …):
    fusing PRAYER into the tail of the last numbered clause is exactly the corruption this
    guard exists to prevent, and it is why court pleadings used to be exempted from the page
    cap altogether — which in turn let a 12-page suit explode to the 80-section hard ceiling.
    With the boundary protected, the cap is safe to apply to every document family.
    Stops early when no legal pair remains (every neighbour is a part boundary)."""
    merged = list(sections)
    while len(merged) > cap:
        # Shortest adjacent pair, skipping any pair that would corrupt a structural unit:
        #   * the RIGHT side opens a major document part (PRAYER, LIST OF DOCUMENTS, …), or
        #   * EITHER side is a TABLE. A template table (a schedule, an inventory, a LIST OF
        #     DOCUMENTS grid) is an atomic drafting unit: merged into surrounding prose it
        #     loses its own table_header hint and the drafter emits a flat numbered list
        #     instead of a grid — exactly how the LIST OF DOCUMENTS and PARTICULARS OF
        #     ACCOMPANYING FILINGS tables lost their columns and headings.
        best_i, best_len = None, None
        for i in range(len(merged) - 1):
            a, b = merged[i], merged[i + 1]
            if _is_major_part_line(_section_first_line(b)):
                continue
            if a.contains_table or b.contains_table:
                continue
            combined = len(a.original_text) + len(b.original_text)
            if best_len is None or combined < best_len:
                best_len, best_i = combined, i
        if best_i is None:
            logger.info(
                "[template_drafting] merge stopped at %d unit(s) (cap %d): every remaining "
                "boundary is a major document part or a table", len(merged), cap,
            )
            break
        a, b = merged[best_i], merged[best_i + 1]
        merged[best_i] = TemplateSection(
            index=a.index,
            heading=a.heading,
            original_text=(a.original_text + "\n\n" + b.original_text).strip(),
            placeholders=a.placeholders + b.placeholders,
            typography=_merged_typography([a, b]),
            contains_table=a.contains_table or b.contains_table,
            table_header=a.table_header or b.table_header,
        )
        del merged[best_i + 1]
    for i, s in enumerate(merged):
        s.index = i
    return merged



# Slot-density signals: blank runs, bracketed tokens, a GENERIC "Label: ____/[…]" line
# (family-agnostic — matches Employee Code:, GSTIN:, Passport No:, … in ANY document, not
# just rent-agreement vocabulary), plus common Indian identity/execution keywords.
_SLOT_HEAVY_RE = re.compile(
    r"_{4,}|\[[^\]]{2,}\]|[A-Za-z][\w /.&()-]{1,28}:\s*(?:_{2,}|\[)"
    r"|\b(?:Bank|A/c|Account|IFSC|UPI|Aadhaar|PAN|Address|Signature|Witness|Date|Place)\b",
    re.IGNORECASE,
)


_COURT_PLEADING_TEMPLATE_RE = re.compile(
    r"\b(?:IN\s+THE\s+COURT|SUIT\s+NO\.?|PLAINT\s+UNDER|PETITION\s+UNDER|VAKALATNAMA|"
    r"STATEMENT\s+OF\s+TRUTH|COMMERCIAL\s+COURTS?\s+ACT|VERSUS|V/S\.?|VS\.?)\b",
    re.IGNORECASE,
)
_COURT_CAUSE_LINE_RE = re.compile(
    r"^(?:IN\s+THE\s+COURT\b|.*\b(?:SUIT|PETITION|APPEAL|APPLICATION|COMPLAINT)\s+NO\.?\b|"
    r"IN\s+THE\s+MATTER\s+OF:?|VERSUS|VS\.?|V/S\.?|.*…\s*(?:PLAINTIFF|DEFENDANT|PETITIONER|RESPONDENT)\b|"
    r"PLAINT\s+UNDER\b|PETITION\s+UNDER\b|APPLICATION\s+UNDER\b|THE\s+PLAINTIFF\s+ABOVE\s+NAMED\b)",
    re.IGNORECASE,
)
_PLEADING_BODY_START_RE = re.compile(r"^\s*\d{1,3}[.)]\s+")
_TEMPLATE_SLOT_RE = re.compile(r"_{3,}|\[[^\]\n]{2,}\]|<[^>\n]{2,}>")


def _is_court_pleading_template(template_text: str) -> bool:
    head = (template_text or "")[:8000]
    score = len(_COURT_PLEADING_TEMPLATE_RE.findall(head))
    return score >= 3 and bool(re.search(r"\b(?:Plaintiff|Defendant|Petitioner|Respondent)\b", head, re.IGNORECASE))


def _section_slots(text: str) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for m in _TEMPLATE_SLOT_RE.finditer(text or ""):
        val = _norm_ws(m.group(0))
        key = val.lower()
        if val and key not in seen:
            seen.add(key)
            out.append(val)
    return out


def _clone_template_section(base: TemplateSection, *, heading: str, text: str, index: int, alignment: str = "justify", bold: bool = False, level: int = 0) -> TemplateSection:
    typo = dict(base.typography or {})
    typo.update({"alignment": alignment, "bold": bold, "level": level})
    return TemplateSection(
        index=index,
        heading=heading,
        original_text=text.strip(),
        placeholders=_section_slots(text),
        typography=typo,
        contains_table=False,
        table_header=[],
    )


def _is_role_line(line: str) -> bool:
    return bool(re.search(r"…\s*(?:Plaintiff|Defendant|Petitioner|Respondent|Appellant|Applicant)\b", line or "", re.IGNORECASE))


def _mostly_upper_line(line: str, *, min_ratio: float = 0.78) -> bool:
    plain = _norm_ws(_boundary_plain(line))
    letters = [c for c in plain if c.isalpha()]
    return bool(letters) and (sum(1 for c in letters if c.isupper()) / len(letters)) >= min_ratio


def _is_pleading_title_line(line: str) -> bool:
    plain = _norm_ws(_boundary_plain(line))
    if not plain:
        return False
    if re.match(r"^(?:PLAINT|PETITION|APPLICATION|APPEAL|COMPLAINT)\s+UNDER\b", plain, re.IGNORECASE):
        return True
    if re.match(r"^(?:WITH\s+SECTION|AND\s+OTHER\s+APPLICABLE|OTHER\s+APPLICABLE|COMMERCIAL\s+COURTS?\s+ACT,?\s+2015\s+FOR|DECLARATION\s*/|COMMERCIAL\s+RELIEFS)", plain, re.IGNORECASE):
        return True
    if re.search(r"\b(?:CODE\s+OF\s+CIVIL\s+PROCEDURE|COMMERCIAL\s+RELIEFS|SPECIFIC\s+PERFORMANCE)\b", plain, re.IGNORECASE) and _mostly_upper_line(plain, min_ratio=0.60):
        return True
    return False


def _resplit_court_pleading_header(sections: list[TemplateSection]) -> list[TemplateSection]:
    """Repair a court pleading cause-title span if Stage A lumped it together.

    The visible template owns these boundaries: court line, case number, matter label,
    party descriptions, role labels, VERSUS, document title, opening lead-in. These must
    not be packed into one drafting section, because each line has different alignment.
    """
    out: list[TemplateSection] = []
    changed = False
    for base in sections:
        text = base.original_text or ""
        if not (re.search(r"\bIN\s+THE\s+COURT\b", text, re.IGNORECASE) and re.search(r"\bVERSUS\b", text, re.IGNORECASE)):
            out.append(base)
            continue
        lines = [ln.strip() for ln in text.replace("\r", "\n").split("\n") if ln.strip()]
        if len(lines) < 4:
            out.append(base)
            continue
        local: list[TemplateSection] = []
        i = 0
        while i < len(lines):
            line = lines[i]
            plain = _norm_ws(_boundary_plain(line))
            if not plain:
                i += 1
                continue
            if _PLEADING_BODY_START_RE.match(plain):
                remaining = "\n".join(lines[i:])
                local.extend(_split_numbered_pleading_blocks(base, remaining, start_index=len(local)))
                i = len(lines)
                continue
            if re.match(r"^IN\s+THE\s+COURT\b", plain, re.IGNORECASE):
                local.append(_clone_template_section(base, heading="Court Name", text=line, index=len(local), alignment="center", bold=True, level=1))
                i += 1
                continue
            if re.search(r"\b(?:SUIT|PETITION|APPEAL|APPLICATION|COMPLAINT)\s+NO\.?\b", plain, re.IGNORECASE):
                local.append(_clone_template_section(base, heading="Case Number", text=line, index=len(local), alignment="center", bold=True, level=1))
                i += 1
                continue
            if re.match(r"^IN\s+THE\s+MATTER\s+OF:?$", plain, re.IGNORECASE):
                local.append(_clone_template_section(base, heading="Matter Heading", text=line, index=len(local), alignment="left", bold=True, level=0))
                i += 1
                continue
            if re.fullmatch(r"VERSUS|VS\.?|V/S\.?,?", plain, re.IGNORECASE):
                local.append(_clone_template_section(base, heading="Versus", text=line, index=len(local), alignment="center", bold=True, level=1))
                i += 1
                continue
            if _is_role_line(plain):
                role = "Plaintiff Role" if re.search(r"plaintiff|petitioner|appellant|applicant", plain, re.IGNORECASE) else "Defendant Role"
                local.append(_clone_template_section(base, heading=role, text=line, index=len(local), alignment="right", bold=False, level=0))
                i += 1
                continue
            if _is_pleading_title_line(plain):
                title_lines = [line]
                i += 1
                while i < len(lines):
                    nxt = _norm_ws(_boundary_plain(lines[i]))
                    if not nxt or _PLEADING_BODY_START_RE.match(nxt) or re.match(r"^The\s+Plaintiff\s+above\s+named", nxt, re.IGNORECASE):
                        break
                    if _is_pleading_title_line(nxt) or (_mostly_upper_line(nxt, min_ratio=0.70) and len(nxt) <= 140):
                        title_lines.append(lines[i])
                        i += 1
                        continue
                    break
                local.append(_clone_template_section(base, heading="Pleading Title", text="\n".join(title_lines), index=len(local), alignment="center", bold=True, level=1))
                continue
            if re.match(r"^The\s+Plaintiff\s+above\s+named", plain, re.IGNORECASE):
                local.append(_clone_template_section(base, heading="Opening Statement", text=line, index=len(local), alignment="left", bold=True, level=0))
                i += 1
                continue
            # Party description: collect wrapped lines until role/VERSUS/title/body.
            desc = [line]
            i += 1
            while i < len(lines):
                nxt = _norm_ws(_boundary_plain(lines[i]))
                if (_is_role_line(nxt) or re.fullmatch(r"VERSUS|VS\.?|V/S\.?,?", nxt, re.IGNORECASE)
                        or _is_pleading_title_line(nxt) or _PLEADING_BODY_START_RE.match(nxt)
                        or re.match(r"^The\s+Plaintiff\s+above\s+named", nxt, re.IGNORECASE)):
                    break
                desc.append(lines[i])
                i += 1
            joined = "\n".join(desc)
            h = "Defendant Description" if any(sec.heading == "Versus" for sec in local) else "Plaintiff Description"
            local.append(_clone_template_section(base, heading=h, text=joined, index=len(local), alignment="justify", bold=False, level=0))
        if len(local) > 1:
            out.extend(local)
            changed = True
        else:
            out.append(base)
    if changed:
        for idx, sec in enumerate(out):
            sec.index = idx
    return out


def _split_numbered_pleading_blocks(base: TemplateSection, text: str, *, start_index: int = 0) -> list[TemplateSection]:
    lines = [ln.rstrip() for ln in (text or "").replace("\r", "\n").split("\n")]
    starts = [i for i, ln in enumerate(lines) if _PLEADING_BODY_START_RE.match(_boundary_plain(ln))]
    if len(starts) <= 1:
        return [_clone_template_section(base, heading=base.heading, text=text, index=start_index, alignment="justify", bold=False, level=0)] if text.strip() else []
    out: list[TemplateSection] = []
    bounds = starts + [len(lines)]
    for pos, (a, b) in enumerate(zip(bounds, bounds[1:])):
        block = "\n".join(lines[a:b]).strip()
        if not block:
            continue
        m = re.match(r"^\s*(\d{1,3})[.)]", _boundary_plain(block))
        heading = f"Paragraph {m.group(1)}" if m else f"Paragraph {start_index + pos + 1}"
        out.append(_clone_template_section(base, heading=heading, text=block, index=start_index + len(out), alignment="justify", bold=False, level=0))
    return out


def _resplit_numbered_pleading_sections(sections: list[TemplateSection]) -> list[TemplateSection]:
    out: list[TemplateSection] = []
    changed = False
    for base in sections:
        starts = [ln for ln in (base.original_text or "").split("\n") if _PLEADING_BODY_START_RE.match(_boundary_plain(ln))]
        if len(starts) <= 1:
            out.append(base)
            continue
        split = _split_numbered_pleading_blocks(base, base.original_text, start_index=len(out))
        if len(split) > 1:
            out.extend(split)
            changed = True
        else:
            out.append(base)
    if changed:
        for idx, sec in enumerate(out):
            sec.index = idx
    return out


def _is_protected_pleading_unit(section: TemplateSection) -> bool:
    text = _norm_ws(f"{section.heading}\n{section.original_text}")
    first = _norm_ws(_section_first_line(section))
    if re.match(r"^Paragraph\s+\d+\b", section.heading or "", re.IGNORECASE):
        return True
    if _PLEADING_BODY_START_RE.match(first):
        return True
    if _COURT_CAUSE_LINE_RE.match(first) or _is_role_line(first) or _is_pleading_title_line(first):
        return True
    if re.match(r"^(?:Court Name|Case Number|Matter Heading|Plaintiff Description|Plaintiff Role|Versus|Defendant Description|Defendant Role|Pleading Title|Opening Statement)$", section.heading or "", re.IGNORECASE):
        return True
    return bool(re.search(r"\b(?:PLAINTIFF|DEFENDANT)\b", text, re.IGNORECASE) and re.search(r"\b(?:VERSUS|IN THE MATTER OF|SUIT NO\.)\b", text, re.IGNORECASE))


def _should_keep_section_standalone(section: TemplateSection, *, preserve_pleading_units: bool = False) -> bool:
    """Only a genuine data table or an extremely slot-dense block (execution/witness/bank
    blocks) stands alone. The earlier "every numbered clause standalone" rule exploded a
    4-page template into 31 drafting calls — page-proportional packing + the coverage
    checklist protect clause fidelity instead."""
    text = f"{section.heading}\n{section.original_text or ''}"
    if preserve_pleading_units and _is_protected_pleading_unit(section):
        return True
    if section.contains_table:
        return True
    # A very slot-dense block is where hallucination is most damaging — keep it alone.
    if len(_SLOT_HEAVY_RE.findall(text)) >= 8:
        return True
    return False


# Major DOCUMENT PARTS — structural part names of Indian legal drafts (not template-
# specific): each must START its own drafting unit, and a part heading buried mid-span
# by a failed Stage-A anchor must be re-split out. Packing across these boundaries is
# what fused "PRAYER" into the tail of the last numbered clause.
_MAJOR_PART_RE = re.compile(
    r"^(?:PRAYER|VERIFICATION|SCHEDULE|ANNEXURE(?:\s*-?\s*[A-Z0-9])?|WITNESSES|SIGNATURES?|"
    r"STATEMENT\s+OF\s+TRUTH|AFFIDAVIT|DECLARATION|IN\s+WITNESS\s+WHEREOF|MEMO\s+OF\s+PARTIES|"
    r"APPENDIX(?:\s*-?\s*[A-Z0-9])?|EXHIBIT(?:\s*-?\s*[A-Z0-9])?|ENCLOSURES?|TESTIMONIUM|"
    # Tail parts of an Indian pleading. These were MISSING, so the merge guard did not protect
    # them and the page cap fused LIST OF DOCUMENTS + PARTICULARS OF ACCOMPANYING FILINGS into
    # the preceding signature block — the two schedule TABLES then lost their own drafting unit
    # and came out as flat numbered lists with their headings and columns gone.
    r"LIST\s+OF\s+(?:DOCUMENTS?|DATES?|EVENTS?|PARTIES)|"
    r"PARTICULARS\s+OF\s+(?:ACCOMPANYING\s+FILINGS?|[A-Z ]{3,30})|"
    r"INDEX|SYNOPSIS|VAKALATNAMA|COURT\s+FEES?|IDENTIFIED\s+BY|"
    r"INTERIM\s+APPLICATION|ADVOCATE\s+FOR\s+THE\s+"
    r"(?:PLAINTIFF|PETITIONER|APPELLANT|DEFENDANT|RESPONDENT|APPLICANT)"
    r")\b",
    re.IGNORECASE,
)


def _is_major_part_line(line: str) -> bool:
    plain = _boundary_plain(line)
    if not plain or len(plain) > 60 or not _MAJOR_PART_RE.match(plain):
        return False
    letters = [c for c in plain if c.isalpha()]
    return bool(letters) and sum(1 for c in letters if c.isupper()) / len(letters) >= 0.8


def _section_first_line(s: TemplateSection) -> str:
    for raw in (s.original_text or "").split("\n"):
        if raw.strip():
            return raw
    return s.heading or ""


def _resplit_at_major_parts(sections: list[TemplateSection]) -> list[TemplateSection]:
    """When a Stage-A anchor fails to locate, a major part heading (PRAYER, VERIFICATION,
    SCHEDULE …) ends up buried INSIDE the previous section's verbatim span. Re-split such
    spans at the part heading so the part drafts as its own coherent block."""
    out: list[TemplateSection] = []
    for s in sections:
        lines = (s.original_text or "").split("\n")
        cuts = [i for i in range(1, len(lines)) if _is_major_part_line(lines[i])]
        if not cuts:
            out.append(s)
            continue
        bounds = [0] + cuts + [len(lines)]
        segs: list[tuple[int, str]] = []
        for a, b in zip(bounds, bounds[1:]):
            text = "\n".join(lines[a:b]).strip()
            if text:
                segs.append((a, text))
        if len(segs) <= 1:
            out.append(s)
            continue
        for k, (a, text) in enumerate(segs):
            out.append(TemplateSection(
                index=s.index,
                heading=(s.heading if k == 0 else (_boundary_plain(lines[a])[:80] or s.heading)),
                original_text=text,
                placeholders=s.placeholders if k == 0 else [],
                typography=s.typography,
                contains_table=s.contains_table if k == 0 else False,
                table_header=s.table_header if k == 0 else [],
            ))
    for i, s in enumerate(out):
        s.index = i
    return out


def _merged_typography(subs: list[TemplateSection]) -> dict:
    """Typography for a merged drafting unit: the head section's typography plus a compact
    per-part layout map, so packing does NOT flatten every sub-section's measured
    alignment/bold down to the first one's — the drafter is told each packed part's own
    layout (a centered title, a right-aligned role label and a justified clause can share
    one unit without losing their individual alignment)."""
    head = dict(subs[0].typography or {})
    parts: list[dict] = []
    for b in subs:
        t = b.typography or {}
        nested = t.get("parts")
        if isinstance(nested, list) and nested:
            parts.extend(p for p in nested if isinstance(p, dict))
            continue
        if not (b.heading or "").strip():
            continue
        parts.append({
            "heading": b.heading[:60],
            "alignment": str(t.get("alignment") or "justify"),
            "bold": bool(t.get("bold")),
            "level": int(t.get("level") or 0),
        })
    line_layouts: list[dict] = []
    for b in subs:
        t = b.typography or {}
        for entry in (t.get("lines") or []):
            if isinstance(entry, dict):
                line_layouts.append(entry)
    head.pop("parts", None)
    head.pop("lines", None)
    if len(parts) > 1:
        head["parts"] = parts[:10]
    if line_layouts:
        head["lines"] = line_layouts[:160]
        head["layout_source"] = "template"
    return head


def _pack_sections(sections: list[TemplateSection], *, template_len: int = 0, preserve_pleading_units: bool = False) -> list[TemplateSection]:
    """Greedily merge consecutive small sections into PAGE-PROPORTIONAL drafting units.

    Fine-grained structural analysis (one section per header line / clause) yields many
    tiny sections that each draft to only 50–150 output tokens — slow, expensive and
    repetitive (the observed 31 calls for a 4-page rent agreement). Units are sized off
    the template itself: ~_UNITS_PER_PAGE units per page, so a 4-page template drafts in
    ~8-12 calls. Line/clause structure within a unit is preserved by the drafter (rule 9b)
    and the MANDATORY coverage checklist. A table section stays standalone so its
    per-section column hint stays accurate; an oversize section stands alone.
    """
    if len(sections) <= 1:
        return sections
    total = sum(len(s.original_text) for s in sections)
    basis = max(template_len, total, 1)
    est_pages = max(1.0, basis / _CHARS_PER_PAGE)
    desired_units = max(3, round(est_pages * _UNITS_PER_PAGE))
    unit_target = max(900, basis // desired_units)
    unit_max = unit_target * 2
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
            # A table member should never reach a multi-item bucket (_should_keep_section_standalone
            # holds it back), but if it ever does, do NOT silently drop the grid — hardcoding
            # contains_table=False here would strip the measured table_header and turn the
            # schedule back into a flat list.
            tbl_member = next((b for b in bucket if b.contains_table), None)
            units.append(TemplateSection(
                index=head.index,
                heading=head.heading,
                original_text=combined,
                placeholders=placeholders,
                typography=_merged_typography(bucket),
                contains_table=tbl_member is not None,
                table_header=list(tbl_member.table_header) if tbl_member else [],
            ))
        bucket = []
        bucket_len = 0

    for s in sections:
        if _should_keep_section_standalone(s, preserve_pleading_units=preserve_pleading_units):
            _flush()
            units.append(s)
            continue
        # A major document part (PRAYER, VERIFICATION, SCHEDULE …) starts its own unit —
        # never packed onto the tail of the preceding clauses.
        if bucket and _is_major_part_line(_section_first_line(s)):
            _flush()
        slen = len(s.original_text)
        # Adding this section would blow the max → close the current unit first.
        if bucket and (bucket_len + slen > unit_max or len(bucket) >= _UNIT_MAX_SECTIONS):
            _flush()
        bucket.append(s)
        bucket_len += slen
        # Reached the target → close the unit.
        if bucket_len >= unit_target:
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
        parts.append(" ".join(section.placeholders[:12]))
    body = _norm_ws(section.original_text)[:360]
    if body:
        parts.append(body)
    return " ".join(p for p in parts if p).strip() or (section.heading or "section")


def _section_retrieval_queries(section: TemplateSection) -> list[str]:
    """Return targeted RAG queries for a section, with exact-value facets first."""
    text = _norm_ws(" ".join([
        section.heading or "",
        section.original_text or "",
        " ".join(section.placeholders or []),
    ])).lower()
    queries: list[str] = []
    if re.search(r"\b(bank|account|a/c|ifsc|upi|neft|rtgs|cheque|payment|rent|deposit)\b", text):
        queries.append(
            "exact payment details bank name account number account no A/c IFSC code UPI ID "
            "cheque NEFT RTGS rent deposit landlord tenant"
        )
    if re.search(r"\b(witness|signature|id proof|pan|aadhaar|address)\b", text):
        queries.append(
            "exact witness details witness name address ID proof PAN Aadhaar signature landlord tenant"
        )
    if re.search(r"\b(inventory|annexure|fixture|fitting|furniture|geyser|wardrobe|fan|condition|quantity)\b", text):
        queries.append(
            "exact inventory annexure fixtures fittings furniture item quantity condition schedule premises"
        )
    queries.append(_section_query(section))

    seen: set[str] = set()
    out: list[str] = []
    for q in queries:
        key = _norm_ws(q).lower()
        if key and key not in seen:
            seen.add(key)
            out.append(q)
    return out


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


def _deterministic_field_inventory(corpus: str) -> str:
    """Small regex/line extractor for short exact values that vector/LLM passes miss."""
    if not corpus:
        return ""
    interesting = re.compile(
        r"\b(bank|banker|account|a/c|ifsc|upi|aadhaar|aadhar|pan|id\s+proof|"
        r"witness|rent|deposit|maintenance|notice|lock-in|lock\s+in)\b",
        re.IGNORECASE,
    )
    seen: set[str] = set()
    lines: list[str] = []
    for raw in corpus.splitlines():
        line = _norm_ws(raw)
        if not line or len(line) < 6 or not interesting.search(line):
            continue
        key = line.lower()
        if key in seen:
            continue
        seen.add(key)
        lines.append(f"- SOURCE LINE: {line[:260]}")
        if len(lines) >= 80:
            break

    def candidates(label: str, pattern: str) -> list[str]:
        vals: list[str] = []
        local_seen: set[str] = set()
        for m in re.finditer(pattern, corpus, flags=re.IGNORECASE):
            val = _norm_ws(m.group(1) if m.groups() else m.group(0))
            if val and val.lower() not in local_seen:
                local_seen.add(val.lower())
                vals.append(val)
            if len(vals) >= 20:
                break
        return [f"- {label}: " + "; ".join(vals)] if vals else []

    extracted: list[str] = []
    extracted += candidates("IFSC CANDIDATES", r"\b[A-Z]{4}0[A-Z0-9]{6}\b")
    extracted += candidates("UPI ID CANDIDATES", r"\b[A-Z0-9._%+-]{2,}@[A-Z][A-Z0-9._-]{2,}\b")
    extracted += candidates(
        "ACCOUNT NUMBER CANDIDATES",
        r"(?:account(?:\s+number|\s+no\.?)?|a/c\s*no\.?)\s*[:\-]?\s*([0-9][0-9\s-]{7,24}[0-9])",
    )
    extracted += candidates(
        "PAN CANDIDATES",
        r"\b([A-Z]{5}[0-9]{4}[A-Z])\b",
    )

    if not lines and not extracted:
        return ""
    return "\n".join(extracted + lines)


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
    inventory = (inventory or "").strip()
    field_hints = _deterministic_field_inventory(corpus)
    if field_hints:
        inventory = (
            f"{inventory}\n\n"
            "PART 4 — DETERMINISTIC SOURCE FIELD HINTS\n"
            "These are exact lines/values extracted by code from the supporting documents. "
            "Use them only when the surrounding source line identifies the correct field; "
            "do not infer ownership from a candidate alone.\n"
            f"{field_hints}"
        ).strip()
    return inventory


# ─────────────────── Evidence ledger (anti-repetition, cheap) ────────────────
# Replaces the O(n^2) "paste every previously drafted section" blob. Instead of re-sending the
# whole document to every section, we send a compact LEDGER of which facts have already been
# stated IN FULL and how to refer to them from now on. A 12-page pleading was carrying up to
# _PRIOR_DRAFTS_CHAR_CAP (60,000) chars of prior text into EVERY section call — that alone was
# most of the 121,034 input tokens a single draft burned.
#
# Facts are harvested deterministically (no extra model call) from the fact matrix:
#   ENTITY  — a party/company identity line: capitalised, long, comma-qualified.
#   ADDRESS — contains a street/PIN/place marker.
#   FIGURE  — money / dates / percentages / document numbers.
# ENTITY and ADDRESS get a short form after their first use ("the Plaintiff", "the said
# premises"); a FIGURE may legitimately recur (an operative rent or decree amount), so it is
# listed as repeatable.
_LEDGER_ROLE_RE = re.compile(
    r"\b(Plaintiff|Defendant|Petitioner|Respondent|Appellant|Applicant|Landlord|Lessor|"
    r"Tenant|Lessee|Complainant|Accused|Claimant|Vendor|Purchaser|Borrower|Lender)\b",
    re.IGNORECASE,
)
_LEDGER_ADDRESS_RE = re.compile(
    r"\b\d{6}\b|\b(?:Road|Street|Lane|Nagar|Marg|Colony|Sector|Plot|Flat|House|Building|Park|"
    r"Floor|Block|Society|Premises|Office)\b",
    re.IGNORECASE,
)
_LEDGER_FIGURE_RE = re.compile(
    r"(?:(?:INR|Rs\.?|₹)\s*[\d,]+(?:\.\d+)?(?:/-)?)"           # money
    r"|(?:\b\d{1,2}[-/ ][A-Za-z]{3,9}[-/ ]\d{2,4}\b)"           # 04 June 2025
    r"|(?:\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b)"                 # 04/06/2025
    r"|(?:\b\d{1,3}(?:\.\d+)?\s*%)"                             # 18%
)
_LEDGER_ENTITY_RE = re.compile(
    r"\b((?:[A-Z][\w&.'-]+\s+){1,6}(?:Private\s+Limited|Limited|Ltd\.?|LLP|Pvt\.?\s*Ltd\.?|"
    r"Corporation|Company|Enterprises|Industries|Solutions|Technologies|Infotech))\b"
)
_LEDGER_PERSON_RE = re.compile(
    r"\b((?:Mr|Mrs|Ms|Shri|Smt|Dr)\.?\s+[A-Z][\w'-]+(?:\s+[A-Z][\w'-]+){0,3})\b"
)
# "Landlord: Ramesh Krishnarao Desai" / "- Plaintiff: Nexora Infotech ..." — how a fact matrix
# actually states parties. Neither the corporate nor the honorific pattern catches this.
_LEDGER_LABELLED_RE = re.compile(r"^(?P<label>[A-Za-z][\w /&()'-]{2,40}?)\s*[:=]\s*(?P<value>\S.*)$")
_LEDGER_PARTY_LABEL_RE = re.compile(
    r"\b(?:Plaintiff|Defendant|Petitioner|Respondent|Appellant|Applicant|Landlord|Lessor|Tenant|"
    r"Lessee|Complainant|Accused|Claimant|Vendor|Purchaser|Borrower|Lender|Party|Parties|Name|"
    r"Deponent|Owner|Witness)\b",
    re.IGNORECASE,
)


def _harvest_ledger_facts(fact_inventory: str) -> list[dict]:
    """Deterministically pull the repeat-prone facts out of the fact matrix."""
    text = fact_inventory or ""
    facts: list[dict] = []
    seen: set[str] = set()

    def add(value: str, kind: str) -> None:
        v = _norm_ws(value).strip(" .,;:")
        if len(v) < 4 or v.lower() in seen:
            return
        seen.add(v.lower())
        facts.append({"value": v, "kind": kind})

    for m in _LEDGER_ENTITY_RE.finditer(text):
        add(m.group(1), "entity")
    for m in _LEDGER_PERSON_RE.finditer(text):
        add(m.group(1), "person")
    for m in _LEDGER_FIGURE_RE.finditer(text):
        add(m.group(0), "figure")

    for raw in text.split("\n"):
        line = _norm_ws(raw).strip(" -*•")
        # Addresses: whole inventory lines that look like one.
        if 24 <= len(line) <= 180 and _LEDGER_ADDRESS_RE.search(line) and any(c.isdigit() for c in line):
            add(line, "address")
        # LABELLED PARTY LINES. The corporate/honorific patterns above miss the most common
        # Indian form entirely — "Landlord: Ramesh Krishnarao Desai" has no "Private Limited"
        # and no "Mr.". The fact matrix states parties as labelled values, so read them there.
        m = _LEDGER_LABELLED_RE.match(line)
        if m:
            label, value = m.group("label"), _norm_ws(m.group("value"))
            if _LEDGER_PARTY_LABEL_RE.search(label) and 3 <= len(value) <= 120:
                # Take the name, not the whole descriptive clause after it.
                add(re.split(r"\s+(?:S/o|D/o|W/o|aged|residing|having|a\s+private|,)", value)[0], "person")
    return facts


_LEDGER_AGENT_RE = re.compile(
    r"\b(?:Director|Manager|authoris|authoriz|represent|deponent|partner|proprietor|"
    r"signator|constituted\s+attorney)\w*", re.IGNORECASE,
)


def _short_form(fact: dict, drafted_before: str) -> str:
    """How a later section should refer back to a fact already stated in full.

    Role resolution looks FORWARD first. An Indian pleading puts the procedural role label AFTER
    the party's description ("Aarav Retail Solutions Private Limited, having its office at …
    …Defendant"), so a window centred on the name and extending backwards picks up the PREVIOUS
    party's label — which labelled the Defendant "the Plaintiff".
    """
    kind = fact["kind"]
    if kind in ("entity", "person"):
        low = drafted_before.lower()
        val = fact["value"].lower()
        pos = low.find(val[:28])
        if pos >= 0:
            end = pos + len(val)
            after = drafted_before[end: end + 240]
            # A natural person described as a Director / authorised representative is NOT a party.
            if kind == "person" and _LEDGER_AGENT_RE.search(drafted_before[max(0, pos - 80): end + 120]):
                return "the authorised representative"
            roles_after = _LEDGER_ROLE_RE.findall(after)
            if roles_after:
                return f"the {roles_after[0].capitalize()}"
            before = drafted_before[max(0, pos - 220): pos]
            roles_before = _LEDGER_ROLE_RE.findall(before)
            if roles_before:
                return f"the {roles_before[-1].capitalize()}"   # nearest preceding, not the first
        return "as described above"
    if kind == "address":
        return "the said premises / address (already set out above)"
    return ""


def build_evidence_ledger(
    fact_inventory: str,
    drafted: list[str],
    sections: list[TemplateSection],
    upto: int,
) -> str:
    """Compact anti-repetition brief for the section about to be drafted.

    Lists (a) the sections already written, (b) the identities/addresses already stated in FULL
    and the short form to use from now on, and (c) the figures that may legitimately recur.
    """
    prior = "\n\n".join(drafted[j] for j in range(upto) if (drafted[j] or "").strip())
    if not prior.strip():
        return ""
    prior_lower = prior.lower()

    done = [
        f"{j + 1}. {sections[j].heading}"
        for j in range(upto)
        if (drafted[j] or "").strip() and j < len(sections)
    ]

    stated_full: list[str] = []
    repeatable: list[str] = []
    for fact in _harvest_ledger_facts(fact_inventory):
        val = fact["value"]
        if val.lower()[:40] not in prior_lower:
            continue  # not yet used — the upcoming section may introduce it in full
        if fact["kind"] == "figure":
            repeatable.append(val)
            continue
        sf = _short_form(fact, prior)
        stated_full.append(f'- "{val[:110]}" → already stated in full; refer to it as "{sf}"')

    if not stated_full and not repeatable:
        return ""

    parts = ["\n=== EVIDENCE LEDGER — what THIS document has already said ===",
             "Continue the document; do NOT restate what is below."]
    if done:
        parts.append("Sections already drafted: " + "; ".join(done[:40]))
    if stated_full:
        parts.append(
            "\nAlready stated IN FULL (do NOT repeat the full description — use the short form):\n"
            + "\n".join(stated_full[:24])
        )
    if repeatable:
        parts.append(
            "\nFigures already used. They MAY be repeated where operationally necessary "
            "(an amount in a payment clause, a date in a limitation plea) — but do not "
            "re-narrate the surrounding facts:\n  " + ", ".join(sorted(set(repeatable))[:24])
        )
    parts.append("")
    return "\n".join(parts)


# ───────────────────────── Stage C: section drafting ────────────────────────
# Template coverage checklist: gives weak models a deterministic contract for each
# section, so they cannot silently skip template clauses/fields inside a large source span.
_CHECKLIST_LINE_RE = re.compile(
    r"^(?:\s*(?:\d{1,2}[.)]|[A-Z][.)])\s+|\s*[A-Z][A-Z\s/&()\-.]{3,}:?\s*$|.*(?:_{4,}|\[[^\]]{2,}\]|strike out|whichever is applicable|as applicable|if any|Bank|A/c|Account|IFSC|UPI|Aadhaar|PAN|Witness|Signature|Address|Date|Place).*)",
    re.IGNORECASE,
)
_LABEL_SLOT_RE = re.compile(
    r"\b(?:Bank(?:\s+Name)?|A/c\s+No\.?|Account\s+Number|IFSC(?:\s+Code)?|UPI\s+ID|Aadhaar\s+No\.?|PAN\s+No\.?|Witness\s+Name|Signature|Address|Date|Place|Name|Rent|Deposit|Notice\s+Period|Term|Start\s+Date|End\s+Date)\b",
    re.IGNORECASE,
)


def _template_coverage_checklist(section: TemplateSection) -> str:
    """Deterministic mini-contract telling the drafter what the template requires."""
    items: list[str] = []
    if section.heading:
        items.append(f"Section heading/order: {section.heading}")
    if section.contains_table:
        cols = " | ".join(section.table_header) if section.table_header else "same columns as the template"
        items.append(f"Render exactly one table with columns: {cols}; no duplicate table and no example rows")

    for raw in (section.original_text or "").splitlines():
        line = _norm_ws(raw)
        if not line:
            continue
        if len(line) > 220:
            labels = sorted({_norm_ws(m.group(0)) for m in _LABEL_SLOT_RE.finditer(line)})
            if labels:
                line = f"Resolve fields in this template line: {', '.join(labels)}"
            elif not re.match(r"^\d{1,2}[.)]\s+", line):
                continue
        if _CHECKLIST_LINE_RE.match(line):
            items.append(line[:220])

    if section.placeholders:
        items.append("Placeholders to resolve or red-placeholder: " + ", ".join(section.placeholders[:20]))

    seen: set[str] = set()
    out: list[str] = []
    for item in items:
        key = _norm_ws(item).lower()
        if key and key not in seen:
            seen.add(key)
            out.append(item)
        if len(out) >= 50:
            break
    return "\n".join(f"- {item}" for item in out) or "- Preserve every line and slot from the template section."


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
    ledger: str | None = None,
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
            chunks: list[dict] = []
            for q in _section_retrieval_queries(section):
                chunks.extend(retrieve_fn(q, _SECTION_TOP_K) or [])
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
        measured = (section.typography or {}).get("table")
        grid = measured if isinstance(measured, dict) else None
        if grid and grid.get("header") and grid.get("rows"):
            # We recovered the template's ACTUAL grid from its ruling lines, so the drafter is
            # given the table verbatim rather than asked to invent one from the fact inventory.
            # A schedule like LIST OF DOCUMENTS is template-owned: its rows are fixed, and its
            # empty "Original / Copy" columns are blanks the advocate fills by hand — telling the
            # model to "never leave a cell blank" (the old hint) is what turned these into
            # invented flat lists.
            hdr = [str(c or "") for c in grid["header"]]
            body = [[str(c or "") for c in r] for r in grid["rows"]]
            rendered = "\n".join(
                ["| " + " | ".join(hdr) + " |",
                 "| " + " | ".join("---" for _ in hdr) + " |"]
                + ["| " + " | ".join(_escape_table_cell(c) for c in r) + " |" for r in body]
            )
            table_hint = (
                "\nThis section IS A TABLE in the template. Its exact grid was measured from the "
                "template itself — reproduce it as a markdown table:\n\n"
                f"{rendered}\n\n"
                "TABLE RULES:\n"
                "- Reproduce EVERY row and EVERY column above, in the same order. Do NOT turn it "
                "into a numbered list, do not drop columns, do not add or remove rows.\n"
                "- Fill a cell ONLY where the case documents supply that value.\n"
                "- A cell the template leaves EMPTY stays empty unless the documents fill it — "
                "those are blanks the advocate completes by hand. Do NOT invent content for them.\n"
                "- Keep the section's heading line above the table.\n"
            )
        else:
            table_hint = (
                f"\nThis section is a TABLE. Output a markdown table with columns: {cols}. "
                "Add ONE ROW PER RELEVANT FACT from the inventory, in order. Leave a cell empty "
                "only when the template itself leaves it blank.\n"
            )
    typo = section.typography or {}
    layout_hint = ""
    if typo:
        # A packed drafting unit carries each merged part's own measured layout — render the
        # map so a centered title, a right-aligned label and a justified clause sharing one
        # unit each keep their individual alignment/bold in the draft.
        _tparts = [p for p in (typo.get("parts") or []) if isinstance(p, dict)]
        _part_lines = "".join(
            f"  • '{p.get('heading', '')}' → alignment={p.get('alignment', 'justify')}, "
            f"bold={'yes' if p.get('bold') else 'no'}, level={p.get('level', 0)}\n"
            for p in _tparts[:10]
        )
        _line_entries = [p for p in (typo.get("lines") or []) if isinstance(p, dict)]
        _line_lines = "".join(
            f"  • '{p.get('text', '')[:90]}' → alignment={p.get('alignment', 'left')}, "
            f"bold={'yes' if p.get('bold') else 'no'}, level={p.get('level', 0)}\n"
            for p in _line_entries[:16]
        )
        layout_hint = (
            f"\nMEASURED LAYOUT (from the template itself): alignment={typo.get('alignment', 'justify')}, "
            f"bold={'yes' if typo.get('bold') else 'no'}, heading_level={typo.get('level', 0)}. "
            "This measured template layout is authoritative: do NOT center a clause or lead-in unless "
            "the matching template line below says alignment=center. Keep each mapped line on its own line.\n"
            + (
                "This block packs several template parts — each keeps ITS OWN measured layout:\n"
                + _part_lines
                if _part_lines else ""
            )
            + (
                "Measured template line layout map:\n" + _line_lines
                if _line_lines else ""
            )
        )
    correction_hint = ""
    if correction:
        correction_hint = (
            "\nCORRECTION REQUIRED — a guardian audit flagged this section. Fix ONLY the "
            "specific grounding/format issues below. Preserve all supported facts, numbering, "
            "and template layout:\n"
            f"{correction}\n"
        )
    # Anti-repetition context. The EVIDENCE LEDGER (a compact statement of what has already been
    # said and how to refer back to it) replaces the old approach of pasting every previously
    # drafted section into every prompt — which grew quadratically and dominated the input-token
    # bill. A short verbatim TAIL of the immediately preceding text is still included so the
    # section has local continuity (clause numbering, an unfinished enumeration).
    prior_block = ""
    _pd = (prior_drafts or "").strip()
    if ledger and ledger.strip():
        prior_block = ledger
        if _pd:
            prior_block += (
                "\n=== IMMEDIATELY PRECEDING TEXT (for continuity only — do NOT repeat it) ===\n"
                + _pd[-_PRIOR_TAIL_CHAR_CAP:]
                + "\n"
            )
    elif _pd:
        prior_block = (
            "\n=== ALREADY-DRAFTED EARLIER SECTIONS (context — do NOT repeat their content) ===\n"
            "The following text has ALREADY been written earlier in THIS document. Do NOT restate, "
            "re-introduce parties, or re-narrate facts already covered here. Draft ONLY the new "
            "section below, continuing from this — reference earlier clauses by number if needed, "
            "never duplicate them.\n" + _pd[-_PRIOR_DRAFTS_CHAR_CAP:] + "\n"
        )
    fmt = section.original_text.strip() or f"(heading only) {section.heading}"
    checklist = _template_coverage_checklist(section)
    prompt = (
        f"{DRAFTING_SYSTEM_PROMPT}\n\n"
        + (f"DOCUMENT: {doc_title}\n\n" if doc_title else "")
        + prior_block
        + f"\n=== TEMPLATE SECTION (FORMAT AUTHORITY — reproduce its structure, replace its content) ===\n"
        f"Heading: {section.heading}\n{fmt}\n"
        + f"\n=== MANDATORY TEMPLATE COVERAGE CHECKLIST ===\n{checklist}\n"
        + table_hint
        + layout_hint
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
    return normalize_drafted_markdown(
        _strip_fences(out or ""),
        section_heading=section.heading,
        source_text=f"{inv}\n{evidence}",
    ).strip()


def _strip_fences(text: str) -> str:
    t = text.strip()
    if t.startswith("```"):
        t = re.sub(r"^```[a-zA-Z]*\s*", "", t)
        t = re.sub(r"\s*```$", "", t)
    return t


_EXECUTION_LABEL_START_RE = re.compile(
    r"(?:^|\s+)(?P<label>"
    r"(?:(?:LANDLORD\s*/\s*LESSOR|TENANT\s*/\s*LESSEE|LICENSOR|LICENSEE|"
    r"LESSOR|LESSEE|VENDOR|PURCHASER)\s+)?Signature|"
    r"Witness\s+Name|ID\s+Proof\s+No\.?|PAN\s+No\.?|Aadhaar\s+No\.?|"
    r"Name|Date|Place|Address"
    r")\s*:",
    re.IGNORECASE,
)
_EXECUTION_CONTEXT_RE = re.compile(
    r"\b(?:IN\s+WITNESS\s+WHEREOF|SIGNED|EXECUTED|WITNESSES?|SIGNATURE|"
    r"LANDLORD|LESSOR|TENANT|LESSEE|LICENSOR|LICENSEE|VENDOR|PURCHASER|"
    r"WITNESS\s+NAME|ID\s+PROOF\s+NO\.?|PAN\s+NO\.?|AADHAAR\s+NO\.?|"
    r"PLACE\s*:|DATE\s*:|ADDRESS\s*:)\b",
    re.IGNORECASE,
)
_MD_HR_LINE_RE = re.compile(r"^\s*([-*_])(\s*\1){2,}\s*$")
_INSTRUCTIONAL_PAREN_RE = re.compile(
    r"\((?=[^)]{0,500}\b(?:e\.g\.|for example|list all|attach|insert|specify|"
    r"mention|whichever is applicable|strike out|as applicable|if any|delete as applicable|"
    r"provide details|fill in)\b)[^)]{0,700}\)",
    re.IGNORECASE | re.DOTALL,
)
_INSTRUCTIONAL_LINE_RE = re.compile(
    r"^\s*(?:[-*]\s*)?\(?\s*(?:list all|attach|insert|specify|mention|"
    r"provide details|fill in|strike out|delete as applicable|delete whichever|"
    r"select whichever)\b",
    re.IGNORECASE,
)


def _red_placeholder(label: str) -> str:
    clean = re.sub(r"\s+", " ", (label or "DETAILS FROM SUPPORTING DOCUMENTS").strip().upper())
    return f'<span style="color:red;font-weight:bold;">[________ {clean} ________]</span>'


def _is_markdown_table_row(line: str) -> bool:
    s = (line or "").strip()
    return s.startswith("|") and s.endswith("|") and s.count("|") >= 2


def _is_markdown_table_separator(line: str) -> bool:
    s = (line or "").strip()
    return bool(s.startswith("|") and re.fullmatch(r"\|?[\s:\-|]+\|?", s))


_UNRESOLVED_BRACKET_SLOT_RE = re.compile(
    r"\[\s*(?P<label>(?:BANK\s+NAME|ACCOUNT\s+NUMBER|A/C\s+NO\.?|IFSC\s+CODE|UPI\s+ID|AADHAAR\s+NO\.?|PAN\s+NO\.?|EMAIL|CONTACT\s+NO\.?|NOTICE\s+HOURS|RENEWAL\s+MONTHS|RENEWAL\s+NOTICE\s+DAYS)[^\]]*)\s*\]",
    re.IGNORECASE,
)
_FAKE_MASKED_VALUE_RE = re.compile(
    r"\b(?:X{2,}[-\s]?X{2,}[-\s]?\d{2,}|98X{6,}|example@example\.com|"
    r"(?:ABCDE|VWXYZ|AAAAA|BBBBB|XXXXX)\d{4}[A-Z])\b",
    re.IGNORECASE,
)
_DRAFT_METADATA_LABEL_RE = re.compile(
    r"^\s*(?:#{1,6}\s*)?(?:\*\*)?\s*(?:"
    r"Heading\s*:\s*(?P<heading>.+?)|"
    r"(?:(?:Landlord|Tenant|Witness(?:es)?|Signature|Inventory)\s+Block)|"
    r"Testimonium|Agreement\s+Introduction|Landlord\s+Details|Tenant\s+Details|"
    r"Parties\s+Definition|Recital\s+\d+"
    r")\s*(?:\*\*)?\s*$",
    re.IGNORECASE,
)


def _slot_label_from_text(text: str) -> str:
    label = re.sub(r"[^A-Za-z0-9/& ]+", " ", text or "").strip()
    label = re.sub(r"\s+", " ", label).upper()
    return label or "DETAILS FROM SUPPORTING DOCUMENTS"


def _replace_unresolved_slots(line: str, source_lower: str = "") -> str:
    if _is_markdown_table_separator(line):
        return line
    line = _UNRESOLVED_BRACKET_SLOT_RE.sub(lambda m: _red_placeholder(_slot_label_from_text(m.group("label"))), line)

    def _mask_repl(m: re.Match) -> str:
        # EVIDENCE-AWARE: a masked-looking value that appears in the SOURCES is the
        # source's own (test/dummy) value — "Aadhaar No. (Dummy): XXXX-XXXX-7890" — and
        # must be KEPT verbatim. Only a masked value ABSENT from the sources is a
        # model-invented sample → red placeholder. (An unconditional scrub here was
        # destroying real source values and re-destroying Stage-E recoveries.)
        if source_lower and m.group(0).lower() in source_lower:
            return m.group(0)
        return _red_placeholder("EXACT VALUE FROM SUPPORTING DOCUMENTS")

    return _FAKE_MASKED_VALUE_RE.sub(_mask_repl, line)


_STRIKETHROUGH_RE = re.compile(r"~~[^~\n]{1,120}~~")


def _strip_strikethrough(line: str) -> str:
    """Rejected template options must be DELETED, not struck through — remove any
    ~~strikethrough~~ remnants a model leaves ("Mr. ~~Mrs./Ms.~~ Ramesh",
    "(Carpet~~/Built-up~~ area)") and tidy the separators they leave behind."""
    if "~~" not in (line or ""):
        return line
    out = _STRIKETHROUGH_RE.sub(" ", line)
    out = re.sub(r"\(\s*/\s*", "(", out)          # "( /Built-up area)" → "(Built-up area)"
    out = re.sub(r"\s*/\s*(?=[),.;:])", "", out)  # "Carpet / )" → "Carpet)"
    out = re.sub(r"\s{2,}", " ", out)
    out = re.sub(r"\s+([),.;:])", r"\1", out)
    return out.rstrip()


def _strip_draft_metadata_label(line: str) -> str | None:
    """Drop analysis/helper labels that weak models sometimes copy into the draft."""
    if _is_markdown_table_row(line) or _is_markdown_table_separator(line):
        return line
    m = _DRAFT_METADATA_LABEL_RE.match(line or "")
    if not m:
        return line
    heading = (m.group("heading") or "").strip()
    if not heading:
        return None
    # "Heading: RENT ESCALATION" is metadata only when the clause itself follows on
    # another line. Keep inline clause text if the model fused it after the label.
    if re.search(r"\b\d{1,2}[.)]\s+\S", heading):
        return heading
    return None


def _instruction_placeholder(text: str) -> str:
    low = (text or "").lower()
    if any(w in low for w in ("inventory", "item", "fitting", "fixture", "furniture", "geyser", "wardrobe", "annexure")):
        return _red_placeholder("INVENTORY ITEMS")
    if any(w in low for w in ("document", "exhibit", "photograph", "attachment")):
        return _red_placeholder("SUPPORTING DOCUMENT DETAILS")
    return _red_placeholder("DETAILS FROM SUPPORTING DOCUMENTS")


def _replace_instructional_leaks(line: str) -> str:
    if _is_markdown_table_row(line) or _is_markdown_table_separator(line):
        return line
    replaced = _INSTRUCTIONAL_PAREN_RE.sub(lambda m: _instruction_placeholder(m.group(0)), line)
    if _INSTRUCTIONAL_LINE_RE.search(replaced):
        return _instruction_placeholder(replaced)
    return replaced


def _split_crammed_execution_line(line: str) -> list[str]:
    if _is_markdown_table_row(line) or _is_markdown_table_separator(line):
        return [line]
    compact = re.sub(r"[ \t]+", " ", (line or "").strip())
    if not compact:
        return [line]
    matches = list(_EXECUTION_LABEL_START_RE.finditer(compact))
    if len(matches) < 2:
        return [line]
    # Do not split ordinary prose that happens to contain two labels unless it looks
    # like an execution/signature block.
    if not _EXECUTION_CONTEXT_RE.search(compact):
        return [line]
    starts = [m.start("label") for m in matches]
    starts[0] = 0 if starts[0] > 0 else starts[0]
    parts: list[str] = []
    for idx, start in enumerate(starts):
        end = starts[idx + 1] if idx + 1 < len(starts) else len(compact)
        part = compact[start:end].strip()
        if part:
            parts.append(part)
    return parts if len(parts) > 1 else [line]


def _nearest_nonblank(lines: list[str], start: int, step: int) -> str:
    i = start
    while 0 <= i < len(lines):
        if lines[i].strip():
            return lines[i].strip()
        i += step
    return ""


def _is_execution_context(line: str) -> bool:
    if not line:
        return False
    return bool(_EXECUTION_CONTEXT_RE.search(line) or _EXECUTION_LABEL_START_RE.search(line))


def _boundary_plain(line: str) -> str:
    plain = re.sub(r"^#{1,6}\s*", "", (line or "").strip())
    plain = plain.replace("**", "").strip()
    plain = re.sub(r"\s+", " ", plain)
    return plain.strip(" :-")


def _looks_like_boundary_heading(line: str) -> bool:
    plain = _boundary_plain(line)
    if not plain or _is_markdown_table_row(plain) or _is_markdown_table_separator(plain):
        return False
    up = plain.upper()
    if up.startswith((
        "ANNEXURE", "SCHEDULE", "WITNESSES", "SIGNATURES", "RENEWAL", "TERMINATION",
        "IN WITNESS", "FORCE MAJEURE", "DISPUTE RESOLUTION", "ENTIRE AGREEMENT",
        "INVENTORY", "PAYMENT", "RENT", "SECURITY DEPOSIT", "MAINTENANCE",
    )):
        return True
    letters = [c for c in plain if c.isalpha()]
    if 3 <= len(letters) and len(plain) <= 120:
        upper_ratio = sum(1 for c in letters if c.isupper()) / len(letters)
        if upper_ratio >= 0.78:
            return True
    return False


def _section_boundary_aliases(section: TemplateSection) -> list[str]:
    aliases: list[str] = []
    if (section.heading or "").strip():
        aliases.append(_boundary_plain(section.heading))
    scanned = 0
    for raw in (section.original_text or "").splitlines():
        plain = _boundary_plain(raw)
        if not plain:
            continue
        scanned += 1
        if _looks_like_boundary_heading(plain):
            aliases.append(plain)
        if scanned >= 12:
            break
    seen: set[str] = set()
    out: list[str] = []
    for a in aliases:
        key = _norm_ws(a).lower()
        if len(key) >= 3 and key not in seen:
            seen.add(key)
            out.append(a)
    return out


def _matches_boundary_alias(line: str, alias: str) -> bool:
    plain = _norm_ws(_boundary_plain(line)).lower()
    target = _norm_ws(alias).lower()
    if not plain or not target:
        return False
    if plain == target:
        return True
    if len(target) >= 16 and (plain.startswith(target) or target.startswith(plain)):
        return True
    return False


def trim_leaked_future_sections(markdown: str, sections: list[TemplateSection], current_index: int) -> str:
    """Remove content that belongs to later template sections from this section draft."""
    if not markdown or current_index >= len(sections) - 1:
        return (markdown or "").strip()
    aliases: list[str] = []
    for future in sections[current_index + 1:]:
        aliases.extend(_section_boundary_aliases(future))
        if len(aliases) >= 48:
            break
    if not aliases:
        return markdown.strip()
    lines = markdown.split("\n")
    cut_at: int | None = None
    for i, line in enumerate(lines):
        if _is_markdown_table_row(line) or _is_markdown_table_separator(line):
            continue
        if any(_matches_boundary_alias(line, alias) for alias in aliases):
            cut_at = i
            break
    if cut_at is None:
        return markdown.strip()
    return "\n".join(lines[:cut_at]).strip()


def _table_row_cells(line: str) -> list[str]:
    return [c.strip() for c in (line or "").strip().strip("|").split("|")]


def _table_fingerprint(rows: list[str]) -> str:
    data_rows = [r for r in rows if _is_markdown_table_row(r) and not _is_markdown_table_separator(r)]
    if len(data_rows) < 4:
        return ""
    body_rows = data_rows[1:]
    normalized_rows: list[str] = []
    for row in body_rows:
        cells = [re.sub(r"\s+", " ", c).strip().lower() for c in _table_row_cells(row)]
        if cells and re.fullmatch(r"\d+\.?", cells[0]):
            cells = cells[1:]
        normalized_rows.append("|".join(cells))
    return "\n".join(normalized_rows)


def _table_body_overlap(rows_a: list[str], rows_b: list[str]) -> float:
    def body_set(rows: list[str]) -> set[str]:
        data_rows = [r for r in rows if _is_markdown_table_row(r) and not _is_markdown_table_separator(r)]
        out: set[str] = set()
        for row in data_rows[1:]:
            cells = [re.sub(r"\s+", " ", c).strip().lower() for c in _table_row_cells(row)]
            if cells and re.fullmatch(r"\d+\.?", cells[0]):
                cells = cells[1:]
            key = "|".join(cells)
            if key:
                out.add(key)
        return out

    a = body_set(rows_a)
    b = body_set(rows_b)
    if len(a) < 4 or len(b) < 4:
        return 0.0
    return len(a & b) / max(1, min(len(a), len(b)))


def _table_key_overlap(rows_a: list[str], rows_b: list[str]) -> float:
    """Overlap of just the KEY column (first content cell after the serial — the item /
    description identifier). This catches the SAME data re-tabulated with DIFFERENT columns
    or cell formatting — e.g. an inventory drafted once as `Item | Quantity/Details` and
    again as `Item Description | Quantity | Condition`. `_table_body_overlap` misses that
    (the full-row keys differ: `ceiling fan|4 (good)` vs `ceiling fan|4|good`), so it is
    used with a HIGH threshold to avoid collapsing genuinely different tables that merely
    share a few first-column values."""
    def key_set(rows: list[str]) -> set[str]:
        data_rows = [r for r in rows if _is_markdown_table_row(r) and not _is_markdown_table_separator(r)]
        out: set[str] = set()
        for row in data_rows[1:]:   # skip header
            cells = [re.sub(r"\s+", " ", c).strip().lower() for c in _table_row_cells(row)]
            if cells and re.fullmatch(r"\d+\.?", cells[0]):
                cells = cells[1:]
            if cells and cells[0]:
                out.add(cells[0])
        return out

    a = key_set(rows_a)
    b = key_set(rows_b)
    if len(a) < 4 or len(b) < 4:
        return 0.0
    return len(a & b) / max(1, min(len(a), len(b)))


def _looks_like_table_caption(line: str) -> bool:
    plain = _boundary_plain(line)
    low = plain.lower()
    if not plain or _is_markdown_table_row(plain):
        return False
    if any(word in low for word in ("table", "inventory", "annexure", "schedule", "list of")):
        return True
    return _looks_like_boundary_heading(plain)


def _dedupe_repeated_markdown_tables(markdown: str) -> str:
    lines = markdown.split("\n")
    out: list[str] = []
    seen: set[str] = set()
    seen_blocks: list[list[str]] = []
    i = 0
    while i < len(lines):
        if not _is_markdown_table_row(lines[i]):
            out.append(lines[i])
            i += 1
            continue
        block: list[str] = []
        j = i
        while j < len(lines) and (_is_markdown_table_row(lines[j]) or _is_markdown_table_separator(lines[j])):
            block.append(lines[j])
            j += 1
        fp = _table_fingerprint(block)
        overlaps_seen = any(
            _table_body_overlap(block, prior) >= 0.82 or _table_key_overlap(block, prior) >= 0.9
            for prior in seen_blocks
        )
        if (fp and fp in seen) or overlaps_seen:
            while out and not out[-1].strip():
                out.pop()
            if out and _looks_like_table_caption(out[-1]):
                out.pop()
                while out and not out[-1].strip():
                    out.pop()
            i = j
            continue
        if fp:
            seen.add(fp)
            seen_blocks.append(block)
        out.extend(block)
        i = j
    return "\n".join(out).strip()


def _escape_table_cell(text: str) -> str:
    return (text or "").replace("|", "\\|").strip()


def _extract_table_blocks(markdown: str) -> list[list[str]]:
    """All contiguous markdown-table blocks in a text, as lists of raw lines."""
    lines = (markdown or "").split("\n")
    blocks: list[list[str]] = []
    i = 0
    while i < len(lines):
        if not _is_markdown_table_row(lines[i]):
            i += 1
            continue
        block: list[str] = []
        while i < len(lines) and (_is_markdown_table_row(lines[i]) or _is_markdown_table_separator(lines[i])):
            block.append(lines[i])
            i += 1
        blocks.append(block)
    return blocks


def dedupe_tables_against_prior(markdown: str, prior_markdowns: list[str]) -> str:
    """Remove any table in `markdown` that duplicates a table already drafted in an
    EARLIER section — the "Annexure-A inventory appears twice" failure, where Stage A
    yields both an annexure-heading section and a standalone table section and BOTH
    draft the same table. The FIRST occurrence (already streamed) is kept; the later
    copy (and its caption line) is dropped."""
    prior_blocks = [b for pm in (prior_markdowns or []) for b in _extract_table_blocks(pm)]
    prior_blocks = [b for b in prior_blocks if _table_fingerprint(b)]
    if not prior_blocks or not (markdown or "").strip():
        return (markdown or "").strip()
    prior_fps = {_table_fingerprint(b) for b in prior_blocks}
    lines = markdown.split("\n")
    out: list[str] = []
    i = 0
    while i < len(lines):
        if not _is_markdown_table_row(lines[i]):
            out.append(lines[i])
            i += 1
            continue
        block: list[str] = []
        j = i
        while j < len(lines) and (_is_markdown_table_row(lines[j]) or _is_markdown_table_separator(lines[j])):
            block.append(lines[j])
            j += 1
        fp = _table_fingerprint(block)
        dup = (fp and fp in prior_fps) or any(
            _table_body_overlap(block, p) >= 0.82 or _table_key_overlap(block, p) >= 0.9
            for p in prior_blocks
        )
        if dup:
            while out and not out[-1].strip():
                out.pop()
            if out and _looks_like_table_caption(out[-1]):
                out.pop()
                while out and not out[-1].strip():
                    out.pop()
            i = j
            continue
        out.extend(block)
        i = j
    return "\n".join(out).strip()


def _witness_block_end(lines: list[str], start: int) -> int:
    end = start + 1
    allowed = re.compile(r"^(address|id\s+proof\s+no\.?|pan\s+no\.?|aadhaar\s+no\.?|signature)\s*:", re.IGNORECASE)
    while end < len(lines):
        stripped = lines[end].strip()
        if not stripped:
            end += 1
            continue
        if re.match(r"^witness\s+name\s*:", stripped, re.IGNORECASE):
            break
        if allowed.match(stripped):
            end += 1
            continue
        break
    return end


_ALLCAPS_EXCLUDE_RE = re.compile(r"^\s*IN THE MATTER OF\b", re.IGNORECASE)

# "PRAYER The Plaintiff therefore prays…" — a part heading fused onto the first body
# sentence. Split the heading onto its own line. The heading must be short ALL-CAPS and
# the remainder must start like a sentence (title-case starter), so all-caps prose lines
# ("AND FOR THIS ACT OF KINDNESS, THE PLAINTIFF …") never match.
_FUSED_HEADING_RE = re.compile(
    r"^(?P<h>[A-Z][A-Z\s./&-]{2,38}?)\s+(?P<rest>(?:The|This|That|These|Those|It|In|If|I|We)[,\s].+)$"
)


def _split_fused_heading(line: str) -> list[str]:
    s = (line or "").strip()
    if not s or len(s) > 400 or s.startswith(("|", "#")) or "**" in s:
        return [line]
    m = _FUSED_HEADING_RE.match(s)
    if not m:
        return [line]
    h = m.group("h").strip()
    letters = [c for c in h if c.isalpha()]
    if len(letters) < 4 or len(h.split()) > 4:
        return [line]
    if sum(1 for c in letters if c.isupper()) / len(letters) < 0.95:
        return [line]
    return [h, "", m.group("rest").strip()]


def _bold_allcaps_label(line: str) -> str:
    """PDF text extraction loses bold styling, so the drafter cannot see which template
    lines were bold. Restore standard drafting convention deterministically: a standalone
    ALL-CAPS heading/label line (SIGNATURES, LANDLORD / LESSOR, ANNEXURE-A: …, VERSUS)
    is bold in an Indian legal draft. Cause-title party lines ("IN THE MATTER OF"),
    blanks, tables, red placeholders and already-bold lines are left untouched."""
    s = (line or "").strip()
    if (not s or len(s) > 80 or "**" in s or "<span" in s or "____" in s
            or s.startswith(("|", "#")) or _ALLCAPS_EXCLUDE_RE.match(s)
            or _MD_HR_LINE_RE.match(s)):
        return line
    # Operative lead-in lines ("The Plaintiff above named states as follows:",
    # "…WITNESSETH AS FOLLOWS:") are conventionally bold even in mixed case.
    if s.lower().endswith("as follows:") and len(s) <= 100:
        return f"**{s}**"
    letters = [c for c in s if c.isalpha()]
    if len(letters) < 4:
        return line
    if sum(1 for c in letters if c.isupper()) / len(letters) < 0.85:
        return line
    return f"**{s}**"


_EXEC_FIELD_LINE_RE = re.compile(
    r"^(?:signature|name|date|place|address|id\s+proof\s+no\.?|pan\s+no\.?|"
    r"aadhaar\s+no\.?|contact\s+no\.?|email)\s*:",
    re.IGNORECASE,
)


def _party_role_header_at(lines: list[str], i: int) -> str | None:
    """A short standalone ALL-CAPS role line (LANDLORD / LESSOR, TENANT / LESSEE,
    LICENSOR, EMPLOYER …) whose next non-blank line is an execution field."""
    plain = _boundary_plain(lines[i])
    if not plain or len(plain) > 40 or "witness" in plain.lower():
        return None
    letters = [c for c in plain if c.isalpha()]
    if len(letters) < 4 or sum(1 for c in letters if c.isupper()) / len(letters) < 0.9:
        return None
    j = i + 1
    while j < len(lines) and not lines[j].strip():
        j += 1
    if j < len(lines) and _EXEC_FIELD_LINE_RE.match(lines[j].strip()):
        return plain
    return None


def _format_party_signature_blocks_as_columns(markdown: str) -> str:
    """Templates typically show the two signing parties SIDE-BY-SIDE (LANDLORD | TENANT);
    PDF extraction + the drafter linearize them vertically. When the text contains exactly
    TWO party sub-blocks of execution fields, restore the template's 2-column layout —
    the same treatment the witness block already gets."""
    if "signature" not in (markdown or "").lower():
        return (markdown or "").strip()
    lines = markdown.split("\n")
    headers = [(i, h) for i in range(len(lines)) if (h := _party_role_header_at(lines, i))]
    if len(headers) != 2:
        return markdown.strip()
    (h1, name1), (h2, name2) = headers

    def _block_end(start: int, stop: int) -> int:
        j = start + 1
        while j < stop:
            s = lines[j].strip()
            if not s or _EXEC_FIELD_LINE_RE.match(s) or re.fullmatch(r"_{3,}", s):
                j += 1
                continue
            break
        return j

    end1 = _block_end(h1, h2)
    end2 = _block_end(h2, len(lines))
    b1 = [l.strip() for l in lines[h1 + 1:end1] if l.strip()]
    b2 = [l.strip() for l in lines[h2 + 1:end2] if l.strip()]
    if not b1 or not b2:
        return markdown.strip()
    # Block 1 must flow directly into header 2 (only blanks between), and the region must
    # not already contain a table.
    if any(lines[j].strip() for j in range(end1, h2)):
        return markdown.strip()
    if any(_is_markdown_table_row(lines[j]) for j in range(h1, end2)):
        return markdown.strip()
    table = [
        f"| {_escape_table_cell(name1)} | {_escape_table_cell(name2)} |",
        "| --- | --- |",
        f"| {_escape_table_cell('<br>'.join(b1))} | {_escape_table_cell('<br>'.join(b2))} |",
    ]
    result = lines[:h1]
    if result and result[-1].strip():
        result.append("")
    result.extend(table)
    rest = lines[end2:]
    if rest:
        result.append("")
        result.extend(rest)
    return "\n".join(result).strip()


def _format_witness_blocks_as_columns(markdown: str, section_heading: str | None = None) -> str:
    context = f"{section_heading or ''}\n{markdown[:240]}".lower()
    if "witness" not in context:
        return markdown.strip()
    if re.search(r"^\s*\|\s*witness\s*1\s*\|\s*witness\s*2\s*\|", markdown, re.IGNORECASE | re.MULTILINE):
        return markdown.strip()
    lines = markdown.split("\n")
    starts = [i for i, line in enumerate(lines) if re.match(r"^\s*witness\s+name\s*:", line.strip(), re.IGNORECASE)]
    if len(starts) != 2:
        return markdown.strip()
    first_start, second_start = starts
    first_end = second_start
    second_end = _witness_block_end(lines, second_start)
    first_lines = [l.strip() for l in lines[first_start:first_end] if l.strip()]
    second_lines = [l.strip() for l in lines[second_start:second_end] if l.strip()]
    if not first_lines or not second_lines:
        return markdown.strip()
    prefix = lines[:first_start]
    suffix = lines[second_end:]
    table = [
        "| Witness 1 | Witness 2 |",
        "| --- | --- |",
        f"| {_escape_table_cell('<br>'.join(first_lines))} | {_escape_table_cell('<br>'.join(second_lines))} |",
    ]
    result = prefix
    if result and result[-1].strip():
        result.append("")
    result.extend(table)
    if suffix:
        result.append("")
        result.extend(suffix)
    return "\n".join(result).strip()


def _strip_echoed_heading(markdown: str, section: TemplateSection) -> str:
    """Drop a first line that merely echoes the ANALYZER's derived unit heading
    ("CLAUSE 29", "Statement of Truth Clause 4") when the template itself does not
    contain that heading text — the template is the format authority, and these derived
    labels must never surface in the filed draft."""
    lines = (markdown or "").split("\n")
    i = 0
    while i < len(lines) and not lines[i].strip():
        i += 1
    if i >= len(lines):
        return markdown
    first = _norm_ws(_boundary_plain(lines[i])).lower().strip(" :")
    head = _norm_ws(section.heading or "").lower().strip(" :")
    if not first or not head or first != head:
        return markdown
    if head in _norm_ws(section.original_text or "").lower():
        return markdown  # the template genuinely shows this heading — keep it
    del lines[i]
    return "\n".join(lines).strip()


_GENERATED_CLAUSE_PREFIX_RE = re.compile(
    r"^(?P<lead>\s*)(?:\*\*)?\s*Clause\s+(?P<num>\d{1,3})\s*:\s*"
    r"(?P<label>[A-Z][A-Z0-9 /&().,'-]{2,120})(?:\*\*)?\s*(?P<rest>.*)$",
    re.IGNORECASE,
)
_INLINE_DUP_CLAUSE_PREFIX_RE = re.compile(
    r"\bClause\s+(?P<num>\d{1,3})\s*:\s*[A-Z][A-Z0-9 /&().,'-]{2,120}?\s+(?=(?P=num)[.)]\s+)",
    re.IGNORECASE,
)
_INLINE_NUMBERED_CLAUSE_RE = re.compile(
    r"(?<=[.;])\s+(?P<clause>\d{1,3}[.)]\s+[A-Z][A-Z0-9 /&().,'-]{2,120}:)",
)


def _template_has_clause_prefix(section: TemplateSection, num: str) -> bool:
    text = _norm_ws(_boundary_plain(section.original_text or "")).lower()
    return bool(re.search(rf"\bclause\s+{re.escape(str(num))}\s*:", text, re.IGNORECASE))


def _remove_generated_clause_prefixes(markdown: str, section: TemplateSection) -> str:
    """Remove helper clause labels invented by the drafter/analyzer.

    If the template says "4. RENT ESCALATION:" the draft must not surface an extra
    "Clause 4:" label. If the template genuinely says "Clause 4:" we keep it.
    """
    raw_lines = (markdown or "").split("\n")
    out: list[str] = []
    for idx, raw in enumerate(raw_lines):
        line = raw
        if _is_markdown_table_row(line) or _is_markdown_table_separator(line):
            out.append(line)
            continue
        line = _INLINE_DUP_CLAUSE_PREFIX_RE.sub("", line)
        m = _GENERATED_CLAUSE_PREFIX_RE.match(line)
        if m and not _template_has_clause_prefix(section, m.group("num")):
            next_line = ""
            for later in raw_lines[idx + 1:]:
                if later.strip():
                    next_line = later.strip()
                    break
            label = _norm_ws(m.group("label") or "").strip(" :")
            if next_line and re.match(rf"^{re.escape(m.group('num'))}[.)]\s+", _boundary_plain(next_line)):
                # The actual numbered clause is already present next; drop only the fake heading.
                continue
            rest = (m.group("rest") or "").strip()
            if rest and re.match(rf"^{re.escape(m.group('num'))}[.)]\s+", rest):
                line = f"{m.group('lead')}{rest}"
            else:
                tail = f" {rest}" if rest else ""
                line = f"{m.group('lead')}{m.group('num')}. {label}{tail}".rstrip()
        line = _INLINE_NUMBERED_CLAUSE_RE.sub(lambda mm: "\n\n" + mm.group("clause"), line)
        out.extend(line.split("\n"))
    return "\n".join(out).strip()


def normalize_section_draft(markdown: str, sections: list[TemplateSection], index: int,
                            *, source_text: str = "") -> str:
    section_heading = sections[index].heading if 0 <= index < len(sections) else None
    if 0 <= index < len(sections):
        markdown = _strip_echoed_heading(markdown, sections[index])
        markdown = _remove_generated_clause_prefixes(markdown, sections[index])
    cleaned = normalize_drafted_markdown(markdown, section_heading=section_heading, source_text=source_text)
    cleaned = trim_leaked_future_sections(cleaned, sections, index)
    cleaned = normalize_drafted_markdown(cleaned, section_heading=section_heading, source_text=source_text)
    return cleaned.strip()


# A line that CONTINUES the previous one always starts lowercase (or with a conjunction /
# closing bracket). A new clause, heading, list item or table row never does — that asymmetry is
# what makes the re-join safe.
_CONTINUATION_START_RE = re.compile(r"^[a-z(\"'‘“]")
# Anything that unambiguously OPENS a new block, so it must never be swallowed into the line above.
_BLOCK_START_RE = re.compile(
    r"^\s*(?:[#>|]|[-*+]\s|\d{1,3}[.)]\s|[a-z][.)]\s|\(\w{1,3}\)\s|\*\*|__|`{3}|_{4,}|\[_{2,})",
    re.IGNORECASE,
)
# A line that ENDS a sentence/clause — the next line is a new thought, not a wrap.
_SENTENCE_END_RE = re.compile(r"[.;:!?…]\s*$|[.;:!?]\*{0,2}\s*$")


def _rejoin_wrapped_lines(markdown: str) -> str:
    """Re-join lines that a PDF hard-wrapped mid-sentence.

    PDF text extraction yields one line per VISUAL line, so a single justified paragraph arrives
    pre-broken:

        29. Without prejudice to the present suit, the Plaintiff reserves its
        right to initiate and/or pursue such other civil, criminal, contractual
        proceedings as may be available in law against the Defendant.

    The drafter faithfully reproduces those breaks, and every renderer then turns each line into
    its OWN paragraph — the mid-sentence fragmentation visible in the draft. Rejoin a line into
    the one above it only when the evidence is unambiguous: the previous line does not end a
    sentence, and this line starts lowercase (a new clause, heading, bullet, numbered item or
    table row never does). Blank lines, tables, lists and headings are left completely alone.
    """
    if not markdown or "\n" not in markdown:
        return markdown or ""

    out: list[str] = []
    in_fence = False
    for raw in markdown.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        line = raw.rstrip()
        stripped = line.strip()

        if stripped.startswith("```"):
            in_fence = not in_fence
            out.append(line)
            continue
        if in_fence or not stripped:
            out.append(line)
            continue

        prev = out[-1].rstrip() if out else ""
        prev_s = prev.strip()
        joinable = (
            bool(prev_s)                                   # there is a line to join onto
            and not _is_markdown_table_row(prev_s)         # never fuse table rows
            and not _is_markdown_table_row(stripped)
            and not _is_markdown_table_separator(prev_s)
            and not _BLOCK_START_RE.match(prev_s.lstrip("*_ "))  # prev isn't a heading/fence
            and not _BLOCK_START_RE.match(stripped)        # this line doesn't open a block
            and not _SENTENCE_END_RE.search(prev_s)        # prev didn't finish a sentence
            and _CONTINUATION_START_RE.match(stripped)     # this line reads as a continuation
        )
        # A numbered clause ("29. …") is a legitimate line to CONTINUE onto, even though it
        # opens a block itself — so allow it as the target of a join.
        if not joinable and prev_s and re.match(r"^\s*\d{1,3}[.)]\s", prev_s):
            joinable = (
                not _is_markdown_table_row(stripped)
                and not _BLOCK_START_RE.match(stripped)
                and not _SENTENCE_END_RE.search(prev_s)
                and bool(_CONTINUATION_START_RE.match(stripped))
            )
        if joinable:
            out[-1] = f"{prev} {stripped}"
        else:
            out.append(line)
    return "\n".join(out)


def normalize_drafted_markdown(markdown: str, *, section_heading: str | None = None,
                               source_text: str = "") -> str:
    """Make weak-model draft output model-agnostic before assembly/rendering.

    The LLM decides what content belongs in the section; this deterministic pass enforces
    the parts weak models commonly break: execution line structure, leaked template
    instructions, and stray markdown rules inside signature/witness blocks.

    source_text (fact inventory + retrieved evidence) makes the fake-value scrub
    EVIDENCE-AWARE: masked-looking values that genuinely appear in the sources are kept.
    """
    source_lower = (source_text or "").lower()
    markdown = _rejoin_wrapped_lines(markdown)
    lines = (markdown or "").replace("\r\n", "\n").replace("\r", "\n").split("\n")
    expanded: list[str] = []
    for raw in lines:
        stripped_label = _strip_draft_metadata_label(raw)
        if stripped_label is None:
            continue
        line = _strip_strikethrough(stripped_label)
        line = _replace_unresolved_slots(_replace_instructional_leaks(line), source_lower)
        parts = _split_crammed_execution_line(line)
        for part_idx, part in enumerate(parts):
            if part_idx > 0 and expanded and expanded[-1].strip():
                expanded.append("")
            for piece in _split_fused_heading(part):
                expanded.append(_bold_allcaps_label(piece) if piece.strip() else piece)

    cleaned: list[str] = []
    for idx, line in enumerate(expanded):
        if _MD_HR_LINE_RE.match(line.strip()):
            prev_line = _nearest_nonblank(expanded, idx - 1, -1)
            next_line = _nearest_nonblank(expanded, idx + 1, 1)
            if _is_execution_context(prev_line) and _is_execution_context(next_line):
                if cleaned and cleaned[-1].strip():
                    cleaned.append("")
                continue
        cleaned.append(line.rstrip())

    out: list[str] = []
    blank_run = 0
    for line in cleaned:
        if line.strip():
            blank_run = 0
            out.append(line.rstrip())
        else:
            blank_run += 1
            if blank_run <= 2:
                out.append("")
    rendered = "\n".join(out).strip()
    rendered = _dedupe_repeated_markdown_tables(rendered)
    rendered = _format_witness_blocks_as_columns(rendered, section_heading=section_heading)
    rendered = _format_party_signature_blocks_as_columns(rendered)
    return rendered.strip()


def reconcile_assembled_sections(drafted: list[str]) -> list[str]:
    """Global coherence pass over ALL drafted sections. Sections are drafted in document order
    and deduped against their predecessors as they go, but the later audit-repair and
    slot-recovery passes REWRITE sections after that point, so a duplicate table can reappear.
    Re-dedupe every section's tables against ALL earlier sections (keep the first occurrence
    in document order). Per-section STRUCTURE is untouched; this only removes cross-section
    table duplication. Returns a new list (the input is not mutated)."""
    out = list(drafted)
    for i in range(1, len(out)):
        if not (out[i] and out[i].strip()):
            continue
        prior = [out[j] for j in range(i) if out[j] and out[j].strip()]
        if not prior:
            continue
        deduped = dedupe_tables_against_prior(out[i], prior)
        if deduped != out[i]:
            logger.info("[template_drafting] global reconcile: removed duplicate table from section %d", i)
            out[i] = deduped
    return out


# ───────────────────────── Stage D: grounding + format audit ─────────────────
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
                            "why": str(v.get("why") or v.get("offending_text") or ""),
                            "type": "grounding"})
            except (TypeError, ValueError):
                continue
    return out


def format_audit(
    sections_md: list[str],
    *,
    model_name: str,
    user_id: str | int | None = None,
    template_sections: list[TemplateSection] | None = None,
) -> list[dict]:
    """Audit assembled draft structure. Returns [{section_index, why, type}]."""
    blocks: list[str] = []
    for i, md in enumerate(sections_md):
        checklist = _template_coverage_checklist(template_sections[i]) if template_sections and i < len(template_sections) else ""
        blocks.append(
            f"[SECTION {i}]\n"
            + (f"TEMPLATE COVERAGE CHECKLIST:\n{checklist}\n\n" if checklist else "")
            + f"DRAFT:\n{md}"
        )
    marked = "\n\n".join(blocks)
    prompt = (
        f"{FORMAT_AUDIT_PROMPT}\n\n"
        f"=== TEMPLATE CHECKLISTS AND DRAFT ===\n{marked[:200_000]}\n\n=== JSON ==="
    )
    raw = _generate_text(
        prompt,
        agent_name="format_audit_agent",
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
                out.append({
                    "section_index": int(v["section_index"]),
                    "why": str(v.get("why") or v.get("issue") or ""),
                    "type": "format",
                })
            except (TypeError, ValueError):
                continue
    return out

# ───────────────────── Stage E: slot recovery (completeness) ─────────────────
# Matches OUR red placeholder body: [________ FIELD NAME ________] (with or without the
# wrapping <span>), tolerating the one-sided underscore runs weak models emit
# ("[ FIELD ________]" / "[________ FIELD ]"). Customary blanks ("NO. ____ OF 20__",
# bare signature "____") and plain [NAME] tokens have no bracket+underscore pair, so
# they are never treated as recoverable slots.
_RED_SLOT_RE = re.compile(r"\[\s*_{2,}\s*([^\]\n]*?)\s*_{0,}\s*\]|\[\s*([^\]\n]*?)\s*_{2,}\s*\]")


def _red_slot_labels(md: str) -> list[str]:
    """Distinct red-placeholder field labels left in a drafted section, in order."""
    out: list[str] = []
    for m in _RED_SLOT_RE.finditer(md or ""):
        label = _norm_ws(m.group(1) or m.group(2) or "").strip("_ ")
        if label and label not in out:
            out.append(label)
    return out


def recover_section_slots(
    section: TemplateSection,
    drafted_md: str,
    fact_inventory: str,
    *,
    model_name: str,
    user_id: str | int | None = None,
    retrieve_fn: Callable[[str, int], list[dict]] | None = None,
) -> str:
    """Completeness critic (Stage E): try to FILL the red placeholders left in a drafted
    section. Each missing field gets its OWN targeted retrieval (field label + section
    heading), so a value the drafting pass missed — but the supporting documents contain
    (the "Aadhaar exists in the docs but the draft shows a red blank" failure) — is
    recovered. Strictly conservative: a placeholder is replaced only when the exact value
    appears in the fresh evidence / inventory; otherwise it stays a red blank."""
    labels = _red_slot_labels(drafted_md)
    if not labels or retrieve_fn is None:
        return drafted_md
    gathered: list[dict] = []
    for label in labels[:10]:
        try:
            gathered.extend(retrieve_fn(f"{label} {section.heading}".strip(), _SECTION_TOP_K) or [])
        except Exception as exc:
            logger.warning("[template_drafting] slot retrieval failed for %r: %s", label[:48], exc)
    evidence = _format_chunks(gathered, char_cap=_SECTION_EVIDENCE_CHAR_CAP)
    prompt = (
        "You are a legal-draft SLOT FILLER. The drafted section below contains RED PLACEHOLDERS "
        'of the form <span style="color:red;font-weight:bold;">[_ FIELD _]</span> '
        "(or bare [_ FIELD _]). For EACH placeholder, search the FRESH EVIDENCE and "
        "the FACT INVENTORY for that exact field's value.\n"
        "- If the exact value IS stated there: replace the ENTIRE placeholder (span and all) with "
        "the value, copied VERBATIM from the source.\n"
        "- If it is NOT stated: keep the placeholder EXACTLY as it is. NEVER guess, infer, or use "
        "a typical/example value.\n"
        "Change NOTHING else — no rewording, no reformatting, no added or removed lines.\n"
        "Return ONLY the full corrected section markdown. NO commentary, NO explanation, NO "
        "reasoning, NO notes about which fields were found or kept — your output must begin "
        "directly with the section's first line.\n\n"
        f"MISSING FIELDS: {', '.join(labels[:10])}\n\n"
        f"=== DRAFTED SECTION ===\n{drafted_md}\n\n"
        f"=== FRESH EVIDENCE (targeted retrieval for these fields) ===\n{evidence}\n\n"
        f"=== FACT INVENTORY ===\n{(fact_inventory or '')[:60_000]}\n\n"
        "=== CORRECTED SECTION ==="
    )
    out = _generate_text(
        prompt,
        agent_name="slot_recovery_agent",
        user_id=user_id,
        model_name_override=model_name,
        max_output_tokens=_SECTION_MAX_TOKENS,
    )
    cleaned = _strip_fences(out or "").strip()
    if not cleaned:
        return drafted_md
    # COMMENTARY GUARD: weak models prepend reasoning ("The MISSING FIELDS list
    # indicates …") despite instructions. Re-anchor the output at the section's real
    # opening line; if the opening can't be found and the head reads like meta-talk,
    # reject the recovery entirely — a red blank is better than leaked reasoning.
    orig_lines = [l.strip() for l in drafted_md.split("\n") if l.strip()]
    anchor: int | None = None
    for cand in orig_lines[:3]:
        pos = cleaned.find(cand[:60])
        if pos >= 0:
            anchor = pos if anchor is None else min(anchor, pos)
    if anchor is not None and anchor > 0:
        cleaned = cleaned[anchor:].strip()
    elif anchor is None and re.search(
        r"MISSING FIELDS|FRESH EVIDENCE|FACT INVENTORY|keep the placeholder|not available",
        cleaned[:400], re.IGNORECASE,
    ):
        logger.warning("[template_drafting] slot recovery returned commentary for %r — rejected",
                       section.heading[:60])
        return drafted_md
    return cleaned if cleaned else drafted_md


def _reliable_alt_chain(model: str) -> list[str]:
    """Ordered fallback models to retry a FAILED pipeline stage on, most-preferred first.

    gemma-4-26b-a4b-it (the MoE variant) intermittently 500s / hangs on the Gemini Developer
    API — a single flaky structure/fact-matrix call otherwise aborts the WHOLE pipeline to a
    section-less single-call draft. The dense gemma-4-31b-it is usually more stable (same free
    GEMMA_API_KEY), so try it first — BUT gemma sometimes has a FAMILY-WIDE 500 outage where
    BOTH variants are down. So every gemma chain ends at the reliable (paid) gemini backstop:
    when all free gemma options fail, gemini still gets the draft through instead of collapsing
    to a section-less single-call. Non-gemma engines (gemini/claude) are already reliable → []."""
    m = (model or "").strip().lower()
    if not m:
        return []
    if m.startswith("gemma-4-31b"):
        return ["gemini-3.1-pro-preview"]
    if m.startswith("gemma"):
        return ["gemma-4-31b-it", "gemini-3.1-pro-preview"]
    return []


def _stage_timeout(model: str, *, fast: float = 180.0) -> float:
    """Blocking timeout for a pipeline stage, sized to the model's throughput.

    Free-tier gemma on Google AI Studio runs at only ~16 tokens/sec, so a structure or
    fact-matrix call legitimately takes minutes — give gemma a generous 300s window before
    declaring a hang and escalating. Cutting it short just forces a needless jump to a paid
    model (gemini) when free gemma would have finished. Faster paid models don't need it, so
    they keep the shorter `fast` window (a stall on them really is a problem)."""
    return 300.0 if (model or "").strip().lower().startswith("gemma") else fast


# ─────────────────────────────── orchestrator ───────────────────────────────
async def run_template_drafting_pipeline(
    *,
    template_text: str,
    template_layout: dict | None = None,
    doc_texts: list[dict] | None = None,
    query_text: str,
    draft_engine: str,
    analysis_model: str,
    user_id: str | int | None,
    run_blocking: Callable,
    doc_title: str | None = None,
    cached_fact_inventory: str | None = None,
    enable_audit: bool = True,
    retrieve_fn: Callable[[str, int], list[dict]] | None = None,
    audit_model: str | None = None,
) -> AsyncIterator[tuple[str, dict]]:
    """Async generator yielding (kind, data):

      ("progress", {"type": "thinking", "text": "..."})  → caller yields _sse(data)
      ("final", {"answer": <assembled markdown>, "tiptap_json": <TipTap doc>,
                 "tiptap_sections": <per-section TipTap payloads>, "typography": {...},
                 "fact_inventory": <str>, "sections": <int>})  → caller streams + saves

    All blocking model calls go through `run_blocking(func, *, timeout_s, timeout_message)`
    (the caller's executor wrapper) so the event loop is never blocked. Raises on hard
    failure so the caller can fall back to the single-call draft.
    """
    def _prog(text: str) -> tuple[str, dict]:
        return ("progress", {"type": "thinking", "text": text})

    # ---- Stage A: structure ----
    # Timeout is throughput-aware (_stage_timeout): free-tier gemma (~16 tps) gets a generous
    # 300s so a slow-but-working structure call finishes on the free engine instead of being
    # cut short and bounced to a paid model; gemini/claude keep the shorter 180s. On a genuine
    # failure (500s exhausted, or a true hang past the window) we escalate to a reliable model
    # rather than aborting the whole pipeline to a section-less single-call draft.
    _alts_a = _reliable_alt_chain(analysis_model)
    doc_texts = doc_texts or []
    yield _prog("Analyzing the template's structure…\n")
    analysis: TemplateAnalysis | None = None
    try:
        analysis = await run_blocking(
            lambda: analyze_template_structure(template_text, model_name=analysis_model, user_id=user_id),
            timeout_s=_stage_timeout(analysis_model), timeout_message="template_structure_timeout",
        )
    except Exception as _exc_a:
        # Walk the fallback chain (free gemma sibling → reliable gemini) until one succeeds, so a
        # family-wide gemma 500 outage still yields a real structure instead of collapsing the
        # whole pipeline to a section-less single-call draft.
        analysis = None
        _last_a = _exc_a
        for _alt in _alts_a:
            logger.warning("[template_drafting] structure model %s failed (%s) — escalating to %s",
                           analysis_model, _last_a, _alt)
            yield _prog(
                f"Structure model '{analysis_model}' is unavailable ({type(_last_a).__name__}); "
                f"retrying structure on {_alt}…\n"
            )
            try:
                analysis = await run_blocking(
                    lambda a=_alt: analyze_template_structure(
                        template_text, model_name=a, user_id=user_id, template_layout=template_layout
                    ),
                    timeout_s=_stage_timeout(_alt), timeout_message="template_structure_timeout_alt",
                )
                break
            except Exception as _e:
                _last_a = _e
        if analysis is None:
            raise _last_a
    sections = analysis.sections
    n = len(sections)
    if n == 0:
        raise ValueError("no template sections to draft")
    yield _prog(f"Template mapped into {n} section(s).\n")
    yield ("outline", {
        "total": n,
        "sections": [
            {
                "index": i,
                "heading": sec.heading,
                "section_id": render_section_tiptap(sec, "")["section_id"],
                "template_layout": sec.typography,
            }
            for i, sec in enumerate(sections)
        ],
    })

    # ---- Stage B: fact inventory (cached per session by the caller) ----
    # `fact_inventory` is bound exactly once, always as a non-empty str (the escalation uses a
    # local `_fi` sentinel and narrows it before binding) — so the many draft_section closures
    # below capture a definite str, never Optional.
    if cached_fact_inventory:
        fact_inventory: str = cached_fact_inventory
        yield _prog("Reusing the extracted case facts…\n")
    else:
        # Say what this stage ACTUALLY does. extract_fact_inventory only falls back to RAG
        # retrieval when the corpus is too big to read whole (> _INV_FULL_CONTEXT_MAX_CHARS);
        # for a normal case it reads every document in full. The old label claimed "Retrieving
        # … (RAG)" purely because a retrieve_fn existed, so users watched a "retrieving chunks"
        # message for minutes while nothing was being retrieved — the wait is the single
        # fact-matrix model call, which is the slowest step of the whole draft on a free-tier
        # engine (it can emit up to _INVENTORY_MAX_TOKENS).
        _corpus_len = len(_corpus_from_docs(doc_texts))
        _matrix_uses_rag = retrieve_fn is not None and _corpus_len > _INV_FULL_CONTEXT_MAX_CHARS
        if _matrix_uses_rag:
            yield _prog(
                f"Case is large ({_corpus_len:,} chars) — retrieving the most relevant evidence (RAG) "
                f"and building the case fact matrix…\n"
            )
        else:
            yield _prog(
                f"Reading all {len(doc_texts)} document(s) in full and building the case fact matrix "
                f"(the slowest step — one pass over every fact)…\n"
            )
        _extra_q = [query_text] if (query_text or "").strip() else None
        _alts_b = _reliable_alt_chain(draft_engine)
        _fi: str | None = None
        try:
            _fi = await run_blocking(
                lambda: extract_fact_inventory(
                    doc_texts, model_name=draft_engine, user_id=user_id,
                    retrieve_fn=retrieve_fn, extra_queries=_extra_q,
                ),
                timeout_s=_stage_timeout(draft_engine, fast=300.0), timeout_message="fact_inventory_timeout",
            )
        except Exception as _exc_b:
            # Walk the fallback chain (free gemma sibling → reliable gemini) until one succeeds,
            # so a family-wide gemma 500 outage still produces a fact matrix rather than aborting
            # the pipeline to a section-less single-call draft.
            _last_b = _exc_b
            for _alt in _alts_b:
                logger.warning("[template_drafting] fact-matrix model %s failed (%s) — escalating to %s",
                               draft_engine, _last_b, _alt)
                yield _prog(
                    f"Fact-matrix model '{draft_engine}' is unavailable ({type(_last_b).__name__}); "
                    f"retrying on {_alt}…\n"
                )
                try:
                    _fi = await run_blocking(
                        lambda a=_alt: extract_fact_inventory(
                            doc_texts, model_name=a, user_id=user_id,
                            retrieve_fn=retrieve_fn, extra_queries=_extra_q,
                        ),
                        timeout_s=_stage_timeout(_alt, fast=300.0), timeout_message="fact_inventory_timeout_alt",
                    )
                    break
                except Exception as _e:
                    _last_b = _e
            if _fi is None:
                raise _last_b
        if not _fi or not _fi.strip():
            raise ValueError("fact inventory extraction produced nothing")
        fact_inventory = _fi
    if not fact_inventory.strip():
        raise ValueError("fact inventory extraction produced nothing")

    # ---- Stage C: draft sections STRICTLY SEQUENTIALLY, in the template's own order
    # (0, 1, 2 … n-1). Every section is drafted with `prior_drafts` = every section already
    # committed before it, so no section is ever drafted blind.
    #
    # This used to run a two-phase schedule: "independent" blocks (schedules, annexures,
    # signature/witness blocks) fanned out first with prior_drafts="", then the narrative
    # clauses ran sequentially. That was wrong on both axes:
    #   • It bought NO speed — the fan-out was bounded by a semaphore that the free-tier
    #     engines had to set to 1 anyway, so it was already one-call-at-a-time.
    #   • It cost accuracy — the fanned-out blocks were blind to each other AND arrived out
    #     of template order, which is what forced the cross-section table dedupe and the
    #     global reconciliation pass to exist as cleanup for damage the schedule itself
    #     caused (the same inventory table emitted twice, sections landing out of order).
    # Drafting in document order with full prior context is both the accurate and the
    # structurally faithful thing to do, so that is now the only path.
    #
    # A section that errors becomes a flagged placeholder, so one bad section can't sink the
    # whole draft. Each finished section streams live, in order.
    drafted: list[str] = [""] * n

    def _section_event(i: int) -> dict:
        rendered = render_section_tiptap(sections[i], drafted[i])
        return {
            "index": i, "total": n,
            "heading": sections[i].heading, "markdown": drafted[i],
            "section_id": rendered["section_id"],
            "tiptap_json": rendered["doc"],
            "tiptap_content": rendered["content"],
            "legal_section": rendered["legal_section"],
            "template_layout": sections[i].typography,
            "source_traceability": rendered["source_traceability"],
        }

    def _commit_section(i: int, res) -> None:
        _norm = (
            normalize_section_draft(res, sections, i, source_text=fact_inventory)
            if (isinstance(res, str) and res.strip()) else ""
        )
        if not _norm.strip() and len((sections[i].original_text or "").strip()) >= 80:
            # Nothing usable came back for a non-trivial template span — make the gap
            # VISIBLE instead of silently dropping template content (the empty
            # "Verification" card failure).
            _norm = f"**{sections[i].heading}**\n\n{NOT_FOUND_MARKER}"
        drafted[i] = _norm

    for idx in range(n):
        yield _prog(f"Drafting section {idx + 1}/{n}: {sections[idx].heading[:80]}…\n")
        prior = "\n\n".join(drafted[j] for j in range(idx) if drafted[j] and drafted[j].strip())
        # Compact anti-repetition brief instead of the whole document so far. See
        # build_evidence_ledger: it states which identities/addresses are already set out (and
        # the short form to use for them) and which figures may recur — a few hundred tokens
        # instead of up to 60,000 characters of re-pasted draft on every single section call.
        _ledger = build_evidence_ledger(fact_inventory, drafted, sections, idx)
        try:
            res = await run_blocking(
                lambda s=sections[idx], pr=prior, lg=_ledger: draft_section(
                    s, fact_inventory, model_name=draft_engine, user_id=user_id, doc_title=doc_title,
                    retrieve_fn=retrieve_fn, prior_drafts=pr, ledger=lg,
                ),
                timeout_s=180.0, timeout_message=f"section_{idx}_timeout",
            )
        except Exception as exc:
            logger.warning("[template_drafting] section %s failed: %s", idx, exc)
            res = None
        _commit_section(idx, res)
        # Belt-and-braces: every section already sees all prior text, so it should not restate
        # an earlier table. Keep the check anyway — a weak engine can still re-emit one.
        if drafted[idx]:
            _dd = dedupe_tables_against_prior(
                drafted[idx],
                [drafted[j] for j in range(idx) if drafted[j] and drafted[j].strip()],
            )
            if _dd != drafted[idx]:
                logger.info("[template_drafting] removed duplicate table from section %d", idx)
                drafted[idx] = _dd
        # Emit each finished section so the section-by-section UI fills in document order.
        yield ("section", _section_event(idx))

    # ---- Stage D: grounding audit + repair (buffer internally; never append copies) ----
    # Run the audit + repair on a GUARDIAN model (audit_model, e.g. Opus) even when a weaker
    # model drafted — a strong model catching and rewriting fabrications is the backstop that
    # makes non-Opus drafting usable. Falls back to the draft engine when no guardian is set.
    guardian = (audit_model or draft_engine)
    if enable_audit and drafted:
        yield _prog(f"Auditing the draft against the case facts and format (guardian: {guardian})…\n")
        # The two critics are independent — run them CONCURRENTLY (halves audit latency).
        g_res, f_res = await asyncio.gather(
            run_blocking(
                lambda: grounding_audit(drafted, fact_inventory, model_name=guardian, user_id=user_id),
                timeout_s=180.0, timeout_message="grounding_audit_timeout",
            ),
            run_blocking(
                lambda: format_audit(drafted, model_name=guardian, user_id=user_id, template_sections=sections),
                timeout_s=180.0, timeout_message="format_audit_timeout",
            ),
            return_exceptions=True,  # audits are a backstop — never fail the draft over them
        )
        if isinstance(g_res, BaseException):
            logger.warning("[template_drafting] grounding audit skipped: %s", g_res)
            g_res = []
        if isinstance(f_res, BaseException):
            logger.warning("[template_drafting] format audit skipped: %s", f_res)
            f_res = []
        violations = list(g_res or []) + list(f_res or [])
        # Repair each flagged section in place — on the guardian model, with the earlier
        # sections as context so the fix stays consistent and non-repetitive.
        flagged = sorted({v["section_index"] for v in violations if 0 <= v["section_index"] < len(drafted)})
        for k in flagged:
            why = "; ".join(
                f"{v.get('type', 'audit')}: {v['why']}"
                for v in violations
                if v["section_index"] == k and v.get("why")
            )
            yield _prog(f"Refining section {k + 1}: correcting audit findings…\n")
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
                    drafted[k] = dedupe_tables_against_prior(
                        normalize_section_draft(fixed, sections, k, source_text=fact_inventory),
                        drafted[:k],
                    )
                    yield ("section", _section_event(k))
            except Exception as exc:
                logger.warning("[template_drafting] repair of section %s failed: %s", k, exc)

    # ---- Stage E: slot recovery (completeness critic) — every red placeholder left in
    # the draft gets its OWN targeted retrieval, and the GUARDIAN fills it only if the
    # exact value exists in the sources. This rescues values the drafting model missed
    # even though the supporting documents contain them.
    if retrieve_fn is not None:
        for idx in range(n):
            labels = _red_slot_labels(drafted[idx])
            if not labels:
                continue
            shown = ", ".join(labels[:3]) + ("…" if len(labels) > 3 else "")
            yield _prog(f"Recovering missing fields in section {idx + 1} ({shown})…\n")
            try:
                recovered = await run_blocking(
                    lambda i=idx: recover_section_slots(
                        sections[i], drafted[i], fact_inventory,
                        model_name=guardian, user_id=user_id, retrieve_fn=retrieve_fn,
                    ),
                    timeout_s=180.0, timeout_message=f"slot_recovery_{idx}_timeout",
                )
                if recovered and recovered.strip() and recovered.strip() != drafted[idx].strip():
                    drafted[idx] = dedupe_tables_against_prior(
                        normalize_section_draft(recovered, sections, idx, source_text=fact_inventory),
                        drafted[:idx],
                    )
                    yield ("section", _section_event(idx))
            except Exception as exc:
                logger.warning("[template_drafting] slot recovery of section %s failed: %s", idx, exc)

    # Reconcile: Stage D repairs / Stage E slot recovery rewrite sections AFTER the in-order
    # dedupe in Stage C, so they can re-introduce a cross-section duplicate table. Idempotent
    # when nothing changed. Re-emit any section this pass changes so the live section cards
    # match the final assembled answer — otherwise a table deduped only here would linger on
    # the streamed card while being absent from the saved draft.
    _before_final_reconcile = list(drafted)
    drafted = reconcile_assembled_sections(drafted)
    for i in range(n):
        if drafted[i] != _before_final_reconcile[i]:
            yield ("section", _section_event(i))
    assembled = normalize_drafted_markdown(
        "\n\n".join(md for md in drafted if md and md.strip()),
        source_text=fact_inventory,
    )
    tiptap_rendered = render_document_tiptap(sections, drafted)
    yield ("final", {
        "answer": assembled,
        "tiptap_json": tiptap_rendered["doc"],
        "tiptap_sections": tiptap_rendered["sections"],
        "legal_section_doc": tiptap_rendered["legal_section_doc"],
        "typography": {
            "title_format": analysis.title_format,
            "base_font": analysis.base_font,
        },
        "fact_inventory": fact_inventory,
        "sections": n,
    })
