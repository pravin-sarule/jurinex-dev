"""
Drafter Agent Tools - Google ADK powered.

Contains the actual implementation of drafting logic using Gemini or Claude.
"""

from __future__ import annotations

import logging
import os
import re
from typing import Any, Dict, List, Optional, Union

from config.gemini_models import is_claude_model, claude_api_model_id

logger = logging.getLogger(__name__)

DEFAULT_MODEL = "gemini-flash-lite-latest"

# ── Template HTML cache ───────────────────────────────────────────────────────
# Templates change very rarely. Cache per URL for the process lifetime to avoid
# a network fetch on every section generation call.
_TEMPLATE_HTML_CACHE: dict[str, str] = {}

def _strip_citation_sources(text: str) -> str:
    """Remove [cite: ...], [Source: ...], and similar citation/source strings from generated content."""
    if not text:
        return ""
    # [cite: filename.pdf] or [cite: anything]
    text = re.sub(r'\[cite:\s*[^\]]*\]', '', text, flags=re.IGNORECASE)
    # [Source: ...]
    text = re.sub(r'\[Source:\s*[^\]]*\]', '', text, flags=re.IGNORECASE)
    # Footnote-style (e.g. [1], [2]) only if they look like source refs - leave normal footnotes; remove "Source: filename" plain text
    text = re.sub(r'Source:\s*[^\s<>\[\]]+\.(pdf|docx?)\b', '', text, flags=re.IGNORECASE)
    # Collapse multiple spaces left after removal
    text = re.sub(r'  +', ' ', text)
    return text.strip()


def _clean_html_response(text: str) -> str:
    """Strip markdown, citation sources, fix excessive nbsp/br, and clean artifacts."""
    if not text:
        return ""
    import re
    # Remove citation/source strings first (actual template may contain [cite: ...]; output must not)
    text = _strip_citation_sources(text)
    # Remove triple backticks blocks
    cleaned = re.sub(r'```(?:html)?\s*(.*?)\s*```', r'\1', text, flags=re.DOTALL)
    # Markdown artifacts
    cleaned = re.sub(r'\*\*(.*?)\*\*', r'<b>\1</b>', cleaned)
    cleaned = re.sub(r'\*(.*?)\*', r'<i>\1</i>', cleaned)
    # Replace excessive &nbsp; (3+ consecutive) with a single normal space
    cleaned = re.sub(r'(&nbsp;){3,}', ' ', cleaned)
    cleaned = re.sub(r'(\s|&nbsp;){10,}', ' ', cleaned)  # long whitespace runs
    # Collapse excessive <br> tags (more than 2 in a row) to max 2
    cleaned = re.sub(r'(<br\s*/?>)\s*(<br\s*/?>)\s*(<br\s*/?>\s*)+', r'\1\2', cleaned, flags=re.IGNORECASE)
    return cleaned.strip()

CHUNKS_PER_BATCH = 30  # Process ~30 chunks per API call; larger batch = fewer sequential LLM calls


def _parts_to_user_message(parts: List[Union[str, Any]]) -> str:
    """Flatten text parts for Claude (skip non-string parts e.g. Gemini Part from URI)."""
    return "\n\n".join(p for p in parts if isinstance(p, str))


# Detail level is only a hint — the Section Prompt always takes priority.
# If the prompt says "generate an index", generate only an index regardless of detail_level.
DETAIL_LEVEL_INSTRUCTIONS = {
    "detailed": "If the Section Prompt asks for comprehensive content, be thorough. Otherwise match the exact scope the Section Prompt specifies.",
    "concise": "Match the exact scope the Section Prompt specifies. Be clear and well-structured.",
    "short": "Match the exact scope the Section Prompt specifies. Be brief and to the point.",
}


