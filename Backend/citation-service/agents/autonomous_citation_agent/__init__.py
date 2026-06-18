"""
Autonomous Citation Research Agent — Public API.

Entry points:
  run_citation_research(query, ...)     — main autonomous research (used by pipeline_runner.py)
  run_web_research_for_issue(issue, ...) — single-issue shim for external callers
"""
from __future__ import annotations

import json
import logging
import os
import time
import uuid
from typing import Any, Dict, List, Optional

from agents.autonomous_citation_agent.runner import run_autonomous_pipeline

logger = logging.getLogger(__name__)


def run_citation_research(
    query: str,
    case_context: str = "",
    run_id: Optional[str] = None,
    user_id: str = "anonymous",
    case_id: Optional[str] = None,
    selected_keywords: Optional[List[str]] = None,
    selected_case_names: Optional[List[str]] = None,
    custom_keywords: Optional[List[str]] = None,
    max_iterations: int = int(os.environ.get("CITATION_AUTO_MAX_ITERATIONS", "4")),
    latency_budget_ms: int = int(os.environ.get("CITATION_AUTO_LATENCY_BUDGET_MS", "300000")),
) -> Dict[str, Any]:
    """Run the autonomous citation research agent. Synchronous wrapper."""
    enabled = os.environ.get("CITATION_USE_AUTONOMOUS_AGENT", "true").strip().lower()
    if enabled in ("false", "0", "no", "off"):
        return _empty_report(query, run_id, "disabled")

    run_id = run_id or str(uuid.uuid4())
    print(f"\n[CITATION AGENT] Starting autonomous research", flush=True)
    print(f"[CITATION AGENT] query: {query[:80]}", flush=True)
    print(f"[CITATION AGENT] run_id: {run_id[:8]}", flush=True)

    initial_state: Dict[str, Any] = {
        "case_query": query,
        "case_context": (case_context or "")[:5000],
        "run_id": run_id,
        "user_id": user_id,
        "case_id": case_id or "",
        "selected_keywords": selected_keywords or [],
        "selected_case_names": selected_case_names or [],
        "custom_keywords": custom_keywords or [],
        "case_analysis": "{}",
        "research_questions": "[]",
        "issue": "",
        "planned_queries": "{}",
        "citation_candidates": "[]",
        "critic_output": "",
        "citation_report": "{}",
        "searched_queries": [],
        "iteration": 0,
        "budget_exhausted": False,
        "budget_exhaustion_reason": "",
        "budget_state": {
            "max_iterations": max_iterations,
            "iterations_used": 0,
            "searches_used": 0,
            "start_ts": time.time(),
            "latency_budget_ms": latency_budget_ms,
        },
    }

    try:
        final_state = run_autonomous_pipeline(initial_state)
    except Exception as exc:
        logger.exception("[CITATION_AUTO] Pipeline failed: %s", exc)
        try:
            from db.client import agent_log_insert
            agent_log_insert(run_id, None, "CitationAgent", "failed", "ERROR", str(exc)[:2000])
        except Exception:
            pass
        return _empty_report(query, run_id, f"Agent failed: {exc}")

    return _extract_report(final_state, query, run_id)


def run_web_research_for_issue(
    issue: Dict[str, Any],
    case_context: str = "",
    run_id: Optional[str] = None,
    user_id: str = "anonymous",
    max_iterations: int = int(os.environ.get("CITATION_WEB_MAX_ITERATIONS", "3")),
    max_searches: int = int(os.environ.get("CITATION_WEB_MAX_SEARCHES", "6")),
    latency_budget_ms: int = int(os.environ.get("CITATION_WEB_LATENCY_BUDGET_MS", "60000")),
) -> Dict[str, Any]:
    """
    Run citation research for a single legal issue.
    Wraps the autonomous agent with a single-issue query.
    """
    issue_title = str(issue.get("issue_title") or "Legal Issue")
    proposition = str(issue.get("proposition") or "")
    acts = ", ".join(issue.get("acts_involved") or [])
    query = f"{issue_title}: {proposition}" + (f" ({acts})" if acts else "")

    result = run_citation_research(
        query=query,
        case_context=case_context,
        run_id=run_id,
        user_id=user_id,
        max_iterations=max_iterations,
        latency_budget_ms=latency_budget_ms,
    )

    citations = result.get("citations") or []
    verified = []
    for c in citations:
        verified.append({
            "parties": c.get("caseName") or c.get("parties") or "",
            "court": c.get("court") or "",
            "year": c.get("dateOfJudgment") or c.get("year") or "",
            "citation_no": c.get("primaryCitation") or c.get("citation_no") or "",
            "ratio": c.get("excerptText") or c.get("ratio") or "",
            "how_helps": c.get("relevanceReason") or c.get("how_helps") or "",
            "source_url": c.get("sourceUrl") or c.get("source_url") or "",
            "source_name": c.get("source") or "",
            "authority_tier": "T1" if c.get("groundingValidated") else "T2",
            "confidence": "HIGH" if c.get("groundingValidated") else "MEDIUM",
            "verification_status": "GREEN" if c.get("groundingValidated") else "YELLOW",
            "official_citation": c.get("primaryCitation") or "",
            "legal_issue": issue_title,
        })

    gaps = result.get("metadata", {}).get("research_gaps") or []
    return {
        "verified_citations": verified,
        "research_gaps": gaps,
        "iterations": result.get("metadata", {}).get("iterations_used", 0),
        "searches": 0,
        "budget_exhausted": False,
    }


