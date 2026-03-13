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


# User detail option: controls output length. Always accurate only.
DETAIL_LEVEL_INSTRUCTIONS = {
    "detailed": "LENGTH: LONG (2-10 A4 pages). Comprehensive, thorough, full paragraphs and details. Only accurate content—no filler.",
    "concise": "LENGTH: CONCISE. Balanced, clear, moderate detail for this section. Only accurate content.",
    "short": "LENGTH: SHORT. Brief, essential information only. One or a few focused paragraphs. Only accurate content.",
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
    if system_prompt_override and system_prompt_override.strip():
        system_prompt = system_prompt_override.strip()
        print(
            f"[Drafter tools] Agent={agent_name!r} | Model={model!r} | "
            f"System prompt from DB (length={len(system_prompt)}): {system_prompt[:120]}{'...' if len(system_prompt) > 120 else ''}"
        )
    else:
        # Fallback when no DB prompt configured — minimal safe instructions.
        system_prompt = (
            "You are an expert legal document drafter. "
            "Output raw HTML ONLY — no markdown, no code fences, no prose. "
            "Generate ONLY the content specified in the Section Prompt. "
            "Follow the HTML template structure, fonts, and inline styles exactly. "
            "Fill every placeholder from Field Data; court name, petitioner name, and respondent name must never be empty. "
            "Do not include citation markers, source names, or [cite: ...] in output."
        )
        print(
            f"[Drafter tools] Agent={agent_name!r} | Model={model!r} | "
            "No DB system prompt — using built-in fallback."
        )

    print(f"[Drafter tools] Section={section_key!r} | Mode={mode!r} | DetailLevel={detail_level!r} | Temperature={temperature}")
    print(f"[Drafter tools] Section prompt preview: {section_prompt[:160]}{'...' if len(section_prompt) > 160 else ''}")

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

OUTPUT RULES: Output length: {length_instruction}
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
- Output length: {length_instruction}
- Generate ONLY what the Section Prompt above specifies. Do not add unsolicited sections, preambles, or conclusions.
- Match the HTML template structure above exactly (same tags, classes, inline styles, order).
- Fill EVERY placeholder: [PETITIONER_NAME], [RESPONDENT_NAME], [COURT_NAME], [DATE], [CASE_NUMBER], [ADDRESS] etc.
  • Use Field Data first → then RAG → then safe fallback ("the Petitioner", "the Hon'ble Court").
  • Court name, petitioner name, and respondent name must NEVER be blank.
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

        if content_html is None:
            return {"status": "error", "error_message": "LLM returned no content"}
            
        return {"status": "success", "content_html": _clean_html_response(content_html)}

    except Exception as e:
        logger.exception("Drafting tool failed")
        return {"status": "error", "error_message": str(e)}
