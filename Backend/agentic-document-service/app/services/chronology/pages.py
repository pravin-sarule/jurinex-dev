"""Stamp OCR with [PAGE n] markers and resolve pin cites from those markers."""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from .grounding import date_in_source, quote_in_source

_PAGE_MARK = re.compile(r"\[PAGE\s+(\d{1,4})\]", re.I)
_WORD = re.compile(r"[a-zA-Z]{4,}")


@dataclass(frozen=True, slots=True)
class PageSlice:
    number: int
    text: str


def text_with_page_markers(structured: dict[str, Any] | None, fallback: str = "") -> str:
    """Rebuild OCR text with a [PAGE n] stamp on every non-empty Document AI page."""
    pages = []
    for page in (structured or {}).get("pages") or []:
        if not isinstance(page, dict):
            continue
        try:
            number = int(page.get("pageNumber") or 0)
        except (TypeError, ValueError):
            continue
        body = str(page.get("text") or "").strip()
        if number >= 1 and body:
            pages.append((number, body))
    if not pages:
        return fallback or ""
    return "\n\n".join(f"[PAGE {number}]\n{body}" for number, body in pages)


def split_into_pages(source: str) -> list[PageSlice]:
    text = source or ""
    marks = list(_PAGE_MARK.finditer(text))
    if marks:
        out: list[PageSlice] = []
        for index, match in enumerate(marks):
            end = marks[index + 1].start() if index + 1 < len(marks) else len(text)
            body = text[match.end() : end].strip()
            out.append(PageSlice(int(match.group(1)), body))
        return out
    if "\f" in text:
        return [
            PageSlice(index + 1, part.strip())
            for index, part in enumerate(text.split("\f"))
            if part.strip()
        ]
    return []


def pages_for_quote(quote: str, source: str, *, date_key: str = "") -> str:
    """Pages whose body contains the quote. Prefer pages that also carry the event date."""
    pages = split_into_pages(source)
    if not pages or not (quote or "").strip():
        return ""
    hits = [page for page in pages if quote_in_source(quote, page.text)]
    if not hits:
        # Short OCR quotes sometimes only match once the page stamp is ignored;
        # fall back to a word-overlap scan of each page.
        hits = [page for page in pages if _quote_words_on_page(quote, page.text)]
    if date_key and len(hits) > 2:
        dated = [
            page
            for page in hits
            if _page_has_date(page.text, date_key)
        ]
        if dated:
            hits = dated
    numbers = []
    seen: set[int] = set()
    for page in hits:
        if page.number in seen:
            continue
        seen.add(page.number)
        numbers.append(str(page.number))
        if len(numbers) >= 6:
            break
    return ", ".join(numbers)


def _quote_words_on_page(quote: str, page_text: str) -> bool:
    words = {item.lower() for item in _WORD.findall(quote)}
    if len(words) < 4:
        return False
    page_words = {item.lower() for item in _WORD.findall(page_text)}
    return len(words & page_words) >= max(4, len(words) // 2)


def _page_has_date(page_text: str, date_key: str) -> bool:
    from .dates import parse_date

    parsed = parse_date(date_key)
    if not parsed:
        return False
    return date_in_source(parsed, page_text)
