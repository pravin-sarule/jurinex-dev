"""
Citation usage-analysis (the "how to use this judgment" memo).

After classification, ONE batched gemini-3.5-flash call writes, for every shown
citation at once, a 500-600 word category-aware memo (4 sections) plus an honest
relevance verdict. The verdict drives the relevance gate (see
pipeline/stages/generate_usage_analysis.py) so the Recommended bucket stays
genuinely relevant — an off-point citation is useless no matter how cheap.

The call is registered through usage_tracker so it shows in the run cost breakdown.
Any failure is non-fatal: candidates keep empty memo fields and the run continues.
"""

from __future__ import annotations

import logging
import os

from core.budgets import BudgetTracker
from core.enums import Classification
from core.exceptions import BudgetExceeded
from models.citation_models import Candidate

logger = logging.getLogger(__name__)

# Relevance verdict vocabulary (kept in sync with the prompt + the relevance gate).
# ADVERSE = bears on the matter but goes AGAINST the client (opponent authority);
# it must be SURFACED in the adverse bundle, never dropped. NOT_RELEVANT = off-topic.
RELEVANT = "RELEVANT"
ADVERSE = "ADVERSE"
PARTIALLY_RELEVANT = "PARTIALLY_RELEVANT"
NOT_RELEVANT = "NOT_RELEVANT"
_ALLOWED_RELEVANCE = {RELEVANT, ADVERSE, PARTIALLY_RELEVANT, NOT_RELEVANT}


def category_for(candidate: Candidate) -> str:
    """Map a candidate's final classification to its report bucket (memo framing)."""
    if candidate.classification == Classification.SUPPORTING:
        return "recommended"
    if candidate.classification == Classification.ADVERSE:
        return "adverse"
    return "caution"


def _model() -> str:
    return (os.environ.get("CITATION_V2_JUDGE_MODEL")
            or os.environ.get("CITATION_V2_GEMINI_MODEL")
            or os.environ.get("GEMINI_MODEL", "gemini-3.5-flash"))


def generate_usage_analyses(
    candidates: list[Candidate], issues: list, perspective: str, case_context: str,
    run_id: str, user_id: str, budget: BudgetTracker,
) -> int:
    """Attach usage_analysis / usage_verdict / relevance_verdict to each candidate.

    Returns the number of candidates annotated. Non-fatal on any failure (returns 0).
    """
    items = [c for c in (candidates or []) if c]
    if not items:
        return 0

    from integrations.gemini._jsonsafe import loads_lenient
    from integrations.gemini.client import get_client
    from integrations.gemini.prompts import usage_analysis_prompt
    from utils.usage_tracker import record_gemini

    client = get_client()
    if not client:
        logger.info("[USAGE_ANALYSIS] Gemini client unavailable; skipping memos")
        return 0
    try:
        budget.consume("ai_analysis", estimated_cost=3.0)
    except BudgetExceeded:
        logger.warning("[USAGE_ANALYSIS] budget exhausted; skipping memos")
        return 0

    compact = [{
        "doc_id": c.doc_id,
        "title": (c.title or "")[:160],
        "category": category_for(c),
        "court": c.docsource or "",
        "disposition": c.disposition or "UNKNOWN",
        "winning_party": c.winning_party or "UNCLEAR",
        "operative_quote": (c.operative_quote or "")[:300],
        "direction": c.direction_flag or "",
        "ratio": (c.reason or "")[:300],
        "excerpt": (c.fragment or c.headline or "")[:900],
    } for c in items]

    case_summary = (case_context or "").strip()[:2500]
    issue_dicts = [i.to_dict() if hasattr(i, "to_dict") else i for i in (issues or [])][:5]
    prompt = usage_analysis_prompt(perspective, case_summary, issue_dicts, compact)
    model = _model()
    try:
        resp = client.models.generate_content(
            model=model, contents=prompt,
            config={
                "temperature": 0,
                "max_output_tokens": int(os.environ.get(
                    "CITATION_V2_USAGE_ANALYSIS_MAX_TOKENS",
                    str(getattr(budget.config, "usage_analysis_max_tokens", 6000)),
                )),
                "response_mime_type": "application/json",
                "thinking_config": {"thinking_budget": 0},
            },
        )
        usage = getattr(resp, "usage_metadata", None)
        record_gemini(
            run_id, user_id, "citation_v2_usage_analysis",
            int(getattr(usage, "prompt_token_count", 0) or 0),
            int(getattr(usage, "candidates_token_count", 0) or 0),
            model=model,
        )
        data = loads_lenient(str(getattr(resp, "text", "") or ""))
    except Exception:
        logger.exception("[USAGE_ANALYSIS] generation failed (non-fatal)")
        return 0

    rows = data.get("items", []) if isinstance(data, dict) else (data if isinstance(data, list) else [])
    by_id = {str(r.get("doc_id")): r for r in rows if isinstance(r, dict)}

    annotated = 0
    for c in items:
        row = by_id.get(c.doc_id)
        if not isinstance(row, dict):
            continue
        sections = []
        for s in (row.get("sections") or []):
            if isinstance(s, dict) and (s.get("heading") or s.get("body")):
                sections.append({
                    "heading": str(s.get("heading") or "").strip()[:120],
                    "body": str(s.get("body") or "").strip()[:1500],
                })
        relevance = str(row.get("relevance") or "").strip().upper().replace(" ", "_")
        c.relevance_verdict = relevance if relevance in _ALLOWED_RELEVANCE else ""
        c.relevance_reason = str(row.get("relevance_reason") or "").strip()[:300]
        c.usage_verdict = str(row.get("verdict") or "").strip()[:400]
        c.usage_analysis = sections[:4]
        if sections or c.relevance_verdict:
            annotated += 1

    logger.info("[USAGE_ANALYSIS] wrote memos for %d/%d citation(s) via %s",
                annotated, len(items), model)
    return annotated
