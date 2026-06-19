"""
Claude path: Serper API web search + Claude Sonnet extraction.
1 iteration.
"""
from __future__ import annotations

import json
import logging
import os
import re
import time
from typing import Any, Dict, List, Optional

import httpx

from agents.citation_test_agent.domain_allowlist import filter_results, tier_of

logger = logging.getLogger(__name__)

_CLAUDE_MODEL = os.environ.get("CLAUDE_MODEL", "claude-sonnet-4-6")
_SERPER_API_KEY = os.environ.get("SERPER_API_KEY", "")
_ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("CLAUDE_API_KEY") or ""


def _serper_search(query: str, num: int = 5) -> List[Dict[str, Any]]:
    """Call Serper API and return organic result dicts."""
    if not _SERPER_API_KEY:
        logger.warning("[CLAUDE_RUNNER] SERPER_API_KEY not set")
        return []
    try:
        with httpx.Client(timeout=15.0) as client:
            resp = client.post(
                "https://google.serper.dev/search",
                headers={"X-API-KEY": _SERPER_API_KEY, "Content-Type": "application/json"},
                json={"q": query, "num": num, "gl": "in", "hl": "en"},
            )
            resp.raise_for_status()
            data = resp.json()
            return data.get("organic") or []
    except Exception as exc:
        logger.warning("[CLAUDE_RUNNER] Serper failed for %r: %s", query[:60], exc)
        return []


def _claude_call(prompt: str, max_tokens: int = 6144) -> Optional[str]:
    if not _ANTHROPIC_API_KEY:
        logger.warning("[CLAUDE_RUNNER] ANTHROPIC_API_KEY not set")
        return None
    for attempt, delay in enumerate([0, 3, 7]):
        if delay:
            time.sleep(delay)
        try:
            with httpx.Client(timeout=90.0) as client:
                resp = client.post(
                    "https://api.anthropic.com/v1/messages",
                    headers={
                        "x-api-key": _ANTHROPIC_API_KEY,
                        "anthropic-version": "2023-06-01",
                        "content-type": "application/json",
                    },
                    json={
                        "model": _CLAUDE_MODEL,
                        "max_tokens": max_tokens,
                        "messages": [{"role": "user", "content": prompt}],
                    },
                )
                resp.raise_for_status()
                data = resp.json()
                content = data.get("content") or []
                for block in content:
                    if isinstance(block, dict) and block.get("type") == "text":
                        return (block.get("text") or "").strip() or None
                return None
        except Exception as exc:
            if attempt < 2 and "529" in str(exc):
                continue
            logger.warning("[CLAUDE_RUNNER] Claude call failed: %s", exc)
            return None
    return None


def _strip_json(text: str) -> str:
    text = re.sub(r"^```(?:json)?\s*", "", (text or "").strip())
    text = re.sub(r"```\s*$", "", text).strip()
    for start, end in [(text.find("{"), text.rfind("}")), (text.find("["), text.rfind("]"))]:
        if start != -1 and end > start:
            return text[start:end + 1]
    return text


def run_claude_pipeline(
    case_query: str,
    case_context: str,
    run_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    1-iteration Claude + Serper pipeline.
    Returns {"citations": [...], "search_results": [...], "gaps": [...]}
    """
    print("[CITATION_TEST][CLAUDE] Starting pipeline", flush=True)

    # Step 1: plan search queries via Claude
    plan_prompt = (
        f"You are a legal research assistant. Generate 3 targeted search queries for Indian court judgments.\n\n"
        f"Case context: {case_context[:2000]}\n\nQuery: {case_query}\n\n"
        f"Return ONLY JSON: {{\"queries\": [\"...\", \"...\", \"...\"]}}"
    )
    plan_text = _claude_call(plan_prompt, max_tokens=512)
    queries: List[str] = []
    if plan_text:
        try:
            parsed = json.loads(_strip_json(plan_text))
            queries = [q.strip() for q in (parsed.get("queries") or []) if q and q.strip()]
        except Exception:
            pass
    if not queries:
        queries = [case_query]
    print(f"[CITATION_TEST][CLAUDE] Planned {len(queries)} queries", flush=True)

    # Step 2: search via Serper + allowlist filter
    all_results: List[Dict[str, Any]] = []
    seen_uris: set = set()
    for q in queries[:3]:
        organic = _serper_search(q + " site:indiankanoon.org OR site:sci.gov.in OR site:ecourts.gov.in OR site:livelaw.in", num=5)
        for hit in organic:
            uri = str(hit.get("link") or "").strip()
            if not uri or uri in seen_uris:
                continue
            tier = tier_of(uri)
            if tier in ("T1", "T2"):
                seen_uris.add(uri)
                all_results.append({
                    "uri": uri,
                    "title": str(hit.get("title") or ""),
                    "snippet": str(hit.get("snippet") or ""),
                    "authority_tier": tier,
                })
    print(f"[CITATION_TEST][CLAUDE] Got {len(all_results)} T1/T2 Serper results", flush=True)

    if not all_results:
        return {"citations": [], "search_results": [], "gaps": ["No T1/T2 sources found via Serper"]}

    # Step 3: extract citations via Claude
    sources_json = json.dumps(all_results, ensure_ascii=False, indent=2)
    extract_prompt = (
        f"You are a legal citation extractor. Extract all valid Indian court citation candidates from the sources below.\n\n"
        f"Case context: {case_context[:1500]}\n\nSearch query: {case_query}\n\n"
        f"Sources (T1/T2 — official and recognized reporter sites):\n{sources_json}\n\n"
        f"For each citation extract: parties, court, year, citation_no (official citation like (2022) 5 SCC 123), "
        f"ratio (core legal holding in 2 sentences), how_helps (why relevant to the query), "
        f"source_url, authority_tier, confidence (HIGH/MEDIUM).\n"
        f"Only include citations that are clearly identifiable Indian court judgments.\n"
        f"Return ONLY JSON: {{\"citations\": [{{...}}, ...]}}"
    )
    extract_text = _claude_call(extract_prompt, max_tokens=6144)
    citations: List[Dict[str, Any]] = []
    if extract_text:
        try:
            parsed = json.loads(_strip_json(extract_text))
            raw_cits = parsed.get("citations") or (parsed if isinstance(parsed, list) else [])
            for c in raw_cits:
                if not isinstance(c, dict):
                    continue
                if str(c.get("authority_tier", "")).upper() == "T3":
                    continue
                citations.append({
                    "parties": str(c.get("parties") or ""),
                    "court": str(c.get("court") or ""),
                    "year": str(c.get("year") or ""),
                    "citation_no": str(c.get("citation_no") or ""),
                    "ratio": str(c.get("ratio") or ""),
                    "how_helps": str(c.get("how_helps") or ""),
                    "source_url": str(c.get("source_url") or ""),
                    "source_name": str(c.get("source_name") or ""),
                    "authority_tier": str(c.get("authority_tier") or "T2"),
                    "confidence": str(c.get("confidence") or "MEDIUM").upper(),
                    "verification_status": "verified_claude_serper",
                    "legal_issue": str(c.get("legal_issue") or ""),
                })
        except Exception as exc:
            logger.warning("[CLAUDE_RUNNER] extract JSON parse failed: %s", exc)

    print(f"[CITATION_TEST][CLAUDE] Extracted {len(citations)} citations", flush=True)
    return {
        "citations": citations,
        "search_results": all_results,
        "gaps": [] if citations else ["Could not extract structured citations from Serper results"],
    }
