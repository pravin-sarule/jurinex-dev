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


def _resolve_drafting_agent_config(payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Resolve the drafting-agent DB row by specific name before falling back to generic type."""
    from services.agent_config_service import get_agent_by_preferences

    return get_agent_by_preferences(
        agent_type="drafting",
        preferred_names=[
            payload.get("db_agent_name"),
            payload.get("agent_name"),
            payload.get("agent_config_name"),
            "Jurinex Drafter Agent",
            "Drafter Agent",
        ],
    )


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
    agent = _resolve_drafting_agent_config(payload)

    agent_name = (agent.get("name") or "unknown-agent") if agent else "no-agent-in-db"
    agent_id   = (agent.get("id") or "—") if agent else "—"
    db_prompt  = (agent.get("prompt") or "").strip() if agent else ""
    temperature = float((agent.get("temperature") or 0.7) if agent else 0.7)
    llm_params  = (agent.get("llm_parameters") or {}) if agent else {}

    # Allow payload to override temperature
    temperature = float(payload.get("temperature") or temperature)

    model = _resolve_drafter_model(payload, agent=agent)

    # ── Agent config log (prompt resolution happens inside draft_section) ───────
    prompt_source = f"DB (agent_id={agent_id}, {len(db_prompt)} chars)" if db_prompt else "DEFAULT (no DB prompt — fallback will be used)"
    print(
        f"\n{'='*70}\n"
        f"[Drafter] AGENT CONFIG\n"
        f"  Agent name   : {agent_name!r} (id={agent_id})\n"
        f"  Model        : {model!r}  ← from DB agent config\n"
        f"  Temperature  : {temperature}\n"
        f"  LLM params   : {llm_params}\n"
        f"  Prompt source: {prompt_source}\n"
        f"  Prompt preview: {db_prompt[:200]}{'...' if len(db_prompt) > 200 else ''}\n"
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

def run_html_draft_generator(payload: dict) -> dict:
    """
    HTML Draft Generator Agent — 2-pass LLM pipeline.

    Expects payload:
      - section_title: str
      - section_prompt: str
      - template_raw_html: str       (from librarian output)
      - chunks: list                 (from librarian output)
      - repair_context: Optional[str]   (non-None on repair pass)
      - previous_draft: Optional[str]   (non-None on repair pass)
      - model: Optional[str]

    Returns { status, html, template_analysis, validation, error? }
    """
    from agents.drafter.tools import generate_html_draft, validate_generated_html

    section_title = payload.get("section_title") or payload.get("section_key", "Document Section")
    section_prompt = payload.get("section_prompt", "")
    template_raw_html = payload.get("template_raw_html", "")
    chunks = payload.get("chunks", [])
    repair_context = payload.get("repair_context")
    previous_draft = payload.get("previous_draft")

    agent = _resolve_drafting_agent_config(payload)
    model = payload.get("model") or (agent.get("resolved_model") if agent else DEFAULT_MODEL)
    temperature = float(payload.get("temperature") or (agent.get("temperature") if agent else 0.4))

    logger.info(
        "[HtmlDraftGenerator] section=%r model=%r template_len=%d chunks=%d repair=%s",
        section_title, model, len(template_raw_html), len(chunks), bool(repair_context),
    )

    result = generate_html_draft(
        section_title=section_title,
        section_prompt=section_prompt,
        template_raw_html=template_raw_html,
        chunks=chunks,
        model=model,
        temperature=temperature,
        repair_context=repair_context,
        previous_draft=previous_draft,
    )

    if result.get("status") == "error":
        return result

    html = result["html"]
    validation = validate_generated_html(html, template_raw_html, chunks)

    return {
        "status": "success",
        "html": html,
        "template_analysis": result.get("template_analysis", {}),
        "validation": validation.model_dump(),
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
