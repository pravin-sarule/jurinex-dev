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

# Section packing — combine consecutive small sections into drafting units sized off the
# TEMPLATE PAGE COUNT: ~2-3 units per page, so a 4-page rent agreement drafts in ~8-12
# calls — never 31 one-line calls (each call is wall-clock latency + an API charge, and
# tiny units are what caused repetition across sections). Clause fidelity inside a bigger
# unit is protected by the coverage checklist + rule 9b, not by making units tiny.
_CHARS_PER_PAGE = 2800          # rough extracted-text chars per template page
_UNITS_PER_PAGE = 2.5           # target drafting units per template page (2-3/page)
_UNIT_MAX_SECTIONS = 10         # never group more than this many template sections into one unit

# ── RAG retrieval knobs (used when the caller supplies a retrieve_fn) ─────────
# The draft path retrieves top-chunks from the case's vector store instead of dumping the
# whole corpus. Recall matters (a legal draft needs EVERY fact), so the fact matrix is built
# by retrieving PER FACET and unioning — a single vague "draft the agreement" query would
# miss most facts. Each section then also pulls its OWN focused top-chunks (precision).
_INV_FACET_TOP_K = 16            # top-k chunks retrieved per facet query for the fact matrix
_INV_RETRIEVAL_CHAR_CAP = 130_000  # budget for the retrieved corpus fed to Stage B
_SECTION_TOP_K = 20              # top-k chunks retrieved per section for drafting
_SECTION_EVIDENCE_CHAR_CAP = 30_000  # budget for a section's own retrieved evidence
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

    # Re-split spans where a failed anchor buried a major part heading (PRAYER,
    # VERIFICATION …) inside the previous section's verbatim text.
    resplit = _resplit_at_major_parts(sections)
    if len(resplit) != len(sections):
        logger.info("[template_drafting] re-split %d section(s) at buried part headings",
                    len(resplit) - len(sections))
        sections = resplit

    # Pack tiny sections into page-proportional drafting units (~2-3 per template page)
    # so each section call yields a substantial section, not a 50–150 token fragment.
    fine_grained = len(sections)
    sections = _pack_sections(sections, template_len=len(template_text))
    if len(sections) != fine_grained:
        logger.info("[template_drafting] packed %d sections into %d drafting unit(s)", fine_grained, len(sections))

    # Hard page-proportional cap (~3 drafting units per template page): even when table
    # flags or slot-dense blocks defeat greedy packing, a 4-page template must never
    # explode into 31 drafting calls — each call is wall-clock latency + an API charge.
    est_pages = max(1.0, len(template_text) / _CHARS_PER_PAGE)
    dyn_cap = min(_MAX_SECTIONS, max(4, round(est_pages * 3)))
    if len(sections) > dyn_cap:
        logger.info("[template_drafting] merging %d unit(s) down to page cap %d (~%.1f pages)",
                    len(sections), dyn_cap, est_pages)
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



_SLOT_HEAVY_RE = re.compile(r"_{4,}|\[[^\]]{2,}\]|\b(?:Bank|A/c|Account|IFSC|UPI|Aadhaar|PAN|Address|Signature|Witness|Date|Place)\b", re.IGNORECASE)


def _should_keep_section_standalone(section: TemplateSection) -> bool:
    """Only a genuine data table or an extremely slot-dense block (execution/witness/bank
    blocks) stands alone. The earlier "every numbered clause standalone" rule exploded a
    4-page template into 31 drafting calls — page-proportional packing + the coverage
    checklist protect clause fidelity instead."""
    text = f"{section.heading}\n{section.original_text or ''}"
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
    r"STATEMENT\s+OF\s+TRUTH|AFFIDAVIT|DECLARATION|IN\s+WITNESS\s+WHEREOF|MEMO\s+OF\s+PARTIES)\b",
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


def _pack_sections(sections: list[TemplateSection], *, template_len: int = 0) -> list[TemplateSection]:
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
        if _should_keep_section_standalone(s):
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
        parts.append(" ".join(str(p) for p in section.placeholders[:12]))
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
        table_hint = (
            f"\nThis section is a TABLE. Output a markdown table with columns: {cols}. "
            "Add ONE ROW PER RELEVANT FACT from the inventory, in order; never leave a cell blank.\n"
        )
    typo = section.typography or {}
    layout_hint = ""
    if typo:
        layout_hint = (
            f"\nMEASURED LAYOUT (from the template itself): alignment={typo.get('alignment', 'justify')}, "
            f"bold={'yes' if typo.get('bold') else 'no'}, heading_level={typo.get('level', 0)}. "
            "Honour it: keep centered lines centered on their OWN line, right-aligned labels on "
            "their own line, and bold ONLY what the template bolds.\n"
        )
    correction_hint = ""
    if correction:
        correction_hint = (
            "\nCORRECTION REQUIRED — a guardian audit flagged this section. Fix ONLY the "
            "specific grounding/format issues below. Preserve all supported facts, numbering, "
            "and template layout:\n"
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
        overlaps_seen = any(_table_body_overlap(block, prior) >= 0.82 for prior in seen_blocks)
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
        dup = (fp and fp in prior_fps) or any(_table_body_overlap(block, p) >= 0.82 for p in prior_blocks)
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


def normalize_section_draft(markdown: str, sections: list[TemplateSection], index: int,
                            *, source_text: str = "") -> str:
    section_heading = sections[index].heading if 0 <= index < len(sections) else None
    if 0 <= index < len(sections):
        markdown = _strip_echoed_heading(markdown, sections[index])
    cleaned = normalize_drafted_markdown(markdown, section_heading=section_heading, source_text=source_text)
    cleaned = trim_leaked_future_sections(cleaned, sections, index)
    cleaned = normalize_drafted_markdown(cleaned, section_heading=section_heading, source_text=source_text)
    return cleaned.strip()


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
        _norm_res = (
            normalize_section_draft(res, sections, idx, source_text=fact_inventory)
            if (isinstance(res, str) and res.strip()) else ""
        )
        if not _norm_res.strip() and len((sections[idx].original_text or "").strip()) >= 80:
            # Nothing usable came back for a non-trivial template span — make the gap
            # VISIBLE instead of silently dropping template content (the empty
            # "Verification" card failure).
            _norm_res = f"**{sections[idx].heading}**\n\n{NOT_FOUND_MARKER}"
        drafted[idx] = _norm_res
        # Cross-section table dedupe BEFORE streaming: a table already drafted in an
        # earlier section must not appear again (the duplicated Annexure-A inventory).
        if idx > 0 and drafted[idx]:
            _dd = dedupe_tables_against_prior(drafted[idx], drafted[:idx])
            if _dd != drafted[idx]:
                logger.info("[template_drafting] removed duplicate table from section %d", idx)
                drafted[idx] = _dd
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
                    yield ("section", {
                        "index": k, "total": n,
                        "heading": sections[k].heading, "markdown": drafted[k],
                    })
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
                    yield ("section", {
                        "index": idx, "total": n,
                        "heading": sections[idx].heading, "markdown": drafted[idx],
                    })
            except Exception as exc:
                logger.warning("[template_drafting] slot recovery of section %s failed: %s", idx, exc)

    assembled = normalize_drafted_markdown(
        "\n\n".join(md for md in drafted if md and md.strip()),
        source_text=fact_inventory,
    )
    yield ("final", {
        "answer": assembled,
        "typography": {
            "title_format": analysis.title_format,
            "base_font": analysis.base_font,
        },
        "fact_inventory": fact_inventory,
        "sections": n,
    })
