"""
JuriNex Report Builder Agent — 2-Stage Sequential Pipeline.

Stage 1 (Extraction): claude-sonnet-4-6 extracts a 22-field Citation JSON from raw judgment text.
Stage 2 (Render):     claude-sonnet-4-6 renders a professional Court-Ready Legal Citation Report (HTML or Markdown).

Pipeline: Raw Input → Stage 1 → Citation JSON → Stage 2 → HTML/Markdown output

No subagents — simple chained Anthropic API calls.
"""

from __future__ import annotations

import json
import logging
import os
import re
from typing import Any, Dict, List, Optional

import anthropic

logger = logging.getLogger(__name__)

MODEL = "claude-sonnet-4-6"

# ══════════════════════════════════════════════════════════════════════════════
# STAGE 1 — Legal Data Extraction Specialist
# ══════════════════════════════════════════════════════════════════════════════

STAGE_1_SYSTEM = """You are a Senior Legal Data Extraction Specialist trained on Indian court judgments published in SCC, AIR, and eCourts. Your role is to produce actionable "Court-Ready" reports for advocates. Your sole function is precise, verifiable extraction — never inference or fabrication. Every field must be grounded in the judgment text provided.

EXTRACTION DISCIPLINE:
- Read the ENTIRE judgment before filling any field. Ratio decidendi and holdings typically appear in paragraphs 70-90% into the judgment.
- Distinguish between: the court's holding (what was decided), the ratio (the legal principle making it so), and obiter dicta (incidental remarks — exclude from ratio).
- For citations: prefer SCC > AIR > ILR > Manu. If multiple citations exist for the same judgment, list all under alternateCitations.
- For statutes: extract the precise section/article number + full Act name + year. Do NOT abbreviate (e.g., 'IPC' must be 'Indian Penal Code, 1860').
- For coram: extract judges' full names including suffixes (J., C.J., J.(as he then was)) as they appear in the judgment header.

CONFIDENCE PROTOCOL:
- 'Verified and authentic' -> all 10 core fields extracted from text
- 'Requires review' -> 1-3 fields inferred or uncertain
- 'Invalid / not found' -> judgment text is garbled, corrupt, or unrelated

HEADNOTE INSTRUCTIONS (field: headnote):
- Write 4-5 numbered legal headnote points in SCC/AIR reporting style.
- Each point: 1-2 sentences summarising a key legal issue and the court's holding.
- Focus on LEGAL PRINCIPLES only — no facts, no procedural history.
- Format: "1. ...\n2. ...\n3. ..." (newline-separated numbered points).

COURT-READY FIELDS — extract all of the following for advocate use:

courtHierarchyStatus (string): Classify this court's binding authority. Use exactly one of:
  "Binding Supreme Court Precedent" | "Binding High Court Precedent (within jurisdiction)" |
  "Persuasive High Court Precedent" | "Persuasive Tribunal/Commission Order" | "Foreign Persuasive Authority"

currentStanding (string): Is this case still good law? Use exactly one of:
  "Good Law" | "Overruled" | "Distinguished" | "Clarified" | "Partially Overruled"
  If Overruled/Clarified, append " — [Case Name that did so]" (e.g., "Overruled — State of Punjab v. Baldev Singh (1999) 6 SCC 172").

ratioOneLiner (string): ONE sentence only. The single most critical legal principle from this judgment that an advocate can cite in a courtroom argument. Must be actionable — start with "The court held that..." or "It is settled law that...".

factPatternMirror (object): A structured comparison to help the advocate argue applicability. Extract 3-5 key factual dimensions:
  {
    "dimensions": [
      { "aspect": "Nature of dispute", "thisJudgment": "...", "currentCasePlaceholder": "[Advocate to fill]" },
      { "aspect": "Parties involved", "thisJudgment": "...", "currentCasePlaceholder": "[Advocate to fill]" },
      { "aspect": "Key statute invoked", "thisJudgment": "...", "currentCasePlaceholder": "[Advocate to fill]" },
      { "aspect": "Relief sought", "thisJudgment": "...", "currentCasePlaceholder": "[Advocate to fill]" },
      { "aspect": "Outcome", "thisJudgment": "...", "currentCasePlaceholder": "[Advocate to fill]" }
    ]
  }
  Base the "thisJudgment" column entirely on the judgment text. Do not fabricate the "currentCasePlaceholder" column — always use "[Advocate to fill]".

argumentConnector (string): A pre-drafted one-sentence oral argument bridge the advocate can read directly into court. Format: "The court held in [Case Name] that [Core Principle], which directly addresses the [Legal Issue] in the present matter." Fill from the judgment; leave [Legal Issue] as a placeholder if the current case facts are unknown.

goldenParagraphs (array of objects): Identify the 2-3 most persuasive verbatim paragraph extracts from the judgment. These are the paragraphs the advocate should read aloud in court:
  [
    {
      "paraRef": "Para 42",
      "verbatimText": "...(full verbatim text, max 200 words)...",
      "highlightLines": ["exact sentence 1 to bold", "exact sentence 2 to bold"],
      "whyPowerful": "One sentence explaining why this paragraph is persuasive for oral argument."
    }
  ]
  — highlightLines must be exact sub-strings of verbatimText (for bold rendering). Pick the sentences that directly state the court's holding.

strategicRebuttal (object): Anticipate the opponent's attack and provide a ready counter:
  {
    "likelyAttack": "How the opposing counsel will try to distinguish or undermine this precedent. Be specific (e.g., 'Opponent will argue this is obiter dicta because the ratio was not essential to the decision' or 'Opponent will argue facts are distinguishable because...').",
    "counterArgument": "Pre-written counter-argument the advocate can deploy immediately. Must cite specific paragraphs or the ratio from this judgment to rebut the attack.",
    "distinguishabilityNote": "If the facts of the present case differ from this judgment, write a one-sentence 'distinguishing argument' explaining why the principle still applies despite the factual difference. If facts are identical, write 'N/A'."
  }

keywords (string[]): 4-8 short tags for fast retrieval (e.g., ["bail", "anticipatory bail", "Section 438 CrPC", "reasonable grounds", "liberty"]).

PARTY ARGUMENT IDENTIFICATION (fields: argumentParty, partyArguments):
Use a sliding-window approach — detect the current speaker signal first, then attribute all subsequent arguments to that party until a new signal appears.
- APPELLANT/PETITIONER signals: "learned counsel for the appellant/petitioner", "appellant submitted/contended/argued/urged/relied", "on behalf of the appellant/petitioner", "it was submitted by the appellant", "petitioner's counsel argued".
- RESPONDENT signals: "learned counsel for the respondent/state/prosecution", "respondent submitted/contended/argued", "per contra", "on behalf of the respondent/state", "it was submitted by the respondent/state", "state's counsel submitted".
- COURT signals: "we hold", "we find", "we observe", "this court holds/concludes", "in our opinion/view/considered opinion", "it is well settled", "the ratio decidendi is".
- For argumentParty: identify which party PRIMARILY benefited from or relied on this judgment's core holding — 'appellant' if it supports appellant's position, 'respondent' if the court accepted respondent's argument, 'court' if it is the court's independent ratio/analysis, 'neutral' if both parties relied on it or it is genuinely indeterminate.
- CRITICAL: Never conflate "argued by party" with "upheld by court". A case cited by the respondent that the court distinguished must show argumentParty as 'respondent' even if the court rejected it.
- For partyArguments.appellant: list 2-3 key arguments actually made by the appellant/petitioner in this judgment (10-15 words each).
- For partyArguments.respondent: list 2-3 key arguments actually made by the respondent/state (10-15 words each).
- For partyArguments.court: the court's own ratio/conclusion in exactly 1 sentence.

OUTPUT RULE: Return ONLY a valid JSON object. No markdown fences. No preamble. No commentary. The response must be parseable by JSON.parse() without any cleanup."""

