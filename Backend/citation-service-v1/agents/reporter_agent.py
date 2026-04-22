"""Reporter Agent — builds the final structured citation report.

Plan-then-execute pattern:
  STEP 1  tool_create_report_plan  → Claude reasons about how many citations to include,
                                     how to enrich excerpts, what coverage to highlight;
                                     stored in state["report_plan"]
  STEP 2  tool_build_report        → Claude enriches citations + assembles ReportFormat
"""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from google.adk.agents import LlmAgent
from google.adk.models.lite_llm import LiteLlm
from google.adk.tools import FunctionTool
from google.adk.tools.tool_context import ToolContext

from utils.claude_client import claude_complete_json
from utils.logger import pipeline_log


# ---------------------------------------------------------------------------
# PLAN tool  (always called first)
# ---------------------------------------------------------------------------

async def tool_create_report_plan(tool_context: ToolContext) -> Dict[str, Any]:
    """Reason about the report building task and create a step-by-step report plan.

    Reads from state: query, perspective, ranked_citations (count), dimensions (count),
                      pipeline_plan, ranking_plan, run_id
    Writes to state:  report_plan
    """
    query = tool_context.state.get("query", "")
    perspective = tool_context.state.get("perspective", "all")
    run_id = tool_context.state.get("run_id", "")
    ranked_citations: List[Dict] = tool_context.state.get("ranked_citations", [])
    dimensions: List[Dict] = tool_context.state.get("dimensions", [])
    pipeline_plan = tool_context.state.get("pipeline_plan", {})
    ranking_plan = tool_context.state.get("ranking_plan", {})

    citation_count = len(ranked_citations)
    dim_count = len(dimensions)
    dim_names = [d.get("name", "") for d in dimensions[:5]]
    pipeline_steps = pipeline_plan.get("steps", [])
    focus_areas = pipeline_plan.get("focus_areas", [])

    # Sample top 3 citations for context
    top_cit_names = [c.get("caseName", "") for c in ranked_citations[:3] if c.get("caseName")]

    system = (
        "You are a legal report architect for Indian courts. "
        "Plan how to assemble the final citation research report."
    )
    user = f"""
Citation query: {query}
Perspective: {perspective}
Ranked citations available: {citation_count}
Legal dimensions identified: {dim_count} — {dim_names}
Top citations: {top_cit_names}
Focus areas: {focus_areas}
Pipeline final step guidance: {pipeline_steps[-2:] if len(pipeline_steps) >= 2 else pipeline_steps}
Ranking plan: {ranking_plan.get('reasoning', '')}

Design a 3–5 step report building plan. Specify:
- How many citations to include in the final report (max 15 recommended)
- What enrichment to apply to excerptText and ratio fields
- How to structure the dimension groups
- What coverage stats to highlight
- Any perspective-specific framing for '{perspective}'

Return ONLY this JSON:
{{
  "steps": [
    "1. Select top {min(citation_count, 15)} citations by relevanceScore ...",
    "2. Enrich excerptText — ensure each is legally precise and max 350 chars ...",
    "3. Improve ratio decidendi statements — clear, principle-focused, max 200 chars ...",
    "4. Finalise dimension groups — ensure each dimension has 2+ citations ...",
    "5. Build metadata with coverage stats (court spread, year range) ..."
  ],
  "reasoning": "why this report structure fits the query and perspective",
  "target_citation_count": {min(citation_count, 15)},
  "emphasis": "what the report should emphasise for '{perspective}' perspective"
}}
"""
    try:
        plan = await claude_complete_json(system=system, user=user, max_tokens=512)
    except Exception as exc:
        plan = {
            "steps": [
                f"1. Select top {min(citation_count, 15)} citations",
                "2. Enrich excerpts and ratios",
                "3. Finalise dimension groups",
                "4. Build metadata",
            ],
            "reasoning": f"Default report plan (planning failed: {exc})",
            "target_citation_count": min(citation_count, 15),
            "emphasis": perspective,
        }

    tool_context.state["report_plan"] = plan

    steps = plan.get("steps", [])
    if run_id:
        pipeline_log(run_id, "ReporterAgent", f"Report plan created ({len(steps)} steps)")
        for step in steps:
            pipeline_log(run_id, "ReporterAgent", f"  → {step}")
        pipeline_log(run_id, "ReporterAgent",
                     f"Target: {plan.get('target_citation_count', citation_count)} citations, "
                     f"emphasis: {plan.get('emphasis', perspective)}")

    return plan


