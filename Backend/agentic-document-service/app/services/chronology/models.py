"""Canonical phase / event-type vocabularies for chronology extraction."""
from __future__ import annotations

from dataclasses import dataclass, field

PHASE_ORDER: tuple[str, ...] = (
    "pre_litigation",
    "institution",
    "pleadings",
    "interim",
    "evidence",
    "hearing",
    "order",
    "execution",
    "other",
)

PHASE_LABELS: dict[str, str] = {
    "pre_litigation": "Pre-litigation",
    "institution": "Institution",
    "pleadings": "Pleadings",
    "interim": "Interim",
    "evidence": "Evidence",
    "hearing": "Hearings",
    "order": "Orders / Judgment",
    "execution": "Execution",
    "other": "Other",
}

EVENT_TYPES: frozenset[str] = frozenset(
    {
        "agreement",
        "notice",
        "reply",
        "payment",
        "breach",
        "filing",
        "hearing",
        "order",
        "judgment",
        "affidavit",
        "evidence",
        "communication",
        "other",
    }
)

EVENT_TYPE_TO_PHASE: dict[str, str] = {
    "agreement": "pre_litigation",
    "notice": "pre_litigation",
    "reply": "pre_litigation",
    "payment": "pre_litigation",
    "breach": "pre_litigation",
    "communication": "pre_litigation",
    "filing": "institution",
    "affidavit": "pleadings",
    "evidence": "evidence",
    "hearing": "hearing",
    "order": "order",
    "judgment": "order",
    "other": "other",
}


def normalize_phase(raw: str | None, event_type: str = "other") -> str:
    value = str(raw or "").strip().lower().replace(" ", "_").replace("-", "_")
    if value in PHASE_LABELS:
        return value
    mapped = EVENT_TYPE_TO_PHASE.get(str(event_type or "other").strip().lower(), "other")
    return mapped if mapped in PHASE_LABELS else "other"


def normalize_event_type(raw: str | None) -> str:
    value = str(raw or "").strip().lower().replace(" ", "_").replace("-", "_")
    return value if value in EVENT_TYPES else "other"


@dataclass(slots=True)
class GroundedEvent:
    """A single event that survived date parse + source grounding."""

    date_key: str
    display_date: str
    precision: str
    title: str
    particulars: str
    event_type: str
    phase: str
    source_document: str
    source_quote: str
    extra: dict = field(default_factory=dict)
