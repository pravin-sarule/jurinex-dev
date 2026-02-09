"""
Drafter Agent Tools - Google ADK powered.

Contains the actual implementation of drafting logic using Gemini.
"""

from __future__ import annotations

import logging
import os
from typing import Any, Dict, Optional

from google import genai
from google.genai import types

logger = logging.getLogger(__name__)

DEFAULT_MODEL = "gemini-flash-lite-latest"

def _clean_html_response(text: str) -> str:
    """Strip markdown code blocks and excess whitespace."""
    if not text:
        return ""
    # Remove triple backticks blocks: ```html ... ``` or ``` ... ```
    import re
    cleaned = re.sub(r'```(?:html)?\s*(.*?)\s*```', r'\1', text, flags=re.DOTALL)
    # Clean up common LLM markdown artifacts
    cleaned = re.sub(r'\*\*(.*?)\*\*', r'<b>\1</b>', cleaned) # **text** -> <b>text</b>
    cleaned = re.sub(r'\*(.*?)\*', r'<i>\1</i>', cleaned)   # *text* -> <i>text</i>
    return cleaned.strip()

def draft_section(
    section_key: str,
    section_prompt: str,
    rag_context: str,
    field_values: Dict[str, Any],
    template_url: Optional[str] = None,
    previous_content: Optional[str] = None,
    user_feedback: Optional[str] = None,
    model: str = DEFAULT_MODEL,
) -> Dict[str, Any]:
    """
    Generate or refine a legal section using Gemini.
    """
    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        return {"error": "API Key not found"}

    # Load system prompt
    system_prompt = ""
    try:
        from pathlib import Path
        instr_path = Path(__file__).parent.parent.parent / "instructions" / "drafter.txt"
        if instr_path.exists():
            system_prompt = instr_path.read_text(encoding="utf-8").strip()
    except Exception:
        pass

    try:
        client = genai.Client(api_key=api_key)
        parts = []

        if system_prompt:
            parts.append(f"System Instructions:\n{system_prompt}\n\n")

        if template_url:
            try:
                # Fetch template content if it's HTML to provide as text context
                # This is more reliable than from_uri for text/html
                import requests
                logger.info("Drafter tool: Fetching template content from signed URL")
                t_resp = requests.get(template_url, timeout=10)
                if t_resp.status_code == 200:
                    template_content = t_resp.text
                    parts.append(f"TEMPLATE STRUCTURE FOR REFERENCE:\n{template_content}\n\n")
                    parts.append("☝️ Follow the visual/structural style from the template above.\n\n")
                else:
                    parts.append(types.Part.from_uri(file_uri=template_url, mime_type="text/html"))
                    parts.append("☝️ The above is the template format for visual reference.\n\n")
            except Exception as e:
                logger.warning("Could not load/fetch template_url: %s", e)

        if user_feedback and previous_content:
            # Refinement mode
            prompt = f"""You are an expert legal document drafter. Refine the section "{section_key}" based on user feedback.

**Previous Content:**
{previous_content}

**User Feedback:**
{user_feedback}

**Retrieved Context (RAG):**
{rag_context if rag_context else 'No additional context.'}

**Field Data:**
{field_values}

**CRITICAL INSTRUCTIONS:**
1. Update content based on user feedback.
2. NEVER use placeholder brackets like [FIELD_NAME], [PETITIONER_NAME], [DATE], etc. in the output.
3. ALWAYS fill in ALL data using actual values from Field Data and Retrieved Context.
4. If a specific value is not available:
   - For names/parties: Use generic terms like "the Petitioner", "the Respondent"
   - For dates: Use "the date of [event]" or descriptive text
   - NEVER leave empty brackets or placeholders
5. **PRESERVE TEMPLATE FORMAT (CRITICAL):**
   - MAINTAIN the exact formatting, styling, and structure from the previous content
   - Keep all font families, font sizes, and font weights unchanged
   - Preserve text alignment (left, center, right, justify)
   - Maintain spacing, line heights, and paragraph margins
   - Keep indentation levels and list formatting
   - Preserve CSS classes, inline styles, and HTML structure
   - Keep the same HTML tags (div, span, table, etc.)
   - Maintain any special formatting like bold, italic, underline, colors
   - **Only update the text content, not the formatting**
6. Citation: Mention sources (filenames/cases) if using context information.
7. Use HTML format, NO markdown code blocks (triple backticks).
8. Return ONLY the HTML content.
"""
        else:
            # Generation mode
            prompt = f"""You are an expert legal document drafter. Generate content for the section "{section_key}".

**Section Prompt:** {section_prompt}

**Retrieved Context (RAG):**
{rag_context if rag_context else 'No specific context.'}

**Field Data:**
{field_values}

**CRITICAL INSTRUCTIONS:**
1. Generate FULL, professional legal content in HTML.
2. NEVER use placeholder brackets like [FIELD_NAME], [PETITIONER_NAME], [DATE], etc. in the output.
3. ALWAYS fill in ALL data using the actual values from:
   - **Field Data** above (e.g., if field_values contains "petitioner_name": "John Doe", use "John Doe" directly)
   - **Retrieved Context (RAG)** above (extract names, dates, addresses, case details from the context)
4. If a specific value is not available in Field Data or RAG Context:
   - For names/parties: Use generic terms like "the Petitioner", "the Respondent", "the Plaintiff", "the Defendant"
   - For dates: Use "the date of [event]" or "on [specify date]"
   - For addresses: Use "at [specify address]" or "the registered address"
   - NEVER leave empty brackets or placeholders
5. **TEMPLATE FORMAT ADHERENCE (CRITICAL):**
   - STRICTLY follow the exact formatting, styling, and structure from the template provided above
   - Match the font family, font size, and font weight from the template
   - Replicate text alignment (left, center, right, justify) exactly as shown in template
   - Preserve spacing, line heights, and paragraph margins from template
   - Maintain indentation levels and list formatting from template
   - Copy CSS classes, inline styles, and HTML structure from template
   - If template uses specific HTML tags (div, span, table, etc.), use the same tags
   - Preserve any special formatting like bold, italic, underline, colors from template
   - **Your output should look visually identical to the template format**
6. Citation: Mention sources (filenames/cases) if using context information.
7. Use HTML format, NO markdown code blocks (triple backticks).
8. Return ONLY the HTML content.
9. Default to "Times New Roman" font family if template doesn't specify.

**EXAMPLE OF CORRECT OUTPUT:**
Instead of: "Name: [PETITIONER_NAME]"
Use: "Name: Kitti Dal Mills Ltd." (from RAG context or field data)

Instead of: "Date: [DATE_OF_SIGNATURE_1]"
Use: "Date: January 15, 2024" (from RAG context or field data)

**FORMAT MATCHING EXAMPLE:**
If template shows:
  <h2 style="text-align: center; font-weight: bold;">TITLE</h2>
  <p style="text-indent: 50px;">Content here</p>

Your output MUST use the same structure:
  <h2 style="text-align: center; font-weight: bold;">ACTUAL TITLE</h2>
  <p style="text-indent: 50px;">Actual content here</p>
"""
        parts.append(prompt)

        # Implementation matching user's requested snippet
        from google.genai import types
        tools = [types.Tool(googleSearch=types.GoogleSearch())]
        generate_content_config = types.GenerateContentConfig(
            thinking_config=types.ThinkingConfig(thinking_budget=0),
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
