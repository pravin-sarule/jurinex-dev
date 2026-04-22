"""Case Context Agent — fetches case details from agentic-document-service.

Google ADK LlmAgent that calls the document service to extract:
- Case title, parties, jurisdiction
- Facts and legal issues from uploaded documents
- Statutes / acts mentioned
- Key legal questions to use as search seeds
"""
from __future__ import annotations

import os
from typing import Any, Dict

from google.adk.agents import LlmAgent
from google.adk.models.lite_llm import LiteLlm
from google.adk.tools import FunctionTool
from google.adk.tools.tool_context import ToolContext

from tools.document_service import fetch_case_context, fetch_case_metadata

# ---------------------------------------------------------------------------
# ADK Tool functions
# ---------------------------------------------------------------------------

async def tool_fetch_case_context(
    case_id: str,
    user_id: str,
    query: str,
    tool_context: ToolContext,
) -> Dict[str, Any]:
    """Fetch case context from the agentic document service.

    Args:
        case_id: The case identifier in the document service
        user_id: The requesting user's ID
        query: The citation search query to use for RAG retrieval

    Returns:
        Case context dict with facts, issues, statutes
    """
    if not case_id or case_id in ("none", "null", ""):
        result: Dict[str, Any] = {"case_id": None, "facts": "", "available": False}
        tool_context.state["case_context"] = result
        return result

    ctx = await fetch_case_context(case_id=case_id, user_id=user_id, query=query)
    tool_context.state["case_context"] = ctx
    return ctx


async def tool_fetch_case_metadata(
    case_id: str,
    tool_context: ToolContext,
) -> Dict[str, Any]:
    """Fetch metadata for a case (title, type, parties).

    Args:
        case_id: The case identifier
    """
    meta = await fetch_case_metadata(case_id=case_id)
    existing = tool_context.state.get("case_context", {})
    existing.update(meta)
    tool_context.state["case_context"] = existing
    return meta


# ---------------------------------------------------------------------------
# ADK FunctionTools
# ---------------------------------------------------------------------------

fetch_context_tool = FunctionTool(func=tool_fetch_case_context)
fetch_metadata_tool = FunctionTool(func=tool_fetch_case_metadata)


# ---------------------------------------------------------------------------
# Agent factory
# ---------------------------------------------------------------------------

_INSTRUCTION = """You are the Case Context Agent for a legal citation research pipeline.

Your role:
1. When given a case_id, call `tool_fetch_case_context` to retrieve case details from the document service.
2. If metadata is needed, call `tool_fetch_case_metadata`.
3. Summarise the key legal issues, applicable statutes, and parties from the case context.
4. Extract 3-5 focused legal search queries that a lawyer would use to find relevant precedents for this case.

Output a JSON object with:
{
  "case_summary": "<brief case summary>",
  "legal_issues": ["issue 1", "issue 2"],
  "statutes": ["IPC §302", "CrPC §437"],
  "parties": {"petitioner": "...", "respondent": "..."},
  "search_queries": ["query 1", "query 2", "query 3"]
}

If no case_id is provided, generate search queries from the citation_query alone.
Always output valid JSON — no prose outside the JSON block.
"""


def build_case_context_agent() -> LlmAgent:
    model_id = os.getenv("CLAUDE_MODEL", "claude-sonnet-4-6-20251001")
    return LlmAgent(
        name="CaseContextAgent",
        model=LiteLlm(model=f"anthropic/{model_id}"),
        instruction=_INSTRUCTION,
        tools=[fetch_context_tool, fetch_metadata_tool],
        output_key="case_context_summary",
    )
