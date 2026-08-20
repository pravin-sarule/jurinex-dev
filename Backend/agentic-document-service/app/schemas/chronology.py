"""API shapes for case chronology (unique dates, grounded events, phase tree)."""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class ChronologyEvent(BaseModel):
    title: str = ""
    particulars: str = ""
    eventType: str = "other"
    sourceDocument: str = ""
    sourceQuote: str = ""


class ChronologyDateNode(BaseModel):
    """One calendar date. The same date key never appears twice in a tree."""

    date: str
    displayDate: str
    precision: str = "day"
    phase: str = "other"
    summary: str = ""
    events: list[ChronologyEvent] = Field(default_factory=list)


class ChronologyPhaseNode(BaseModel):
    id: str
    label: str
    dates: list[ChronologyDateNode] = Field(default_factory=list)


class ChronologyTree(BaseModel):
    dates: list[ChronologyDateNode] = Field(default_factory=list)
    phases: list[ChronologyPhaseNode] = Field(default_factory=list)
    sourceDocuments: list[str] = Field(default_factory=list)
    eventCount: int = 0

    def as_dict(self) -> dict[str, Any]:
        return self.model_dump(mode="json")


class ChronologyResponse(BaseModel):
    success: bool = True
    folderName: str
    case_id: str
    chronology: ChronologyTree
    message: str = ""
