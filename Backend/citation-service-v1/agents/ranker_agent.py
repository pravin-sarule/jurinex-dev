"""Ranker Agent — Claude-powered relevance ranking and legal dimension grouping.

Plan-then-execute pattern:
  STEP 1  tool_create_ranking_plan       → Claude reasons about ranking strategy,
                                           expected dimensions, authority hierarchy;
                                           stored in state["ranking_plan"]
  STEP 2  tool_rank_and_group_citations  → Claude scores each citation and groups
                                           into legal dimensions
"""
from __future__ import annotations

import os
from typing import Any, Dict, List

from google.adk.agents import LlmAgent
from google.adk.models.lite_llm import LiteLlm
from google.adk.tools import FunctionTool
from google.adk.tools.tool_context import ToolContext

from utils.claude_client import claude_complete_json
from utils.logger import pipeline_log


# ---------------------------------------------------------------------------
# PLAN tool  (always called first)
# ---------------------------------------------------------------------------

async def tool_create_ranking_plan(tool_context: ToolContext) -> Dict[str, Any]:
    """Reason about the ranking task and create a step-by-step ranking plan.

    Reads from state: query, perspective, raw_citations (count), pipeline_plan,
                      extraction_plan, run_id
    Writes to state:  ranking_plan
    """
    query = tool_context.state.get("query", "")
    perspective = tool_context.state.get("perspective", "all")
    run_id = tool_context.state.get("run_id", "")
    raw_citations: List[Dict] = tool_context.state.get("raw_citations", [])
    pipeline_plan = tool_context.state.get("pipeline_plan", {})

    citation_count = len(raw_citations)
    focus_areas = pipeline_plan.get("focus_areas", [])
    expected_dims = pipeline_plan.get("expected_dimensions", [])

    # Sample a few citation courts/dates for context without blowing token budget
    sample_courts = list({c.get("court", "") for c in raw_citations[:10] if c.get("court")})[:5]
    sample_statutes = list({s for c in raw_citations[:10] for s in c.get("statutes", [])})[:6]

    system = (
        "You are a senior Indian legal analyst. Plan how to rank and group a set of "
        "court citations by relevance, authority, and thematic dimension."
    )
    user = f"""
Citation query: {query}
Perspective: {perspective}
Citations to rank: {citation_count}
Courts found in results: {sample_courts}
Statutes appearing: {sample_statutes}
Pipeline focus areas: {focus_areas}
Expected dimensions from pipeline plan: {expected_dims}

Design a 3–5 step ranking and grouping plan. Specify:
- The relevance scoring criteria (recency, court authority, ratio strength, statute match)
- How to set auditStatus (VERIFIED/VERIFIED_WITH_WARNINGS/NEEDS_REVIEW/QUARANTINED)
- The 2–5 legal dimensions/themes to group citations into
- Any perspective-specific filtering for '{perspective}'

Return ONLY this JSON:
{{
  "steps": [
    "1. Score each citation 0.0–1.0 on relevance — weight Supreme Court > High Court ...",
    "2. Assign auditStatus: VERIFIED if court + date + citation all present ...",
    "3. Group into dimensions: [list them] ...",
    "4. Filter/deprioritise citations outside '{perspective}' perspective ...",
    "5. Sort by relevanceScore descending ..."
  ],
  "reasoning": "why this ranking strategy fits the query and perspective",
  "authority_weights": {{"Supreme Court": 1.0, "High Court": 0.8, "Tribunal": 0.6}},
  "expected_dimensions": ["Dimension A", "Dimension B", "Dimension C"]
}}
"""
    try:
        plan = await claude_complete_json(system=system, user=user, max_tokens=512)
    except Exception as exc:
        plan = {
            "steps": [
                "1. Score by relevance 0.0–1.0",
                "2. Assign audit statuses",
                "3. Group into legal dimensions",
                "4. Sort by score descending",
            ],
            "reasoning": f"Default ranking plan (planning failed: {exc})",
            "authority_weights": {"Supreme Court": 1.0, "High Court": 0.8},
            "expected_dimensions": expected_dims or ["General"],
        }

    tool_context.state["ranking_plan"] = plan

    steps = plan.get("steps", [])
    if run_id:
        pipeline_log(run_id, "RankerAgent", f"Ranking plan created ({len(steps)} steps)")
        for step in steps:
            pipeline_log(run_id, "RankerAgent", f"  → {step}")
        if plan.get("expected_dimensions"):
            pipeline_log(run_id, "RankerAgent", f"Target dimensions: {plan['expected_dimensions']}")

    return plan


# ---------------------------------------------------------------------------
# EXECUTE tool
# ---------------------------------------------------------------------------

