"""Drop chronology events that are not actually present in the source text."""
from __future__ import annotations

import re

from .dates import ParsedDate, date_variants

_NON_ALNUM = re.compile(r"[^\w\s/%.\-]", re.UNICODE)
_WS = re.compile(r"\s+")


def normalize_for_match(text: str) -> str:
    collapsed = _WS.sub(" ", str(text or "").lower())
    collapsed = _NON_ALNUM.sub("", collapsed)
    return collapsed.strip()


def quote_in_source(quote: str, source_text: str, *, min_chars: int = 12) -> bool:
    raw = str(quote or "").strip()
    if len(raw) < min_chars:
        return False
    src = normalize_for_match(source_text)
    if not src:
        return False
    needle = normalize_for_match(raw)
    if len(needle) < 8:
        return False
    if needle in src:
        return True
    # OCR often splits a long quote; accept a substantial prefix.
    prefix = needle[:48].strip()
    return bool(prefix) and len(prefix) >= 12 and prefix in src


def date_in_source(parsed: ParsedDate, source_text: str) -> bool:
    src = normalize_for_match(source_text)
    if not src:
        return False
    for variant in date_variants(parsed):
        if normalize_for_match(variant) in src:
            return True
    return False
