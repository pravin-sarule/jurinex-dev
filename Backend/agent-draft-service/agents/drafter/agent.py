"""
Drafter Agent (ADK-style): Generate legal document section content.
Model is taken from payload['model'], or from DB agent config for agent_type 'drafting', or default.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, Optional

from agents.drafter.tools import draft_section

logger = logging.getLogger(__name__)

DEFAULT_MODEL = "gemini-flash-lite-latest"


def _resolve_drafter_model(payload: Dict[str, Any], agent: Optional[Dict[str, Any]] = None) -> str:
    """Model: payload['model'] > DB agent config (drafting) > DEFAULT_MODEL."""
    from config.gemini_models import is_valid_model
    from services.agent_config_service import get_resolved_model_for_agent

    override = payload.get("model")
    if override and is_valid_model(override):
        return override
    if agent:
        return agent.get("resolved_model") or get_resolved_model_for_agent("drafting", override_model=override)
    return get_resolved_model_for_agent("drafting", override_model=override)


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
    detail_level = payload.get("detail_level") or "concise"  # detailed | concise | short

    if not section_prompt and mode != "refine":
        return {"error": "section_prompt is required for generation"}

    # Fetch agent from DB once: used for model resolution and prompt
    from services.agent_config_service import get_agent_by_type
    agent = get_agent_by_type("drafting")
    model = _resolve_drafter_model(payload, agent=agent)
    print(f"[Drafter] Using model: {model!r} (from DB agent config or payload)")
    db_prompt = (agent.get("prompt") or "").strip() if agent else ""

    # Use the tool
    mode = payload.get("mode", "generate")
    batch_info = payload.get("batch_info")
    result = draft_section(
        section_key=section_key,
        section_prompt=section_prompt,
        rag_context=rag_context,
        field_values=field_values,
        template_url=template_url,
        previous_content=previous_content,
        user_feedback=user_feedback,
        mode=mode,
        batch_info=batch_info,
        model=model,
        system_prompt_override=db_prompt or None,
        detail_level=detail_level,
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
            "model": model,
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
