"""
root_agent.py — backward-compat exports only.

The active pipeline is now proposition_pipeline.run_proposition_pipeline.
This file keeps AgentContext, AgentResult, BaseAgent, LegalDimensionExtractor
exported for any code that still imports from agents.root_agent.
"""
from __future__ import annotations

from agents.base_agent import BaseAgent, AgentContext, AgentResult, Tool  # noqa: F401

import logging
logger = logging.getLogger(__name__)


class LegalDimensionExtractor(BaseAgent):
    """Deprecated stub — pipeline now uses PropositionExtractor."""
    name        = "legal_dimension_extractor"
    description = "Deprecated stub."

    def run(self, context: AgentContext) -> AgentResult:
        return AgentResult(success=False, error="LegalDimensionExtractor is deprecated. Use proposition_pipeline.")


class CitationRootAgent(BaseAgent):
    """Deprecated stub — pipeline now uses run_proposition_pipeline directly."""
    name        = "citation_root_agent"
    description = "Deprecated stub."

    def run(self, context: AgentContext) -> AgentResult:
        return AgentResult(success=False, error="CitationRootAgent is deprecated. Use pipeline.run_pipeline().")