def draft_section(
    section_key: str,
    section_prompt: str,
    rag_context: str,
    field_values: Dict[str, Any],
    template_url: Optional[str] = None,
    previous_content: Optional[str] = None,
    user_feedback: Optional[str] = None,
    mode: str = "generate",
    batch_info: Optional[str] = None,
    model: str = DEFAULT_MODEL,
    system_prompt_override: Optional[str] = None,
    detail_level: Optional[str] = None,
    temperature: float = 0.7,
    agent_name: Optional[str] = None,
    language: str = "English",
) -> Dict[str, Any]:
    """
    Generate or refine a legal section using Gemini or Claude (by model).

    Separation of concerns:
      - system_prompt (system_instruction) = drafter agent instructions from DB → HOW to write
      - section_prompt (user message)      = what to generate for THIS section → WHAT to write
      - template HTML                      = reference for structure/format
      - RAG context + field_values         = actual content / placeholder values
    """
    from config.gemini_models import is_claude_model, claude_api_model_id

    # ── System prompt: ONLY from DB agent config ─────────────────────────────
    # This tells the model HOW to behave (legal style, HTML-only output, rules).
    # Goes to Gemini system_instruction / Claude system prompt (NOT user message).
    # ── Language enforcement block (appended to any system prompt) ──────────
    # This is MANDATORY — it overrides and cannot be softened by DB prompt content.
    lang = (language or "English").strip()
    lang_directive = (
        f" LANGUAGE: Every word of your output MUST be written in {lang} only. "
        f"Do not include any text in any other language. "
        f"All legal terms, headings, body text, and HTML content must be in {lang}."
    ) if lang and lang.lower() != "english" else ""

    if system_prompt_override and system_prompt_override.strip():
        system_prompt = system_prompt_override.strip() + lang_directive
        prompt_source = "DB"
    else:
        # Fallback when no DB prompt configured — legal tone + strict scope.
        system_prompt = (
            "You are a senior advocate and expert legal document drafter with decades of courtroom experience. "
            "Write with a formal, precise legal tone — use correct legal terminology, proper case references, "
            "and the authoritative style expected in Indian court filings (pleadings, petitions, applications). "
            "Structure content as a lawyer would: logical flow, numbered paragraphs where appropriate, "
            "clear legal arguments, and no ambiguous language. "
            "Output raw HTML ONLY — no markdown, no code fences, no prose outside HTML tags. "
            "Generate EXACTLY and ONLY the content specified in the Section Prompt — nothing more. "
            "If the Section Prompt asks for an index, output only the index. "
            "If it asks for a title page, output only the title page. "
            "Never add extra sections, preambles, conclusions, or unsolicited content. "
            "Follow the HTML template structure, fonts, and inline styles exactly. "
            "Fill every placeholder from Field Data; court name, petitioner name, and respondent name must never be empty. "
            "Do not include citation markers, source names, or [cite: ...] in output."
        ) + lang_directive
        prompt_source = "DEFAULT (no DB prompt configured)"

    print(
        f"\n{'─'*70}\n"
        f"[Drafter] PROMPT & MODEL CONFIG\n"
        f"  Agent        : {agent_name!r}\n"
        f"  Model        : {model!r}  (source: payload > DB > default)\n"
        f"  Temperature  : {temperature}\n"
        f"  Language     : {lang!r}\n"
        f"  Prompt source: {prompt_source}\n"
        f"  Prompt length: {len(system_prompt)} chars\n"
        f"  Prompt preview: {system_prompt[:200]}{'...' if len(system_prompt) > 200 else ''}\n"
        f"[Drafter] SECTION REQUEST\n"
        f"  Section key  : {section_key!r}\n"
        f"  Mode         : {mode!r}\n"
        f"  Detail level : {detail_level!r}\n"
        f"  Section prompt ({len(section_prompt)} chars): {section_prompt[:200]}{'...' if len(section_prompt) > 200 else ''}\n"
        f"{'─'*70}"
    )

    detail_level = (detail_level or "concise").lower().strip()
    length_instruction = DETAIL_LEVEL_INSTRUCTIONS.get(detail_level, DETAIL_LEVEL_INSTRUCTIONS["concise"])

    try:
        # system_prompt goes to system_instruction (not into parts / user message)
        parts = []
        # NOTE: Do NOT add system_prompt to parts — it is passed separately to call_llm
        # as system_prompt → Gemini system_instruction / Claude system.

        # Fetch template, extract HTML for this specific section only, then section-wise format
        template_content = ""
        template_format_spec = ""
        section_template_html = ""
        if template_url:
            try:
                from services.template_format import (
                    fetch_template_html,
                    get_template_format_for_section,
                    extract_section_fragment,
                )
                # Cache template HTML per URL to avoid repeated network fetches
                if template_url not in _TEMPLATE_HTML_CACHE:
                    _TEMPLATE_HTML_CACHE[template_url] = fetch_template_html(template_url)
                template_content = _TEMPLATE_HTML_CACHE[template_url]
                if template_content:
                    # Section-wise: analyze template and extract HTML for only this section
                    section_template_html = extract_section_fragment(template_content, section_key)
                    if not section_template_html.strip():
                        section_template_html = template_content
                    template_format_spec = get_template_format_for_section(
                        template_url, section_key, html=template_content
                    )
                    parts.append(
                        f"TEMPLATE HTML FOR THIS SECTION ONLY (structure and styles — use this section only):\n{section_template_html}\n\n"
                    )
                    if template_format_spec:
                        parts.append(
                            "TEMPLATE FORMAT FOR THIS SECTION — USE EXACTLY (font-family, font-size, margin, padding, headings):\n"
                            f"{template_format_spec}\n\n"
                            "☝️ Apply the above section format exactly in your generated section.\n\n"
                        )
                    else:
                        parts.append("☝️ Follow the visual/structural style and inline styles from the template above.\n\n")
                else:
                    import requests
                    t_resp = requests.get(template_url, timeout=10)
                    if t_resp.status_code == 200:
                        template_content = t_resp.text
                        section_template_html = extract_section_fragment(template_content, section_key) or template_content
                        template_format_spec = get_template_format_for_section(
                            template_url, section_key, html=template_content
                        )
                        parts.append(f"TEMPLATE HTML FOR THIS SECTION ONLY:\n{section_template_html}\n\n")
                        if template_format_spec:
                            parts.append(f"TEMPLATE FORMAT FOR THIS SECTION (use exactly):\n{template_format_spec}\n\n")
                        else:
                            parts.append("☝️ Follow the template format from above.\n\n")
                    else:
                        parts.append(types.Part.from_uri(file_uri=template_url, mime_type="text/html"))
                        parts.append("☝️ Follow the template format (font, size, margin, padding, headings) from above.\n\n")
            except Exception as e:
                logger.warning("Could not load/fetch template_url: %s", e)

        if mode == "continue" and previous_content:
            # ── Batch continuation ────────────────────────────────────────────
            prompt = f"""SECTION: {section_key} — CONTINUATION {batch_info or ''}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTION PROMPT (same as initial — generate more content that fulfills it):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{section_prompt}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ALREADY GENERATED (DO NOT REPEAT — append new content only):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{previous_content}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ADDITIONAL CASE CONTEXT (this batch — use only chunks relevant to this section):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{rag_context if rag_context else 'No additional context.'}

FIELD DATA: {field_values}

OUTPUT RULES:
- LANGUAGE: All output must be in {lang} only — no other language.
- LEGAL TONE: Maintain formal legal language and advocate style throughout.
- STRICT SCOPE: Continue ONLY within the scope the Section Prompt specifies — no new sections or unsolicited content.
- Output ONLY NEW continuation HTML (not a repeat of Already Generated).
- Match template structure and inline styles. Fill all placeholders. No markdown, no code fences.
- Do NOT include citation/source markers.
"""
        elif user_feedback and previous_content:
            # ── Targeted refinement ───────────────────────────────────────────
            prompt = f"""SECTION: {section_key} — TARGETED EDIT

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
USER INSTRUCTION (apply ONLY this change — change nothing else):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{user_feedback}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PREVIOUS CONTENT (change only what the instruction refers to; copy everything else exactly):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{previous_content}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CASE CONTEXT (use only if the instruction needs facts from context):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{rag_context if rag_context else 'No additional context.'}

FIELD DATA: {field_values}

OUTPUT RULES:
- LANGUAGE: All output must be in {lang} only — no other language permitted.
- LEGAL TONE: Maintain formal legal language and advocate style.
- Apply the User Instruction as a MINIMAL SURGICAL EDIT. Change ONLY the specific part referenced.
- Return the COMPLETE section HTML with only that one change applied.
- Preserve all other paragraphs, headings, tables, inline styles, and HTML tags exactly.
- No markdown, no code fences. Raw HTML only.
"""
        else:
            # ── Fresh generation ──────────────────────────────────────────────
            prompt = f"""SECTION TO DRAFT: {section_key}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTION PROMPT (THIS IS WHAT YOU MUST GENERATE — follow exactly):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{section_prompt}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FIELD DATA (fill ALL placeholders from this first):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{field_values}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CASE CONTEXT (RAG — use only the chunks relevant to this section):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{rag_context if rag_context else 'No case context available. Use Field Data to fill values.'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OUTPUT RULES:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- LANGUAGE: Write ALL output exclusively in {lang}. Every word — headings, body, labels, tables — must be in {lang}. No other language permitted.
- LEGAL TONE: Write as a senior advocate. Use formal legal language, precise terminology, and the authoritative style expected in court filings. Numbered paragraphs where appropriate.
- STRICT SCOPE: Generate EXACTLY and ONLY what the Section Prompt specifies — nothing more, nothing less.
  If the Section Prompt says "generate an index", output only the index entries.
  If it says "generate a title page", output only the title page content.
  Do NOT add preambles, introductions, extra sections, summaries, or any content not explicitly asked for.
- Detail hint (only if Section Prompt does not already define scope): {length_instruction}
- Fill EVERY placeholder: [PETITIONER_NAME], [RESPONDENT_NAME], [COURT_NAME], [DATE], [CASE_NUMBER], [ADDRESS] etc.
  • Use Field Data first → then RAG → then safe fallback ("the Petitioner", "the Hon'ble Court").
  • Court name, petitioner name, and respondent name must NEVER be blank.
- Match the HTML template structure above exactly (same tags, classes, inline styles, order).
- Output raw HTML only. No markdown, no code fences, no prose outside HTML tags.
- Use inline styles: font-family: 'Times New Roman', serif; font-size: 16px; line-height: 1.5; text-align: justify; margin-bottom: 1em.
- Tables: use proper <table><tr><td> with border style. Headings: center-aligned.
- Do NOT include [cite: ...], [Source: ...], or any citation markers in output.
"""
        parts.append(prompt)

        from services.llm_service import call_llm
        from agents.drafter.tools import _parts_to_user_message

        user_message = _parts_to_user_message(parts)

        print(
            f"[Drafter tools] Calling LLM → Agent={agent_name!r} | Model={model!r} | "
            f"Temp={temperature} | UserMsg={len(user_message)} chars | SysPrompt={len(system_prompt)} chars"
        )

        content_html = call_llm(
            prompt=user_message,
            system_prompt=system_prompt,   # → Gemini system_instruction / Claude system
            model=model,
            temperature=temperature,
            use_google_search=False,       # RAG context already provides all facts; web search adds latency
        )

        if not content_html:
            return {"status": "error", "error_message": f"LLM returned empty content (model={model!r})"}

        return {"status": "success", "content_html": _clean_html_response(content_html)}

    except Exception as e:
        logger.exception("Drafting tool failed")
        return {"status": "error", "error_message": str(e)}


