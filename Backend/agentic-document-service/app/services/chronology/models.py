"""Canonical phase / event-type vocabularies for chronology extraction."""
from __future__ import annotations

from dataclasses import dataclass, field

PHASE_ORDER: tuple[str, ...] = (
    "pre_litigation",
    "correspondence",
    "institution",
    "pleadings",
    "interim",
    "evidence",
    "hearing",
    "order",
    "appeal",
    "execution",
    "other",
)

PHASE_LABELS: dict[str, str] = {
    "pre_litigation": "Pre-litigation",
    "correspondence": "Correspondence",
    "institution": "Institution",
    "pleadings": "Pleadings",
    "interim": "Interim",
    "evidence": "Evidence",
    "hearing": "Hearings",
    "order": "Orders / Judgment",
    "appeal": "Appeal / Writ",
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
        "transfer",
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
    "reply": "correspondence",
    "payment": "pre_litigation",
    "breach": "pre_litigation",
    "communication": "correspondence",
    "filing": "institution",
    "transfer": "institution",
    "affidavit": "pleadings",
    "evidence": "evidence",
    "hearing": "hearing",
    "order": "order",
    "judgment": "order",
    "other": "other",
}

SOURCE_ROLES: frozenset[str] = frozenset(
    {"petitioner", "respondent", "court", "official", "impugned", "admitted", "disputed"}
)


def normalize_phase(raw: str | None, event_type: str = "other") -> str:
    value = str(raw or "").strip().lower().replace(" ", "_").replace("-", "_")
    aliases = {
        "arguments": "hearing",
        "judgment": "order",
        "writ": "appeal",
        "appellate": "appeal",
    }
    value = aliases.get(value, value)
    if value in PHASE_LABELS:
        return value
    mapped = EVENT_TYPE_TO_PHASE.get(str(event_type or "other").strip().lower(), "other")
    return mapped if mapped in PHASE_LABELS else "other"


def normalize_event_type(raw: str | None) -> str:
    value = str(raw or "").strip().lower().replace(" ", "_").replace("-", "_")
    aliases = {"appeal": "filing", "writ": "filing"}
    value = aliases.get(value, value)
    return value if value in EVENT_TYPES else "other"


def normalize_source_role(raw: str | None, *, disputed: bool = False) -> str:
    value = str(raw or "").strip().lower().replace(" ", "_").replace("-", "_")
    aliases = {
        "applicant": "petitioner",
        "plaintiff": "petitioner",
        "disputant": "petitioner",
        "petitioners_case": "petitioner",
        "defendant": "respondent",
        "opponent": "respondent",
        "finding": "court",
        "judge": "court",
        "bench": "court",
        "court_order": "court",
        "court_recorded": "court",
        "gazette": "official",
        "government": "official",
        "official_record": "official",
        "notification": "official",
        "impugned_notification": "impugned",
        "challenged": "impugned",
    }
    value = aliases.get(value, value)
    if value in SOURCE_ROLES:
        return value
    return "disputed" if disputed else ""


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
    forum: str = ""
    case_number: str = ""
    source_page: str = ""
    exhibit: str = ""
    source_role: str = ""
    disputed: bool = False
    extra: dict = field(default_factory=dict)
