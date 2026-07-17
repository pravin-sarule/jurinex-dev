"""
Pydantic schemas for the structured-JSON case endpoint (`POST /api/summarize`).

DeepSeek is forced into JSON mode and asked to return a GENERIC legal-document
shape (works for any matter — civil, writ, criminal, recovery, etc.). Money-claim
fields (`claimAmount`, `components`) are OPTIONAL and stay empty for non-money
matters.
"""
from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field


# ── Request ────────────────────────────────────────────────────────────────────

class SummarizeRequest(BaseModel):
    """Either `caseText` (raw document text) and/or a `query` may be supplied."""
    caseText: Optional[str] = Field(
        default=None,
        description="Raw case / document text to structure.",
        max_length=200_000,
    )
    query: Optional[str] = Field(
        default=None,
        description="Optional instruction, e.g. 'summarise the recovery claim'.",
        max_length=4_000,
    )
    model: Optional[str] = Field(
        default=None,
        description="Override DeepSeek model id (defaults to deepseek-v4-flash).",
    )


# ── Structured case shape ────────────────────────────────────────────────────────

class Party(BaseModel):
    role: str = ""
    name: str = ""
    details: str = ""


class AmountComponent(BaseModel):
    description: str = ""
    amount: str = ""


class DateEvent(BaseModel):
    date: str = ""
    event: str = ""


class ActSection(BaseModel):
    act: str = ""
    section: str = ""
    purpose: str = ""


class StructuredCase(BaseModel):
    caseName: str = ""
    caseType: str = ""
    overview: str = ""
    parties: List[Party] = Field(default_factory=list)
    # Money-claim fields — empty for non-money matters.
    claimAmount: str = ""
    components: List[AmountComponent] = Field(default_factory=list)
    datesAndEvents: List[DateEvent] = Field(default_factory=list)
    issues: List[str] = Field(default_factory=list)
    reliefs: List[str] = Field(default_factory=list)
    actsAndSections: List[ActSection] = Field(default_factory=list)


# ── Response envelope ────────────────────────────────────────────────────────────

class SummarizeResponse(BaseModel):
    success: bool = True
    data: StructuredCase
    # When JSON parsing fails we still return the model's raw text here so the
    # frontend can fall back to markdown rendering instead of showing nothing.
    rawMarkdown: Optional[str] = None
    warnings: List[str] = Field(default_factory=list)