# ── HTML Draft Generator (2-pass LLM pipeline) ───────────────────────────────

from pydantic import BaseModel as _BaseModel
from typing import List as _List


class HTMLValidation(_BaseModel):
    is_valid: bool
    unfilled_placeholders: _List[str]
    missing_classes: _List[str]
    uncited_blocks: _List[str]
    gaps_count: int
    warnings: _List[str]


_TEMPLATE_ANALYSER_SYSTEM = """You are an expert HTML/CSS template analyst.
You will receive a raw HTML template. Your job is to deeply understand its structure
before any content is written into it.
Analyse and return a JSON object with:
{
  "layout_description": "one paragraph describing the visual layout and purpose",
  "sections": [
    {
      "selector": "#section-id or .class-name",
      "role": "hero | summary | body | table | chart | footer | sidebar",
      "content_type": "heading | paragraph | list | table | image | chart | mixed",
      "max_words_estimate": 120,
      "placeholder_text": "current placeholder text in this slot",
      "css_classes_to_preserve": ["class1", "class2"]
    }
  ],
  "typography": {
    "heading_class": "...",
    "body_class": "...",
    "accent_class": "..."
  },
  "interactivity_needed": ["tab switching", "accordion", "chart render", "none"],
  "data_tables_present": true,
  "charts_present": false
}
Return ONLY valid JSON. No explanation text."""