# ---------------------------------------------------------------------------
# EXECUTE tool
# ---------------------------------------------------------------------------

async def tool_build_report(
    ranked_citations: List[Dict[str, Any]],
    dimensions: List[Dict[str, Any]],
    query: str,
    user_id: str,
    case_id: Optional[str],
    run_id: str,
    perspective: str = "all",
    tool_context: ToolContext = None,
) -> Dict[str, Any]:
    """Build the final citation report in the format expected by the frontend.

    Args:
        ranked_citations: Ranked and enriched citation dicts
        dimensions: Legal dimension groups
        query: Original citation query
        user_id: Requesting user ID
        case_id: Optional case ID
        run_id: Pipeline run identifier
        perspective: "all" | "appellant" | "respondent" | "court"
    """
    report_plan = tool_context.state.get("report_plan", {}) if tool_context else {}
    target_count = report_plan.get("target_citation_count", 15)
    emphasis = report_plan.get("emphasis", perspective)
    run_id_log = tool_context.state.get("run_id", run_id) if tool_context else run_id

    if not ranked_citations:
        now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        empty: Dict[str, Any] = {
            "citations": [],
            "generatedAt": now,
            "perspective": perspective,
            "dimensions": [],
            "dimensionGroups": [],
            "metadata": {
                "query": query,
                "user_id": user_id,
                "case_id": case_id,
                "run_id": run_id,
                "status": "completed",
                "citation_count": 0,
                "generated_at": now,
                "service_version": "v1-adk",
                "coverage": {},
            },
        }
        if tool_context:
            tool_context.state["report_format"] = empty
        return empty

    top_cits = ranked_citations[:target_count]

    if run_id_log:
        pipeline_log(run_id_log, "ReporterAgent", f"Enriching {len(top_cits)} citations with Claude")

    # Use Claude to enrich the top citations per the report plan
    cits_text = "\n\n".join(
        f"[{i+1}] {c.get('caseName','')} | {c.get('court','')} | {c.get('date','')}\n"
        f"ratio: {c.get('ratio','')}\nexcerpt: {c.get('excerptText','')[:150]}"
        for i, c in enumerate(top_cits)
    )

    system = "You are a legal research assistant finalising a citation report for an Indian lawyer."
    user = f"""Query: {query}
Perspective: {perspective}
Report emphasis: {emphasis}

Top citations to enrich:
{cits_text}

For each citation provide:
1. excerptText — most legally relevant excerpt for '{perspective}' perspective (max 350 chars)
2. ratio — clear ratio decidendi statement (max 200 chars)
3. Confirm or improve the dimensionName

Return JSON array (same order, index 1-based):
[
  {{
    "index": 1,
    "excerptText": "...",
    "ratio": "...",
    "dimensionName": "..."
  }}
]
"""
    enrichments = await claude_complete_json(system=system, user=user, max_tokens=2048)
    if not isinstance(enrichments, list):
        enrichments = []

    enrich_map = {e.get("index", 0): e for e in enrichments}

    final_cits = []
    for i, cit in enumerate(top_cits):
        c = dict(cit)
        enrich = enrich_map.get(i + 1, {})
        if enrich.get("excerptText"):
            c["excerptText"] = enrich["excerptText"]
        if enrich.get("ratio"):
            c["ratio"] = enrich["ratio"]
        if enrich.get("dimensionName"):
            c["dimensionName"] = enrich["dimensionName"]
        c.setdefault("id", str(uuid.uuid4()))
        c.setdefault("partyArguments", {"appellant": [], "respondent": [], "court": ""})
        c.setdefault("treatment", {"followedList": [], "distinguishedList": [], "overruledList": []})
        c.setdefault("ikCiteList", [])
        c.setdefault("ikCitedByList", [])
        c.setdefault("sourceCitations", [c.get("sourceUrl", "")] if c.get("sourceUrl") else [])
        final_cits.append(c)

    # Build dimension objects
    dim_by_id: Dict[str, Dict] = {}
    for d in dimensions:
        dim_id = str(d.get("dimension_id", "1"))
        dim_by_id[dim_id] = {
            "dimension_id": dim_id,
            "name": d.get("name", "General"),
            "reasoning": d.get("reasoning", ""),
            "citations": [],
        }

    for c in final_cits:
        dim_id = str(c.get("dimensionId", "1"))
        if dim_id not in dim_by_id:
            dim_by_id[dim_id] = {
                "dimension_id": dim_id,
                "name": c.get("dimensionName", "General"),
                "reasoning": "",
                "citations": [],
            }
        dim_by_id[dim_id]["citations"].append(c.get("id", ""))

    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    courts = list({c.get("court", "") for c in final_cits if c.get("court")})
    dates = [c.get("date", "") for c in final_cits if c.get("date")]
    years = []
    for d in dates:
        if d and len(d) >= 4 and d[:4].isdigit():
            years.append(int(d[:4]))

    coverage: Dict[str, Any] = {
        "courts": len(courts),
        "court_names": courts[:5],
        "years_span": (max(years) - min(years)) if len(years) >= 2 else 0,
        "earliest": str(min(years)) if years else "",
        "latest": str(max(years)) if years else "",
    }

    report_format: Dict[str, Any] = {
        "citations": final_cits,
        "generatedAt": now,
        "perspective": perspective,
        "dimensions": list(dim_by_id.values()),
        "dimensionGroups": list(dim_by_id.values()),
        "metadata": {
            "query": query,
            "user_id": user_id,
            "case_id": case_id,
            "run_id": run_id,
            "status": "completed",
            "citation_count": len(final_cits),
            "generated_at": now,
            "service_version": "v1-adk",
            "coverage": coverage,
        },
    }

    if tool_context:
        tool_context.state["report_format"] = report_format

    if run_id_log:
        pipeline_log(run_id_log, "ReporterAgent",
                     f"Report built — {len(final_cits)} citations, "
                     f"{len(dim_by_id)} dimensions, coverage: {coverage.get('years_span', 0)} years")

    return report_format


