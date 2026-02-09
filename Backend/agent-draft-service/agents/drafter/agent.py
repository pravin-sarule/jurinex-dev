"""
Drafter Agent (ADK-style): Generate legal document section content.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, Optional

from agents.drafter.tools import draft_section

logger = logging.getLogger(__name__)

DEFAULT_MODEL = "gemini-flash-lite-latest"

def run_drafter_agent(payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    Run the Drafter agent: use drafting tools and report results.
    """
    mode = payload.get("mode", "generate")
    section_key = payload.get("section_key", "unknown")
    section_prompt = payload.get("section_prompt", "")
    rag_context = payload.get("rag_context", "")
    field_values = payload.get("field_values", {})
    template_url = payload.get("template_url")
    previous_content = payload.get("previous_content")
    user_feedback = payload.get("user_feedback")

    if not section_prompt and mode != "refine":
        return {"error": "section_prompt is required for generation"}

    # Use the tool
    result = draft_section(
        section_key=section_key,
        section_prompt=section_prompt,
        rag_context=rag_context,
        field_values=field_values,
        template_url=template_url,
        previous_content=previous_content,
        user_feedback=user_feedback,
    )

    if result.get("status") == "error":
        error = result.get("error_message", "Unknown error")
        return {
            "content_html": _placeholder_generate(section_key, error),
            "error": error
        }

    return {
        "content_html": result.get("content_html", ""),
        "metadata": {
            "model": DEFAULT_MODEL,
            "section_key": section_key,
            "mode": mode,
        },
    }

def _placeholder_generate(section_key: str, error: str) -> str:
    """Fallback UI for errors."""
    clean_error = error
    if "404" in error:
        clean_error = "Model 'gemini-2.5-pro' not found. Please verify availability."
    elif "403" in error:
        clean_error = "API Key permission denied."

    return f"""<div style="padding: 20px; border: 1px solid #fca5a5; background-color: #fef2f2; border-radius: 8px; color: #b91c1c;">
  <h2 style="margin-top: 0; font-size: 1.25rem;">⚠️ Generation Failed: {section_key.replace('_', ' ').title()}</h2>
  <p><strong>Error:</strong> {clean_error}</p>
  <p>Please try again or edit manually.</p>
</div>"""