_DRAFT_GENERATOR_SYSTEM = """You are an expert technical writer and frontend developer combined.
You generate complete, production-ready HTML documents that are:
- Fully self-contained (all CSS inline or in a <style> block, no external files except fonts)
- Visually identical to the provided template in layout, spacing, and typography
- Populated with accurate, grounded content from the provided source chunks

STRICT CONTENT RULES:
- Every piece of factual content you write MUST come from the provided source chunks.
- Tag each paragraph or cell internally in an HTML comment: <!-- CHUNK-N -->
- If a section has no supporting chunk data, insert:
  <div class="draft-gap" data-gap="true"><p>[INFORMATION NOT AVAILABLE IN SOURCES]</p></div>
- Never fabricate statistics, dates, names, or claims not present in chunks.
- Never leave placeholder text like "Lorem ipsum" or "Insert content here" in output.

STRICT HTML/CSS RULES:
- Preserve ALL original CSS classes from the template exactly.
- Preserve the template's color tokens (--primary, --accent etc) in :root.
- Carry forward all Google Fonts @import links exactly.
- Do NOT restructure the layout — fill the existing structure.
- All text must be properly aligned per the template's existing alignment classes.
- Tables must have proper <thead>, <tbody>, correct colspan/rowspan.
- If the template has a chart placeholder (canvas, .chart-container, #chart-*):
  Use Chart.js from CDN: https://cdn.jsdelivr.net/npm/chart.js
  Generate the chart data from chunks.
  Initialise the chart in a <script> block at end of <body>.
- If the template has tabs or accordions, implement them with vanilla JS — no jQuery.
- All <script> blocks go at the end of <body>, never in <head>.

OUTPUT FORMAT:
Return ONLY the complete HTML. No markdown fences. No explanation. Just raw HTML
starting with <!DOCTYPE html> and ending with </html>."""


