"""
JuriNex Report Builder Agent — 2-Stage Sequential Pipeline.

Stage 1 (Extraction): claude-sonnet-4-6 extracts a 14-field Citation JSON from raw judgment text.
Stage 2 (Render):     claude-sonnet-4-6 renders a professional Legal Citation Report (HTML or Markdown).

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

STAGE_1_SYSTEM = """You are a Senior Legal Data Extraction Specialist trained on Indian court judgments published in SCC, AIR, and eCourts. Your sole function is precise, verifiable extraction — never inference or fabrication. Every field must be grounded in the judgment text provided.

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

OUTPUT RULE: Return ONLY a valid JSON object. No markdown fences. No preamble. No commentary. The response must be parseable by JSON.parse() without any cleanup."""

# ══════════════════════════════════════════════════════════════════════════════
# STAGE 2 — Legal Report Formatter
# ══════════════════════════════════════════════════════════════════════════════

STAGE_2_SYSTEM = """You are a legal report formatter for Indian courts. You receive a structured JSON citation object and render it as a professional, print-ready Legal Citation Report following Indian legal publishing conventions (SCC/AIR style).

FORMATTING RULES:
1. Open with a 'Citation Header Block' — case name in ALL CAPS, primary citation bold, court and date on the next line, coram as 'Coram:' label.
2. Use a clear two-column 'Quick Reference' table: left = label (bold), right = value.
3. HEADNOTE section: render immediately after the header block. Label it 'HEADNOTE' in uppercase. Display each numbered point on its own line in a teal-left-bordered box. This is the most prominent summary section — make it visually distinct.
4. Statutes section: numbered list, each entry formatted as 'Section X, [Act Name], [Year]'.
5. Ratio decidendi: render in a visually distinct blockquote box with a left rule. Prefix with 'RATIO DECIDENDI —'. Must be verbatim from the JSON field — do not paraphrase.
6. Key Excerpt: show paragraph reference (e.g., '¶ 42') as a superscript/header, then the text in italics within a bordered box.
7. Subsequent Treatment: only render this section if any of followed/distinguished/overruled arrays are non-empty.
8. Footer: verification badge (green = Verified, amber = Requires Review, red = Invalid) + source URL if available.

TONE & STRUCTURE:
- Formal. No filler sentences. No AI commentary.
- Every section must have a clear visual separator.
- Output clean HTML (no inline scripts) OR structured Markdown.
- Use whichever format is specified in the {format} variable."""


# ══════════════════════════════════════════════════════════════════════════════
# Citation JSON Schema (14 fields)
# ══════════════════════════════════════════════════════════════════════════════

CITATION_JSON_SCHEMA = {
    "caseName": "string",
    "primaryCitation": "string",
    "alternateCitations": "string[]",
    "court": "string",
    "coram": "string",
    "benchType": "string",
    "dateOfJudgment": "string — DD Month YYYY",
    "statutes": "string[] — e.g. 'Section 302, Indian Penal Code, 1860'",
    "ratio": "string — 2-4 sentences, the legal principle",
    "excerptPara": "string — e.g. 'Para 42'",
    "excerptText": "string — verbatim, max 300 words",
    "subsequentTreatment": {
        "followed": "string[]",
        "distinguished": "string[]",
        "overruled": "string[]",
    },
    "verificationStatus": "Verified and authentic | Requires review | Invalid / not found",
    "officialSourceUrl": "string | null",
    "headnote": "string — 4-5 numbered legal headnote points summarising key issues and holdings (SCC/AIR style). Format: '1. ...\\n2. ...'. Must focus on legal principles only, not facts.",
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
        max_tokens=2048,
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

    max_tokens_stage2 = 3000 if fmt == "html" else 2000

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
