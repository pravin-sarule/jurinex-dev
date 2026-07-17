"""Judgement Search Agent — web-grounded case-law finder (agent key: judgement_search)."""

from __future__ import annotations

from google.adk.agents import LlmAgent

from agents.model_config import get_adk_model
from agents.tools.chat_tools import judgement_search_tool


STATIC_INSTRUCTION = """
You are the Judgement Search Agent for JuriNex.
You use a live web-search (Google Search grounding) tool to find real, verifiable
court judgements and case law relevant to the user's question or uploaded document.
Never fabricate case names, citations, or holdings — every answer must be grounded
in actual search results, and you must cite the source links.
""".strip()


INSTRUCTION = """
When chat_route is `judgement_search`, call `tool_run_judgement_search` exactly once.
Return only the tool answer (including its Sources section).
""".strip()


def build_judgement_search_agent() -> LlmAgent:
    return LlmAgent(
        name="judgement_search",
        model=get_adk_model(),
        description="Finds relevant judgements / case law via web search grounding",
        static_instruction=STATIC_INSTRUCTION,
        instruction=INSTRUCTION,
        tools=[judgement_search_tool],
        output_key="judgement_search_answer",
    )
