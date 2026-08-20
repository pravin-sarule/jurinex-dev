"""Turn raw LLM JSON into grounded chronology events. Drops anything unverifiable."""
from __future__ import annotations

import logging
import re
from typing import Any

from .dates import parse_date
from .grounding import date_in_source, quote_in_source
from .models import GroundedEvent, normalize_event_type, normalize_phase

logger = logging.getLogger("agentic_document_service.chronology.extract")

_SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+")
_MAX_SUMMARY_SENTENCES = 5


def _as_str(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, (str, int, float)):
        return str(value).strip()
    return ""


def _clip_particulars(text: str) -> str:
    raw = re.sub(r"\s+", " ", str(text or "")).strip()
    if not raw:
        return ""
    parts = [p.strip() for p in _SENTENCE_SPLIT.split(raw) if p.strip()]
    if not parts:
        return raw[:800]
    return " ".join(parts[:_MAX_SUMMARY_SENTENCES])


def _event_dicts(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, dict):
        for key in ("events", "chronology", "datesAndEvents", "dates_and_events"):
            value = payload.get(key)
            if isinstance(value, list):
                return [item for item in value if isinstance(item, dict)]
        return []
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    return []


def extract_grounded_events(
    payload: Any,
    *,
    source_text: str,
    document_name: str,
) -> list[GroundedEvent]:
    """Keep only events with a parseable date, a source quote, and both present in OCR text."""
    out: list[GroundedEvent] = []
    dropped = 0
    for item in _event_dicts(payload):
        parsed = parse_date(item.get("date") or item.get("eventDate") or item.get("event_date"))
        title = _as_str(item.get("title") or item.get("event") or item.get("heading"))
        particulars = _clip_particulars(item.get("particulars") or item.get("summary") or item.get("description") or title)
        quote = _as_str(item.get("sourceQuote") or item.get("source_quote") or item.get("quote") or item.get("evidence"))
        if not parsed or not title:
            dropped += 1
            continue
        if not quote_in_source(quote, source_text) or not date_in_source(parsed, source_text):
            dropped += 1
            continue
        event_type = normalize_event_type(item.get("eventType") or item.get("event_type"))
        phase = normalize_phase(item.get("phase"), event_type)
        out.append(
            GroundedEvent(
                date_key=parsed.key,
                display_date=parsed.display,
                precision=parsed.precision,
                title=title[:240],
                particulars=particulars or title,
                event_type=event_type,
                phase=phase,
                source_document=document_name,
                source_quote=quote[:500],
            )
        )
    if dropped:
        logger.info(
            "[Chronology] grounded %d event(s), dropped %d unverifiable from %s",
            len(out),
            dropped,
            document_name,
        )
    return out
