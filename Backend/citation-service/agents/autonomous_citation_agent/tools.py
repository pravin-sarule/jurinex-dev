"""
Tools for the Autonomous Citation Agent.

authorized_web_search — Gemini google_search grounding + authority allowlist filter.
exit_loop             — signals the research loop to stop iterating.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List

logger = logging.getLogger(__name__)


def authorized_web_search(query: str, tool_context: Any = None, state: Dict[str, Any] = None) -> Dict[str, Any]:
    """
    Search the web for Indian court judgments using only authorized sources.
    """
    from agents.autonomous_citation_agent.grounding_search import run_authorized_search

    session_state = state
    if session_state is None and tool_context is not None:
        session_state = getattr(tool_context, "state", None)

    run_id = (session_state or {}).get("run_id")
    user_id = (session_state or {}).get("user_id") or "anonymous"

    if session_state is not None:
        try:
            budget: Dict[str, Any] = dict(session_state.get("budget_state") or {})
            budget["searches_used"] = int(budget.get("searches_used", 0)) + 1
            session_state["budget_state"] = budget
        except Exception as exc:
            logger.debug("[WEB_SEARCH_TOOL] Could not update budget state: %s", exc)

    results = run_authorized_search(query, num_results=4, run_id=run_id, user_id=user_id)

    serialized = [
        {
            "uri": r.uri,
            "title": r.title,
            "snippet": r.snippet,
            "authority_tier": r.authority_tier,
        }
        for r in results
    ]

    logger.info(
        "[WEB_SEARCH_TOOL] authorized_web_search(%r) -> %d result(s)",
        query[:60], len(serialized),
    )
    return {"results": serialized}


def exit_loop(tool_context: Any = None) -> Dict[str, Any]:
    """Signal the research loop to stop iterating."""
    try:
        if tool_context is not None and hasattr(tool_context, "actions"):
            tool_context.actions.escalate = True
            tool_context.actions.skip_summarization = True
        logger.info("[WEB_SEARCH_TOOL] exit_loop called — stopping research loop")
    except Exception as exc:
        logger.warning("[WEB_SEARCH_TOOL] exit_loop action failed: %s", exc)

    return {"status": "loop_exit_requested", "reason": "sufficient citations found"}
