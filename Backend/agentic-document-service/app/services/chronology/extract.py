"""Turn raw LLM JSON into grounded chronology events. Drops anything unverifiable."""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from typing import Any

from .corroborate import corroborate_event, index_numeric_dates
from .dates import ParsedDate, parse_date
from .grounding import date_in_source, quote_in_source
from .models import (
    GroundedEvent,
    normalize_event_type,
    normalize_phase,
    normalize_source_role,
)
from .pages import pages_for_quote, split_into_pages

logger = logging.getLogger("agentic_document_service.chronology.extract")

_SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+")
_MAX_SUMMARY_SENTENCES = 5
_BLANK_DATES = frozenset({"", "undated", "unknown", "n/a", "na", "none", "null"})
_PAGE_MARK = re.compile(r"^(?:p(?:age)?\.?\s*)?(\d{1,4})$", re.I)
_OFFICIAL_MARK = re.compile(
    r"gazette|government resolution|\bg\.?r\.?\b|official gazette|notification|"
    r"section\s*31|section\s*28|development plan|corrigendum|town planning|"
    r"assistant director|municipal|joint measurement|resolution no",
    re.I,
)
_COURT_MARK = re.compile(
    r"\bhigh court\b|\bthis court\b|status quo|stand over|it is ordered|"
    r"ordered that|writ petition no|notice of motion",
    re.I,
)
_IMPUGNED_MARK = re.compile(
    r"\bimpugned\b|under challenge|challenged by|section\s*31\s*\(\s*1\s*\)",
    re.I,
)
_VERIFY_MARK = re.compile(r"\bverif(?:y|ied|ication)\b|solemnly affirm", re.I)
_REGISTRY_MARK = re.compile(r"received on|registered on|filed on|lodged on", re.I)
_ADMIT_MARK = re.compile(r"\badmit(?:s|ted|ting)\b|written statement", re.I)


def _blob(event: GroundedEvent) -> str:
    return f"{event.title} {event.particulars} {event.source_quote}"


def refine_characterization(event: GroundedEvent) -> GroundedEvent:
    """Stop treating gazette/GRs as admissions and verification as filing."""
    blob = _blob(event)
    role = event.source_role
    if _IMPUGNED_MARK.search(blob) and not _COURT_MARK.search(event.title):
        if role in {"court", "admitted", "disputed", ""}:
            event.source_role = "impugned"
            event.disputed = False
            role = "impugned"
    if role in {"admitted", "court"} and _OFFICIAL_MARK.search(blob) and not _COURT_MARK.search(blob):
        if not _ADMIT_MARK.search(blob):
            event.source_role = "official"
            role = "official"
    if role == "admitted" and not _ADMIT_MARK.search(blob):
        event.source_role = "petitioner" if not _OFFICIAL_MARK.search(blob) else "official"

    title = event.title
    if re.search(r"\bfiled\b", title, re.I) and _VERIFY_MARK.search(event.source_quote) and not _REGISTRY_MARK.search(
        event.source_quote
    ):
        cleaned = re.sub(r"(?i)\s*and\s+filed\b", "", title)
        cleaned = re.sub(r"(?i)\bfiled\b", "verified", cleaned)
        event.title = cleaned[:240] or "Writ petition verified"
        if event.phase == "institution":
            event.phase = "pleadings"
            event.event_type = "affidavit"
    return event


def _as_str(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, (str, int, float)):
        return str(value).strip()
    return ""


def _as_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    text = _as_str(value).lower()
    return text in {"true", "1", "yes", "disputed"}


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


def _year_not_on_record(year: int) -> ParsedDate:
    return ParsedDate(
        key=f"{year:04d}",
        display=f"{year} (date not on record)",
        precision="year",
        year=year,
    )


def parse_event_date(item: dict[str, Any]) -> ParsedDate | None:
    """Day-first parse; year-only when the model marks the day as not on record."""
    raw = _as_str(item.get("date") or item.get("eventDate") or item.get("event_date"))
    if raw.lower() not in _BLANK_DATES:
        parsed = parse_date(raw)
        if parsed:
            return parsed
    year_raw = _as_str(
        item.get("year") or item.get("approximateYear") or item.get("undatedYear")
    )
    year_parsed = parse_date(year_raw) if year_raw else None
    if year_parsed is None and raw.lower() in _BLANK_DATES:
        return None
    if year_parsed and year_parsed.precision == "year":
        return _year_not_on_record(year_parsed.year)
    if year_parsed:
        return year_parsed
    return None


def _source_page(raw: Any) -> str:
    text = _as_str(raw)
    if not text:
        return ""
    match = _PAGE_MARK.fullmatch(text.replace(",", ""))
    if match:
        return match.group(1)
    # Allow "54" or "p. 54" only — never a narrative page guess.
    digits = re.sub(r"\D+", "", text)
    if digits and text.lower() in {digits, f"p.{digits}", f"p. {digits}", f"page {digits}"}:
        return digits
    return ""


