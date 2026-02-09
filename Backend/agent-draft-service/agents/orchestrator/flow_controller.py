"""Execution flow control for the orchestrator."""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from agents.orchestrator.state_manager import DocumentState


class AgentName(str, Enum):
    """Canonical agent identifiers."""

    INGESTION = "ingestion"
    LIBRARIAN = "librarian"
    DRAFTER = "drafter"
    CRITIC = "critic"
    ASSEMBLER = "assembler"


@dataclass(frozen=True)
class FlowDecision:
    """Represents the next agent to run, or a terminal state."""

    next_agent: AgentName | None
    reason: str


class FlowController:
    """
    Controls the orchestration flow based on current document state.

    This class holds the business rules for the agent execution order.
    """

    def decide_next(self, state: DocumentState) -> FlowDecision:
        if not state.ingested:
            return FlowDecision(AgentName.INGESTION, "raw input not ingested")
        if not state.embedded:
            return FlowDecision(AgentName.LIBRARIAN, "chunks or embeddings missing")
        if not state.drafted:
            return FlowDecision(AgentName.DRAFTER, "draft not created")
        if not state.validated:
            return FlowDecision(AgentName.CRITIC, "draft not validated")
        if not state.completed:
            return FlowDecision(AgentName.ASSEMBLER, "final output not assembled")

        return FlowDecision(None, "document completed")
