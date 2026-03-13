"""
Critic Agent (ADK-style): Validate and review legal draft content.
"""

from __future__ import annotations

import logging
from typing import Any, Dict

from agents.critic.tools import review_section

logger = logging.getLogger(__name__)

DEFAULT_MODEL = "models/gemini-2.5-pro"

    # Fetch agent from DB once: used for model resolution and prompt
    from services.agent_config_service import get_agent_by_type, get_resolved_model_for_agent
    agent = get_agent_by_type("critic")
    model = payload.get("model") or (agent.get("resolved_model") if agent else DEFAULT_MODEL)
    db_prompt = (agent.get("prompt") or "").strip() if agent else ""

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
            "model": DEFAULT_MODEL,
            "section_key": section_key,
        },
    }