# ---------------------------------------------------------------------------
# ADK FunctionTools
# ---------------------------------------------------------------------------

create_report_plan_tool = FunctionTool(func=tool_create_report_plan)
build_report_tool = FunctionTool(func=tool_build_report)


# ---------------------------------------------------------------------------
# Agent factory
# ---------------------------------------------------------------------------

_INSTRUCTION = """You are the Report Builder Agent — the final step in the legal citation pipeline.

ALWAYS follow this exact order — do not skip steps:

STEP 1 — Call `tool_create_report_plan` FIRST.
          This reads the ranked_citations count, dimensions, and pipeline plan from state,
          then designs the final report structure and enrichment strategy.
          Read the target_citation_count and emphasis from the plan result.

STEP 2 — Execute: call `tool_build_report` with:
          - ranked_citations = from state
          - dimensions = from state
          - query, user_id, case_id, run_id, perspective = from state

STEP 3 — Verify quality before reporting:
          - Remove citations with empty caseName AND no court
          - Ensure every citation has an id, auditStatus, verificationStatus
          - Confirm dimensions list is populated

Output JSON:
{
  "report_status": "completed",
  "citation_count": <int>,
  "dimension_count": <int>,
  "top_court": "<most common court in report>"
}
"""


def build_reporter_agent() -> LlmAgent:
    model_id = os.getenv("CLAUDE_MODEL", "claude-sonnet-4-6-20251001")
    return LlmAgent(
        name="ReporterAgent",
        model=LiteLlm(model=f"anthropic/{model_id}"),
        instruction=_INSTRUCTION,
        tools=[
            create_report_plan_tool,   # always first
            build_report_tool,
        ],
        output_key="report_status",
    )