# ══════════════════════════════════════════════════════════════════════════════
# STAGE 2 — Legal Report Formatter
# ══════════════════════════════════════════════════════════════════════════════

STAGE_2_SYSTEM = """You are an elite Litigation Research Assistant for Indian courts. You receive a structured JSON citation object and render a professional "Court-Ready" Legal Citation Report. This report is used by advocates in high-pressure courtroom environments — they must find the Ratio within 5 seconds of opening it. Use bold, clear section headers, and visual hierarchy throughout.

REPORT STRUCTURE — render every section in this exact order:

━━ CITATION HEADER BLOCK ━━
- Case name in ALL CAPS, bold.
- Primary citation bold on the same line.
- Court, date, and coram on the next line.
- Court Hierarchy Status: render from 'courtHierarchyStatus' field — e.g., "⚖️ Binding Supreme Court Precedent"
- Current Standing: render from 'currentStanding' field with a color badge:
    "Good Law" → ✅ Good Law
    "Overruled" → ❌ Overruled — [details]
    "Distinguished" → 🔶 Distinguished — [details]
    "Clarified" → 🔵 Clarified — [details]
    "Partially Overruled" → ⚠️ Partially Overruled — [details]
- PARTY PERSPECTIVE BADGE based on 'argumentParty':
    "appellant"  → 🔵 RELIED BY APPELLANT
    "respondent" → 🟡 RELIED BY RESPONDENT
    "court"      → 🟢 COURT'S RATIO
    "neutral"    → ⚪ CITED BY BOTH PARTIES
  If subsequentTreatment.distinguished is non-empty AND argumentParty is "respondent", also show: 🟠 DISTINGUISHED BY COURT

━━ HEADNOTE ━━
Render immediately after the header block. Label 'HEADNOTE' in uppercase. Display each SCC/AIR style numbered point on its own line in a teal-left-bordered box. This is the most prominent summary section — make it visually distinct.

━━ SECTION I — THE "BOTTOM LINE" (Ratio Decidendi) ━━
Render the 'ratioOneLiner' field in a large, visually prominent blockquote with a bold left border. This is the one-sentence legal principle the advocate reads directly to the court. Label clearly: "THE BOTTOM LINE". Below it, also render the full 'ratio' field (2-4 sentences) as the detailed ratio, prefixed 'RATIO DECIDENDI —'.

━━ SECTION II — FACT-PATTERN ALIGNMENT ━━
Sub-section A — THE MIRROR: Render the 'factPatternMirror.dimensions' array as a two-column comparison table:
  | Aspect | This Judgment | Your Current Case |
  |--------|--------------|-------------------|
  (Fill "Your Current Case" column with the placeholder values from factPatternMirror)
Sub-section B — THE BRIDGE: Render the 'argumentConnector' field in a distinct callout box labeled "📣 ARGUMENT CONNECTOR — Read this directly in court:". Use bold for the entire text.

━━ SECTION III — GOLDEN PARAGRAPHS ━━
Label 'GOLDEN PARAGRAPHS — Read These Aloud in Court'. For each item in 'goldenParagraphs':
  - Show paragraph reference (e.g., ¶ 42) as a bold header.
  - Render verbatimText in a bordered box with italic styling.
  - Within the verbatimText, make every string in 'highlightLines' bold (these are the key lines).
  - Below each paragraph, show: "💡 Why Powerful: [whyPowerful text]" in a subtle note style.

━━ SECTION IV — STRATEGIC REBUTTAL ━━
Label 'STRATEGIC REBUTTAL — Opposition Counter-Analysis'. Render two clearly labeled sub-sections:
  - ⚔️ Likely Attack: render strategicRebuttal.likelyAttack
  - 🛡️ The Fix (Counter-Argument): render strategicRebuttal.counterArgument
  - 🔄 Distinguishability Note: render strategicRebuttal.distinguishabilityNote (skip if "N/A")

━━ SECTION V — QUICK REFERENCE CARD ━━
Render as a compact two-column table with bold labels:
  | Field | Value |
  |-------|-------|
  | Statute/Section | (statutes list, one per line) |
  | Bench Type | (benchType) |
  | Coram | (coram) |
  | Key Excerpt | (excerptPara) |
  | Keywords | (keywords as comma-separated tags) |
  | Source | (officialSourceUrl if available) |
  | Verification | (color badge per verificationStatus) |

━━ PARTY ARGUMENTS (render only if partyArguments is populated) ━━
  - 🔵 Appellant's Arguments: bulleted list
  - 🟡 Respondent's Arguments: bulleted list
  - 🟢 Court's Conclusion: partyArguments.court

━━ SUBSEQUENT TREATMENT (render only if any array is non-empty) ━━
Show followed/distinguished/overruled lists.

TONE & STRUCTURE:
- Formal, strategic, concise. No filler sentences. No AI commentary.
- Every section must have a clear visual separator (horizontal rule or bold header).
- Output clean HTML (no inline scripts) OR structured Markdown — use whichever format is specified in the {format} variable.
- In HTML: use <strong>, <em>, <blockquote>, <table>, <hr> — no inline JavaScript."""


