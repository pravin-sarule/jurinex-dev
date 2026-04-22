"""Planner Agent — creates a cross-agent pipeline execution plan before any search or extraction.

Runs SECOND in the SequentialAgent (after CaseContextAgent has populated case context).
Uses Claude to reason about the full pipeline and produce a structured plan stored in
state["pipeline_plan"] that every downstream agent reads before creating its own local plan.

Pipeline position: CaseContextAgent → PlannerAgent → SearchAgent → ...
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
# ADK Tool
# ---------------------------------------------------------------------------

async def tool_create_pipeline_plan(tool_context: ToolContext) -> Dict[str, Any]:
    """Reason about the full citation pipeline and create a step-by-step execution plan.

    Reads from session state:
        - query: original citation research query
        - perspective: "all" | "appellant" | "respondent" | "court"
        - case_context_summary: JSON summary from CaseContextAgent
        - run_id: pipeline run identifier for logging

    Writes to session state:
        - pipeline_plan: {"steps": [...], "reasoning": "...", "focus_areas": [...]}

    Returns:
        The pipeline plan dict.
    """
    query = tool_context.state.get("query", "")
    perspective = tool_context.state.get("perspective", "all")
    run_id = tool_context.state.get("run_id", "")

    # case_context_summary may be a JSON string (set by CaseContextAgent's output_key)
    # or a dict (set directly by tool_fetch_case_context)
    raw_summary = tool_context.state.get("case_context_summary", "")
    if isinstance(raw_summary, dict):
        case_summary_text = str(raw_summary)[:600]
    else:
        case_summary_text = str(raw_summary)[:600]

    case_context = tool_context.state.get("case_context", {})
    legal_issues: List[str] = case_context.get("legal_issues", [])
    statutes: List[str] = case_context.get("statutes", [])

    system = (
        "You are a senior Indian legal research strategist. "
        "Your task is to create a concise, actionable pipeline execution plan for a "
        "citation research task. The plan will guide 4 downstream agents: "
        "SearchAgent, ExtractorAgent, RankerAgent, and ReporterAgent."
    )

    user = f"""
Citation research query: {query}
Perspective: {perspective}
Legal issues identified: {', '.join(legal_issues[:5]) if legal_issues else 'infer from query'}
Applicable statutes: {', '.join(statutes[:5]) if statutes else 'infer from query'}
Case context summary: {case_summary_text or 'Not available — infer from query'}

Create a 4–6 step execution plan for the entire pipeline. Be specific:
- Which courts / databases to prioritise for search
- What extraction approach to use (full-text vs snippet)
- How to rank citations (chronological? authority-based? perspective-filtered?)
- What dimensions/themes to group citations into
- What the final report should emphasise

Return ONLY this JSON (no prose):
{{
  "steps": [
    "1. Search Indian Kanoon for Supreme Court judgments on ...",
    "2. Also search Serper for High Court precedents on ...",
    "3. Extract full citation metadata — focus on ratio decidendi and ...",
    "4. Rank by authority (Supreme Court > High Court) and recency ...",
    "5. Group into dimensions: [X, Y, Z]",
    "6. Build report emphasising {perspective} perspective ..."
  ],
  "reasoning": "Brief explanation of why this strategy fits the query",
  "focus_areas": ["keyword1", "keyword2", "keyword3"],
  "priority_courts": ["Supreme Court of India", "High Court"],
  "expected_dimensions": ["Dimension A", "Dimension B", "Dimension C"]
}}
"""

    try:
        plan = await claude_complete_json(system=system, user=user, max_tokens=512)
    except Exception as exc:
        plan = {
            "steps": [
                f"1. Search for '{query}' on Indian Kanoon",
                "2. Search Serper for related judgments",
                "3. Extract citation metadata from results",
                "4. Rank by relevance and authority",
                "5. Build report",
            ],
            "reasoning": f"Default plan (planning call failed: {exc})",
            "focus_areas": [],
            "priority_courts": ["Supreme Court of India"],
            "expected_dimensions": ["General"],
        }

    tool_context.state["pipeline_plan"] = plan

    steps = plan.get("steps", [])
    focus = plan.get("focus_areas", [])
    if run_id:
        pipeline_log(run_id, "PlannerAgent", f"Pipeline plan created ({len(steps)} steps)")
        for step in steps:
            pipeline_log(run_id, "PlannerAgent", f"  → {step}")
        if focus:
            pipeline_log(run_id, "PlannerAgent", f"Focus areas: {', '.join(focus)}")

    return plan


# ---------------------------------------------------------------------------
# ADK FunctionTool
# ---------------------------------------------------------------------------

create_pipeline_plan_tool = FunctionTool(func=tool_create_pipeline_plan)


# ---------------------------------------------------------------------------
# Agent factory
# ---------------------------------------------------------------------------

_INSTRUCTION = """You are the Pipeline Planner Agent for a legal citation research pipeline.

You have the case context summary from the previous step.

YOUR ONLY JOB:
STEP 1 — Call `tool_create_pipeline_plan`. This reads the case context and query from state,
          reasons about the full pipeline, and produces a structured execution plan.
STEP 2 — Output the plan steps so the next agent in the pipeline can see them.

Do NOT search. Do NOT extract citations. Do NOT rank. Only plan.

After calling the tool, output this JSON:
{
  "plan_created": true,
  "step_count": <number of steps in the plan>,
  "focus_summary": "<one sentence: what this pipeline will focus on>",
  "priority_courts": ["..."],
  "expected_dimensions": ["..."]
}
"""


def build_planner_agent() -> LlmAgent:
    model_id = os.getenv("CLAUDE_MODEL", "claude-sonnet-4-6-20251001")
    return LlmAgent(
        name="PlannerAgent",
        model=LiteLlm(model=f"anthropic/{model_id}"),
        instruction=_INSTRUCTION,
        tools=[create_pipeline_plan_tool],
        output_key="pipeline_plan_summary",
    )