def _format_chunks_for_prompt(chunks: list) -> str:
    """Format chunks list into numbered prompt block."""
    parts = []
    for i, chunk in enumerate(chunks, 1):
        doc_id = chunk.get("file_id") or chunk.get("doc_id") or "unknown"
        page = chunk.get("page_start") or chunk.get("page") or "?"
        score = chunk.get("similarity") or chunk.get("relevance_score") or 0
        text = (chunk.get("content") or chunk.get("text") or "").strip()
        if text:
            parts.append(
                f"[CHUNK-{i}] | doc: {doc_id} | page: {page} | score: {score:.3f}\n{text}"
            )
    return "\n\n".join(parts)


def generate_html_draft(
    section_title: str,
    section_prompt: str,
    template_raw_html: str,
    chunks: list,
    model: str = DEFAULT_MODEL,
    temperature: float = 0.4,
    repair_context: Optional[str] = None,
    previous_draft: Optional[str] = None,
) -> Dict[str, Any]:
    """
    2-pass LLM pipeline to generate a complete self-contained HTML draft.

    Pass 1 — Template Analysis: Understand the template structure and slots.
    Pass 2 — Content Generation: Fill the template with content from chunks.

    Returns { status, html, template_analysis, error_message? }
    """
    from services.llm_service import call_llm

    if not template_raw_html:
        return {"status": "error", "error_message": "template_raw_html is required"}

    # ── Pass 1: Template Analysis ─────────────────────────────────────────────
    analysis_user_msg = (
        f"Analyse this HTML template:\n{template_raw_html}\n\n"
        "Identify every slot where content will be injected."
    )
    logger.info("[DraftGenerator] Pass 1 — template analysis (model=%s)", model)
    analysis_raw = call_llm(
        prompt=analysis_user_msg,
        system_prompt=_TEMPLATE_ANALYSER_SYSTEM,
        model=model,
        temperature=0.1,
        response_mime_type="application/json",
    )
    if not analysis_raw:
        return {"status": "error", "error_message": "Template analysis LLM call returned no content"}

    import json as _json
    import re as _re
    # Strip markdown fences if present
    analysis_clean = _re.sub(r'^```(?:json)?\s*', '', analysis_raw.strip())
    analysis_clean = _re.sub(r'\s*```$', '', analysis_clean).strip()
    try:
        template_analysis = _json.loads(analysis_clean)
    except Exception:
        template_analysis = {"raw": analysis_clean}

    template_analysis_json = _json.dumps(template_analysis, indent=2)
    logger.info(
        "[DraftGenerator] Pass 1 complete — sections=%d, charts=%s",
        len(template_analysis.get("sections", [])),
        template_analysis.get("charts_present", False),
    )

    # ── Pass 2: Content Generation ────────────────────────────────────────────
    chunks_text = _format_chunks_for_prompt(chunks)

    repair_block = ""
    if repair_context and previous_draft:
        repair_block = (
            f"\n\nREPAIR INSTRUCTIONS (apply to previous draft):\n{repair_context}\n\n"
            f"PREVIOUS DRAFT (fix only the issues above, preserve everything else):\n"
            f"{previous_draft[:8000]}{'...[truncated]' if len(previous_draft) > 8000 else ''}\n"
        )

    generation_user_msg = (
        f"SECTION TO DRAFT\n"
        f"Title: {section_title}\n"
        f"Writing Instructions: {section_prompt}\n\n"
        f"TEMPLATE ANALYSIS\n{template_analysis_json}\n\n"
        f"RAW TEMPLATE HTML\n{template_raw_html}\n\n"
        f"SOURCE CHUNKS (use ONLY these for content)\n{chunks_text or '[No source chunks provided]'}"
        f"{repair_block}\n\n"
        "TASK\n"
        "- Preserve the template's exact layout, classes, colors, fonts\n"
        "- Fill every section with content from the chunks above\n"
        "- Cite every paragraph with an HTML comment <!-- CHUNK-N -->\n"
        "- Mark any gaps with <div class=\"draft-gap\">\n"
        "- Implement any required JS (charts, tabs, accordions)\n"
        "- Return ONLY raw HTML starting with <!DOCTYPE html>"
    )

    logger.info("[DraftGenerator] Pass 2 — content generation (model=%s, chunks=%d)", model, len(chunks))
    generated_html = call_llm(
        prompt=generation_user_msg,
        system_prompt=_DRAFT_GENERATOR_SYSTEM,
        model=model,
        temperature=temperature,
    )
    if not generated_html:
        return {"status": "error", "error_message": "Content generation LLM call returned no content"}

    # Strip markdown code fences if the model wrapped the output
    generated_html = _re.sub(r'^```(?:html)?\s*', '', generated_html.strip())
    generated_html = _re.sub(r'\s*```$', '', generated_html).strip()

    return {
        "status": "success",
        "html": generated_html,
        "template_analysis": template_analysis,
    }


