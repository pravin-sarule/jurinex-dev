"""Extractor Agent — uses Claude to extract structured citations from search results.

Plan-then-execute pattern:
  STEP 1  tool_create_extraction_plan  → Claude reasons about how many docs to fetch,
                                         which sources to prioritise, and what metadata
                                         to extract; stored in state["extraction_plan"]
  STEP 2  tool_fetch_and_extract       → fetches full text + Claude extracts metadata
  STEP 3  tool_extract_from_snippets   → fast snippet-only extraction for remaining results
"""
from __future__ import annotations

import asyncio
import os
from typing import Any, Dict, List

from google.adk.agents import LlmAgent
from google.adk.models.lite_llm import LiteLlm
from google.adk.tools import FunctionTool
from google.adk.tools.tool_context import ToolContext

from tools.judgment_fetcher import fetch_judgment_text
from utils.claude_client import claude_complete_json
from utils.logger import pipeline_log

_MAX_FETCH = int(os.getenv("CITATION_MAX_FETCH_DOCS", "8"))


# ---------------------------------------------------------------------------
# PLAN tool  (always called first)
# ---------------------------------------------------------------------------

async def tool_create_extraction_plan(tool_context: ToolContext) -> Dict[str, Any]:
    """Reason about the extraction task and create a step-by-step extraction plan.

    Reads from state: query, search_results (count), pipeline_plan, search_plan, run_id
    Writes to state:  extraction_plan
    """
    query = tool_context.state.get("query", "")
    run_id = tool_context.state.get("run_id", "")
    search_results: List[Dict] = tool_context.state.get("search_results", [])
    pipeline_plan = tool_context.state.get("pipeline_plan", {})
    search_plan = tool_context.state.get("search_plan", {})

    result_count = len(search_results)
    sources = list({r.get("source", "unknown") for r in search_results})
    pipeline_steps = pipeline_plan.get("steps", [])
    focus_areas = pipeline_plan.get("focus_areas", [])

    system = (
        "You are a legal citation extraction strategist for Indian courts. "
        "Plan how to extract structured citation metadata from a set of search results."
    )
    user = f"""
Citation query: {query}
Search results available: {result_count} results from sources: {sources}
Pipeline focus areas: {focus_areas}
Pipeline plan steps: {pipeline_steps[:4]}
Search plan reasoning: {search_plan.get('reasoning', '')}

Design a 3–5 step extraction plan. Consider:
- How many results merit full-text fetch vs snippet-only extraction
- What metadata fields are most critical to extract (ratio, holding, statutes, excerpts)
- Whether to prioritise Indian Kanoon docs (have structured metadata) over web URLs
- Any quality filters to apply (e.g. skip results with no court information)

Return ONLY this JSON:
{{
  "steps": [
    "1. Fetch full text for top {min(result_count, _MAX_FETCH)} results ...",
    "2. For each fetched doc, extract: caseName, court, date, ratio, holding, statutes ...",
    "3. For remaining results, use snippet-only extraction ...",
    "4. Deduplicate by caseName similarity ...",
    "5. Filter out results missing caseName and court ..."
  ],
  "reasoning": "why this extraction approach fits the available results",
  "max_full_fetch": {min(result_count, _MAX_FETCH)},
  "snippet_fallback": true,
  "priority_sources": ["indian_kanoon", "serper"]
}}
"""
    try:
        plan = await claude_complete_json(system=system, user=user, max_tokens=512)
    except Exception as exc:
        plan = {
            "steps": [
                f"1. Fetch full text for top {min(result_count, _MAX_FETCH)} results",
                "2. Extract citation metadata using Claude",
                "3. Snippet-only extraction for remaining results",
                "4. Deduplicate",
            ],
            "reasoning": f"Default extraction plan (planning failed: {exc})",
            "max_full_fetch": min(result_count, _MAX_FETCH),
            "snippet_fallback": True,
            "priority_sources": ["indian_kanoon"],
        }

    tool_context.state["extraction_plan"] = plan

    steps = plan.get("steps", [])
    if run_id:
        pipeline_log(run_id, "ExtractorAgent", f"Extraction plan created ({len(steps)} steps)")
        for step in steps:
            pipeline_log(run_id, "ExtractorAgent", f"  → {step}")

    return plan


