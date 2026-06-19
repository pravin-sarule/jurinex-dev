"""
Gemini path: Google Grounding search + Gemini Pro extraction.
1 iteration; mirrors citation-service grounding_search + runner logic.
"""
from __future__ import annotations

import json
import logging
import os
import re
import time
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

import httpx

from agents.citation_test_agent.domain_allowlist import filter_results, tier_of
from agents.citation_test_agent.schema import SearchResult

logger = logging.getLogger(__name__)

_FLASH = os.environ.get("GEMINI_FLASH_MODEL", "gemini-2.5-flash")
_PRO = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")

_REDIRECT_HOSTS = frozenset({
    "vertexaisearch.cloud.google.com", "cloud.google.com",
    "google.com", "www.google.com",
})


def _is_redirect(uri: str) -> bool:
    h = urlparse(uri).netloc.lower()
    return h in _REDIRECT_HOSTS or "grounding-api-redirect" in uri


def _resolve_url(uri: str) -> str:
    if not uri or not _is_redirect(uri):
        return uri
    try:
        with httpx.Client(follow_redirects=True, timeout=8.0) as c:
            for method in ("head", "get"):
                try:
                    r = c.request(method, uri)
                    final = str(r.url)
                    if final.startswith("http") and not _is_redirect(final):
                        return final
                except Exception:
                    continue
    except Exception:
        pass
    return uri


def _extract_chunks(response: Any):
    out = []
    try:
        for cand in (response.candidates or []):
            gm = getattr(cand, "grounding_metadata", None) or getattr(cand, "groundingMetadata", None)
            if not gm:
                continue
            support_map: Dict[int, str] = {}
            for sup in (getattr(gm, "grounding_supports", None) or getattr(gm, "groundingSupports", None) or []):
                text = str(getattr(sup, "segment", None) and getattr(sup.segment, "text", "") or "").strip()
                if not text:
                    continue
                for idx in (getattr(sup, "grounding_chunk_indices", None) or getattr(sup, "groundingChunkIndices", None) or []):
                    try:
                        i = int(idx)
                        support_map[i] = (support_map.get(i, "") + " " + text).strip()
                    except Exception:
                        pass
            for idx, ch in enumerate(getattr(gm, "grounding_chunks", None) or getattr(gm, "groundingChunks", None) or []):
                web = getattr(ch, "web", None) if hasattr(ch, "web") else (ch.get("web") if isinstance(ch, dict) else None)
                if not web:
                    continue
                uri = str(getattr(web, "uri", None) or (web.get("uri") if isinstance(web, dict) else None) or "").strip()
                title = str(getattr(web, "title", None) or (web.get("title") if isinstance(web, dict) else None) or "").strip()
                if uri and uri.startswith("http"):
                    resolved = _resolve_url(uri)
                    snippet = support_map.get(idx, "")[:500]
                    out.append((resolved, title, snippet))
    except Exception as exc:
        logger.debug("[GEMINI_RUNNER] chunk extraction error: %s", exc)
    return out


def _gemini_grounding_search(query: str, num: int = 5) -> List[SearchResult]:
    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        logger.warning("[GEMINI_RUNNER] GOOGLE_API_KEY not set")
        return []

    t1_hints = "site:sci.gov.in OR site:ecourts.gov.in OR site:indiankanoon.org"
    prompt = (
        f"Search for Indian court judgments relevant to this legal query. "
        f"Prioritise official government and court sources ({t1_hints}). "
        f"Return results for: {query}"
    )
    try:
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=api_key)
        grounding_tool = types.Tool(google_search=types.GoogleSearch())
        try:
            thinking_cfg = types.ThinkingConfig(thinking_budget=0)
        except Exception:
            thinking_cfg = None
        cfg = types.GenerateContentConfig(
            tools=[grounding_tool],
            max_output_tokens=2048,
            temperature=0.0,
            **({"thinking_config": thinking_cfg} if thinking_cfg else {}),
        )
        response = None
        for attempt in range(3):
            try:
                response = client.models.generate_content(model=_FLASH, contents=prompt, config=cfg)
                break
            except Exception as exc:
                msg = str(exc)
                if ("429" in msg or "RESOURCE_EXHAUSTED" in msg.upper()) and attempt < 2:
                    time.sleep(5)
                    continue
                raise

        if response is None:
            return []

        raw = _extract_chunks(response)
        allowed = filter_results(raw[: num * 3])
        return [r for r in allowed if r.authority_tier in ("T1", "T2")][:num]

    except Exception as exc:
        logger.warning("[GEMINI_RUNNER] grounding search failed: %s", exc)
        return []