def validate_generated_html(
    html: str,
    template_raw_html: str,
    chunks: list,
) -> HTMLValidation:
    """
    Programmatic post-generation validation.

    Check 1 — No placeholder text remaining
    Check 2 — All original CSS classes preserved
    Check 3 — draft-gap elements are reasonable
    Check 4 — Basic script syntax guard (unmatched braces)
    Check 5 — Chunk citation coverage (3+ sentences without <!-- CHUNK-N --> comment)
    """
    import re as _re

    warnings: _List[str] = []
    unfilled: _List[str] = []
    missing_classes: _List[str] = []
    uncited_blocks: _List[str] = []

    # Check 1 — Unfilled placeholders
    PLACEHOLDER_PATTERNS = [
        r'lorem\s+ipsum', r'\bplaceholder\b', r'insert content here',
        r'coming soon', r'\{\{[^}]+\}\}', r'\[DRAFT\]', r'\bTBD\b', r'\bTODO\b',
    ]
    html_lower = html.lower()
    for pat in PLACEHOLDER_PATTERNS:
        for m in _re.finditer(pat, html_lower):
            snippet = html[max(0, m.start()-20):m.end()+20].strip()
            unfilled.append(snippet)

    # Check 2 — Missing CSS classes from template
    try:
        from bs4 import BeautifulSoup as _BS
        tpl_soup = _BS(template_raw_html, "html.parser")
        tpl_classes: set = set()
        for el in tpl_soup.find_all(True):
            for c in (el.get("class") or []):
                if c:
                    tpl_classes.add(c)

        gen_soup = _BS(html, "html.parser")
        gen_classes: set = set()
        for el in gen_soup.find_all(True):
            for c in (el.get("class") or []):
                if c:
                    gen_classes.add(c)

        missing_classes = sorted(tpl_classes - gen_classes)
    except ImportError:
        warnings.append("beautifulsoup4 not available; class check skipped")
    except Exception as e:
        warnings.append(f"class check error: {e}")

    # Check 3 — Count gap markers
    gaps_count = len(_re.findall(r'class=["\'][^"\']*draft-gap', html, _re.IGNORECASE))

    # Check 4 — Script syntax guard (unmatched braces)
    script_blocks = _re.findall(r'<script[^>]*>([\s\S]*?)</script>', html, _re.IGNORECASE)
    for i, block in enumerate(script_blocks):
        opens = block.count('{')
        closes = block.count('}')
        if abs(opens - closes) > 5:
            warnings.append(f"Script block {i+1}: possible unmatched braces ({opens} open, {closes} close)")

    # Check 5 — Uncited blocks (3+ sentences without <!-- CHUNK-N -->)
    # Split on <!-- CHUNK-N --> comments and check sentence density
    comment_pattern = _re.compile(r'<!--\s*CHUNK-\d+\s*-->', _re.IGNORECASE)
    text_only = _re.sub(r'<[^>]+>', ' ', html)
    segments = comment_pattern.split(text_only)
    sentence_pattern = _re.compile(r'[.!?]+\s+[A-Z]')
    for seg in segments:
        seg_stripped = seg.strip()
        if len(seg_stripped) < 50:
            continue
        sentence_count = len(sentence_pattern.findall(seg_stripped))
        if sentence_count >= 3:
            preview = seg_stripped[:120].replace('\n', ' ')
            uncited_blocks.append(preview)

    is_valid = (
        len(unfilled) == 0
        and len(missing_classes) == 0
        and len(warnings) == 0
    )

    return HTMLValidation(
        is_valid=is_valid,
        unfilled_placeholders=unfilled[:10],
        missing_classes=missing_classes[:20],
        uncited_blocks=uncited_blocks[:10],
        gaps_count=gaps_count,
        warnings=warnings,
    )
