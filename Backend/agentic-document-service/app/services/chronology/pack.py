"""Pack OCR for form_population_agent so later pages are not dropped by a prefix cap."""
from __future__ import annotations

import re

from .pages import PageSlice, split_into_pages

# gemini-3.7-flash is a 1M-token model. 900k chars ≈ 220k tokens — full 100-page
# paper books fit; larger files keep dated / procedural pages instead of the first 80k.
EXTRACTION_CHAR_BUDGET = 900_000

_DATE_HIT = re.compile(
    r"\b\d{1,2}[./\-]\d{1,2}[./\-]\d{2,4}\b"
    r"|\b\d{1,2}(?:st|nd|rd|th)?\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+\d{4}\b",
    re.I,
)
_PROC_HIT = re.compile(
    r"\b(?:filed|instituted|transferred|renumbered|preferred|challenged|disposed|"
    r"dismissed|remanded|registered|received\s+on|restrained|allowed|rejected|"
    r"writ\s+petition|appeal\s+no)\b",
    re.I,
)
_GAP = "\n\n[PAGES OMITTED]\n\n"


def pack_for_extraction(text: str, *, budget: int = EXTRACTION_CHAR_BUDGET) -> tuple[str, dict[str, object]]:
    """Return text the LLM should read, plus pack metadata for logs."""
    raw = text or ""
    meta: dict[str, object] = {
        "packed": False,
        "mode": "full",
        "source_chars": len(raw),
        "chars": len(raw),
        "budget": budget,
    }
    if len(raw) <= budget:
        return raw, meta
    pages = split_into_pages(raw)
    if len(pages) >= 2:
        packed = _pack_pages(pages, budget)
        meta.update(packed=True, mode="pages", chars=len(packed))
        return packed, meta
    packed = _pack_windows(raw, budget)
    meta.update(packed=True, mode="windows", chars=len(packed))
    return packed, meta


def _page_score(page: PageSlice, *, total: int) -> int:
    dates = len(_DATE_HIT.findall(page.text))
    procs = len(_PROC_HIT.findall(page.text))
    edge = 8 if page.number <= 12 or page.number > total - 8 else 0
    return dates * 5 + procs * 3 + edge + min(len(page.text), 2500) // 800


def _pack_pages(pages: list[PageSlice], budget: int) -> str:
    total = len(pages)
    must: set[int] = set()
    for page in pages[:12]:
        must.add(page.number)
    for page in pages[-8:]:
        must.add(page.number)

    ranked = sorted(pages, key=lambda item: _page_score(item, total=total), reverse=True)
    selected: set[int] = set(must)
    used = sum(len(page.text) + 16 for page in pages if page.number in selected)
    for page in ranked:
        if page.number in selected:
            continue
        cost = len(page.text) + 16
        if used + cost > budget:
            continue
        selected.add(page.number)
        used += cost

    chunks: list[str] = []
    skipped = 0
    for page in pages:
        if page.number not in selected:
            skipped += 1
            continue
        if skipped:
            chunks.append(f"[PAGES OMITTED: {skipped} page(s) with no dated or procedural content]")
            skipped = 0
        chunks.append(f"[PAGE {page.number}]\n{page.text}")
    if skipped:
        chunks.append(f"[PAGES OMITTED: {skipped} page(s) with no dated or procedural content]")
    packed = "\n\n".join(chunks)
    if len(packed) <= budget:
        return packed
    return packed[:budget]


def _merge_spans(spans: list[tuple[int, int]]) -> list[tuple[int, int]]:
    if not spans:
        return []
    ordered = sorted(spans)
    merged = [ordered[0]]
    for start, end in ordered[1:]:
        prev_start, prev_end = merged[-1]
        if start <= prev_end + 80:
            merged[-1] = (prev_start, max(prev_end, end))
        else:
            merged.append((start, end))
    return merged


def _pack_windows(text: str, budget: int) -> str:
    length = len(text)
    head = min(80_000, budget // 3, length)
    tail = min(60_000, budget // 4, max(0, length - head))
    spans: list[tuple[int, int]] = [(0, head)]
    if tail:
        spans.append((length - tail, length))
    for match in _DATE_HIT.finditer(text):
        spans.append((max(0, match.start() - 1800), min(length, match.end() + 1800)))
    for match in _PROC_HIT.finditer(text):
        spans.append((max(0, match.start() - 900), min(length, match.end() + 900)))
    merged = _merge_spans(spans)
    parts: list[str] = []
    used = 0
    last_end = 0
    for start, end in merged:
        chunk = text[start:end]
        extra = len(_GAP) if parts and start > last_end else 0
        if used + extra + len(chunk) > budget:
            remain = budget - used - extra
            if remain > 400:
                if extra:
                    parts.append(_GAP.strip())
                parts.append(chunk[:remain])
            break
        if extra:
            parts.append(_GAP.strip())
            used += extra
        parts.append(chunk)
        used += len(chunk)
        last_end = end
    return "\n\n".join(parts)
