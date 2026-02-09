"""Re-export Ingestion agent pipeline from agents folder (single source: agents/ingestion/)."""

from __future__ import annotations

from agents.ingestion.pipeline import IngestionInput, IngestionResult, run_ingestion

__all__ = ["IngestionInput", "IngestionResult", "run_ingestion"]
