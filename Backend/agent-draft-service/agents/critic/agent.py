"""
Critic Agent (ADK-style): Validate and review legal draft content.
"""

from __future__ import annotations

import logging
from typing import Any, Dict

from agents.critic.tools import review_section, review_html_draft

logger = logging.getLogger(__name__)

DEFAULT_MODEL = "models/gemini-2.5-pro"


def run_critic_agent(payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    Run the Critic agent: use review tools and report results.
    """
    section_content = payload.get("section_content", "")
    section_key = payload.get("section_key", "unknown")
    rag_context = payload.get("rag_context", "")
    field_values = payload.get("field_values", {})
    section_prompt = payload.get("section_prompt", "")

    if not section_content:
        return {"error": "section_content is required for review"}

    # Fetch agent from DB once: used for model resolution and prompt
    from services.agent_config_service import get_agent_by_preferences
    agent = get_agent_by_preferences(
        agent_type="critic",
        preferred_names=[
            payload.get("db_agent_name"),
            payload.get("agent_name"),
            "Jurinex Critic Agent",
            "Critic Agent",
        ],
    )
    model = payload.get("model") or (agent.get("resolved_model") if agent else DEFAULT_MODEL)
    db_prompt = (agent.get("prompt") or "").strip() if agent else ""

    model_source = "payload override" if payload.get("model") else ("DB agent config" if agent else "DEFAULT hardcoded")
    prompt_source = f"DB (agent_id={agent.get('id')}, {len(db_prompt)} chars)" if db_prompt else "DEFAULT (no DB prompt — fallback will be used)"
    logger.info(
        "\n%s\n[Critic] AGENT CONFIG\n"
        "  Agent name   : %s (id=%s)\n"
        "  Model        : %r  ← from %s\n"
        "  Prompt source: %s\n"
        "  Prompt preview: %s\n"
        "  Section key  : %r\n%s",
        "─" * 70,
        agent.get("name") if agent else "no-agent-in-db",
        agent.get("id") if agent else "—",
        model, model_source,
        prompt_source,
        (db_prompt[:200] + "..." if len(db_prompt) > 200 else db_prompt) if db_prompt else "(none — using critic.txt or hardcoded fallback)",
        section_key,
        "─" * 70,
    )

    # Use the tool
    result = review_section(
        section_content=section_content,
        section_key=section_key,
        rag_context=rag_context,
        field_values=field_values,
        section_prompt=section_prompt,
        model=model,
        system_prompt_override=db_prompt or None,
    )

    if result.get("status") == "error":
        error_msg = result.get("error_message", "Unknown error")
        return {
            "status": "FAIL",
            "score": 0,
            "feedback": f"Validation error: {error_msg}",
            "issues": [error_msg],
            "suggestions": ["Check API Key and Model availability"],
        }

    # Extract review from success result
    review = result.get("review", {})
    return {
        "status": review.get("status", "FAIL"),
        "score": review.get("score", 0),
        "feedback": review.get("feedback", ""),
        "issues": review.get("issues") or [],
        "suggestions": review.get("suggestions") or [],
        "sources": review.get("sources") or [],
        "metadata": {
            "model": model,
            "section_key": section_key,
        },
    }


def run_html_draft_critic(payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    HTML Draft Critic Agent — 5-dimension confidence report.

    Expects payload:
      - generated_html: str
      - chunks: list
      - section_prompt: str
      - model: Optional[str]

    Returns { status, report: CriticReport dict } or { status: "error", ... }
    """
    generated_html = payload.get("generated_html", "")
    chunks = payload.get("chunks", [])
    section_prompt = payload.get("section_prompt", "")

    if not generated_html:
        return {"status": "error", "error_message": "generated_html is required"}

    from services.agent_config_service import get_agent_by_preferences
    agent = get_agent_by_preferences(
        agent_type="critic",
        preferred_names=[
            payload.get("db_agent_name"),
            payload.get("agent_name"),
            "Jurinex Critic Agent",
            "Critic Agent",
        ],
    )
    model = payload.get("model") or (agent.get("resolved_model") if agent else DEFAULT_MODEL)

    logger.info(
        "[HtmlDraftCritic] reviewing draft (len=%d, chunks=%d, model=%s)",
        len(generated_html), len(chunks), model,
    )

    result = review_html_draft(
        generated_html=generated_html,
        chunks=chunks,
        section_prompt=section_prompt,
        model=model,
    )

    if result.get("status") == "error":
        # Return a minimal fallback report on error so the pipeline can continue
        logger.warning("[HtmlDraftCritic] review failed: %s", result.get("error_message"))
        return {
            "status": "error",
            "error_message": result.get("error_message"),
            "report": {
                "scores": {k: 0.5 for k in ("factual_grounding", "completeness", "template_fidelity", "content_quality", "technical_correctness")},
                "overall_confidence": 0.5,
                "verdict": "needs_revision",
                "critical_issues": [result.get("error_message", "Critic failed")],
                "one_line_summary": "Critic evaluation failed; manual review recommended.",
            },
        }

    return result
