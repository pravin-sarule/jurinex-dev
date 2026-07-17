"""
Prompt Orchestration Layer
==========================

Three-layer prompting architecture that lets users ask questions in any natural
form while the BACKEND (not the user) decides the response format.

Layer 1 — Permanent System Prompt (`PERMANENT_SYSTEM_PROMPT`)
    Provider-agnostic role / legal-accuracy / hallucination-prevention /
    markdown / OCR-cleanup rules. No document-specific instructions.

Layer 2 — Intent Detection (`detect_response_format`)
    Semantic scoring classifier (synonym/paraphrase groups, not single keywords)
    that maps a free-form user query to a `ResponseIntent`. Extensible by adding
    entries to `_INTENT_SIGNALS`.

Layer 3 — Dynamic Formatting Prompt (`build_format_instruction`)
    A short, intent-specific formatting instruction generated from the detected
    intent (or a reusable section template). Appended to the user prompt as the
    final "OUTPUT CONTRACT" reminder.

The route / QA assembly combine:
    Permanent System Prompt  +  Dynamic Formatting Prompt  +  User Prompt  +  Document Text
before calling any provider (DeepSeek / Claude / Gemini). The user's wording is
never modified — only the format directive is chosen by the backend.

This module is standalone (no imports from document_ai) to avoid circular deps.
"""

from __future__ import annotations

import re
from enum import Enum


# ─────────────────────────────────────────────────────────────────────────────
# Layer 2 — Intent types
# ─────────────────────────────────────────────────────────────────────────────

class ResponseIntent(str, Enum):
    """Every supported response format. `str` mixin so values serialize easily."""
    SUMMARY = "summary"
    TIMELINE = "timeline"
    TABLE = "table"
    ANALYSIS = "analysis"
    LIST = "list"
    LEGAL_RESEARCH = "legal_research"
    COMPARISON = "comparison"
    COMPREHENSIVE = "comprehensive"  # full multi-section case analysis ("analyze this document")
    GENERAL_QA = "general_qa"
    CUSTOM_TEMPLATE = "custom_template"  # user supplied their own multi-section template


# ─────────────────────────────────────────────────────────────────────────────
# Custom-template detection — when the user pastes their own multi-section
# analysis template (e.g. a 14-section case-summary prompt), we must honour it
# exactly instead of imposing a single format.
# ─────────────────────────────────────────────────────────────────────────────

_TEMPLATE_MARKER_RE = re.compile(
    r"(master\s+template|extraction\s+guidelines|core\s+objective|strict\s+adherence|"
    r"special\s+considerations|quality\s+checklist|self[\s-]correction|"
    r"section\s+\d{1,2}|more\s+than\s+\d{3,}\s*words|\d{3,}\s*words|"
    r"final\s+quality\s+checklist|output\s+preamble)",
    re.IGNORECASE,
)
_NUMBERED_SECTION_HEADER_RE = re.compile(
    r"^\s*\d{1,2}\.\s+[A-Z][A-Za-z &/\-]{3,}\s*$",
    re.MULTILINE,
)


def is_custom_template_question(question: str) -> bool:
    """True when the user's question is a comprehensive multi-section template."""
    q = str(question or "")
    if not q:
        return False
    if _TEMPLATE_MARKER_RE.search(q):
        return True
    if len(_NUMBERED_SECTION_HEADER_RE.findall(q)) >= 3:
        return True
    if len(q) > 1200 and re.search(r"\b\d{1,2}\.\s", q):
        return True
    return False


# ─────────────────────────────────────────────────────────────────────────────
# Layer 2 — Semantic intent signals
#
# Each intent maps to a list of (compiled regex, weight) "signals". A signal is
# a synonym / paraphrase group; matching is word-boundary and case-insensitive.
# The query's score per intent = sum of weights of all matching signals. The
# highest-scoring intent wins (tie → earlier enum priority). This is "semantic"
# matching via curated meaning groups — extensible without code changes to the
# scorer. To add a new intent, add an enum value + a signal group + a format
# template.
# ─────────────────────────────────────────────────────────────────────────────

def _sig(pattern: str, weight: int = 3) -> re.Pattern:
    return re.compile(r"\b(" + pattern + r")\b", re.IGNORECASE)


