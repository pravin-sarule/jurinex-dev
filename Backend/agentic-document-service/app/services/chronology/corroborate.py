"""Majority-vote repeated OCR date tokens (same day+month, conflicting years)."""
from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass

from .dates import ParsedDate, parse_date
from .grounding import date_in_source, quote_in_source
from .models import GroundedEvent

_NUMERIC_DATE = re.compile(r"\b(\d{1,2})[./\-](\d{1,2})[./\-](\d{2,4})\b")
_WORD = re.compile(r"[a-zA-Z]{4,}")


@dataclass(frozen=True, slots=True)
class DateHit:
    parsed: ParsedDate
    raw: str
    start: int
    end: int


def index_numeric_dates(text: str) -> list[DateHit]:
    hits: list[DateHit] = []
    for match in _NUMERIC_DATE.finditer(text or ""):
        parsed = parse_date(match.group(0))
        if not parsed or parsed.precision != "day":
            continue
        hits.append(DateHit(parsed, match.group(0), match.start(), match.end()))
    return hits


def majority_date(parsed: ParsedDate, hits: list[DateHit]) -> ParsedDate:
    """If the same day+month is written with different years, keep the year that appears most."""
    if parsed.precision != "day" or not parsed.day or not parsed.month:
        return parsed
    years: Counter[int] = Counter()
    for hit in hits:
        if hit.parsed.day == parsed.day and hit.parsed.month == parsed.month:
            years[hit.parsed.year] += 1
    if not years:
        return parsed
    winner, count = years.most_common(1)[0]
    current = years.get(parsed.year, 0)
    if count < 2 or count <= current:
        return parsed
    voted = parse_date(f"{parsed.day:02d}/{parsed.month:02d}/{winner}")
    return voted or parsed


def corroborate_event(event: GroundedEvent, source_text: str, hits: list[DateHit] | None = None) -> GroundedEvent:
    """Correct minority OCR years on the event date and, when possible, the quote."""
    indexed = hits if hits is not None else index_numeric_dates(source_text)
    parsed = parse_date(event.date_key) or parse_date(event.display_date)
    if parsed:
        voted = majority_date(parsed, indexed)
        if voted.key != parsed.key and date_in_source(voted, source_text):
            event.date_key = voted.key
            event.display_date = voted.display
            event.precision = voted.precision
            parsed = voted

    replacement = _majority_quote(event.source_quote, source_text, indexed)
    if replacement and quote_in_source(replacement, source_text):
        event.source_quote = replacement[:500]
    return event


def corroborate_events(events: list[GroundedEvent], source_text: str) -> list[GroundedEvent]:
    hits = index_numeric_dates(source_text)
    return [corroborate_event(event, source_text, hits) for event in events]


def _majority_quote(quote: str, source: str, hits: list[DateHit]) -> str | None:
    quote = str(quote or "").strip()
    if not quote:
        return None
    changed = False
    for match in _NUMERIC_DATE.finditer(quote):
        parsed = parse_date(match.group(0))
        if not parsed:
            continue
        voted = majority_date(parsed, hits)
        if voted.key == parsed.key:
            continue
        changed = True
        window = _window_for_date(voted, quote, source, hits)
        if window:
            return window
    return None if not changed else None


def _window_for_date(voted: ParsedDate, quote: str, source: str, hits: list[DateHit]) -> str | None:
    quote_words = {item.lower() for item in _WORD.findall(quote)}
    ranked: list[tuple[int, str]] = []
    for hit in hits:
        if hit.parsed.key != voted.key:
            continue
        start = max(0, hit.start - 140)
        end = min(len(source), hit.end + 140)
        window = re.sub(r"\s+", " ", source[start:end]).strip()
        if len(window) < 12 or not quote_in_source(window, source):
            continue
        overlap = len(quote_words & {item.lower() for item in _WORD.findall(window)})
        ranked.append((overlap, window))
    if not ranked:
        return None
    ranked.sort(key=lambda item: item[0], reverse=True)
    best_overlap, best_window = ranked[0]
    if best_overlap >= 2 or not quote_words:
        return best_window
    return None