def _extract_report(state: Dict[str, Any], query: str, run_id: str) -> Dict[str, Any]:
    """Convert final agent state into the frontend report format."""
    report_raw = state.get("citation_report") or "{}"
    if isinstance(report_raw, str):
        try:
            report_raw = json.loads(report_raw)
        except Exception:
            report_raw = {}

    citations_raw = []
    if isinstance(report_raw, dict):
        citations_raw = report_raw.get("citations") or []
    elif isinstance(report_raw, list):
        citations_raw = report_raw

    if not citations_raw:
        candidates_raw = state.get("citation_candidates") or "[]"
        if isinstance(candidates_raw, str):
            try:
                parsed = json.loads(candidates_raw)
                if isinstance(parsed, dict):
                    citations_raw = parsed.get("citations", [])
                elif isinstance(parsed, list):
                    citations_raw = parsed
            except Exception:
                citations_raw = []
        elif isinstance(candidates_raw, list):
            citations_raw = candidates_raw

    converted = [_to_frontend_dict(c) for c in citations_raw]

    print(f"[CITATION AGENT] Done -- {len(converted)} citations", flush=True)

    iterations_used = int(state.get("iteration", 0))
    searched_queries: List[str] = list(state.get("searched_queries") or [])
    gaps: List[str] = list(state.get("research_gaps") or [])
    if state.get("budget_exhaustion_reason") and state["budget_exhaustion_reason"] not in gaps:
        gaps.append(state["budget_exhaustion_reason"])
    critic = state.get("critic_output") or ""
    if critic and critic not in gaps and not converted:
        gaps.append(critic)

    return {
        "citations": converted,
        "metadata": {
            "query": query,
            "run_id": run_id,
            "citation_count": len(converted),
            "coverage_summary": critic,
            "research_gaps": gaps,
            "iterations_used": iterations_used,
            "agent_mode": "autonomous",
        },
        "dimensions": [],
        "searchKeywordsByRoute": {"google": searched_queries, "local": [], "indian_kanoon": [], "web": searched_queries},
    }


def _to_frontend_dict(c: Any) -> Dict[str, Any]:
    if isinstance(c, dict):
        d = c
    elif hasattr(c, "model_dump"):
        d = c.model_dump()
    else:
        d = vars(c) if hasattr(c, "__dict__") else {}

    confidence = str(d.get("confidence") or "").upper()
    vs_raw = str(d.get("verification_status") or "").lower()

    # Map internal verification_status → frontend-expected GREEN/YELLOW/RED/STALE
    if confidence == "HIGH" or vs_raw == "verified":
        frontend_vs = "GREEN"
    elif confidence == "MEDIUM" or vs_raw == "unverified":
        frontend_vs = "YELLOW"
    elif confidence == "BLOCKED" or vs_raw == "blocked":
        frontend_vs = "RED"
    else:
        frontend_vs = "YELLOW"  # safe default — show rather than hide

    return {
        "caseName": d.get("parties") or d.get("case_name") or "",
        "primaryCitation": d.get("official_citation") or d.get("citation_no") or "",
        "court": d.get("court") or "",
        "dateOfJudgment": d.get("year") or "",
        "relevanceScore": 0.9 if confidence == "HIGH" else 0.7,
        "excerptText": d.get("ratio") or "",
        "verificationStatus": frontend_vs,
        "sourceUrl": d.get("source_url") or "",
        "source": d.get("source_name") or "web",
        "source_type": d.get("source_name") or "web",
        "which_issue": d.get("legal_issue") or "",
        "ik_tid": "",
        "canonical_id": "",
        "groundingValidated": confidence == "HIGH",
        "argumentParty": "neutral",
        "relevanceReason": d.get("how_helps") or "",
    }


def _empty_report(query: str, run_id: Optional[str], reason: str) -> Dict[str, Any]:
    return {
        "citations": [],
        "metadata": {
            "query": query, "run_id": run_id or "", "citation_count": 0,
            "coverage_summary": "", "research_gaps": [reason],
            "iterations_used": 0, "agent_mode": "autonomous",
        },
        "dimensions": [],
        "search_keywords_by_route": {"google": [], "local": [], "indian_kanoon": [], "web": []},
    }