_INTENT_SIGNALS: dict[ResponseIntent, list[tuple[re.Pattern, int]]] = {
    ResponseIntent.TIMELINE: [
        (_sig(r"chronolog(?:y|ical)", 5), 5),
        (_sig(r"timeline", 5), 5),
        (_sig(r"date[\s-]?wise", 5), 5),
        (_sig(r"sequence\s+of\s+events", 5), 5),
        (_sig(r"order\s+of\s+events", 4), 4),
        (_sig(r"events\s+in\s+order", 4), 4),
        (_sig(r"dateline", 4), 4),
        (_sig(r"factual\s+matrix", 5), 5),
        (_sig(r"evidence\s+matrix", 5), 5),
        (_sig(r"list\s+of\s+dates", 4), 4),
        (_sig(r"dates?\s+and\s+events?", 5), 5),
    ],
    ResponseIntent.TABLE: [
        (_sig(r"tabular(?:\s+format)?", 5), 5),
        (_sig(r"in\s+a?\s*table", 5), 5),
        (_sig(r"as\s+a\s+table", 5), 5),
        (_sig(r"in\s+table\s+form", 5), 5),
        (_sig(r"matrix", 3), 3),
        (_sig(r"side[\s-]by[\s-]side", 3), 3),
        # Nouns that are inherently tabular per the formatting policy.
        (_sig(r"acts?\s+and\s+sections?", 4), 4),
        (_sig(r"sections?\s+(?:of|under)\s+(?:the\s+)?act", 4), 4),
        (_sig(r"documents?\s+relied\s+upon", 4), 4),
        (_sig(r"list\s+of\s+documents?", 4), 4),
        (_sig(r"annexures?(?:\s+(?:and|/)\s+exhibits?)?", 4), 4),
        (_sig(r"exhibits?", 3), 3),
        (_sig(r"\bparties\b", 4), 4),
    ],
    ResponseIntent.SUMMARY: [
        (_sig(r"summar(?:ize|ise|y)", 5), 5),
        (_sig(r"summary", 5), 5),
        (_sig(r"overview", 4), 4),
        (_sig(r"executive\s+summary", 5), 5),
        (_sig(r"in\s+short", 3), 3),
        (_sig(r"in\s+brief", 3), 3),
        (_sig(r"brief(?:\s+overview)?", 4), 4),
        (_sig(r"\bgist\b", 3), 3),
        (_sig(r"abstract", 3), 3),
        (_sig(r"short\s+note", 3), 3),
        (_sig(r"crux\s+of\s+the\s+case", 4), 4),
    ],
    ResponseIntent.LIST: [
        (_sig(r"point[\s-]?wise", 5), 5),
        (_sig(r"as\s+a\s+list", 4), 4),
        (_sig(r"in\s+points?", 4), 4),
        (_sig(r"enumerate(?:\s+the)?", 4), 4),
        (_sig(r"numbered\s+list", 5), 5),
        (_sig(r"bullet(?:\s+points?)?", 4), 4),
        (_sig(r"list\s+the", 3), 3),
        (_sig(r"list\s+of", 3), 3),
        (_sig(r"grounds(?:\s+of\s+(?:challenge|defence|defense))?", 4), 4),
        (_sig(r"reliefs?\s+(?:are\s+)?sought", 4), 4),
        (_sig(r"prayers?(?:\s+sought)?", 3), 3),
        (_sig(r"submissions?", 2), 2),
    ],
    ResponseIntent.ANALYSIS: [
        (_sig(r"analys(?:e|is|ize|ysis)", 5), 5),
        (_sig(r"examine(?:\s+each)?", 4), 4),
        (_sig(r"examination", 4), 4),
        (_sig(r"assess(?:ment)?", 4), 4),
        (_sig(r"evaluat(?:e|ion)", 4), 4),
        (_sig(r"breakdown", 3), 3),
        (_sig(r"deep\s+dive", 3), 3),
        (_sig(r"critically", 3), 3),
        (_sig(r"strengths?\s+and\s+weakness(?:es)?", 4), 4),
        (_sig(r"issues?\s+(?:of\s+law|involved|in\s+the\s+case)", 4), 4),
        (_sig(r"legal\s+issues?", 4), 4),
        (_sig(r"\bissues?\b", 3), 3),
        (_sig(r"questions?\s+of\s+law", 4), 4),
        (_sig(r"procedural\s+history", 4), 4),
        (_sig(r"factual\s+background", 3), 3),
        (_sig(r"background\s+facts?", 3), 3),
        (_sig(r"explain(?:\s+each)?", 2), 2),
        (_sig(r"explain\s+the\s+(?:issue|case)", 3), 3),
    ],
    ResponseIntent.LEGAL_RESEARCH: [
        (_sig(r"case\s+law", 5), 5),
        (_sig(r"precedents?", 5), 5),
        (_sig(r"ratio\s+decidendi", 4), 4),
        (_sig(r"obiter(?:\s+dicta)?", 3), 3),
        (_sig(r"landmark\s+judg(?:e)?ment", 4), 4),
        (_sig(r"citations?", 3), 3),
        (_sig(r"doctrinal", 3), 3),
        (_sig(r"legal\s+research", 5), 5),
        (_sig(r"relied\s+upon", 2), 2),
        (_sig(r"binding\s+(?:precedent|authority)", 3), 3),
        (_sig(r"persuasive\s+(?:precedent|authority)", 3), 3),
        (_sig(r"cit(?:ed|ation)\s+cases?", 3), 3),
    ],
    ResponseIntent.COMPARISON: [
        (_sig(r"compar(?:e|ison)", 5), 5),
        (_sig(r"contrast", 4), 4),
        (_sig(r"distinguish(?:\s+between)?", 4), 4),
        (_sig(r"difference\s+between", 5), 5),
        (_sig(r"similarit(?:y|ies)\s+and\s+differences?", 4), 4),
        (_sig(r"relative\s+(?:merits|strengths)", 3), 3),
        (_sig(r"which\s+is\s+(?:better|stronger|weaker)", 3), 3),
        (_sig(r"pros?\s+and\s+cons", 4), 4),
    ],
    ResponseIntent.COMPREHENSIVE: [
        (_sig(r"analy[sz]e\s+(?:this|the)\s+(?:document|case|petition|judg(?:e)?ment|matter|file|order|suit)", 7), 7),
        (_sig(r"comprehensive\s+(?:case\s+)?(?:summary|analysis|breakdown)", 7), 7),
        (_sig(r"full\s+(?:case\s+)?(?:summary|analysis|breakdown)", 6), 6),
        (_sig(r"complete\s+(?:case\s+)?analysis", 6), 6),
        (_sig(r"detailed\s+(?:case\s+)?(?:summary|analysis)", 5), 5),
        (_sig(r"entire\s+(?:case|document)\s+(?:summary|analysis)", 5), 5),
        (_sig(r"case\s+summary", 4), 4),
        (_sig(r"analy[sz]e\s+everything", 6), 6),
    ],
    ResponseIntent.GENERAL_QA: [
        # fallback — no signals; wins only when nothing else scores.
    ],
}