# ---------------------------------------------------------------------------
# EXECUTE tools
# ---------------------------------------------------------------------------

async def tool_fetch_and_extract(
    search_results: List[Dict[str, Any]],
    original_query: str,
    tool_context: ToolContext = None,
) -> Dict[str, Any]:
    """Fetch full text for top search results and extract citation metadata with Claude.

    Args:
        search_results: List of search result dicts (title, url, snippet, source)
        original_query: The original citation query for relevance scoring
    """
    run_id = tool_context.state.get("run_id", "") if tool_context else ""
    extraction_plan = (tool_context.state.get("extraction_plan", {}) if tool_context else {})
    max_fetch = extraction_plan.get("max_full_fetch", _MAX_FETCH)

    candidates = search_results[:max_fetch]

    if run_id:
        pipeline_log(run_id, "ExtractorAgent", f"Fetching full text for {len(candidates)} results")

    tasks = [fetch_judgment_text(r.get("url", "")) for r in candidates]
    texts = await asyncio.gather(*tasks, return_exceptions=True)

    extracted_citations: List[Dict[str, Any]] = []

    for i, (result, text_result) in enumerate(zip(candidates, texts)):
        if isinstance(text_result, Exception) or not text_result:
            continue

        full_text = text_result.get("full_text", "")
        if len(full_text) < 100:
            full_text = result.get("snippet", "")

        if not full_text:
            continue

        system = (
            "You are a legal citation extractor for Indian courts. "
            "Extract structured metadata from the provided judgment text."
        )
        user = f"""Extract citation metadata from this judgment text. Return ONLY a JSON object.

Original query: {original_query}
Source URL: {result.get('url', '')}
Document title: {result.get('title', '')}
Document text (excerpt):
{full_text[:4000]}

Return this JSON schema (fill what you can, leave empty string for unknowns):
{{
  "caseName": "Full case name e.g. State of Maharashtra v. John Doe",
  "primaryCitation": "Official citation e.g. AIR 2020 SC 1234 or (2020) 5 SCC 100",
  "court": "Supreme Court of India | High Court | Tribunal | etc.",
  "date": "YYYY-MM-DD or YYYY",
  "statutes": ["IPC §302", "CrPC §437"],
  "excerptText": "Most relevant excerpt (max 300 chars)",
  "ratio": "Core legal principle / ratio decidendi (max 200 chars)",
  "holding": "Court's final holding",
  "argumentParty": "appellant | respondent | court | neutral",
  "partyArguments": {{
    "appellant": ["argument 1"],
    "respondent": ["argument 1"],
    "court": "court reasoning"
  }},
  "relevanceScore": 0.0,
  "sourceUrl": "{result.get('url', '')}",
  "source": "{result.get('source', 'serper')}",
  "doc_id": "{text_result.get('doc_id', '')}"
}}
"""
        try:
            citation = await claude_complete_json(system=system, user=user, max_tokens=1024)
            if citation and citation.get("caseName"):
                citation["_search_snippet"] = result.get("snippet", "")
                citation["canonical_id"] = text_result.get("doc_id") or result.get("url", "")
                extracted_citations.append(citation)
        except Exception:
            pass

    if tool_context:
        tool_context.state["raw_citations"] = extracted_citations

    if run_id:
        pipeline_log(run_id, "ExtractorAgent", f"Full-text extraction: {len(extracted_citations)} citations extracted")

    return {
        "citations": extracted_citations,
        "processed": len(candidates),
        "extracted": len(extracted_citations),
    }


