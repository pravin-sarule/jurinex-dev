"""
Drafter Agent Tools - Google ADK powered.

Contains the actual implementation of drafting logic using Gemini or Claude.
"""

from __future__ import annotations

import logging
import os
from typing import Any, Dict, List, Optional, Union

from google import genai
from google.genai import types

logger = logging.getLogger(__name__)

DEFAULT_MODEL = "gemini-flash-lite-latest"

def _strip_citation_sources(text: str) -> str:
    """Remove [cite: ...], [Source: ...], and similar citation/source strings from generated content."""
    if not text:
        return ""
    import re
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

CHUNKS_PER_BATCH = 15  # Process ~15 chunks per API call to avoid token limits


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
) -> Dict[str, Any]:
    """
    Generate or refine a legal section using Gemini or Claude (by model).
    Drafter instructions (what to do) come FROM DB ONLY (agent_prompts.prompt for drafting).
    When DB prompt is empty, use a minimal fallback so the agent still follows section prompt and template.
    """
    from config.gemini_models import is_claude_model, claude_api_model_id

    # System prompt: ONLY from DB (draft instruction). No instructions file—DB defines what the drafter does.
    system_prompt = ""
    if system_prompt_override and system_prompt_override.strip():
        system_prompt = system_prompt_override.strip()
        print(f"[Drafter tools] Using draft instruction from DB only (length={len(system_prompt)})")
    else:
        # Minimal fallback when DB has no prompt: follow section prompt and template; aim for high confidence (90+).
        system_prompt = (
            "You are a legal document drafter. Your instructions come from the DB (agent_prompts for drafting). "
            "When no DB prompt is set: (1) Use ONLY the context chunks relevant to this section—ignore the rest. "
            "(2) Generate ONLY the parts explicitly mentioned in the Section Prompt; do not generate beyond what is asked. "
            "(3) Follow the HTML template structure exactly. (4) Produce draft that will score 90+ on validation: "
            "follow template, use only relevant chunks. Do not include source names or citations in the output. Output raw HTML only, no markdown."
        )
        print("[Drafter tools] No DB prompt; using minimal fallback (draft instruction should be set in DB).")

    detail_level = (detail_level or "concise").lower().strip()
    length_instruction = DETAIL_LEVEL_INSTRUCTIONS.get(detail_level, DETAIL_LEVEL_INSTRUCTIONS["concise"])

    try:
        parts = []

        if system_prompt:
            parts.append(f"System Instructions:\n{system_prompt}\n\n")

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
                template_content = fetch_template_html(template_url)
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
            # Continuation: respect detail_level length; only accurate content.
            prompt = f"""CONTINUE the section "{section_key}" with ADDITIONAL content. Use ONLY the chunks relevant to this section from the context below. What to add and how to format come from System Instructions and the TEMPLATE HTML FOR THIS SECTION ONLY above. Fill empty fields and placeholders from Field Data (from DB) first, then RAG.

**Content already generated (DO NOT REPEAT):**
{previous_content}

**Additional Context (RAG) — use only chunks relevant to this section:**
{rag_context if rag_context else 'No additional context.'}

**Field Data (from DB — use to fill empty fields/placeholders):**
{field_values}

{batch_info or ''}

**Detail level:** {length_instruction}
**Instructions:** Generate ONLY new continuation content. Use only relevant chunks. Match template format (Times New Roman, CSS indent). Use proper word and line spacing (line-height, paragraph margin). Format tables with proper <table>/<tr>/<td>; do not show sources or [Source: ...] in content. Fill placeholders from Field Data and RAG; court name, petitioner name, respondent name must never be empty. Return ONLY new HTML; no markdown.
"""
        elif user_feedback and previous_content:
            # Refinement: preserve structure; respect detail level; only accurate.
            prompt = f"""Refine the section "{section_key}" based on user feedback. Use only the chunks relevant to this section from the context below. What to add and format come from System Instructions and TEMPLATE HTML FOR THIS SECTION ONLY. Fill empty fields from Field Data (from DB) first, then RAG.

**Previous Content:**
{previous_content}

**User Feedback:**
{user_feedback}

**Context (RAG) — use only relevant chunks:**
{rag_context if rag_context else 'No additional context.'}

**Field Data (from DB — use to fill empty fields/placeholders):**
{field_values}

**Detail level:** {length_instruction}
**Instructions:** Update content per feedback. Preserve HTML structure, classes, styling. Use proper word and line spacing. Keep tables properly formatted (<table>, <tr>, <td>). Do not include source references or [Source: ...] in the content. Replace placeholders from Field Data or RAG; court name, petitioner name, respondent name must never be empty. Return ONLY the HTML content; no markdown.
"""
        else:
            # Generation: respect user detail option (detailed=long, concise=moderate, short=short); only accurate.
            prompt = f"""Generate ONLY what the Section Prompt below asks for—no extra content. You have been given multiple context chunks; use ONLY the chunks that are relevant to this section and ignore the rest. Use the **HTML Template Structure** above for format (tags, classes, IDs, alignment). Build draft in that format so it scores 90+ on validation.

**Rules:** (1) **Section Prompt** below is the prompt for this section **fetched from the database** (configured for this draft/template). Generate only what it specifies—nothing else. (2) **Format:** The TEMPLATE HTML FOR THIS SECTION ONLY above was extracted from the template URL for this section. Your output MUST use the **exact same format**: same tags, same order, same class and id attributes, same inline styles (font-family, font-size, margin, padding, text-align, text-indent). The frontend preview displays your HTML with the template styles—so matching the template exactly ensures the generated preview looks correct. (3) **Empty fields and placeholders** must be filled from **Field Data (from DB)** and RAG; use Field Data first, then RAG, then fallbacks.

**Section to draft:** {section_key}

**Section Prompt from DB (generate ONLY what is listed here—do not include anything not mentioned):**
{section_prompt}

**Retrieved Context (RAG) — use ONLY chunks relevant to this section; ignore the rest:**
{rag_context if rag_context else 'No specific context.'}

**Field Data (from DB — use this to fill ALL empty fields and placeholders first):**
{field_values}

**Detail level (user choice — follow strictly):** {length_instruction}

**CRITICAL — FILL ALL PLACEHOLDERS (no empty brackets):**
- **Court name, petitioner name, and respondent name must NEVER be empty.** Fill them from Field Data (template user fields + draft) first, then RAG, then fallbacks ("the Hon'ble Court", "the Petitioner", "the Respondent"). No blank court/petitioner/respondent in the generated section.
- Replace EVERY [PETITIONER_NAME], [RESPONDENT_NAME], [COURT_NAME], [DATE], [ADDRESS], [CASE_NUMBER], and any [FIELD_NAME] or _____ with real values.
- Step 1: Look in **Field Data** above for the exact key (e.g. petitioner_name, respondent_name, court_name, date). Use that value.
- Step 2: If not in Field Data, look in **Retrieved Context (RAG)** from the attached files — extract the name, date, or address from the text.
- Step 3: If still not found, use a proper fallback: "the Petitioner", "the Respondent", "the Hon'ble Court", "the said date", "the registered address" — NEVER output [PETITIONER_NAME] or leave a blank. No empty placeholders in the generated content.
- Your output must contain ZERO instances of unfilled brackets like [PETITIONER_NAME] or empty blanks. Every placeholder must be replaced with either actual data (from Field Data or RAG) or a fallback phrase.

**Spacing (words and lines):**
- Use proper spacing between words (single space; no double spaces or missing spaces).
- Use proper line spacing: add line-height (e.g. 1.5 or 1.6) and margin between paragraphs (e.g. margin-bottom: 0.5em or 1em) so lines and paragraphs are readable. Match the template if it specifies line-height or paragraph margin; otherwise use clear, professional spacing.

**Instructions:**
1. Use only the chunks that are needed for this section. Do not use or repeat content from irrelevant chunks.
2. **Strict section scope:** Generate ONLY the parts explicitly listed or described in the Section Prompt above. Do not add any heading, paragraph, list, or topic that is not mentioned in the Section Prompt. If the prompt says "include X, Y, Z", output only X, Y, Z—no other content.
3. Use the TEMPLATE FORMAT above exactly. Match the HTML structure (tags, classes, IDs, alignment). No &nbsp; for indent—use CSS.
4. **Tables:** Format tabular data properly. Use <table>, <thead>, <tbody>, <tr>, <th>, <td> with border/cell spacing from the template. Preserve table classes (e.g. class="data-table"). Align headers and cells; do not output raw text where a table is required.
5. **Do NOT show citation/source strings in the content:** The template or context may contain [cite: filename.pdf] or [Source: ...]. You must NOT include these in your output. Omit every [cite: ...] and [Source: ...] from the generated HTML. Use the context only to extract facts and names—never display source names, filenames, or citation tags in the final content.
6. Fill ALL placeholders from Field Data and RAG; never show [PETITIONER_NAME] or empty. Apply proper word and line spacing. Output ONLY raw HTML. No markdown. Aim for high confidence (90+).
"""
        parts.append(prompt)

        print(f"[Drafter tools] Model for this request: {model!r}")

        # Claude path: use Anthropic API
        if is_claude_model(model):
            api_key = os.environ.get("ANTHROPIC_API_KEY")
            if not api_key:
                return {"error": "ANTHROPIC_API_KEY not set for Claude model"}
            user_message = _parts_to_user_message(parts)
            api_model = claude_api_model_id(model)
            from services.claude_client import complete as claude_complete
            content_html = claude_complete(
                system_prompt=system_prompt,
                user_message=user_message,
                model=api_model,
            )
            if content_html is None:
                return {"status": "error", "error_message": "Claude API returned no content"}
            return {"status": "success", "content_html": _clean_html_response(content_html)}

        # Gemini path
        api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
        if not api_key:
            return {"error": "API Key not found"}
        client = genai.Client(api_key=api_key)

        # gemini-2.5-pro (and some others) only work in thinking mode: budget must be > 0
        THINKING_MODELS = ("gemini-2.5-pro", "gemini-3-pro-preview")
        thinking_budget = 1024 if model in THINKING_MODELS else 0
        tools = [types.Tool(googleSearch=types.GoogleSearch())]
        generate_content_config = types.GenerateContentConfig(
            thinking_config=types.ThinkingConfig(thinking_budget=thinking_budget),
            tools=tools,
        )

        response = client.models.generate_content(
            model=model,
            contents=parts,
            config=generate_content_config,
        )

        content_html = response.text if response and response.text else ""
        return {"status": "success", "content_html": _clean_html_response(content_html)}

    except Exception as e:
        logger.exception("Drafting tool failed")
        return {"status": "error", "error_message": str(e)}