# Priority order for deterministic tie-breaking (most specific first).
_INTENT_PRIORITY: tuple[ResponseIntent, ...] = (
    ResponseIntent.CUSTOM_TEMPLATE,
    ResponseIntent.COMPREHENSIVE,
    ResponseIntent.TIMELINE,
    ResponseIntent.TABLE,
    ResponseIntent.LEGAL_RESEARCH,
    ResponseIntent.COMPARISON,
    ResponseIntent.LIST,
    ResponseIntent.ANALYSIS,
    ResponseIntent.SUMMARY,
    ResponseIntent.GENERAL_QA,
)


def detect_response_format(user_query: str) -> ResponseIntent:
    """
    Classify a free-form user query into a `ResponseIntent` using semantic
    synonym-group scoring (not single-keyword matching).

    Returns `ResponseIntent.CUSTOM_TEMPLATE` when the user supplied their own
    multi-section analysis template (honoured verbatim). Falls back to
    `ResponseIntent.GENERAL_QA` when no intent scores above zero.
    """
    q = str(user_query or "").strip()
    if not q:
        return ResponseIntent.GENERAL_QA
    if is_custom_template_question(q):
        return ResponseIntent.CUSTOM_TEMPLATE
    # An EXPLICIT format directive is unambiguous and hard-overrides content scoring.
    # Without this, "give me summary in tabular format" scores SUMMARY higher than
    # TABLE (the word "summary" matches two summary signals) and renders as prose.
    if re.search(r"\b(?:tabular(?:\s+format)?|in\s+a?\s*table|as\s+a\s+table|table\s+form(?:at)?|in\s+table)\b", q, re.IGNORECASE):
        return ResponseIntent.TABLE
    if re.search(r"\b(?:as\s+a\s+timeline|in\s+a?\s*timeline|chronolog(?:y|ical)\s+order|date[\s-]?wise)\b", q, re.IGNORECASE):
        return ResponseIntent.TIMELINE

    scores: dict[ResponseIntent, int] = {intent: 0 for intent in _INTENT_SIGNALS}
    for intent, signals in _INTENT_SIGNALS.items():
        for pattern, weight in signals:
            if pattern.search(q):
                scores[intent] += weight

    best_intent = ResponseIntent.GENERAL_QA
    best_score = 0
    for intent in _INTENT_PRIORITY:
        if intent in (ResponseIntent.GENERAL_QA, ResponseIntent.CUSTOM_TEMPLATE):
            continue
        s = scores.get(intent, 0)
        if s > best_score:
            best_score = s
            best_intent = intent

    return best_intent if best_score > 0 else ResponseIntent.GENERAL_QA