def _gemini_call(prompt: str, model: str = _PRO, max_tokens: int = 6144) -> Optional[str]:
    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        return None
    for attempt, delay in enumerate([0, 3, 7]):
        if delay:
            time.sleep(delay)
        try:
            from google import genai
            client = genai.Client(api_key=api_key)
            resp = client.models.generate_content(
                model=model,
                contents=prompt,
                config=genai.types.GenerateContentConfig(temperature=0.1, max_output_tokens=max_tokens),
            )
            return (resp.text or "").strip() or None
        except Exception as exc:
            if attempt < 2 and any(x in str(exc) for x in ("429", "RESOURCE_EXHAUSTED")):
                continue
            logger.warning("[GEMINI_RUNNER] call failed: %s", exc)
            return None
    return None


def _strip_json(text: str) -> str:
    text = re.sub(r"^```(?:json)?\s*", "", (text or "").strip())
    text = re.sub(r"```\s*$", "", text).strip()
    for start, end in [(text.find("{"), text.rfind("}")), (text.find("["), text.rfind("]"))]:
        if start != -1 and end > start:
            return text[start:end + 1]
    return text


def run_gemini_pipeline(
    case_query: str,
    case_context: str,
    run_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    1-iteration Gemini + Google Grounding pipeline.
    Returns {"citations": [...], "search_results": [...], "gaps": [...]}
    """
    print("[CITATION_TEST][GEMINI] Starting pipeline", flush=True)

    # Step 1: plan search queries
    plan_prompt = (
        f"You are a legal research assistant. Generate 3 targeted search queries for Indian court judgments.\n\n"
        f"Case context: {case_context[:2000]}\n\n"
        f"Query: {case_query}\n\n"
        f"Return ONLY JSON: {{\"queries\": [\"...\", \"...\", \"...\"]}}"
    )
    plan_text = _gemini_call(plan_prompt, _FLASH, max_tokens=512)
    queries: List[str] = []
    if plan_text:
        try:
            parsed = json.loads(_strip_json(plan_text))
            queries = [q.strip() for q in (parsed.get("queries") or []) if q and q.strip()]
        except Exception:
            pass
    if not queries:
        queries = [case_query]
    print(f"[CITATION_TEST][GEMINI] Planned {len(queries)} queries", flush=True)

    # Step 2: search with Google Grounding
    all_results: List[SearchResult] = []
    seen_uris: set = set()
    for q in queries[:3]:
        hits = _gemini_grounding_search(q, num=4)
        for h in hits:
            if h.uri not in seen_uris:
                seen_uris.add(h.uri)
                all_results.append(h)
    print(f"[CITATION_TEST][GEMINI] Got {len(all_results)} T1/T2 search results", flush=True)

    # Step 3: extract citations from results
    if not all_results:
        return {"citations": [], "search_results": [], "gaps": ["No T1/T2 sources found via grounding"]}

    sources_json = json.dumps([
        {"uri": r.uri, "title": r.title, "snippet": r.snippet, "authority_tier": r.authority_tier}
        for r in all_results
    ], ensure_ascii=False, indent=2)

    extract_prompt = (
        f"You are a legal citation extractor. Extract all valid Indian court citation candidates from the sources below.\n\n"
        f"Case context: {case_context[:1500]}\n\nSearch query: {case_query}\n\n"
        f"Sources (T1/T2 only — official and recognized reporter sites):\n{sources_json}\n\n"
        f"For each citation extract: parties, court, year, citation_no, ratio (core legal holding), "
        f"how_helps (relevance to the query), source_url, authority_tier, confidence (HIGH/MEDIUM).\n"
        f"Return ONLY JSON: {{\"citations\": [{{...}}, ...]}}"
    )
    extract_text = _gemini_call(extract_prompt, _PRO, max_tokens=6144)
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
                    "verification_status": "verified_gemini_grounding",
                    "legal_issue": str(c.get("legal_issue") or ""),
                })
        except Exception as exc:
            logger.warning("[GEMINI_RUNNER] extract JSON parse failed: %s", exc)

    print(f"[CITATION_TEST][GEMINI] Extracted {len(citations)} citations", flush=True)
    return {
        "citations": citations,
        "search_results": [{"uri": r.uri, "title": r.title, "authority_tier": r.authority_tier} for r in all_results],
        "gaps": [] if citations else ["Could not extract structured citations from grounding results"],
    }
