"""Search Agent — parallel Serper + Indian Kanoon search for legal judgments.

Plan-then-execute pattern:
  STEP 1  tool_create_search_plan   → Claude reasons about query + pipeline plan,
                                      produces a 3-5 step search strategy,
                                      stored in state["search_plan"]
  STEP 2  tool_multi_search         → executes the plan across Serper + IK in parallel
"""
from __future__ import annotations

import asyncio
import os
from typing import Any, Dict, List

from google.adk.agents import LlmAgent
from google.adk.models.lite_llm import LiteLlm
from google.adk.tools import FunctionTool
from google.adk.tools.tool_context import ToolContext

from tools.serper_search import search_google_serper
from tools.ik_search import search_indian_kanoon
from utils.claude_client import claude_complete_json
from utils.logger import pipeline_log


# ---------------------------------------------------------------------------
# PLAN tool  (always called first)
# ---------------------------------------------------------------------------

async def tool_create_search_plan(tool_context: ToolContext) -> Dict[str, Any]:
    """Reason about the search task and create a step-by-step search plan.

    Reads from state: query, pipeline_plan, case_context_summary, run_id
    Writes to state:  search_plan
    """
    query = tool_context.state.get("query", "")
    run_id = tool_context.state.get("run_id", "")
    pipeline_plan = tool_context.state.get("pipeline_plan", {})
    case_summary = tool_context.state.get("case_context_summary", "")

    pipeline_steps = pipeline_plan.get("steps", [])
    focus_areas = pipeline_plan.get("focus_areas", [])
    priority_courts = pipeline_plan.get("priority_courts", [])

    system = (
        "You are a legal search strategist for Indian courts. "
        "Create a precise, actionable search execution plan."
    )
    user = f"""
Citation query: {query}
Pipeline plan steps: {pipeline_steps[:4]}
Focus areas from planner: {focus_areas}
Priority courts: {priority_courts}
Case context: {str(case_summary)[:400] if case_summary else 'not available'}

Design a 3–5 step search execution plan. Specify:
- Which exact search queries to run (with legal terms, statute numbers, court names)
- Which source to use for each query: Indian Kanoon, Serper/Google, or both
- What type of judgments to target first (Supreme Court / High Court / specific tribunal)

Return ONLY this JSON:
{{
  "steps": [
    "1. Search Indian Kanoon for '<specific query>' targeting Supreme Court",
    "2. Search Serper for '<specific query> site:indiankanoon.org'",
    "3. Search Indian Kanoon for '<broader fallback query>'",
    "4. Serper search for '<additional angle>'",
    "5. Broaden to High Court judgments if SC results are sparse"
  ],
  "reasoning": "why this search strategy fits the query",
  "primary_terms": ["term1", "term2", "term3"],
  "queries": ["query1", "query2", "query3"]
}}
"""
    try:
        plan = await claude_complete_json(system=system, user=user, max_tokens=512)
    except Exception as exc:
        plan = {
            "steps": [
                f"1. Search Indian Kanoon: {query}",
                f"2. Serper search: {query} court judgment India",
            ],
            "reasoning": f"Default search plan (planning failed: {exc})",
            "primary_terms": [],
            "queries": [query],
        }

    tool_context.state["search_plan"] = plan

    steps = plan.get("steps", [])
    if run_id:
        pipeline_log(run_id, "SearchAgent", f"Search plan created ({len(steps)} steps)")
        for step in steps:
            pipeline_log(run_id, "SearchAgent", f"  → {step}")

    return plan


# ---------------------------------------------------------------------------
# EXECUTE tools
# ---------------------------------------------------------------------------

async def tool_search_google(
    query: str,
    num_results: int = 10,
    tool_context: ToolContext = None,
) -> Dict[str, Any]:
    """Search Google for relevant Indian legal judgments using Serper.

    Args:
        query: Legal search query (e.g. "Supreme Court bail conditions IPC 437")
        num_results: Number of results to retrieve (default 10)
    """
    legal_query = f"{query} site:indiankanoon.org OR site:judis.nic.in OR judgement court India"
    result = await search_google_serper(legal_query, num_results=num_results)

    if tool_context:
        existing: List[Dict] = tool_context.state.get("search_results", [])
        existing.extend(result.get("results", []))
        tool_context.state["search_results"] = existing

    return result