@dataclass(slots=True)
class GroundingReport:
    events: list[GroundedEvent]
    kept: int
    dropped: int
    reasons: dict[str, int] = field(default_factory=dict)
    proposed: int = 0
    corrections: list[dict[str, Any]] = field(default_factory=list)
    pages_cited: int = 0
    pages_missing: int = 0
    ocr_pages: int = 0


def extract_grounded_report(
    payload: Any,
    *,
    source_text: str,
    document_name: str,
) -> GroundingReport:
    """Keep only events with a parseable date, a source quote, and both present in OCR text."""
    out: list[GroundedEvent] = []
    reasons: dict[str, int] = {}

    def _drop(reason: str) -> None:
        reasons[reason] = reasons.get(reason, 0) + 1

    for item in _event_dicts(payload):
        parsed = parse_event_date(item)
        title = _as_str(item.get("title") or item.get("event") or item.get("heading"))
        particulars = _clip_particulars(
            item.get("particulars") or item.get("summary") or item.get("description") or title
        )
        quote = _as_str(
            item.get("sourceQuote") or item.get("source_quote") or item.get("quote") or item.get("evidence")
        )
        if not parsed or not title:
            _drop("missing_date_or_title")
            continue
        if not quote_in_source(quote, source_text):
            _drop("quote_not_in_document")
            continue
        if not date_in_source(parsed, source_text):
            _drop("date_not_in_document")
            continue
        disputed = _as_bool(item.get("disputed"))
        event_type = normalize_event_type(item.get("eventType") or item.get("event_type"))
        phase = normalize_phase(item.get("phase"), event_type)
        if event_type == "communication" and phase == "pleadings":
            phase = "correspondence"
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
                forum=_as_str(item.get("forum") or item.get("court"))[:160],
                case_number=_as_str(item.get("caseNumber") or item.get("case_number"))[:120],
                source_page=_source_page(item.get("sourcePage") or item.get("source_page") or item.get("page")),
                exhibit=_as_str(item.get("exhibit") or item.get("exhibitNo") or item.get("exhibit_no"))[:80],
                source_role=normalize_source_role(
                    item.get("sourceRole") or item.get("source_role"),
                    disputed=disputed,
                ),
                disputed=disputed,
            )
        )
        refine_characterization(out[-1])
    hits = index_numeric_dates(source_text)
    corrections: list[dict[str, Any]] = []
    for event in out:
        before_date = event.display_date
        before_quote = event.source_quote
        corroborate_event(event, source_text, hits)
        located = pages_for_quote(event.source_quote, source_text, date_key=event.date_key)
        if located:
            event.source_page = located
        if event.display_date != before_date or event.source_quote != before_quote:
            corrections.append(
                {
                    "title": event.title,
                    "from": before_date,
                    "to": event.display_date,
                    "quote_replaced": event.source_quote != before_quote,
                }
            )
    dropped = sum(reasons.values())
    cited = sum(1 for event in out if event.source_page)
    return GroundingReport(
        events=out,
        kept=len(out),
        dropped=dropped,
        reasons=reasons,
        proposed=len(out) + dropped,
        corrections=corrections,
        pages_cited=cited,
        pages_missing=len(out) - cited,
        ocr_pages=len(split_into_pages(source_text)),
    )


def refresh_tree_against_source(tree: Any, source_text: str) -> Any:
    """Re-vote OCR years and attach pin cites on an already-stored tree. No LLM."""
    from app.schemas.chronology import ChronologyTree
    from .merge import merge_events

    if not isinstance(tree, ChronologyTree) or not tree.dates or not source_text:
        return tree
    grounded: list[GroundedEvent] = []
    hits = index_numeric_dates(source_text)
    for node in tree.dates:
        for item in node.events:
            event = GroundedEvent(
                date_key=node.date,
                display_date=node.displayDate,
                precision=node.precision,
                title=item.title,
                particulars=item.particulars,
                event_type=item.eventType or "other",
                phase=node.phase or "other",
                source_document=item.sourceDocument,
                source_quote=item.sourceQuote,
                forum=item.forum,
                case_number=item.caseNumber,
                source_page=item.sourcePage,
                exhibit=item.exhibit,
                source_role=item.sourceRole,
                disputed=bool(item.disputed),
            )
            corroborate_event(event, source_text, hits)
            located = pages_for_quote(event.source_quote, source_text, date_key=event.date_key)
            if located:
                event.source_page = located
            refine_characterization(event)
            grounded.append(event)
    return merge_events(None, grounded)


def extract_grounded_events(
    payload: Any,
    *,
    source_text: str,
    document_name: str,
) -> list[GroundedEvent]:
    return extract_grounded_report(
        payload,
        source_text=source_text,
        document_name=document_name,
    ).events
