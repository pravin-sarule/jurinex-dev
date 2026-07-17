"""Shared contracts for the Stage-2 drafting strategies.

Strategy-neutral pieces used by BOTH the monolithic (one-shot) and the
section-wise drafting engines: the strategy interface, per-run metadata
records, and small shared helpers. This module has no service imports —
it sits at the bottom of the drafting dependency graph:

    drafting_strategy_base
        ↑                ↑
    drafting_monolithic  drafting_strategies (section-wise + facade)
        ↑                ↑
        drafting_service (orchestration)
"""
from __future__ import annotations

import hashlib
import re
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Optional

DraftingStrategyName = str  # "monolithic" | "sectionwise"


MONOLITHIC_DOCUMENT_ID = "__document__"


_MISSING_RE = re.compile(r"\[DATA NOT PROVIDED:[^\]]*\]|\[MISSING:[^\]]*\]|\[CITATION NEEDED\]", re.I)


def _sha256(text: str) -> str:
    return hashlib.sha256((text or "").encode("utf-8", errors="replace")).hexdigest()[:16]


def count_placeholders(text: str) -> int:
    return len(_MISSING_RE.findall(text or ""))


@dataclass
class SectionCallMeta:
    """Per-section trace row (section-wise strategy only)."""

    section_id: str
    heading: str
    success: bool
    latency_ms: int
    input_tokens: int
    output_tokens: int
    placeholders_inserted: int
    input_hash: str
    output_hash: str
    error: Optional[str] = None


@dataclass
class DraftMetadata:
    """Persisted alongside draft_sections — consumed by ops/debug, not Stage 3."""

    drafting_strategy: DraftingStrategyName
    model: str
    section_calls: list[SectionCallMeta] = field(default_factory=list)
    monolithic_latency_ms: Optional[int] = None
    monolithic_input_tokens: int = 0
    monolithic_output_tokens: int = 0

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {
            "drafting_strategy": self.drafting_strategy,
            "model": self.model,
        }
        if self.section_calls:
            d["section_calls"] = [
                {
                    "section_id": c.section_id,
                    "heading": c.heading,
                    "success": c.success,
                    "latency_ms": c.latency_ms,
                    "input_tokens": c.input_tokens,
                    "output_tokens": c.output_tokens,
                    "placeholders_inserted": c.placeholders_inserted,
                    "input_hash": c.input_hash,
                    "output_hash": c.output_hash,
                    **({"error": c.error} if c.error else {}),
                }
                for c in self.section_calls
            ]
        if self.drafting_strategy == "monolithic":
            d["monolithic"] = {
                "latency_ms": self.monolithic_latency_ms,
                "input_tokens": self.monolithic_input_tokens,
                "output_tokens": self.monolithic_output_tokens,
            }
        return d


class DraftingStrategy(ABC):
    """Stage-2 only — fact extraction and verification live outside this interface."""

    @abstractmethod
    async def draft(
        self, ctx: Any,
    ) -> AsyncIterator[dict[str, Any]]:
        ...