# ─────────────────────────────────────────────────────────────────────────────
# Layer 1 — Permanent System Prompt
# ─────────────────────────────────────────────────────────────────────────────

PERMANENT_SYSTEM_PROMPT = """
You are NexIntel AI, a senior legal analyst assistant on the NexIntel AI platform, serving legal professionals (lawyers, paralegals, judges, case managers) who need precise, exhaustive analysis of Indian legal documents.

PERSONA & TONE
- Professional, neutral, meticulous, respectful. Speak in terms of documents, clauses, parties, and case files. Never use AI or technical jargon.
- If the user ONLY greets you ("hi", "hello", "namaste", "नमस्ते"), reply briefly and stop:
  "Hello. I am ready to analyze your documents. How can I assist you with this case today?"

LANGUAGE PROTOCOL (ZERO TOLERANCE)
- ALWAYS reply in the SAME language as the user's latest message.
  English query -> answer in English. Hindi query -> answer in Hindi. Marathi query -> answer in Marathi.
- The language of the documents NEVER changes your output language.
- Translate ONLY when the user explicitly asks you to translate.

ROLE & ACCURACY
- Analyse ONLY the provided case materials. Answer the user's question faithfully.
- Preserve legal terminology, case names, statutory references, section numbers,
  article numbers, and citations EXACTLY as they appear.
- Never simplify legal meaning. Never invent facts, dates, names, holdings, or
  procedural history. If information is not in the documents, state
  "Not mentioned in the document." — do not infer, fabricate, or speculate.
- Maintain a formal, objective, precise legal tone.

MARKDOWN RULES (GitHub-Flavored Markdown ONLY)
- NEVER output HTML. Forbidden tags: <br>, <div>, <span>, <p>, <table>, <tr>, <td>, <b>, <i>.
- Use markdown headings for section titles: # ## ###. NEVER use bold-only headings
  (e.g. **Facts** is wrong; ## Facts is right).
- Keep paragraphs short. Separate sections with headings.
- Bullets use "- "; numbered lists use "1." "2." "3.". Do not randomly alternate.
- Inline emphasis: bold = **word** (the ** MUST touch the word, no spaces);
  italic = *word* (the * MUST touch the word, no spaces).
- Never output markdown syntax literally. Never leave a stray ** where a heading
  is intended. Never emit a malformed table.
- NEVER output internal reasoning, monologue, meta-commentary, or "thinking out loud"
  about the instructions, the conversation history, or your plan. Output ONLY the
  final, polished legal analysis.
- Do NOT use code fences unless the user explicitly asks for code.
- NEVER draw ASCII-art boxes, borders, or banners using box-drawing characters
  (┌ ┐ └ ┘ │ ─ ├ ┤). NEVER emit decorative branded headers — in ANY language —
  such as "LEXIS LEGAL FINDING", "⚖️ LEXIS ...", "⚖️ LEXIS कायदेशीर शोध", or meta
  lines like "Case: ... | Query Type: ..." / "खटला: ... प्रश्नाचा प्रकार: ...".
  This applies equally to translated or localized versions of any banner.
  This rule OVERRIDES any template, preset, or example that shows such a
  banner — skip the banner and its case/query-type meta line entirely and
  start directly with the first real heading of the answer.
- OMIT authorship/date metadata lines entirely — never output "Prepared By:",
  "Prepared For:", "Date:", "Generated On:", or similar lines (in any language),
  even if the template or preset shows them. Never credit "LEXIS",
  "AI Legal Assistant", "JuriNex", or any AI name as the author.

TABLES
- USER OVERRIDE (highest priority): if the user EXPLICITLY asks for a table /
  tabular format / "in a table" / matrix, you MUST return the answer as a
  Markdown table — even for a summary, analysis, or other normally-narrative
  content. The user's explicit format request ALWAYS wins over the defaults
  below. Map the content into sensible columns (e.g. | Section | Details | or
  | Aspect | Details |) rather than refusing or falling back to prose.
- Otherwise (no explicit table request) emit a table ONLY for naturally tabular
  data: timeline / chronology, acts & sections, case law, documents relied upon,
  parties.
- A valid GFM table MUST have a header row, a separator row (|---|---|), and
  closing pipes on every row. Example:
    | Aspect | Details |
    |---|---|
    | Title | Case Name |
- Every Markdown table row MUST start and end with a pipe (|).
- Narrative sections (summary, analysis, procedural history, grounds) stay as
  headings + paragraphs / lists — do NOT force them into a table UNLESS the user
  explicitly asked for a table/tabular format (see USER OVERRIDE above).
- NEVER output internal reasoning, monologue, meta-commentary, or "thinking out loud"
  about the instructions, the conversation history, or your plan. Output ONLY the
  final, polished legal analysis.
- NEVER use bare single-pipe labels like "|A|", "|B|", "|C|" for annexures,
  exhibits, or list items — that is NOT a table and renders as raw pipes. For
  annexures/exhibits use a real table with a header + separator, bolding the
  label in its own cell, e.g.:
    | Annexure | Description | Date | Authority |
    |----------|-------------|------|-----------|
    | **A** | Copy of Orders | 20/04/2011 | Collector of Stamps |
  For a simple labelled list (not tabular) use "**A.** ..." / "**B.** ...", never "|A|".
- NEVER emit a single-column table, and NEVER place a single word, number,
  punctuation mark, or syllable in its own row/cell. Every table MUST have at
  least TWO columns with meaningful headers (e.g. | Aspect | Details |), and each
  cell MUST hold a COMPLETE value (a whole name, full date, or full phrase) — not
  a fragment. WRONG: rows like "| Su |", "| it |", "| No |", "| 04 |". RIGHT:
  | Aspect | Details |  /  | Suit No. | 04 of 2024 |.
- If the source text is fragmented (a name or word split across lines or
  syllables, e.g. "Su it", "S agar D ink ar Mart ande", "202 4"), SILENTLY
  reconstruct the whole word/name/number ("Suit", "Sagar Dinkar Martande",
  "2024") before placing it in any cell, list item, or sentence.

OCR CLEANUP (silently repair, without changing legal meaning)
- Rejoin PDF-split words: "Con stitution" -> "Constitution", "Aur ang abad" ->
  "Aurangabad", "Ground s" -> "Grounds", "Part ies" -> "Parties", "Def endant" ->
  "Defendant", "com pliance" -> "compliance", "rep ayment" -> "repayment",
  "K rish n aji" -> "Krishnaji", "At mar am" -> "Atmaram", "Anand w ade" -> "Anandwade",
  "On kar" -> "Onkar", "Sak har" -> "Sakhar", "K ark hana" -> "Karkhana",
  "initiallyref used" -> "initially refused", "re jected" -> "rejected",
  "den ying" -> "denying", "strong ly" -> "strongly".
- Rejoin split numbers: "201 6" -> "2016", "100 72" -> "10072".
- Tighten spaced dates: "04 / 04 / 2024" -> "04/04/2024", "07/05/202 5" -> "07/05/2025".
- Repair merged words: "Article 227filed" -> "Article 227 filed", "defendon" -> "defend on",
  "withdrawalcanbe" -> "withdrawal can be".

COMPLETENESS
- If the user asks for ALL points / a specific number of points / every section,
  output EVERY one — number them sequentially and do not stop early, merge, or
  omit items. Prefer complete and detailed over brief.

STREAMING LAYOUT (your answer is rendered progressively while you write it)
- Separate every block (heading, paragraph, list, table) with exactly ONE blank line.
- Write each table row complete on a single physical line; never continue a row
  onto the next line.
- Never wrap the whole answer in a ```markdown fence and never emit <think> tags.
""".strip()


