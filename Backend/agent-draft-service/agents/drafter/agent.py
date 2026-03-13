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
    Run the Drafter agent.

    Agent config (type='drafting') is fetched from DB:
      - agent.name   → identifies which agent is active (shown in logs)
      - agent.prompt → system_instruction sent to LLM (HOW to draft)
      - agent.resolved_model → model to use (overridden by payload['model'] if set)
      - agent.temperature    → sampling temperature passed to LLM

    section_prompt (from payload) = WHAT to generate (from template_analysis_sections).
    """
    mode = payload.get("mode", "generate")
    section_key = payload.get("section_key", "unknown")
    section_prompt = payload.get("section_prompt", "")
    rag_context = payload.get("rag_context", "")
    field_values = payload.get("field_values", {})
    template_url = payload.get("template_url")
    previous_content = payload.get("previous_content")
    user_feedback = payload.get("user_feedback")
    detail_level = payload.get("detail_level") or "detailed"
    batch_info = payload.get("batch_info")
    language = payload.get("language") or "English"

    if not section_prompt and mode not in ("refine", "continue"):
        return {"error": "section_prompt is required for generation"}

    # ── Fetch drafting agent config from DB ───────────────────────────────────
    from services.agent_config_service import get_agent_by_type
    agent = get_agent_by_type("drafting")

    agent_name = (agent.get("name") or "unknown-agent") if agent else "no-agent-in-db"
    agent_id   = (agent.get("id") or "—") if agent else "—"
    db_prompt  = (agent.get("prompt") or "").strip() if agent else ""
    temperature = float((agent.get("temperature") or 0.7) if agent else 0.7)
    llm_params  = (agent.get("llm_parameters") or {}) if agent else {}

    # Allow payload to override temperature
    temperature = float(payload.get("temperature") or temperature)

    model = _resolve_drafter_model(payload, agent=agent)

    # ── Detailed log: agent identity, model, prompt, section prompt ───────────
    print(
        f"\n{'='*70}\n"
        f"[Drafter] AGENT CONFIG\n"
        f"  Agent name : {agent_name!r} (id={agent_id})\n"
        f"  Model      : {model!r}\n"
        f"  Temperature: {temperature}\n"
        f"  LLM params : {llm_params}\n"
        f"  System prompt ({len(db_prompt)} chars): "
        f"{db_prompt[:200]}{'...' if len(db_prompt) > 200 else ''}\n"
        f"[Drafter] SECTION REQUEST\n"
        f"  Section key   : {section_key!r}\n"
        f"  Mode          : {mode!r}\n"
        f"  Detail level  : {detail_level!r}\n"
        f"  Section prompt: {section_prompt[:200]}{'...' if len(section_prompt) > 200 else ''}\n"
        f"{'='*70}"
    )

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
        temperature=temperature,
        agent_name=agent_name,
        language=language,
    )

    if result.get("status") == "error":
        error = result.get("error_message", "Unknown error")
        print(f"[Drafter] ERROR for section={section_key!r}: {error}")
        return {
            "content_html": _placeholder_generate(section_key, error),
            "error": error,
        }

    print(
        f"[Drafter] SUCCESS section={section_key!r} | "
        f"HTML length={len(result.get('content_html', ''))} chars | "
        f"Agent={agent_name!r} | Model={model!r}"
    )
    return {
        "content_html": result.get("content_html", ""),
        "metadata": {
            "agent_name": agent_name,
            "agent_id": str(agent_id),
            "model": model,
            "temperature": temperature,
            "section_key": section_key,
            "mode": mode,
            "detail_level": detail_level,
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
