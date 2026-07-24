"""Mechanical verification of quoted claims against their cited sources.

A model can write a highly specific, professional-looking "verbatim quote" next to a
citation without that quote actually appearing anywhere on the page it cites. That's a
DIFFERENT failure mode from a dead link (grounding_links.py fixes that one): the link
works, the page is real, but the quoted text simply isn't on it — exactly the "citations
for the legal [claims] don't give correct [content]" complaint.

This checks it mechanically: fetch the page, look for the quote. Deliberately NOT another
LLM call asking "does this support the claim?" — a model can hallucinate a confident yes
just as easily as it hallucinated the original quote, so a second opinion from the same
kind of system isn't a real check. A deterministic substring match on fetched page text is
the only check that can't be fooled the same way.

Scope: this verifies that a QUOTED span of text is genuinely present on a page. It cannot
(without deep semantic understanding) confirm that an unquoted paraphrase or a broader
legal conclusion is correct — only that literal quoted material is real, not invented.
"""

from __future__ import annotations

import asyncio
import logging
import re
from typing import Any

logger = logging.getLogger(__name__)

# Quoted spans of 8-220 chars — long enough to be a meaningful claim, short enough to stay
# a "quote" rather than an accidentally-matched quotation mark pair around a whole paragraph.
_QUOTE_RE = re.compile(r'"([^"\n]{8,220})"')
_WS_RE = re.compile(r"\s+")
_SCRIPT_STYLE_RE = re.compile(r"<(script|style)[^>]*>.*?</\1>", re.IGNORECASE | re.DOTALL)
_ANY_TAG_RE = re.compile(r"<[^>]+>")

_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)


def extract_quotes(text: str) -> list[str]:
    """Pull double-quoted spans — treated as claimed verbatim quotes to verify."""
    if not text:
        return []
    seen: set[str] = set()
    out: list[str] = []
    for m in _QUOTE_RE.finditer(text):
        q = m.group(1).strip()
        if q and q not in seen:
            seen.add(q)
            out.append(q)
    return out


def _normalize(s: str) -> str:
    return _WS_RE.sub(" ", (s or "")).strip().lower()


def _html_to_text(html: str) -> str:
    html = _SCRIPT_STYLE_RE.sub(" ", html)
    html = _ANY_TAG_RE.sub(" ", html)
    return _WS_RE.sub(" ", html).strip()


def quote_in_page(quote: str, page_text: str) -> bool:
    """Normalized substring check — whitespace-insensitive, case-insensitive exact match."""
    return bool(quote) and bool(page_text) and _normalize(quote) in _normalize(page_text)


async def _fetch_one(client: Any, url: str, timeout_s: float, max_chars: int) -> str:
    try:
        resp = await client.get(url, timeout=timeout_s)
        if resp.status_code >= 400:
            return ""
        return _html_to_text(resp.text)[:max_chars]
    except Exception:
        return ""


async def fetch_pages(
    urls: list[str],
    *,
    timeout_s: float = 6.0,
    total_timeout_s: float = 20.0,
    max_sources: int = 16,
    max_chars_per_page: int = 20000,
) -> dict[str, str]:
    """Fetch each unique URL's readable text (best effort, never raises). Missing/failed
    fetches map to "". `follow_redirects=True` means a Gemini grounding-redirect URL can be
    passed directly — httpx follows the chain and returns the real destination's content."""
    unique = list(dict.fromkeys(u for u in urls if u))[:max_sources]
    if not unique:
        return {}
    try:
        import httpx
    except Exception:
        logger.warning("[CitationVerify] httpx unavailable — skipping fetch for %d url(s)", len(unique))
        return {u: "" for u in unique}

    try:
        async with httpx.AsyncClient(headers={"User-Agent": _UA}, follow_redirects=True) as client:
            async def _one(u: str) -> tuple[str, str]:
                return u, await _fetch_one(client, u, timeout_s, max_chars_per_page)

            results = await asyncio.wait_for(
                asyncio.gather(*(_one(u) for u in unique)), timeout=total_timeout_s,
            )
            return dict(results)
    except asyncio.TimeoutError:
        logger.warning(
            "[CitationVerify] fetch budget (%.0fs) exceeded for %d url(s) — treated as unfetched",
            total_timeout_s, len(unique),
        )
        return {u: "" for u in unique}
    except Exception as exc:
        logger.warning("[CitationVerify] fetch failed: %s", exc)
        return {u: "" for u in unique}


def verify_quotes(quotes: list[str], pages: dict[str, str]) -> dict[str, Any]:
    """Given extracted quotes and a {url: page_text} map, decide per-quote and overall
    verification — pure text matching, no model call involved.

    status:
      "no_quote"           — nothing was quoted for this point; nothing to check.
      "unchecked"          — there were citation URL(s) to check against, but NONE of them
                              could be fetched (network error, blocked, all timed out). This
                              is "we could not verify", not "we verified it's false" — it must
                              never be presented to the model as a sign the quote is fake.
      "verified"           — every quote was found on at least one of the pages.
      "partially_verified" — some quotes found, some not.
      "unverified"         — pages fetched fine, but none contained the quoted text — a real
                              signal the quote may be fabricated or misattributed.
    """
    if not quotes:
        return {"status": "no_quote", "checked": 0, "verified": 0, "unverified": []}
    has_sources = bool(pages)
    page_texts = [t for t in pages.values() if t]
    if has_sources and not page_texts:
        # We had sources to check against but couldn't fetch a single one of them — a fetch
        # problem, not evidence against the quote.
        return {"status": "unchecked", "checked": len(quotes), "verified": 0, "unverified": []}
    unverified: list[str] = []
    verified_count = 0
    for q in quotes:
        if page_texts and any(quote_in_page(q, t) for t in page_texts):
            verified_count += 1
        else:
            unverified.append(q)
    if verified_count and not unverified:
        status = "verified"
    elif verified_count:
        status = "partially_verified"
    else:
        status = "unverified"
    return {
        "status": status,
        "checked": len(quotes),
        "verified": verified_count,
        "unverified": unverified,
    }