# ─────────────────────────────────────────────────────────────────────────────
# Layer 5 (reusable) — Independent section templates
# Each is self-contained and can be composed into a dynamic format instruction.
# ─────────────────────────────────────────────────────────────────────────────

SECTION_TEMPLATES: dict[str, str] = {
    "summary": (
        "Return a structured narrative case summary. Use markdown headings "
        "(## Overview, ## Facts, ## Issues, ## Court Holding) with short paragraphs. "
        "No table."
    ),
    "timeline": (
        "Return ONLY a valid GitHub-Flavored Markdown table, ordered by date ascending. "
        "Columns: | S.No | Date (DD/MM/YYYY) | Event |. Keep each row on one physical line. "
        "No prose before or after the table."
    ),
    "table": (
        "The user EXPLICITLY requested a TABLE / tabular format, so this overrides every "
        "default rule about which content is 'naturally tabular' — present the FULL requested "
        "answer (even a summary or analysis) as a table, never as prose. "
        "Return ONLY valid GitHub-Flavored Markdown table(s). Choose meaningful columns for the "
        "content (e.g. | Section | Details | for a summary, | Aspect | Details | otherwise). "
        "Include a header row and a |---| separator. Every row MUST start and end with a pipe (|). "
        "Keep each row on one physical line. No HTML, no prose before or after the table, no "
        "internal reasoning."
    ),
    "legal_analysis": (
        "Return a structured legal analysis using markdown headings (## Issue, ## Rule, "
        "## Application, ## Conclusion) with paragraphs. No table."
    ),
    "issue_analysis": (
        "Return the legal issues as a numbered list of precise legal questions, each on its "
        "own line. Distinguish questions of fact from questions of law. No table."
    ),
    "grounds": (
        "Return the grounds as a numbered list (1. 2. 3.). Separate grounds of challenge "
        "from grounds of defence with a ## heading. No table."
    ),
    "reliefs": (
        "Return the reliefs / prayers as a numbered list, preserving the exact legal language. "
        "No table."
    ),
    "case_law": (
        "Return cited case law as a GitHub-Flavored Markdown table with columns: "
        "| Case Name | Citation | Court | Principle / Ratio |. Mark each as Binding or Persuasive."
    ),
    "procedural_history": (
        "Return the procedural history as narrative paragraphs under a ## Procedural History "
        "heading, in chronological order. No table."
    ),
    "acts_sections": (
        "Return the acts & sections as a GitHub-Flavored Markdown table with columns: "
        "| Act / Statute | Section(s) | Purpose |."
    ),
    "documents": (
        "Return the documents relied upon as a GitHub-Flavored Markdown table with columns: "
        "| Annexure / Exhibit | Description | Date | Mark Disputed? |."
    ),
    "parties": (
        "Return the parties as a GitHub-Flavored Markdown table with columns: "
        "| Role | Name | Details |."
    ),
}


