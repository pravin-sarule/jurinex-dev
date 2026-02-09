"""
Critic Agent (ADK-style): Validate and review legal draft content.
"""

from __future__ import annotations

import logging
from typing import Any, Dict

from agents.critic.tools import review_section

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
        return {
            "status": "FAIL",
            "score": 0,
            "feedback": "No content provided for validation",
            "issues": ["Empty content"],
            "suggestions": [],
        }

    # Use the tool
    result = review_section(
        section_content=section_content,
        section_key=section_key,
        rag_context=rag_context,
        field_values=field_values,
        section_prompt=section_prompt,
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
