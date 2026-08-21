"""Deterministic OCR sweep for statutory dates the LLM missed.

The model's recall drifts between runs: an impugned notification or a Gazette
publication can be extracted once and skipped on the next call. These events are
written in fixed statutory language, so Python finds them itself and builds the
event from the source sentence — the title comes from the matched rule, the
particulars and the quote are copied verbatim out of the OCR. Nothing here can
introduce a date or a fact that is not already written in the document.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from .dates import ParsedDate, parse_date
from .models import GroundedEvent

_DATE_TOKEN = (
    r"\d{1,2}\s*[./\-]\s*\d{1,2}\s*[./\-]\s*\d{2,4}"
    r"|\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]{3,9},?\s+\d{4}"
)
_DATE = re.compile(_DATE_TOKEN, re.I)
_ANCHOR = re.compile(r"(?:dated|on|vide|w\.?e\.?f\.?)\s*$", re.I)
_PAGE_MARK = re.compile(r"\[PAGE\s+\d{1,4}\]", re.I)
_SENTENCE_SPLIT = re.compile(r"(?<=[.;:])\s+|\n{2,}")
_LIST_JOIN = re.compile(r"^[\s,;]*(?:and|&)?\s*$", re.I)

_QUOTE_WINDOW = 190
_MAX_SWEPT = 40


@dataclass(frozen=True, slots=True)
class SweepRule:
    name: str
    keyword: re.Pattern[str]
    title: str
    event_type: str
    phase: str
    source_role: str
    require: re.Pattern[str] | None = None
    exclude: re.Pattern[str] | None = None
    expand_list: bool = False


SWEEP_RULES: tuple[SweepRule, ...] = (
    SweepRule(
        name="impugned_notification",
        keyword=re.compile(
            r"impugned[^.\n]{0,60}notification|notification[^.\n]{0,80}section\s*31"
            r"|section\s*31\s*\(\s*1\s*\)",
            re.I,
        ),
        title="Government notification under Section 31 of the MRTP Act",
        event_type="order",
        phase="pre_litigation",
        source_role="impugned",
    ),
    SweepRule(
        name="court_order",
        keyword=re.compile(r"order dated|perused the order", re.I),
        require=re.compile(
            r"writ petition|w\.?\s*p\.?\s*(?:no|\d)|high court|this court|perused",
            re.I,
        ),
        exclude=re.compile(r"section\s*31|sanction|development plan", re.I),
        title="Order of the High Court",
        event_type="order",
        phase="order",
        source_role="court",
    ),
    SweepRule(
        name="dp_sanction",
        keyword=re.compile(r"sanction", re.I),
        require=re.compile(r"development plan|\bd\.?p\.?\b|section\s*31", re.I),
        title="Development Plan sanctioned",
        event_type="order",
        phase="pre_litigation",
        source_role="official",
    ),
    SweepRule(
        name="gazette_publication",
        keyword=re.compile(r"(?:official\s+)?gazette", re.I),
        require=re.compile(r"publish|publication|notified", re.I),
        title="Published in the Official Gazette",
        event_type="notice",
        phase="pre_litigation",
        source_role="official",
    ),
    SweepRule(
        name="corrigendum",
        keyword=re.compile(r"corrigendum", re.I),
        title="Corrigendum issued",
        event_type="notice",
        phase="pre_litigation",
        source_role="official",
    ),
    SweepRule(
        name="representation",
        keyword=re.compile(r"representations?", re.I),
        require=re.compile(r"dated", re.I),
        title="Representation submitted",
        event_type="communication",
        phase="correspondence",
        source_role="petitioner",
        expand_list=True,
    ),
    SweepRule(
        name="resolution",
        keyword=re.compile(r"resolution\s+no", re.I),
        title="Resolution passed",
        event_type="other",
        phase="pre_litigation",
        source_role="official",
    ),
)


@dataclass(frozen=True, slots=True)
class _DateHit:
    parsed: ParsedDate
    start: int
    end: int
    anchored: bool


def _page_body(sentence: str) -> str:
    """Keep only the part after the last [PAGE n] stamp so quotes stay contiguous."""
    marks = list(_PAGE_MARK.finditer(sentence))
    if not marks:
        return sentence
    return sentence[marks[-1].end() :]


def _parse_token(raw: str) -> ParsedDate | None:
    text = raw.strip().rstrip(",.")
    parsed = parse_date(text)
    if parsed:
        return parsed
    # OCR often spaces out numeric dates ("15 . 04 . 2025").
    if any(ch.isalpha() for ch in text):
        return None
    return parse_date(re.sub(r"\s+", "", text))


def _date_hits(sentence: str) -> list[_DateHit]:
    hits: list[_DateHit] = []
    for match in _DATE.finditer(sentence):
        parsed = _parse_token(match.group(0))
        if not parsed or parsed.precision != "day":
            continue
        before = sentence[max(0, match.start() - 14) : match.start()]
        hits.append(
            _DateHit(
                parsed=parsed,
                start=match.start(),
                end=match.end(),
                anchored=bool(_ANCHOR.search(before)),
            )
        )
    return hits


def _nearest_hit(hits: list[_DateHit], keyword_start: int) -> _DateHit | None:
    if not hits:
        return None
    anchored = [hit for hit in hits if hit.anchored] or hits
    return min(anchored, key=lambda hit: abs(hit.start - keyword_start))


def _list_continuation(hits: list[_DateHit], chosen: _DateHit, sentence: str) -> list[_DateHit]:
    """Dates joined to the chosen one by commas / "and" — one event per date."""
    out: list[_DateHit] = []
    ordered = sorted(hits, key=lambda hit: hit.start)
    cursor = chosen
    for hit in ordered:
        if hit.start <= cursor.start:
            continue
        if not _LIST_JOIN.fullmatch(sentence[cursor.end : hit.start]):
            break
        out.append(hit)
        cursor = hit
    return out


def _quote_for(sentence: str, hit: _DateHit) -> str:
    start = max(0, hit.start - _QUOTE_WINDOW)
    end = min(len(sentence), hit.end + _QUOTE_WINDOW)
    window = sentence[start:end].strip()
    return re.sub(r"\s+", " ", window)


def sweep_events(
    source_text: str,
    *,
    document_name: str,
    known_date_keys: set[str] | None = None,
    limit: int = _MAX_SWEPT,
) -> list[GroundedEvent]:
    """Build grounded events for statutory dates that are not already on the tree."""
    text = source_text or ""
    if not text.strip():
        return []
    taken = set(known_date_keys or set())
    out: list[GroundedEvent] = []

    for raw_sentence in _SENTENCE_SPLIT.split(text):
        if len(out) >= limit:
            break
        sentence = _page_body(raw_sentence).strip()
        if len(sentence) < 20 or not _DATE.search(sentence):
            continue
        hits = _date_hits(sentence)
        if not hits:
            continue
        for rule in SWEEP_RULES:
            keyword = rule.keyword.search(sentence)
            if not keyword:
                continue
            if rule.require and not rule.require.search(sentence):
                continue
            if rule.exclude and rule.exclude.search(sentence):
                continue
            chosen = _nearest_hit(hits, keyword.start())
            if not chosen:
                continue
            picked = [chosen]
            if rule.expand_list:
                picked.extend(_list_continuation(hits, chosen, sentence))
            for hit in picked:
                if hit.parsed.key in taken or len(out) >= limit:
                    continue
                quote = _quote_for(sentence, hit)
                if len(quote) < 12:
                    continue
                taken.add(hit.parsed.key)
                out.append(
                    GroundedEvent(
                        date_key=hit.parsed.key,
                        display_date=hit.parsed.display,
                        precision=hit.parsed.precision,
                        title=rule.title,
                        particulars=quote,
                        event_type=rule.event_type,
                        phase=rule.phase,
                        source_document=document_name,
                        source_quote=quote[:500],
                        source_role=rule.source_role,
                        extra={"origin": "sweep", "rule": rule.name},
                    )
                )
    return out