# ─────────────────────────────────────────────────────────────────────────────
# Layer 3 — Dynamic formatting instruction per intent
# ─────────────────────────────────────────────────────────────────────────────

_FORMAT_INSTRUCTIONS: dict[ResponseIntent, str] = {
    ResponseIntent.SUMMARY: SECTION_TEMPLATES["summary"],
    ResponseIntent.TIMELINE: SECTION_TEMPLATES["timeline"],
    ResponseIntent.TABLE: SECTION_TEMPLATES["table"],
    ResponseIntent.ANALYSIS: (
        "Return a structured legal analysis using markdown headings (## ) and paragraphs. "
        "Use numbered lists for sub-points. No table unless the data is genuinely tabular."
    ),
    ResponseIntent.LIST: (
        "Return the answer as a clean numbered list (1. 2. 3.), one item per line. "
        "Use ## headings to group if needed. No table."
    ),
    ResponseIntent.LEGAL_RESEARCH: (
        "Return cited case law as a GitHub-Flavored Markdown table: "
        "| Case Name | Citation | Court | Principle / Ratio |, with a Binding/Persuasive note. "
        "Add a short markdown commentary under a ## heading if helpful."
    ),
    ResponseIntent.COMPARISON: (
        "Return a comparison using markdown headings (## ) per item, plus a GitHub-Flavored "
        "Markdown table (| Criterion | A | B |) for the side-by-side view. No HTML."
    ),
    ResponseIntent.COMPREHENSIVE: (
        "Produce a COMPREHENSIVE case analysis. Open with exactly this line: "
        "\"Based on a meticulous analysis of the provided legal documents, here is the comprehensive case summary.\" "
        "Then cover ALL of the following sections in order, each under its own '## ' markdown heading "
        "(e.g. '## 1. Nature of Document'). If a section has no data, write 'Not mentioned in the document.'\n"
        "## 1. Nature of Document — document type and case number\n"
        "## 2. Court & Jurisdiction — court, location, jurisdiction type, bench\n"
        "## 3. Parties — Markdown table: | Role | Name | Details |\n"
        "## 4. Acts & Sections Involved — Markdown table: | Act / Statute | Section(s) | Purpose |\n"
        "## 5. Dates & Events (Chronological) — Markdown table: | S.No | Date (DD/MM/YYYY) | Event |\n"
        "## 6. Procedural History — narrative paragraphs in chronological order\n"
        "## 7. Core Issues / Questions of Law — numbered list\n"
        "## 8. Relevant Background Facts — chronological paragraphs\n"
        "## 9. Grounds of Challenge / Defence — numbered, grouped by side\n"
        "## 10. Documents Relied Upon — Markdown table: | Annexure | Description | Date | Authority |\n"
        "## 11. Reliefs Sought / Prayers — numbered, verbatim\n"
        "## 12. Legal Position — arguments and principles for each side\n"
        "## 13. Probable Counter-Arguments — numbered\n"
        "## 14. Case Law — Markdown table: | Case Name | Citation | Court | Principle |\n"
        "ANNEXURE RULE: NEVER write annexures as bare pipes like '|A| Copy of order'. ALWAYS use the "
        "table in section 10 with the label bolded in its own cell, e.g. | **A** | Copy of Orders | 20/04/2011 | Collector |. "
        "Be exhaustive and detailed. GitHub-Flavored Markdown only — no HTML, no stray ** or | outside tables."
    ),
    ResponseIntent.GENERAL_QA: (
        "Return a readable GitHub-Flavored Markdown answer. Use ## headings and short "
        "paragraphs. Use a table ONLY if the answer is genuinely tabular. No HTML."
    ),
    ResponseIntent.CUSTOM_TEMPLATE: (
        "The user supplied their own multi-section template. Follow it EXACTLY: produce "
        "EVERY section in the specified order and structure. Do NOT replace it with a single "
        "table or a short summary. Use a Markdown table ONLY where the template asks for one; "
        "other sections use headings, paragraphs, and lists as the template describes. "
        "If a section has no data, write 'Not mentioned in the document.' for that section. "
        "Honour any minimum word count with full, detailed paragraphs."
    ),
}


