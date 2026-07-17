"""
Option-A Authorized Web Search Tool.

Uses Gemini google_search grounding, then hard-filters every grounding chunk
whose host is not on the authority allowlist.  The LLM prompt is advisory;
the URI filter is the code-level guarantee.
"""
from __future__ import annotations

import logging
import os
import re
import time
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlparse

import httpx

from agents.autonomous_citation_agent.domain_allowlist import get_allowlist
from agents.autonomous_citation_agent.schema import SearchResult

logger = logging.getLogger(__name__)

_GEMINI_MODEL = os.environ.get("GEMINI_FLASH_MODEL", "gemini-2.5-flash")
_REDIRECT_HOSTS = frozenset({
    "vertexaisearch.cloud.google.com",
    "cloud.google.com",
    "google.com",
    "www.google.com",
})


def _is_grounding_redirect(uri: str) -> bool:
    host = urlparse(uri).netloc.lower().removeprefix("www.")
    return host in _REDIRECT_HOSTS or "grounding-api-redirect" in uri


def _resolve_grounding_url(uri: str) -> str:
    """Follow Gemini grounding redirect links to the real destination URL."""
    if not uri or not _is_grounding_redirect(uri):
        return uri
    try:
        with httpx.Client(follow_redirects=True, timeout=8.0) as client:
            for method in ("head", "get"):
                try:
                    resp = client.request(method, uri)
                    final = str(resp.url)
                    if final.startswith("http") and not _is_grounding_redirect(final):
                        return final
                except Exception:
                    continue
    except Exception as exc:
        logger.debug("[AUTH_SEARCH] Could not resolve redirect %s: %s", uri[:60], exc)
    return uri


def _extract_grounding_chunks(response: Any) -> List[Tuple[str, str, str]]:
    """Return (uri, title, snippet) tuples from Gemini grounding metadata."""
    out: List[Tuple[str, str, str]] = []
    try:
        for cand in (response.candidates or []):
            gm = getattr(cand, "grounding_metadata", None) or getattr(cand, "groundingMetadata", None)
            if not gm:
                continue

            # Build a map from chunk index → support text (from grounding_supports)
            support_map: dict = {}
            supports = getattr(gm, "grounding_supports", None) or getattr(gm, "groundingSupports", None) or []
            for sup in supports:
                text = str(getattr(sup, "segment", None) and getattr(sup.segment, "text", "") or "").strip()
                if not text:
                    continue
                idxs = getattr(sup, "grounding_chunk_indices", None) or getattr(sup, "groundingChunkIndices", None) or []
                for idx in (idxs if isinstance(idxs, list) else []):
                    try:
                        i = int(idx)
                        existing = support_map.get(i, "")
                        support_map[i] = (existing + " " + text).strip() if existing else text
                    except Exception:
                        pass

            chunks = getattr(gm, "grounding_chunks", None) or getattr(gm, "groundingChunks", None) or []
            for idx, ch in enumerate(chunks):
                web = getattr(ch, "web", None) if hasattr(ch, "web") else (ch.get("web") if isinstance(ch, dict) else None)
                if not web:
                    continue
                uri = str(getattr(web, "uri", None) or (web.get("uri") if isinstance(web, dict) else None) or "").strip()
                title = str(getattr(web, "title", None) or (web.get("title") if isinstance(web, dict) else None) or "").strip()
                if uri and uri.startswith("http"):
                    resolved = _resolve_grounding_url(uri)
                    if resolved != uri:
                        logger.info("[AUTH_SEARCH] Resolved redirect → %s", resolved[:80])
                    snippet = support_map.get(idx, "")[:500]
                    out.append((resolved, title, snippet))
    except Exception as exc:
        logger.debug("[AUTH_SEARCH] Error extracting grounding chunks: %s", exc)
    return out


def run_authorized_search(
    query: str,
    num_results: int = 5,
    run_id: Optional[str] = None,
    user_id: Optional[str] = None,
    citable_only: bool = False,
) -> List[SearchResult]:
    """
    Execute one google_search grounding call for `query`, post-filter every
    result URI through the authority allowlist, and return only tagged results.
    Off-list URLs are silently dropped (and counted in the audit log).
    """
    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        logger.warning("[AUTH_SEARCH] GEMINI_API_KEY not set — skipping authorized search")
        return []

    allowlist = get_allowlist()
    if not allowlist.enabled:
        logger.info("[AUTH_SEARCH] citation_web_enabled=false — skipping")
        return []

    # Build T1-biased site: operators where possible
    t1_sites = ["sci.gov.in", "ecourts.gov.in", "indiankanoon.org", "judgments.ecourts.gov.in"]
    site_hints = " OR ".join(f"site:{s}" for s in t1_sites[:3])
    search_prompt = (
        f"Search for Indian court judgments relevant to this legal query. "
        f"Prioritise official government and court sources ({site_hints}). "
        f"Return results for: {query}"
    )

    try:
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=api_key)
        grounding_tool = types.Tool(google_search=types.GoogleSearch())
        thinking_config = None
        try:
            thinking_config = types.ThinkingConfig(thinking_budget=0)
        except Exception:
            pass
        config = types.GenerateContentConfig(
            tools=[grounding_tool],
            max_output_tokens=2048,
            temperature=0.0,
            **({"thinking_config": thinking_config} if thinking_config else {}),
        )

        response = None
        for attempt in range(3):
            try:
                response = client.models.generate_content(
                    model=_GEMINI_MODEL, contents=search_prompt, config=config
                )
                break
            except Exception as exc:
                msg = str(exc)
                if ("429" in msg or "RESOURCE_EXHAUSTED" in msg.upper()) and attempt < 2:
                    logger.warning("[AUTH_SEARCH] Rate-limited (attempt %d/3); retrying in 5s", attempt + 1)
                    time.sleep(5)
                    continue
                raise

        if response is None:
            return []

        raw_chunks = _extract_grounding_chunks(response)
        logger.info("[AUTH_SEARCH] Grounding returned %d raw chunk(s) for: %r", len(raw_chunks), query[:60])

        allowed = allowlist.filter_results(raw_chunks[:num_results * 3])
        if citable_only:
            allowed = [r for r in allowed if r.authority_tier in ("T1", "T2")]
        result = allowed[:num_results]

        for r in result:
            logger.info("[AUTH_SEARCH]  [%s] %s | %s", r.authority_tier, r.title[:50], r.uri[:70])

        try:
            from utils.usage_tracker import record_gemini
            record_gemini(run_id, user_id or "anonymous", "web_citation_search", is_grounding=True)
        except Exception:
            pass

        return result

    except Exception as exc:
        logger.warning("[AUTH_SEARCH] Search failed for %r: %s", query[:60], exc)
        return []
