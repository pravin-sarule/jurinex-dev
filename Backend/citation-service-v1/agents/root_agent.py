"""Root Agent — Google ADK SequentialAgent orchestrating the full citation pipeline.

Pipeline stages (plan-then-execute pattern):
  1. CaseContextAgent  — fetches case from agentic-document-service
  2. PlannerAgent      — creates cross-agent pipeline execution plan
  3. SearchAgent       — plans then executes Serper + Indian Kanoon search
  4. ExtractorAgent    — plans then extracts structured citations
  5. RankerAgent       — plans then ranks + groups into legal dimensions
  6. ReporterAgent     — plans then builds final ReportFormat for the frontend

Each of agents 3–6 calls a tool_create_<agent>_plan FIRST before any execution,
ensuring every agent reasons about its task before acting.
"""
from __future__ import annotations

from typing import Optional

from google.adk.agents import SequentialAgent

from .case_context_agent import build_case_context_agent
from .planner_agent import build_planner_agent
from .search_agent import build_search_agent
from .extractor_agent import build_extractor_agent
from .ranker_agent import build_ranker_agent
from .reporter_agent import build_reporter_agent


class CitationRootAgent:
    """Thin wrapper around the Google ADK SequentialAgent for the citation pipeline."""

    def __init__(self) -> None:
        self._sequential_agent: Optional[SequentialAgent] = None

    def _build(self) -> SequentialAgent:
        return SequentialAgent(
            name="CitationPipeline",
            description=(
                "Legal citation research pipeline (plan-then-execute): "
                "case context → pipeline planning → web search → "
                "citation extraction → relevance ranking → report"
            ),
            sub_agents=[
                build_case_context_agent(),
                build_planner_agent(),        # creates pipeline_plan in state
                build_search_agent(),         # plans → searches Serper + IK
                build_extractor_agent(),      # plans → extracts citation metadata
                build_ranker_agent(),         # plans → ranks + groups into dimensions
                build_reporter_agent(),       # plans → builds final ReportFormat
            ],
        )

    @property
    def agent(self) -> SequentialAgent:
        if self._sequential_agent is None:
            self._sequential_agent = self._build()
        return self._sequential_agent


def build_root_agent() -> SequentialAgent:
    """Factory — returns a freshly built SequentialAgent with plan-then-execute agents."""
    return SequentialAgent(
        name="CitationPipeline",
        description=(
            "Legal citation research pipeline (plan-then-execute): "
            "case context → pipeline planning → web search → "
            "citation extraction → relevance ranking → report"
        ),
        sub_agents=[
            build_case_context_agent(),
            build_planner_agent(),        # creates pipeline_plan in state
            build_search_agent(),         # plans → searches Serper + IK
            build_extractor_agent(),      # plans → extracts citation metadata
            build_ranker_agent(),         # plans → ranks + groups into dimensions
            build_reporter_agent(),       # plans → builds final ReportFormat
        ],
    )