def build_format_instruction(intent: ResponseIntent) -> str:
    """Return the short, intent-specific OUTPUT CONTRACT (Layer 3)."""
    return _FORMAT_INSTRUCTIONS.get(intent, _FORMAT_INSTRUCTIONS[ResponseIntent.GENERAL_QA])


def format_instruction_for_query(user_query: str) -> str:
    """
    Detect intent from the user query and return the matching formatting
    instruction (handles custom templates automatically).
    """
    return build_format_instruction(detect_response_format(user_query))


# ─────────────────────────────────────────────────────────────────────────────
# Orchestrator — combines Layer 1 + Layer 3 for the caller
# ─────────────────────────────────────────────────────────────────────────────

def orchestrate(user_query: str) -> tuple[str, ResponseIntent, str]:
    """
    Run the full pipeline for a user query.

    Returns:
        (permanent_system_prompt, intent, format_instruction)
    """
    intent = detect_response_format(user_query)
    return PERMANENT_SYSTEM_PROMPT, intent, build_format_instruction(intent)


def build_prompt_preamble(user_query: str) -> str:
    """
    Compact block to append at the END of the assembled user prompt (just before
    the answer marker). Contains the dynamic formatting instruction only — the
    permanent system prompt is delivered separately as the system instruction.
    """
    _, _, fmt = orchestrate(user_query)
    return (
        "=== OUTPUT CONTRACT — OVERRIDES ALL PRIOR INSTRUCTIONS ===\n"
        f"{fmt}"
    )
