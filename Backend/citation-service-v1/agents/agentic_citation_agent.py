"""Agentic Citation Agent — Claude drives web search end-to-end.

Flow:
  1. Claude reads the case context and identifies legal issues
  2. Claude calls web_search (Brave via Anthropic) with targeted queries
  3. Claude reads snippets, fetches full pages for relevant results
  4. Claude compares judgment facts vs case facts
  5. Claude outputs a structured JSON citation list

This replaces the multi-stage Serper+IK pipeline with a single agentic loop
that is faster and returns more relevant results because Claude decides what to
search and what to keep.
"""
from __future__ import annotations

import json
import os
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from utils.claude_client import get_claude_client
from utils.logger import pipeline_log


# ---------------------------------------------------------------------------
# System prompt — drives Claude's research behaviour
# ---------------------------------------------------------------------------

_SYSTEM = """You are an expert Indian legal citation researcher with deep knowledge of Supreme Court, High Courts, and Tribunals.

YOUR WORKFLOW for every query:

STEP 1 — ANALYSE
Read the case context carefully. Identify:
- Core legal issues (e.g. "right to property without compensation", "bail conditions Section 437")
- Statutes and sections mentioned
- Key fact pattern (parties, subject matter, relief sought)
- Perspective requested (appellant / respondent / court / all)

STEP 2 — SEARCH STRATEGY
Plan 4–6 targeted queries. Mix:
- Specific: "Article 300A acquisition without compensation site:indiankanoon.org"
- By statute: "Section 437 CrPC bail anticipatory Supreme Court site:indiankanoon.org"
- By principle: "right to property compulsory acquisition compensation India court"
- Recent: add "2015 2024" or "2020 2024" for recent precedents
- By court tier: start with Supreme Court, then High Courts if needed

STEP 3 — SEARCH & EVALUATE
For each search:
- Read titles and snippets
- Only pursue results that are actual court judgments (not articles, commentary)
- Fetch full text for results where snippet confirms relevance

STEP 4 — COMPILE
After all searches, select 8–15 judgments that DIRECTLY address the legal query.
Rank by: (1) Supreme Court authority, (2) fact similarity, (3) recency.

OUTPUT — after completing all searches, output ONLY a valid JSON array:
[
  {
    "caseName": "Full Party Name v Other Party",
    "primaryCitation": "AIR/SCC citation e.g. (2020) 2 SCC 569 or AIR 2019 SC 1234",
    "court": "Supreme Court of India",
    "date": "YYYY-MM-DD",
    "statutes": ["Article 300A", "Land Acquisition Act 1894 s11"],
    "excerptText": "Most legally precise excerpt relevant to the query (max 350 chars)",
    "ratio": "Core ratio decidendi / legal principle established (max 200 chars)",
    "relevanceScore": 0.95,
    "argumentParty": "neutral",
    "sourceUrl": "https://indiankanoon.org/doc/..."
  }
]

RULES:
- Only real court judgments — no articles, no commentary
- Each entry must have caseName + court + ratio at minimum
- Supreme Court first, then High Courts, then Tribunals
- Explain relevance through ratio and excerptText fields
- Output ONLY the JSON array — no preamble, no trailing text"""


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _extract_citations(text: str) -> List[Dict[str, Any]]:
    """Extract JSON citation array from Claude's final text output."""
    if not text:
        return []

    # Try fenced code block first
    fence = re.search(r"```(?:json)?\s*(\[[\s\S]+?\])\s*```", text)
    if fence:
        try:
            return json.loads(fence.group(1))
        except json.JSONDecodeError:
            pass

    # Try raw JSON array (possibly with trailing text)
    decoder = json.JSONDecoder()
    for i, ch in enumerate(text):
        if ch == "[":
            try:
                obj, _ = decoder.raw_decode(text, i)
                if isinstance(obj, list):
                    return obj
            except json.JSONDecodeError:
                pass

    return []


