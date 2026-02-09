"""
Tools: re-exports from agents folder for backward compatibility.

All agent code lives in agents/; each agent has its own folder and separate files.
- agents/librarian/  — Librarian agent (agent.py, tools.py, ...)
- agents/ingestion/  — Ingestion agent (agent.py, pipeline.py, chunker.py, ...)
- agents/orchestrator/ — Orchestrator (agent.py, flow_controller.py, state_manager.py)
- agents/drafter/, critic/, assembler/ — Drafter, Critic, Assembler (separate files when implemented)

tools/ re-exports agent entry points so existing imports like tools.librarian.fetch_relevant_chunks still work.
"""

from __future__ import annotations

from agents.ingestion.pipeline import IngestionInput, IngestionResult, run_ingestion
from agents.librarian.tools import fetch_relevant_chunks

__all__ = [
    "fetch_relevant_chunks",
    "run_ingestion",
    "IngestionInput",
    "IngestionResult",
]