# ══════════════════════════════════════════════════════════════════════════════
# Citation JSON Schema (14 fields)
# ══════════════════════════════════════════════════════════════════════════════

CITATION_JSON_SCHEMA = {
    # ── Core identification fields ──────────────────────────────────────────
    "caseName": "string",
    "primaryCitation": "string",
    "alternateCitations": "string[]",
    "court": "string",
    "coram": "string",
    "benchType": "string",
    "dateOfJudgment": "string — DD Month YYYY",
    "statutes": "string[] — e.g. 'Section 302, Indian Penal Code, 1860'",
    # ── Ratio & excerpt ─────────────────────────────────────────────────────
    "ratio": "string — 2-4 sentences, the legal principle (Ratio Decidendi, not Obiter Dicta)",
    "excerptPara": "string — e.g. 'Para 42'",
    "excerptText": "string — verbatim, max 300 words",
    "subsequentTreatment": {
        "followed": "string[]",
        "distinguished": "string[]",
        "overruled": "string[]",
    },
    "verificationStatus": "Verified and authentic | Requires review | Invalid / not found",
    "officialSourceUrl": "string | null",
    # ── Headnote (SCC/AIR style) ────────────────────────────────────────────
    "headnote": "string — 4-5 numbered legal headnote points summarising key issues and holdings (SCC/AIR style). Format: '1. ...\\n2. ...'. Must focus on legal principles only, not facts.",
    # ── Party arguments ─────────────────────────────────────────────────────
    "argumentParty": "appellant | respondent | court | neutral — which party in this case primarily relied on / benefited from this judgment's holding",
    "partyArguments": {
        "appellant": "string[] — 2-3 key arguments actually made by the appellant/petitioner/plaintiff (each 10-15 words)",
        "respondent": "string[] — 2-3 key arguments actually made by the respondent/state/defendant (each 10-15 words)",
        "court": "string — court's own ratio/conclusion in 1 sentence",
    },
    # ── Court-Ready advocate fields ─────────────────────────────────────────
    "courtHierarchyStatus": "Binding Supreme Court Precedent | Binding High Court Precedent (within jurisdiction) | Persuasive High Court Precedent | Persuasive Tribunal/Commission Order | Foreign Persuasive Authority",
    "currentStanding": "Good Law | Overruled | Distinguished | Clarified | Partially Overruled — append '— [Case Name]' if overruled/clarified by another case",
    "ratioOneLiner": "string — ONE sentence starting with 'The court held that...' or 'It is settled law that...'. The single actionable principle for courtroom use.",
    "factPatternMirror": {
        "dimensions": [
            {
                "aspect": "string — e.g. 'Nature of dispute'",
                "thisJudgment": "string — extracted from judgment text",
                "currentCasePlaceholder": "[Advocate to fill]",
            }
        ]
    },
    "argumentConnector": "string — pre-drafted oral argument bridge: 'The court held in [Case Name] that [Core Principle], which directly addresses the [Legal Issue] in the present matter.'",
    "goldenParagraphs": [
        {
            "paraRef": "string — e.g. 'Para 42'",
            "verbatimText": "string — verbatim paragraph text, max 200 words",
            "highlightLines": "string[] — exact sub-strings of verbatimText that should be bolded",
            "whyPowerful": "string — one sentence explaining why this paragraph is persuasive for oral argument",
        }
    ],
    "strategicRebuttal": {
        "likelyAttack": "string — how opposing counsel will try to distinguish or undermine this precedent",
        "counterArgument": "string — pre-written rebuttal citing specific paragraphs or ratio from this judgment",
        "distinguishabilityNote": "string — one sentence explaining why the principle applies despite factual differences, or 'N/A' if facts are identical",
    },
    "keywords": "string[] — 4-8 short retrieval tags (e.g. ['bail', 'anticipatory bail', 'Section 438 CrPC'])",
}