async def tool_rank_and_group_citations(
    citations: List[Dict[str, Any]],
    query: str,
    case_context: Dict[str, Any],
    perspective: str = "all",
    tool_context: ToolContext = None,
) -> Dict[str, Any]:
    """Rank citations by relevance and group into legal dimensions per the ranking plan.

    Args:
        citations: List of extracted citation dicts
        query: The original citation research query
        case_context: Case context summary dict
        perspective: Perspective filter: "all" | "appellant" | "respondent" | "court"
    """
    run_id = tool_context.state.get("run_id", "") if tool_context else ""
    ranking_plan = tool_context.state.get("ranking_plan", {}) if tool_context else {}

    if not citations:
        if tool_context:
            tool_context.state["ranked_citations"] = []
            tool_context.state["dimensions"] = []
        return {"ranked_citations": [], "dimensions": []}

    cits_for_llm = citations[:20]
    cits_text = "\n\n".join(
        f"[{i+1}] caseName: {c.get('caseName','')}\n"
        f"    court: {c.get('court','')}\n"
        f"    date: {c.get('date','')}\n"
        f"    ratio: {c.get('ratio','')}\n"
        f"    statutes: {', '.join(c.get('statutes', []))}\n"
        f"    excerptText: {c.get('excerptText','')[:200]}"
        for i, c in enumerate(cits_for_llm)
    )

    case_summary = case_context.get("answer", "") or case_context.get("facts", "")
    legal_issues = case_context.get("legal_issues", [])
    authority_weights = ranking_plan.get("authority_weights", {})
    expected_dims = ranking_plan.get("expected_dimensions", [])
    plan_steps = ranking_plan.get("steps", [])

    system = (
        "You are a senior Indian legal researcher ranking citations by relevance "
        "and grouping them into thematic legal dimensions."
    )
    user = f"""Query: {query}
Perspective: {perspective}
Case context: {case_summary[:500] if case_summary else 'Not provided'}
Key legal issues: {', '.join(legal_issues[:5]) if legal_issues else 'Infer from query'}
Ranking plan steps: {plan_steps[:3]}
Authority weights: {authority_weights}
Expected dimensions: {expected_dims}

Citations to rank:
{cits_text}

Tasks:
1. Score each citation 0.0–1.0 on relevance to the query and perspective.
   Apply authority weights: Supreme Court scores highest.
2. Set auditStatus:
   - "VERIFIED" if court + date + citation reference all present and authoritative
   - "VERIFIED_WITH_WARNINGS" if some info uncertain
   - "NEEDS_REVIEW" if key fields missing
   - "QUARANTINED" if citation seems incorrect or irrelevant
3. Set verificationStatus: "GREEN" (VERIFIED), "YELLOW" (VERIFIED_WITH_WARNINGS/NEEDS_REVIEW), "RED" (QUARANTINED)
4. Group into {len(expected_dims) or 3}–5 legal dimensions matching: {expected_dims}
5. Assign each citation to its primary dimension.

Return JSON:
{{
  "ranked_citations": [
    {{
      "index": 1,
      "relevanceScore": 0.85,
      "auditStatus": "VERIFIED",
      "verificationStatus": "GREEN",
      "dimensionId": "1",
      "dimensionName": "Bail Conditions"
    }}
  ],
  "dimensions": [
    {{
      "dimension_id": "1",
      "name": "Bail Conditions",
      "reasoning": "Cases dealing with conditions for granting bail under CrPC",
      "citation_indices": [1, 3, 5]
    }}
  ]
}}
"""
    ranking = await claude_complete_json(system=system, user=user, max_tokens=2048)

    ranked_map = {r["index"]: r for r in ranking.get("ranked_citations", [])}
    dimensions_raw = ranking.get("dimensions", [])

    final_citations: List[Dict[str, Any]] = []
    for i, cit in enumerate(cits_for_llm):
        merged = dict(cit)
        rank_data = ranked_map.get(i + 1, {})
        merged["relevanceScore"] = rank_data.get("relevanceScore", 0.5)
        merged["auditStatus"] = rank_data.get("auditStatus", "NEEDS_REVIEW")
        merged["verificationStatus"] = rank_data.get("verificationStatus", "YELLOW")
        merged["dimensionId"] = rank_data.get("dimensionId", "1")
        merged["dimensionName"] = rank_data.get("dimensionName", "General")
        final_citations.append(merged)

    final_citations.sort(key=lambda c: c.get("relevanceScore", 0), reverse=True)

    if tool_context:
        tool_context.state["ranked_citations"] = final_citations
        tool_context.state["dimensions"] = dimensions_raw

    if run_id:
        pipeline_log(run_id, "RankerAgent",
                     f"Ranked {len(final_citations)} citations into {len(dimensions_raw)} dimensions")

    return {"ranked_citations": final_citations, "dimensions": dimensions_raw}


# ---------------------------------------------------------------------------
# ADK FunctionTools
# ---------------------------------------------------------------------------

create_ranking_plan_tool = FunctionTool(func=tool_create_ranking_plan)
rank_citations_tool = FunctionTool(func=tool_rank_and_group_citations)


# ---------------------------------------------------------------------------
# Agent factory
# ---------------------------------------------------------------------------

_INSTRUCTION = """You are the Citation Ranker Agent for a legal research pipeline.

ALWAYS follow this exact order — do not skip steps:

STEP 1 — Call `tool_create_ranking_plan` FIRST.
          This reads the raw_citations count, perspective, and pipeline plan from state,
          then designs a targeted ranking and grouping strategy.
          Read the expected_dimensions and authority_weights from the plan result.

STEP 2 — Execute: call `tool_rank_and_group_citations` with:
          - citations = the raw_citations from state (pass them directly)
          - query = the original query from state
          - case_context = the case_context dict from state
          - perspective = the perspective from state

STEP 3 — Report the results.

Output JSON:
{
  "ranked_count": <int>,
  "top_citation": "<caseName of highest ranked>",
  "dimensions_identified": ["Dim1", "Dim2"],
  "status": "ok"
}
"""


def build_ranker_agent() -> LlmAgent:
    model_id = os.getenv("CLAUDE_MODEL", "claude-sonnet-4-6-20251001")
    return LlmAgent(
        name="RankerAgent",
        model=LiteLlm(model=f"anthropic/{model_id}"),
        instruction=_INSTRUCTION,
        tools=[
            create_ranking_plan_tool,   # always first
            rank_citations_tool,
        ],
        output_key="ranking_summary",
    )