async def tool_extract_from_snippets(
    search_results: List[Dict[str, Any]],
    original_query: str,
    tool_context: ToolContext = None,
) -> Dict[str, Any]:
    """Fast citation extraction from search snippets only (no full-text fetch).

    Args:
        search_results: Search result dicts with title, snippet, url
        original_query: Original citation query
    """
    run_id = tool_context.state.get("run_id", "") if tool_context else ""

    if not search_results:
        return {"citations": [], "processed": 0}

    if run_id:
        pipeline_log(run_id, "ExtractorAgent", f"Snippet extraction for {len(search_results[:15])} results")

    batch_text = "\n\n".join(
        f"Result {i+1}:\nTitle: {r.get('title','')}\nURL: {r.get('url','')}\n"
        f"Court: {r.get('court','')}\nDate: {r.get('date','')}\nSnippet: {r.get('snippet','')}"
        for i, r in enumerate(search_results[:15])
    )

    system = (
        "You are a legal citation extractor. "
        "Extract structured citations from search result snippets for Indian courts."
    )
    user = f"""Query: {original_query}

Search Results:
{batch_text}

Extract a JSON array of citations. Each citation object:
{{
  "caseName": "...",
  "primaryCitation": "...",
  "court": "...",
  "date": "...",
  "statutes": [],
  "excerptText": "...",
  "ratio": "...",
  "argumentParty": "neutral",
  "relevanceScore": 0.0,
  "sourceUrl": "...",
  "source": "serper"
}}

Return only the JSON array. Include only results that appear to be actual court judgments.
"""
    citations = await claude_complete_json(system=system, user=user, max_tokens=2048)
    if not isinstance(citations, list):
        citations = citations.get("citations", []) if isinstance(citations, dict) else []

    import re
    for c in citations:
        url = c.get("sourceUrl", "")
        if "indiankanoon.org/doc/" in url:
            m = re.search(r"/doc/(\d+)", url)
            if m:
                c["canonical_id"] = f"ik:{m.group(1)}"
        c.setdefault("canonical_id", url)

    if tool_context:
        existing = tool_context.state.get("raw_citations", [])
        merged = existing + [c for c in citations if c not in existing]
        tool_context.state["raw_citations"] = merged

    if run_id:
        pipeline_log(run_id, "ExtractorAgent", f"Snippet extraction complete: {len(citations)} citations")

    return {"citations": citations, "processed": len(search_results)}


# ---------------------------------------------------------------------------
# ADK FunctionTools
# ---------------------------------------------------------------------------

create_extraction_plan_tool = FunctionTool(func=tool_create_extraction_plan)
fetch_extract_tool = FunctionTool(func=tool_fetch_and_extract)
snippet_extract_tool = FunctionTool(func=tool_extract_from_snippets)


# ---------------------------------------------------------------------------
# Agent factory
# ---------------------------------------------------------------------------

_INSTRUCTION = """You are the Citation Extractor Agent for a legal research pipeline.

ALWAYS follow this exact order — do not skip steps:

STEP 1 — Call `tool_create_extraction_plan` FIRST.
          This reads the search results count and pipeline plan from state, then creates
          a targeted extraction strategy. Read the plan before proceeding.

STEP 2 — Execute: call `tool_fetch_and_extract` with the search_results from state
          and the original query. Pass the full search_results list.

STEP 3 — Call `tool_extract_from_snippets` for any results not already processed,
          to catch additional citations from snippets.

STEP 4 — Combine and deduplicate all extracted citations.

Quality standards:
- Only include results that are actual Indian court judgments
- Each citation must have at minimum: caseName, court, date, excerptText
- Remove duplicates based on caseName similarity

Output JSON:
{
  "extracted_count": <int>,
  "courts_found": ["Supreme Court", "High Court"],
  "earliest_date": "...",
  "latest_date": "...",
  "status": "ok"
}
"""


def build_extractor_agent() -> LlmAgent:
    model_id = os.getenv("CLAUDE_MODEL", "claude-sonnet-4-6-20251001")
    return LlmAgent(
        name="ExtractorAgent",
        model=LiteLlm(model=f"anthropic/{model_id}"),
        instruction=_INSTRUCTION,
        tools=[
            create_extraction_plan_tool,   # always first
            fetch_extract_tool,
            snippet_extract_tool,
        ],
        output_key="extraction_summary",
    )