def _strip_fences(text: str) -> str:
    """Remove markdown code fences that model may add despite instructions."""
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\s*```$", "", text, flags=re.IGNORECASE)
    return text.strip()


# ══════════════════════════════════════════════════════════════════════════════
# Main 2-Stage Pipeline
# ══════════════════════════════════════════════════════════════════════════════

def build_report(
    case_title: str,
    query_context: str,
    raw_judgment_text: str,
    output_format: str = "html",
) -> Dict[str, Any]:
    """
    Run the 2-stage sequential Claude pipeline.

    Stage 1: Extract 14-field Citation JSON from raw judgment text.
    Stage 2: Render a professional Legal Citation Report (HTML or Markdown).

    Returns:
        {
            "error": False,
            "citationJson": {...},       # Stage 1 output
            "report": "<html>...</html>" # Stage 2 rendered report
        }
        OR on invalid judgment:
        {
            "error": True,
            "status": "Invalid / not found",
            "data": {...}
        }
        OR on failure:
        {
            "error": True,
            "status": "failed",
            "message": "..."
        }
    """
    api_key = os.environ.get("CLAUDE_API_KEY") or os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise ValueError("CLAUDE_API_KEY or ANTHROPIC_API_KEY env var not set")

    client = anthropic.Anthropic(api_key=api_key)
    fmt = output_format.lower().strip()
    if fmt not in ("html", "markdown"):
        fmt = "html"

    # ── Stage 1: Extraction ──────────────────────────────────────────────────
    logger.info("[ReportBuilder] Stage 1 — extracting citation JSON for: %s", case_title[:80])

    stage1_user = (
        f"Case title: {case_title}\n"
        f"Query context: {query_context}\n"
        f"Full judgment text:\n{raw_judgment_text}\n\n"
        f"Extract all citation fields now. JSON:"
    )

    s1_response = client.messages.create(
        model=MODEL,
        max_tokens=4096,
        system=STAGE_1_SYSTEM,
        messages=[{"role": "user", "content": stage1_user}],
    )

    raw_json = _strip_fences(s1_response.content[0].text)

    try:
        citation_json: Dict[str, Any] = json.loads(raw_json)
    except (json.JSONDecodeError, ValueError) as e:
        logger.error("[ReportBuilder] Stage 1 JSON parse failed: %s\nRaw: %s", e, raw_json[:300])
        return {
            "error": True,
            "status": "failed",
            "message": f"Stage 1 JSON parse failed: {e}",
        }

    # ── Guard: skip Stage 2 for invalid judgments ────────────────────────────
    verification = citation_json.get("verificationStatus", "")
    if verification == "Invalid / not found":
        logger.warning("[ReportBuilder] Stage 1 returned 'Invalid / not found' — skipping Stage 2")
        return {
            "error": True,
            "status": "Invalid / not found",
            "data": citation_json,
        }

    logger.info(
        "[ReportBuilder] Stage 1 done — caseName=%s, status=%s",
        citation_json.get("caseName", "?"),
        verification,
    )

    # ── Stage 2: Rendering ───────────────────────────────────────────────────
    logger.info("[ReportBuilder] Stage 2 — rendering %s report", fmt)

    stage2_user = (
        f"{json.dumps(citation_json, indent=2, ensure_ascii=False)}\n\n"
        f"Output format: {fmt}\n\n"
        f"Render the professional Legal Citation Report now:"
    )

    max_tokens_stage2 = 6000 if fmt == "html" else 4000

    s2_response = client.messages.create(
        model=MODEL,
        max_tokens=max_tokens_stage2,
        system=STAGE_2_SYSTEM,
        messages=[{"role": "user", "content": stage2_user}],
    )

    rendered_report = s2_response.content[0].text.strip()

    logger.info(
        "[ReportBuilder] Stage 2 done — %d chars rendered",
        len(rendered_report),
    )

    return {
        "error": False,
        "citationJson": citation_json,
        "report": rendered_report,
        "format": fmt,
        "verificationStatus": verification,
        "argumentParty": citation_json.get("argumentParty") or "neutral",
        "partyArguments": citation_json.get("partyArguments") or {},
        "courtHierarchyStatus": citation_json.get("courtHierarchyStatus") or "",
        "currentStanding": citation_json.get("currentStanding") or "Good Law",
        "ratioOneLiner": citation_json.get("ratioOneLiner") or "",
        "goldenParagraphs": citation_json.get("goldenParagraphs") or [],
        "strategicRebuttal": citation_json.get("strategicRebuttal") or {},
        "keywords": citation_json.get("keywords") or [],
        "argumentConnector": citation_json.get("argumentConnector") or "",
        "factPatternMirror": citation_json.get("factPatternMirror") or {},
    }


def build_report_from_files(
    query_context: str,
    case_file_context: List[Dict[str, Any]],
    output_format: str = "html",
    case_title: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Convenience wrapper: extract raw text from case_file_context list and run build_report().

    case_file_context items are expected to have:
        { "name": str, "content": str | "snippet": str }
    """
    if not case_file_context:
        return {"error": True, "status": "failed", "message": "No case file context provided"}

    # Assemble raw judgment text from all attached files
    parts: List[str] = []
    title_candidate = case_title or ""

    for f in case_file_context:
        name = f.get("name") or f.get("filename") or "document"
        # Prefer full content over snippet
        text = f.get("content") or f.get("snippet") or f.get("text") or ""
        if text:
            parts.append(f"[Document: {name}]\n{text}")
        if not title_candidate:
            title_candidate = name

    if not parts:
        return {"error": True, "status": "failed", "message": "No text content in case files"}

    raw_text = "\n\n".join(parts)
    title = title_candidate or query_context[:80]

    return build_report(
        case_title=title,
        query_context=query_context,
        raw_judgment_text=raw_text,
        output_format=output_format,
    )
