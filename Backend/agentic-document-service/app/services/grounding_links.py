"""Resolve Gemini Google-Search "grounding-api-redirect" links to their real destination.

Gemini's `google_search` grounding tool never exposes the original publisher URL — every
citation it returns (via grounding_metadata, or written directly into the model's own
answer text per our prompt instructions) is a
`vertexaisearch.cloud.google.com/grounding-api-redirect/...` wrapper. These wrappers are
known to sometimes fail to resolve — dead, expired, or blocked — which is exactly the
"I click the source and nothing is there" bug. This module follows each wrapper server-side
right when the answer is finalized (the redirect is freshly valid at that point) and
rewrites the answer text in place:

  * resolves to a real third-party page -> swap the wrapper for the real URL
  * dead / expired / never leaves Google's own domain (incl. a bare Search-results page,
    which is not a real citation) -> drop the link entirely, keep the label as plain text.
    A non-clickable label is safer than a dead "click here" in a legal product.

Used by both single-pass Research mode (files.py) and Deep Research's synthesis
(deep_research/agent.py) as the last step before an answer is finalized.
"""

from __future__ import annotations

import asyncio
import logging
import re
from urllib.parse import urlparse

logger = logging.getLogger(__name__)

_REDIRECT_URL_RE = re.compile(
    r"https://vertexaisearch\.cloud\.google\.com/grounding-api-redirect/[^\s\)\]\"']+"
)
_MD_LINK_RE = re.compile(
    r"\[([^\[\]]+)\]\((https://vertexaisearch\.cloud\.google\.com/grounding-api-redirect/[^\s\)]+)\)"
)

_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)


def _is_google_owned(url: str) -> bool:
    """True if the resolved URL never actually left Google's own infrastructure — either
    the redirect didn't fire (still vertexaisearch.*) or it landed on a plain Google Search
    results page, which is not a real citation."""
    try:
        host = (urlparse(url).netloc or "").lower()
    except Exception:
        return True
    return host == "vertexaisearch.cloud.google.com" or host.endswith(".google.com") or host == "google.com"


async def _resolve_one(client, url: str, timeout_s: float) -> tuple[str | None, str]:
    """Follow the redirect. Returns (resolved_url_or_None, kind):
      kind="ok"            -> resolved to a genuine third-party page
      kind="dead_end"      -> we got an answer, but it never left Google (expired/invalid
                               redirect, or a bare Search-results page) — a REAL per-URL dead
                               link, safe to drop.
      kind="network_error" -> our request itself failed (DNS/connect/timeout) — this tells
                               us NOTHING about whether the URL is actually dead; it may work
                               fine in the user's own browser. Never used to justify dropping.
    Status code is deliberately not used to decide dead-vs-alive: our server's own request can
    get bot-blocked (403/429) on a page that renders fine in a real browser."""
    try:
        async with client.stream("GET", url, timeout=timeout_s) as resp:
            final_url = str(resp.url)
        if _is_google_owned(final_url):
            return None, "dead_end"
        return final_url, "ok"
    except Exception:
        return None, "network_error"


async def resolve_grounding_links(
    text: str,
    *,
    timeout_s: float = 6.0,
    total_timeout_s: float = 15.0,
    max_links: int = 24,
) -> tuple[str, dict[str, int]]:
    """Rewrite every grounding-redirect link in `text` to its real destination, or drop it
    if it's a confirmed dead end. Returns (rewritten_text, stats). Safe no-op when `text` has
    no grounding links, when httpx/network is unavailable, or when resolution could not even
    be ATTEMPTED for every link (network outage / everything timed out) — in that situation we
    leave the original links untouched rather than strip every citation to plain text: "we
    couldn't check" must never be treated the same as "confirmed dead"."""
    urls = list(dict.fromkeys(_REDIRECT_URL_RE.findall(text)))  # unique, order-preserving
    if not urls:
        return text, {"found": 0, "resolved": 0, "dropped": 0}

    capped = urls[:max_links]
    over_cap = len(urls) - len(capped)

    try:
        import httpx
    except Exception:
        logger.warning("[GroundingLinks] httpx unavailable — leaving %d link(s) unresolved", len(urls))
        return text, {"found": len(urls), "resolved": 0, "dropped": 0}

    outcomes: dict[str, tuple[str | None, str]] = {}
    timed_out = False
    try:
        async with httpx.AsyncClient(
            follow_redirects=True, headers={"User-Agent": _UA}, timeout=timeout_s,
        ) as client:
            async def _one(u: str) -> tuple[str, str | None, str]:
                real, kind = await _resolve_one(client, u, timeout_s)
                return u, real, kind

            triples = await asyncio.wait_for(
                asyncio.gather(*(_one(u) for u in capped)),
                timeout=total_timeout_s,
            )
            outcomes = {u: (real, kind) for u, real, kind in triples}
    except asyncio.TimeoutError:
        timed_out = True
        logger.warning(
            "[GroundingLinks] resolution budget (%.0fs) exceeded before any/all link(s) finished",
            total_timeout_s,
        )
    except Exception as exc:
        logger.warning("[GroundingLinks] resolver failed: %s", exc)

    attempted = len(outcomes)
    network_errors = sum(1 for _, kind in outcomes.values() if kind == "network_error")
    # SYSTEMIC failure guard: if the whole batch timed out, or every attempt that DID finish
    # was a network-level failure (not a confirmed dead end), we have no real signal — leave
    # every link exactly as it was rather than guarantee they all go dead.
    systemic_failure = timed_out or (capped and attempted > 0 and network_errors == attempted)
    if systemic_failure:
        logger.warning(
            "[GroundingLinks] treating this as a network outage, not dead links — left all "
            "%d source link(s) unresolved/untouched",
            len(capped),
        )
        stats = {"found": len(urls), "resolved": 0, "dropped": 0, "network_outage": 1}
        return text, stats

    resolved_map: dict[str, str | None] = {u: real for u, (real, _kind) in outcomes.items()}
    resolved_count = sum(1 for v in resolved_map.values() if v)
    dropped_count = len(capped) - resolved_count + over_cap

    def _md_replace(m: re.Match) -> str:
        label, url = m.group(1), m.group(2)
        real = resolved_map.get(url)
        return f"[{label}]({real})" if real else label

    text = _MD_LINK_RE.sub(_md_replace, text)

    def _bare_replace(m: re.Match) -> str:
        return resolved_map.get(m.group(0)) or ""

    text = _REDIRECT_URL_RE.sub(_bare_replace, text)

    stats = {"found": len(urls), "resolved": resolved_count, "dropped": dropped_count}
    logger.info(
        "[GroundingLinks] %d source link(s) · %d resolved · %d dropped (confirmed dead-end)%s",
        stats["found"], stats["resolved"], stats["dropped"],
        f" · {over_cap} skipped over max_links={max_links}" if over_cap else "",
    )
    return text, stats