def _build_report_format(
    citations: List[Dict[str, Any]],
    query: str,
    user_id: str,
    case_id: Optional[str],
    run_id: str,
    perspective: str,
) -> Dict[str, Any]:
    """Convert raw citation list to the ReportFormat expected by the frontend."""
    now = _now()

    if not citations:
        return {
            "citations": [],
            "generatedAt": now,
            "perspective": perspective,
            "dimensions": [],
            "dimensionGroups": [],
            "metadata": {
                "query": query, "user_id": user_id, "case_id": case_id,
                "run_id": run_id, "status": "completed", "citation_count": 0,
                "generated_at": now, "service_version": "v1-agentic", "coverage": {},
            },
        }

    # Assign dimension groups by statute / legal area
    def _dimension_for(c: Dict) -> str:
        statutes = c.get("statutes", [])
        if statutes:
            return statutes[0].split("§")[0].split("s")[0].strip()[:40]
        court = c.get("court", "")
        if "Supreme" in court:
            return "Supreme Court Precedents"
        if "High" in court:
            return "High Court Precedents"
        return "General"

    dim_map: Dict[str, Dict] = {}
    final_cits: List[Dict] = []

    for i, c in enumerate(citations):
        cid = str(uuid.uuid4())
        dim_name = _dimension_for(c)
        dim_id = re.sub(r"[^a-z0-9]", "_", dim_name.lower())[:20] or f"dim_{i}"

        entry = {
            "id": cid,
            "caseName": c.get("caseName", ""),
            "primaryCitation": c.get("primaryCitation", ""),
            "court": c.get("court", ""),
            "date": c.get("date", ""),
            "statutes": c.get("statutes", []),
            "excerptText": c.get("excerptText", ""),
            "ratio": c.get("ratio", ""),
            "relevanceScore": float(c.get("relevanceScore", 0.7)),
            "argumentParty": c.get("argumentParty", "neutral"),
            "sourceUrl": c.get("sourceUrl", ""),
            "sourceUrls": [c.get("sourceUrl", "")] if c.get("sourceUrl") else [],
            "sourceCitations": [c.get("sourceUrl", "")] if c.get("sourceUrl") else [],
            "dimensionId": dim_id,
            "dimensionName": dim_name,
            "auditStatus": "UNVERIFIED",
            "verificationStatus": "YELLOW",
            "partyArguments": {"appellant": [], "respondent": [], "court": ""},
            "treatment": {"followedList": [], "distinguishedList": [], "overruledList": []},
            "ikCiteList": [], "ikCitedByList": [],
        }

        # Derive canonical_id from IK URL if possible
        ik_match = re.search(r"indiankanoon\.org/doc/(\d+)", entry["sourceUrl"])
        if ik_match:
            entry["canonical_id"] = f"ik:{ik_match.group(1)}"
        else:
            entry["canonical_id"] = entry["sourceUrl"]

        final_cits.append(entry)

        if dim_id not in dim_map:
            dim_map[dim_id] = {"dimension_id": dim_id, "name": dim_name, "reasoning": "", "citations": []}
        dim_map[dim_id]["citations"].append(cid)

    courts = list({c.get("court", "") for c in final_cits if c.get("court")})
    years = [int(c["date"][:4]) for c in final_cits if c.get("date") and c["date"][:4].isdigit()]
    coverage = {
        "courts": len(courts),
        "court_names": courts[:5],
        "years_span": (max(years) - min(years)) if len(years) >= 2 else 0,
        "earliest": str(min(years)) if years else "",
        "latest": str(max(years)) if years else "",
    }

    dims = list(dim_map.values())
    return {
        "citations": final_cits,
        "generatedAt": now,
        "perspective": perspective,
        "dimensions": dims,
        "dimensionGroups": dims,
        "metadata": {
            "query": query, "user_id": user_id, "case_id": case_id,
            "run_id": run_id, "status": "completed",
            "citation_count": len(final_cits),
            "generated_at": now,
            "service_version": "v1-agentic",
            "coverage": coverage,
        },
    }


# ---------------------------------------------------------------------------
# Main agent entry point
# ---------------------------------------------------------------------------

async def run_citation_agent(
    query: str,
    case_context: str,
    run_id: str,
    perspective: str,
    user_id: str,
    case_id: Optional[str],
) -> Dict[str, Any]:
    """Run the agentic citation search loop.

    Claude uses Anthropic's built-in web_search tool (Brave) to autonomously:
    search → read snippets → fetch full pages → compare with case → compile report.
    """
    client = get_claude_client()
    model = os.getenv("CLAUDE_MODEL", "claude-sonnet-4-6")

    pipeline_log(run_id, "CitationAgent", f"Starting agentic search | query='{query[:80]}'")

    user_content = (
        f"Case context:\n{case_context[:5000]}\n\n"
        if case_context
        else "No case document provided — search based on the query alone.\n\n"
    )
    user_content += (
        f"Legal query: {query}\n"
        f"Perspective: {perspective}\n\n"
        "Begin your research. After all searches are complete, output the JSON citation array."
    )

    web_search_tool = {"type": "web_search_20250305", "name": "web_search"}
    messages = [{"role": "user", "content": user_content}]

    search_count = 0
    final_text = ""
    max_turns = 25  # safety cap

    for turn in range(max_turns):
        response = await client.messages.create(
            model=model,
            max_tokens=8096,
            system=_SYSTEM,
            tools=[web_search_tool],
            messages=messages,
        )

        # Log what Claude is doing
        for block in response.content:
            btype = getattr(block, "type", None)
            if btype == "tool_use" and getattr(block, "name", "") == "web_search":
                q = getattr(block, "input", {}).get("query", "")
                search_count += 1
                pipeline_log(run_id, "CitationAgent", f"🔍 [{search_count}] {q}")
            elif btype == "text":
                txt = getattr(block, "text", "")
                if txt and len(txt) > 30:
                    preview = txt[:160].replace("\n", " ")
                    pipeline_log(run_id, "CitationAgent", f"💭 {preview}")
                    final_text = txt

        if response.stop_reason == "end_turn":
            # Capture final text block
            for block in response.content:
                if getattr(block, "type", None) == "text":
                    t = getattr(block, "text", "")
                    if t:
                        final_text = t
            break

        # tool_use turn — append assistant message and provide tool results
        messages.append({"role": "assistant", "content": response.content})

        tool_results = []
        for block in response.content:
            if getattr(block, "type", None) == "tool_use":
                # For server-side web_search, Anthropic injects results automatically.
                # We still need to send a tool_result back to continue the conversation.
                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": block.id,
                    "content": "Search executed by Anthropic web search.",
                })

        if tool_results:
            messages.append({"role": "user", "content": tool_results})
        else:
            # No tool calls but not end_turn — shouldn't happen; break to avoid loop
            break

    pipeline_log(run_id, "CitationAgent",
                 f"Research complete — {search_count} searches, parsing citations")

    citations = _extract_citations(final_text)
    pipeline_log(run_id, "CitationAgent", f"Extracted {len(citations)} citations")

    return _build_report_format(citations, query, user_id, case_id, run_id, perspective)
