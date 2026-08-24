"""Merge per-document events into a unique-date tree. Same calendar date appears once."""
from __future__ import annotations

import re
from collections import OrderedDict

from app.schemas.chronology import (
    ChronologyDateNode,
    ChronologyEvent,
    ChronologyPhaseNode,
    ChronologyTree,
)

from .models import EVENT_TYPE_TO_PHASE, GroundedEvent, PHASE_LABELS, PHASE_ORDER

_SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+")
_TITLE_NOISE = re.compile(r"[^a-z0-9]+")


def _title_key(title: str) -> str:
    return _TITLE_NOISE.sub(" ", str(title or "").lower()).strip()


def _phase_rank(phase: str) -> int:
    try:
        return PHASE_ORDER.index(phase)
    except ValueError:
        return len(PHASE_ORDER)


def _sort_key(date_key: str) -> tuple[int, int, int]:
    parts = [int(p) for p in date_key.split("-") if p.isdigit()]
    while len(parts) < 3:
        parts.append(0)
    return (parts[0], parts[1], parts[2])


def _choose_phase(events: list[GroundedEvent]) -> str:
    if not events:
        return "other"
    ranked = sorted(events, key=lambda item: _phase_rank(item.phase))
    return ranked[0].phase


def _build_summary(events: list[GroundedEvent]) -> str:
    sentences: list[str] = []
    seen: set[str] = set()
    for event in events:
        blob = event.particulars or event.title
        for piece in _SENTENCE_SPLIT.split(blob):
            text = re.sub(r"\s+", " ", piece).strip()
            if not text:
                continue
            key = text.lower()
            if key in seen:
                continue
            seen.add(key)
            if not text.endswith((".", "!", "?")):
                text += "."
            sentences.append(text)
            if len(sentences) >= 5:
                return " ".join(sentences)
    if not sentences:
        titles = []
        for event in events:
            title = event.title.strip()
            if title and title.lower() not in seen:
                seen.add(title.lower())
                titles.append(title)
        return "; ".join(titles[:5])
    return " ".join(sentences)


def merge_events(existing: ChronologyTree | None, incoming: list[GroundedEvent]) -> ChronologyTree:
    """First-wins on identical (date, title); appends new happenings on the same date."""
    buckets: OrderedDict[str, list[GroundedEvent]] = OrderedDict()
    seen_titles: dict[str, set[str]] = {}
    source_docs: list[str] = []

    def _ingest(event: GroundedEvent) -> None:
        title_key = _title_key(event.title)
        used = seen_titles.setdefault(event.date_key, set())
        if title_key and title_key in used:
            return
        if title_key:
            used.add(title_key)
        buckets.setdefault(event.date_key, []).append(event)
        if event.source_document and event.source_document not in source_docs:
            source_docs.append(event.source_document)

    if existing is not None:
        for node in existing.dates:
            for item in node.events:
                inferred_type = item.eventType or "other"
                _ingest(
                    GroundedEvent(
                        date_key=node.date,
                        display_date=node.displayDate,
                        precision=node.precision,
                        title=item.title,
                        particulars=item.particulars,
                        event_type=inferred_type,
                        phase=node.phase or EVENT_TYPE_TO_PHASE.get(inferred_type, "other"),
                        source_document=item.sourceDocument,
                        source_quote=item.sourceQuote,
                        forum=item.forum,
                        case_number=item.caseNumber,
                        source_page=item.sourcePage,
                        exhibit=item.exhibit,
                        source_role=item.sourceRole,
                        disputed=bool(item.disputed),
                    )
                )
        for name in existing.sourceDocuments:
            if name not in source_docs:
                source_docs.append(name)

    for event in incoming:
        _ingest(event)

    date_nodes: list[ChronologyDateNode] = []
    for date_key in sorted(buckets.keys(), key=_sort_key):
        group = buckets[date_key]
        date_nodes.append(
            ChronologyDateNode(
                date=date_key,
                displayDate=group[0].display_date,
                precision=group[0].precision,
                phase=_choose_phase(group),
                summary=_build_summary(group),
                events=[
                    ChronologyEvent(
                        title=item.title,
                        particulars=item.particulars,
                        eventType=item.event_type,
                        sourceDocument=item.source_document,
                        sourceQuote=item.source_quote,
                        forum=item.forum,
                        caseNumber=item.case_number,
                        sourcePage=item.source_page,
                        exhibit=item.exhibit,
                        sourceRole=item.source_role,
                        disputed=item.disputed,
                    )
                    for item in group
                ],
            )
        )

    phases: list[ChronologyPhaseNode] = []
    for phase_id in PHASE_ORDER:
        phase_dates = [node for node in date_nodes if node.phase == phase_id]
        if phase_dates:
            phases.append(
                ChronologyPhaseNode(
                    id=phase_id,
                    label=PHASE_LABELS[phase_id],
                    dates=phase_dates,
                )
            )

    return ChronologyTree(
        dates=date_nodes,
        phases=phases,
        sourceDocuments=source_docs,
        eventCount=sum(len(node.events) for node in date_nodes),
    )


def empty_tree() -> ChronologyTree:
    return ChronologyTree()
