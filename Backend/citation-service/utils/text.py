from __future__ import annotations

import html
import re

from core.constants import STOP_WORDS


def strip_html(value: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html.unescape(value or ""))).strip()


def terms(value: str, minimum: int = 3) -> list[str]:
    found = re.findall(r"[a-zA-Z][a-zA-Z0-9_-]+", (value or "").lower())
    return list(dict.fromkeys(word for word in found if len(word) >= minimum and word not in STOP_WORDS))


def overlap_score(left: str, right: str) -> float:
    left_terms, right_terms = set(terms(left)), set(terms(right))
    if not left_terms or not right_terms:
        return 0.0
    return min(1.0, len(left_terms & right_terms) / max(3, min(len(left_terms), len(right_terms))))


def sentence_chunks(value: str, limit: int = 5) -> list[str]:
    chunks = [part.strip() for part in re.split(r"(?<=[.!?])\s+|\n+", value or "") if len(part.strip()) > 20]
    return chunks[:limit]