async def tool_search_indian_kanoon(
    query: str,
    num_results: int = 10,
    tool_context: ToolContext = None,
) -> Dict[str, Any]:
    """Search Indian Kanoon legal database for relevant judgments.

    Args:
        query: Legal search query
        num_results: Number of results to retrieve (default 10)
    """
    result = await search_indian_kanoon(query, page_num=0)

    if tool_context:
        existing: List[Dict] = tool_context.state.get("search_results", [])
        existing.extend(result.get("results", []))
        seen_urls: set = set()
        deduped = []
        for r in existing:
            url = r.get("url", "")
            if url and url not in seen_urls:
                seen_urls.add(url)
                deduped.append(r)
        tool_context.state["search_results"] = deduped

    return result


async def tool_multi_search(
    queries: List[str],
    tool_context: ToolContext = None,
) -> Dict[str, Any]:
    """Run multiple queries on both Serper and Indian Kanoon in parallel.

    Executes up to 5 queries across both sources simultaneously.

    Args:
        queries: List of search queries to run (max 5)
    """
    run_id = tool_context.state.get("run_id", "") if tool_context else ""
    capped = queries[:5]

    if run_id:
        pipeline_log(run_id, "SearchAgent", f"Executing {len(capped)} queries across Serper + Indian Kanoon")

    tasks = []
    for q in capped:
        legal_q = f"{q} site:indiankanoon.org OR court judgment India"
        tasks.append(search_google_serper(legal_q, num_results=8))
        tasks.append(search_indian_kanoon(q, page_num=0))

    results = await asyncio.gather(*tasks, return_exceptions=True)

    all_results: List[Dict[str, Any]] = []
    for r in results:
        if isinstance(r, Exception):
            continue
        all_results.extend(r.get("results", []))

    seen_urls: set = set()
    deduped = []
    for item in all_results:
        url = item.get("url", "")
        if url and url not in seen_urls:
            seen_urls.add(url)
            deduped.append(item)

    if tool_context:
        tool_context.state["search_results"] = deduped

    if run_id:
        pipeline_log(run_id, "SearchAgent", f"Search complete — {len(deduped)} unique results found")

    return {"results": deduped, "total": len(deduped), "queries_run": len(capped)}


# ---------------------------------------------------------------------------
# ADK FunctionTools
# ---------------------------------------------------------------------------

create_search_plan_tool = FunctionTool(func=tool_create_search_plan)
google_search_tool = FunctionTool(func=tool_search_google)
ik_search_tool = FunctionTool(func=tool_search_indian_kanoon)
multi_search_tool = FunctionTool(func=tool_multi_search)


# ---------------------------------------------------------------------------
# Agent factory
# ---------------------------------------------------------------------------

_INSTRUCTION = """You are the Search Agent for a legal citation research pipeline.

ALWAYS follow this exact order — do not skip steps:

STEP 1 — Call `tool_create_search_plan` FIRST.
          This reads the pipeline plan and query from state, then creates a
          targeted search strategy. Read the plan steps in the result before proceeding.

STEP 2 — Execute the plan: call `tool_multi_search` using the queries from your search plan.
          Pass the "queries" list from the search_plan result as the queries argument.
          If the plan has no queries, derive 3 specific legal queries from the original query.

STEP 3 — Summarise your findings briefly.

Focus on Supreme Court, High Court, and Tribunal judgments.
Do not extract citations yet — that is the next agent's job.

Output JSON:
{
  "total_results": <int>,
  "queries_used": ["..."],
  "top_sources": ["indiankanoon.org", "..."],
  "summary": "<one-sentence summary of what was found>"
}
"""


def build_search_agent() -> LlmAgent:
    model_id = os.getenv("CLAUDE_MODEL", "claude-sonnet-4-6-20251001")
    return LlmAgent(
        name="SearchAgent",
        model=LiteLlm(model=f"anthropic/{model_id}"),
        instruction=_INSTRUCTION,
        tools=[
            create_search_plan_tool,   # always first
            google_search_tool,
            ik_search_tool,
            multi_search_tool,
        ],
        output_key="search_summary",
    )
