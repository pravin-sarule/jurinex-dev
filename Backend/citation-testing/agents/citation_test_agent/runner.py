"""
Citation Test Agent Orchestrator — 1 iteration, full pipeline.

Flow (mirrors citation-service autonomous agent exactly):
  1. Case Analyzer     — extract issues, jurisdiction, parties from case chunks
  2. Research Decomposer — generate 5-7 typed research questions
  3. Query Planner     — generate Boolean search queries (3 per question, ≤9 total)
  4. Search            — Gemini Google Grounding OR Serper API (T1/T2 filter)
  5. Citation Extractor — extract structured citations from T1/T2 sources
  6. Return results

Entry point: run_test_pipeline(state) → state
"""
from __future__ import annotations

import json
import logging
import os
import re
import time
from typing import Any, Dict, List, Optional, Type

from pydantic import BaseModel

logger = logging.getLogger(__name__)

# ── Result cache (keyed by case_id+method; avoids re-running for same case) ──
import hashlib as _hashlib

_RESULT_CACHE: Dict[str, tuple] = {}  # key -> (timestamp, citations, search_results, gaps)
_CACHE_TTL_SECONDS = int(os.environ.get("CITATION_CACHE_TTL_SECONDS", "86400"))  # 24 h default


def _cache_key(case_id: str, case_query: str, method: str) -> str:
    raw = f"{(case_id or '').strip()}|{(case_query or '')[:120].strip()}|{method}"
    return _hashlib.md5(raw.encode()).hexdigest()


def _cache_get(key: str) -> Optional[Dict[str, Any]]:
    entry = _RESULT_CACHE.get(key)
    if entry and (time.time() - entry[0]) < _CACHE_TTL_SECONDS:
        return {"citations": entry[1], "search_results": entry[2], "gaps": entry[3]}
    return None


def _cache_set(key: str, citations: list, search_results: list, gaps: list) -> None:
    _RESULT_CACHE[key] = (time.time(), citations, search_results, gaps)


# ── Shared LLM helpers ────────────────────────────────────────────────────────

def _gemini_call(prompt: str, model: str, max_tokens: int = 4096, json_mode: bool = False) -> Optional[str]:
    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        logger.warning("[RUNNER] GEMINI_API_KEY not set")
        return None
    for attempt, delay in enumerate([0, 3, 7]):
        if delay:
            time.sleep(delay)
        try:
            from google import genai
            client = genai.Client(api_key=api_key)
            config_kwargs: Dict[str, Any] = {"temperature": 0.0, "max_output_tokens": max_tokens}
            if json_mode:
                config_kwargs["response_mime_type"] = "application/json"
            # Disable thinking mode — not needed for structured JSON tasks, saves 3-8s per call
            try:
                config_kwargs["thinking_config"] = genai.types.ThinkingConfig(thinking_budget=0)
            except Exception:
                pass
            resp = client.models.generate_content(
                model=model,
                contents=prompt,
                config=genai.types.GenerateContentConfig(**config_kwargs),
            )
            return (resp.text or "").strip() or None
        except Exception as exc:
            if attempt < 2 and any(x in str(exc) for x in ("429", "RESOURCE_EXHAUSTED", "503", "UNAVAILABLE")):
                continue
            logger.warning("[RUNNER] Gemini call failed (%s): %s", model, exc)
            return None
    return None


def _claude_call(prompt: str, model: str, max_tokens: int = 4096, timeout: float = 120.0) -> Optional[str]:
    import httpx
    api_key = os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("CLAUDE_API_KEY") or ""
    if not api_key:
        logger.warning("[RUNNER] ANTHROPIC_API_KEY not set")
        return None
    for attempt, delay in enumerate([0, 3, 7]):
        if delay:
            time.sleep(delay)
        try:
            with httpx.Client(timeout=timeout) as client:
                resp = client.post(
                    "https://api.anthropic.com/v1/messages",
                    headers={
                        "x-api-key": api_key,
                        "anthropic-version": "2023-06-01",
                        "content-type": "application/json",
                    },
                    json={
                        "model": model,
                        "max_tokens": max_tokens,
                        "messages": [{"role": "user", "content": prompt}],
                    },
                )
                resp.raise_for_status()
                data = resp.json()
                for block in data.get("content") or []:
                    if isinstance(block, dict) and block.get("type") == "text":
                        return (block.get("text") or "").strip() or None
                return None
        except Exception as exc:
            if attempt < 2 and any(x in str(exc) for x in ("529", "503", "overloaded")):
                continue
            logger.warning("[RUNNER] Claude call failed (%s): %s", model, exc)
            return None
    return None


def _strip_json(text: str) -> str:
    text = re.sub(r"^```(?:json)?\s*", "", (text or "").strip())
    text = re.sub(r"```\s*$", "", text).strip()
    brace_pos = text.find("{")
    bracket_pos = text.find("[")
    if bracket_pos != -1 and (brace_pos == -1 or bracket_pos < brace_pos):
        end = text.rfind("]")
        if end > bracket_pos:
            return text[bracket_pos:end + 1]
    if brace_pos != -1:
        end = text.rfind("}")
        if end > brace_pos:
            return text[brace_pos:end + 1]
    return text


def _parse_json(text: str) -> Optional[Any]:
    if not text:
        return None
    raw = _strip_json(text)
    for attempt in (raw, re.sub(r",\s*}", "}", raw), re.sub(r",\s*]", "]", raw)):
        try:
            return json.loads(attempt)
        except Exception:
            continue
    return None


def _llm_json(
    prompt: str,
    gemini_model: str,
    method: str,
    schema: Optional[Type[BaseModel]] = None,
    max_tokens: int = 4096,
    operation: str = "llm",
) -> Optional[Dict[str, Any]]:
    """Route upstream JSON stages to Claude or Gemini based on pipeline method."""
    from agents.citation_test_agent.prompts import CLAUDE_UPSTREAM_MODEL

    full_prompt = prompt
    if schema is not None:
        full_prompt += (
            "\n\nOutput ONLY valid JSON matching this schema:\n"
            + json.dumps(schema.model_json_schema(), indent=2)
        )

    method = (method or "gemini").lower().strip()
    raw: Optional[str] = None
    if method == "claude":
        raw = _claude_call(full_prompt, CLAUDE_UPSTREAM_MODEL, max_tokens=max_tokens)
        if not raw:
            raw = _gemini_call(full_prompt, gemini_model, max_tokens=max_tokens, json_mode=True)
    else:
        raw = _gemini_call(full_prompt, gemini_model, max_tokens=max_tokens, json_mode=True)
        if not raw:
            raw = _claude_call(full_prompt, CLAUDE_UPSTREAM_MODEL, max_tokens=max_tokens)

    if not raw:
        logger.warning("[RUNNER] %s: no LLM response (method=%s)", operation, method)
        return None

    parsed = _parse_json(raw)
    if parsed is None:
        logger.warning("[RUNNER] %s: JSON parse failed — preview: %s", operation, raw[:300])
        return None
    if not isinstance(parsed, dict):
        logger.warning("[RUNNER] %s: expected JSON object, got %s", operation, type(parsed).__name__)
        return None

    if schema is not None:
        try:
            return schema.model_validate(parsed).model_dump()
        except Exception as exc:
            logger.warning("[RUNNER] %s: schema validation failed (%s) — using loose parse", operation, exc)
    return parsed


def _fmt(template: str, state: Dict[str, Any]) -> str:
    out = template
    for k, v in state.items():
        ph = "{" + k + "}"
        if ph in out:
            out = out.replace(ph, json.dumps(v, ensure_ascii=False) if isinstance(v, (dict, list)) else str(v or ""))
    return out


def _issues_to_string(result: Dict[str, Any]) -> str:
    issues = result.get("issues") or []
    lines = []
    for i, iss in enumerate(issues, 1):
        acts = ", ".join(iss.get("acts_involved") or [])
        lines.append(
            f"Issue {i}: {iss.get('issue_title', '')}\n"
            f"  Proposition: {iss.get('proposition', '')}\n"
            f"  Acts: {acts or 'N/A'}\n"
            f"  Facts: {iss.get('fact_summary', '')}"
        )
    jurisdiction = result.get("jurisdiction", "")
    if jurisdiction:
        lines.append(f"\nJurisdiction: {jurisdiction}")
    return "\n\n".join(lines) or result.get("case_fact_summary", "") or ""


# ── Stage 1: Case Analyzer ────────────────────────────────────────────────────

def _run_case_analyzer(state: Dict[str, Any]) -> None:
    from agents.citation_test_agent.prompts import CASE_ANALYZER_INSTRUCTION, CASE_ANALYZER_MODEL
    from agents.citation_test_agent.schema import CaseAnalysis

    method = str(state.get("method") or "gemini")
    print(f"[CITATION_TEST] Stage 1 — Case Analyzer ({method})", flush=True)
    prompt = _fmt(CASE_ANALYZER_INSTRUCTION, state)
    result = _llm_json(
        prompt,
        CASE_ANALYZER_MODEL,
        method,
        schema=CaseAnalysis,
        max_tokens=1500,
        operation="case_analyzer",
    )
    if result:
        state["case_analysis"] = json.dumps(result, ensure_ascii=False)
        issues = result.get("issues") or []
        state["issue"] = _issues_to_string(result) or state.get("case_query", "")
        jurisdiction = result.get("jurisdiction", "")
        print(f"[CITATION_TEST]   → {len(issues)} issue(s) extracted, jurisdiction={jurisdiction}", flush=True)
    else:
        state["case_analysis"] = "{}"
        state["issue"] = state.get("case_query", "Legal research query")
        print("[CITATION_TEST]   → Case analysis failed; using query as issue", flush=True)


# ── Stage 2: Research Decomposer ─────────────────────────────────────────────

def _run_research_decomposer(state: Dict[str, Any]) -> None:
    from agents.citation_test_agent.prompts import DECOMPOSE_INSTRUCTION, DECOMPOSER_MODEL
    from agents.citation_test_agent.schema import DeepResearchPlan

    method = str(state.get("method") or "gemini")
    print(f"[CITATION_TEST] Stage 2 — Research Decomposer ({method})", flush=True)
    prompt = _fmt(DECOMPOSE_INSTRUCTION, state)
    result = _llm_json(
        prompt,
        DECOMPOSER_MODEL,
        method,
        schema=DeepResearchPlan,
        max_tokens=2048,
        operation="research_decomposer",
    )
    if result and isinstance(result.get("research_questions"), list):
        qs = result["research_questions"]
        state["research_questions"] = json.dumps(qs, ensure_ascii=False)
        print(f"[CITATION_TEST]   → {len(qs)} research question(s)", flush=True)
        for i, q in enumerate(qs, 1):
            print(f"[CITATION_TEST]     Q{i} [{q.get('type','?')}] P{q.get('priority','?')}: {q.get('question','')[:90]}", flush=True)
    else:
        state["research_questions"] = "[]"
        print("[CITATION_TEST]   → Decomposer failed; will use case issues only", flush=True)


# ── Stage 3: Query Planner ────────────────────────────────────────────────────

def _run_query_planner(state: Dict[str, Any]) -> List[str]:
    from agents.citation_test_agent.prompts import QUERY_PLANNER_INSTRUCTION, QUERY_PLANNER_MODEL
    from agents.citation_test_agent.schema import QueryPlanOutput

    method = str(state.get("method") or "gemini")
    print(f"[CITATION_TEST] Stage 3 — Query Planner ({method})", flush=True)
    prompt = _fmt(QUERY_PLANNER_INSTRUCTION, state)
    result = _llm_json(
        prompt,
        QUERY_PLANNER_MODEL,
        method,
        schema=QueryPlanOutput,
        max_tokens=1024,
        operation="query_planner",
    )
    queries: List[str] = []
    if result and isinstance(result.get("queries"), list):
        queries = [q.strip() for q in result["queries"] if q and q.strip()]
    if not queries:
        # Fallback: derive from case_query + key terms from research questions
        base = state.get("case_query", "Indian court judgment")
        queries = [
            f'"{base}" site:indiankanoon.org',
            f'"{base}" site:sci.gov.in',
            f'"{base}" Indian court judgment',
        ]
    state["planned_queries"] = json.dumps(queries, ensure_ascii=False)
    print(f"[CITATION_TEST]   → {len(queries)} queries planned:", flush=True)
    for i, q in enumerate(queries, 1):
        print(f"[CITATION_TEST]     {i}. {q}", flush=True)
    return queries


def _normalize_hit(h: Any) -> Dict[str, str]:
    """Normalize Serper dict or SearchResult object to a plain source dict."""
    if isinstance(h, dict):
        return {
            "uri": str(h.get("uri") or ""),
            "title": str(h.get("title") or ""),
            "snippet": str(h.get("snippet") or ""),
            "authority_tier": str(h.get("authority_tier") or "T2"),
        }
    return {
        "uri": str(getattr(h, "uri", "") or ""),
        "title": str(getattr(h, "title", "") or ""),
        "snippet": str(getattr(h, "snippet", "") or ""),
        "authority_tier": str(getattr(h, "authority_tier", "") or "T2"),
    }


# ── Stage 4a: Gemini Search (IK direct + grounding query hints) ──────────────

def _ik_fetch_snippet(uri: str, chars: int = 1000) -> str:
    """
    Fetch judgment text from an indiankanoon.org doc page.
    Uses multiple extraction strategies to get the best text available.
    """
    import re as _re
    import httpx

    try:
        with httpx.Client(
            timeout=6.0,
            follow_redirects=True,
            headers={"User-Agent": "Mozilla/5.0 (compatible; legal-research/1.0)"},
        ) as c:
            resp = c.get(uri)
            if resp.status_code != 200:
                return ""
            html = resp.text
    except Exception:
        return ""

    # Strip scripts/styles first
    html = _re.sub(r'<(script|style)[^>]*>.*?</\1>', '', html, flags=_re.DOTALL | _re.IGNORECASE)

    # Strategy 1: IK stores judgment body in <div id="judgments"> or <div class="judgments">
    for pat in [
        r'<div[^>]+id=["\']judgments["\'][^>]*>(.*?)</div\s*>',
        r'<div[^>]+class=["\'][^"\']*judgment[^"\']*["\'][^>]*>(.*?)</div\s*>',
    ]:
        m = _re.search(pat, html, _re.DOTALL | _re.IGNORECASE)
        if m:
            text = _re.sub(r'<[^>]+>', ' ', m.group(1))
            text = _re.sub(r'\s+', ' ', text).strip()
            if len(text) > 200:
                return text[:chars]

    # Strategy 2: collect all <p> tags that look like judgment text (>80 chars)
    paragraphs = []
    for m in _re.finditer(r'<p[^>]*>(.*?)</p>', html, _re.DOTALL | _re.IGNORECASE):
        t = _re.sub(r'<[^>]+>', ' ', m.group(1))
        t = _re.sub(r'\s+', ' ', t).strip()
        if len(t) >= 80:
            paragraphs.append(t)
        if sum(len(x) for x in paragraphs) >= chars:
            break
    if paragraphs:
        return ' '.join(paragraphs)[:chars]

    # Strategy 3: strip all HTML and return body text
    text = _re.sub(r'<(nav|header|footer|script|style)[^>]*>.*?</\1>', '', html,
                   flags=_re.DOTALL | _re.IGNORECASE)
    text = _re.sub(r'<[^>]+>', ' ', text)
    text = _re.sub(r'\s+', ' ', text).strip()
    return text[:chars]


def _ik_enrich_snippets(hits: List[Dict[str, Any]], workers: int = 8) -> List[Dict[str, Any]]:
    """
    Parallel-fetch judgment text for IK results that have thin/missing snippets.
    Caps at first 10 thin results to keep wall-clock time under ~12s.
    """
    from concurrent.futures import ThreadPoolExecutor, as_completed

    to_fetch = [
        i for i, h in enumerate(hits)
        if len(h.get("snippet") or "") < 150 and "indiankanoon.org/doc/" in h.get("uri", "")
    ][:10]  # cap: 10 × 6s timeout / 8 workers ≈ ~8s wall-clock
    if not to_fetch:
        return hits

    enriched = [dict(h) for h in hits]

    def _fetch(idx: int):
        return idx, _ik_fetch_snippet(enriched[idx]["uri"])

    with ThreadPoolExecutor(max_workers=workers) as pool:
        futs = {pool.submit(_fetch, i): i for i in to_fetch}
        for fut in as_completed(futs, timeout=15):
            try:
                idx, snippet = fut.result()
                if snippet and len(snippet) > 100:
                    enriched[idx]["snippet"] = snippet
            except Exception:
                pass

    fetched = sum(1 for i in to_fetch if len(enriched[i].get("snippet") or "") > 100)
    logger.info("[IK_ENRICH] Enriched %d/%d results with judgment text", fetched, len(to_fetch))
    return enriched


def _ik_search(query: str, num: int = 8) -> List[Dict[str, Any]]:
    """
    Search indiankanoon.org directly and return judgment links with snippets.
    Strips Boolean operators / site: directives before sending the query.
    """
    import re as _re
    from urllib.parse import quote
    import httpx

    # Normalise: remove Boolean/site: syntax IK doesn't support
    clean = _re.sub(r'site:\S+', '', query)
    clean = _re.sub(r'\bAND\b|\bOR\b|\bNOT\b', ' ', clean, flags=_re.IGNORECASE)
    clean = _re.sub(r'["\(\)]', ' ', clean)
    clean = _re.sub(r'\s+', ' ', clean).strip()
    if not clean:
        clean = query[:120]

    search_url = f"https://indiankanoon.org/search/?formInput={quote(clean)}&pagenum=0"
    try:
        with httpx.Client(
            timeout=12.0,
            follow_redirects=True,
            headers={"User-Agent": "Mozilla/5.0 (compatible; legal-research/1.0)"},
        ) as c:
            resp = c.get(search_url)
            if resp.status_code != 200:
                logger.debug("[IK_SEARCH] HTTP %s for %r", resp.status_code, clean[:60])
                return []
            html = resp.text
    except Exception as exc:
        logger.warning("[IK_SEARCH] Request failed: %s", exc)
        return []

    hits: List[Dict[str, Any]] = []
    seen_ids: set = set()

    # IK search results have both the doc link AND a snippet paragraph nearby.
    # Try to extract snippet from the result block around each doc link.
    # Pattern: result block contains title anchor + court info + snippet text
    # We'll do a two-pass: first collect doc links + surrounding block text.
    blocks = _re.split(r'<div[^>]+class=["\'][^"\']*result[^"\']*["\']', html, flags=_re.IGNORECASE)
    for block in blocks:
        m_link = _re.search(r'href="/doc/(\d+)/[^"]*"[^>]*>(.*?)</a>', block, _re.DOTALL | _re.IGNORECASE)
        if not m_link:
            continue
        doc_id = m_link.group(1)
        if doc_id in seen_ids:
            continue
        seen_ids.add(doc_id)
        raw_title = m_link.group(2)
        title = _re.sub(r'<[^>]+>', '', raw_title).strip() or f"Judgment {doc_id}"

        # Try to extract snippet text from the result block
        snippet_text = _re.sub(r'<[^>]+>', ' ', block)
        snippet_text = _re.sub(r'\s+', ' ', snippet_text).strip()
        # Remove the title from the start to get the snippet portion
        if title in snippet_text:
            snippet_text = snippet_text[snippet_text.index(title) + len(title):].strip()
        snippet = snippet_text[:400] if len(snippet_text) > 20 else ""

        hits.append({
            "uri": f"https://indiankanoon.org/doc/{doc_id}/",
            "title": title,
            "snippet": snippet,
            "authority_tier": "T2",
        })
        if len(hits) >= num:
            break

    if not hits:
        # Fallback: simple doc link extraction without snippets
        for m in _re.finditer(r'<a[^>]+href="/doc/(\d+)/[^"]*"[^>]*>(.*?)</a>', html,
                               _re.DOTALL | _re.IGNORECASE):
            doc_id, raw_title = m.group(1), m.group(2)
            if doc_id in seen_ids:
                continue
            seen_ids.add(doc_id)
            title = _re.sub(r'<[^>]+>', '', raw_title).strip() or f"Judgment {doc_id}"
            hits.append({
                "uri": f"https://indiankanoon.org/doc/{doc_id}/",
                "title": title,
                "snippet": "",
                "authority_tier": "T2",
            })
            if len(hits) >= num:
                break

    if hits:
        logger.info("[IK_SEARCH] %d hits for %r", len(hits), clean[:60])
    else:
        logger.warning("[IK_SEARCH] 0 hits for %r", clean[:60])
    return hits


def _gemini_web_queries(query: str) -> List[str]:
    """
    Call Gemini once (with Google Search grounding) to get suggested web_search_queries.
    These are the short keyword queries Gemini would use to research the topic.
    Returns empty list on any failure — caller falls back to the original query.
    """
    import time as _t
    import re as _re
    from agents.citation_test_agent.domain_allowlist import tier_of

    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        return []
    try:
        from google import genai
        from google.genai import types
        client = genai.Client(api_key=api_key)
        cfg = types.GenerateContentConfig(
            tools=[types.Tool(google_search=types.GoogleSearch())],
            max_output_tokens=512,
            temperature=0.0,
        )
        for attempt in range(2):
            try:
                resp = client.models.generate_content(
                    model="gemini-2.5-flash",
                    contents=(
                        f"Briefly search for Indian court judgments on: {query[:300]}. "
                        f"Focus on indiankanoon.org results."
                    ),
                    config=cfg,
                )
                break
            except Exception as exc:
                msg = str(exc)
                if ("429" in msg or "RESOURCE_EXHAUSTED" in msg.upper()) and attempt == 0:
                    _t.sleep(5)
                    continue
                logger.debug("[GEMINI_QUERIES] Gemini call failed: %s", exc)
                return []

        collected_queries: List[str] = []
        collected_text_hits: List[Dict[str, Any]] = []

        for cand in (resp.candidates or []):
            # Extract any direct T1/T2 URLs from the text response
            text = "".join(getattr(p, "text", "") for p in (cand.content.parts or []))
            for url in _re.findall(r'https?://[^\s<>"]+', text):
                url = url.rstrip(".,;)")
                tier = tier_of(url)
                if tier in ("T1", "T2"):
                    collected_text_hits.append({
                        "uri": url, "title": url,
                        "snippet": "", "authority_tier": tier,
                    })

            gm = getattr(cand, "grounding_metadata", None)
            if not gm:
                continue
            sep = getattr(gm, "search_entry_point", None)
            if sep:
                collected_queries.extend(getattr(sep, "web_search_queries", None) or [])
            collected_queries.extend(getattr(gm, "web_search_queries", None) or [])

        # Store text hits on the function object so caller can use them
        _gemini_web_queries._last_text_hits = collected_text_hits
        return [q.strip() for q in collected_queries if q.strip()]

    except Exception as exc:
        logger.debug("[GEMINI_QUERIES] unexpected error: %s", exc)
        return []


def _gemini_grounding_search(query: str, num: int = 10) -> List[Dict[str, Any]]:
    """
    Gemini Google Search grounding — primary search for the Gemini pipeline.

    Key design:
    - Cloud Run IPs are blocked by indiankanoon.org → no direct HTTP scraping.
    - Gemini grounding CAN read IK pages; actual judgment text is in
      grounding_supports[i].segment.text — extracted and used as snippets.
    - vertexaisearch redirect URIs cannot be resolved from Cloud Run (IK blocks
      the redirect destination too), so we ACCEPT ALL grounding chunks that have
      any content — Gemini's grounding already ensures relevance to the legal query.
    - We try GET-based redirect resolution (not HEAD) for a cleaner final URL,
      but a failure does NOT drop the result.
    """
    import re as _re
    from agents.citation_test_agent.domain_allowlist import tier_of

    clean_q = _re.sub(r'\b(?:AND|OR|NOT)\b', ' ', query)
    clean_q = _re.sub(r'site:\S+', '', clean_q)
    clean_q = _re.sub(r'["\(\)]', ' ', clean_q)
    clean_q = _re.sub(r'\s+', ' ', clean_q).strip()
    if not clean_q:
        return []

    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        return []

    try:
        from google import genai
        from google.genai import types as _gtypes

        client = genai.Client(api_key=api_key)
        resp = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=(
                f"Search indiankanoon.org and Indian legal databases for court judgments on this topic.\n\n"
                f"Return judgments from ALL time periods — include:\n"
                f"  • Landmark Supreme Court / Constitution Bench cases from 1960–2000\n"
                f"  • Established High Court precedents from 2000–2010\n"
                f"  • Recent judgments from 2010–2024\n"
                f"Do NOT limit results to only recent judgments. Find as many distinct judgments as possible.\n\n"
                f"Query: {clean_q}"
            ),
            config=_gtypes.GenerateContentConfig(
                tools=[_gtypes.Tool(google_search=_gtypes.GoogleSearch())],
                temperature=0.0,
                max_output_tokens=3000,
            ),
        )
    except Exception as exc:
        logger.warning("[GEMINI_GROUNDING] call failed for %r: %s", clean_q[:60], exc)
        return []

    candidate = (resp.candidates or [None])[0]
    if not candidate:
        return []

    gm = getattr(candidate, "grounding_metadata", None)
    if not gm:
        logger.warning("[GEMINI_GROUNDING] no grounding_metadata for: %s", clean_q[:60])
        return []

    chunks   = list(getattr(gm, "grounding_chunks", None) or [])
    supports = list(getattr(gm, "grounding_supports", None) or [])

    if not chunks:
        logger.warning("[GEMINI_GROUNDING] 0 chunks for: %s", clean_q[:60])
        return []

    # ── 1. Build chunk_index → snippet text from grounding_supports ──────────
    chunk_texts: Dict[int, List[str]] = {}
    for sup in supports:
        txt = getattr(getattr(sup, "segment", None), "text", "") or ""
        if len(txt) > 30:
            for idx in (getattr(sup, "grounding_chunk_indices", []) or []):
                chunk_texts.setdefault(int(idx), []).append(txt)

    # ── 2. Also harvest URLs Gemini cited inline in its text response ─────────
    raw_text = "".join(
        getattr(p, "text", "") for p in (
            getattr(getattr(candidate, "content", None), "parts", []) or []
        )
    )
    inline_urls: List[str] = []
    for u in _re.findall(r'https?://[^\s<>\"\']+', raw_text):
        u = u.rstrip(".,;)>")
        if tier_of(u) in ("T1", "T2"):
            inline_urls.append(u)

    # ── 3. Try GET-based redirect resolution to get clean source URLs ─────────
    #    Failure = keep redirect URI; never drop a result over this.
    from concurrent.futures import ThreadPoolExecutor as _TPE, as_completed as _ac
    import httpx as _hx

    def _get_follow(uri: str) -> str:
        """Follow vertexaisearch redirect via GET to retrieve the actual source URL."""
        try:
            with _hx.Client(
                timeout=5.0,
                follow_redirects=True,
                headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"},
            ) as c:
                r = c.get(uri)
                return str(r.url)
        except Exception:
            return uri

    raw_uris = [
        (i, (getattr(ch, "web", None) and getattr(ch.web, "uri", "")) or "")
        for i, ch in enumerate(chunks)
    ]
    redirect_map: Dict[int, str] = {}
    if raw_uris:
        with _TPE(max_workers=min(len(raw_uris), 8)) as pool:
            futs = {pool.submit(_get_follow, u): i for i, u in raw_uris if u}
            for fut in _ac(futs, timeout=15):
                i = futs[fut]
                try:
                    redirect_map[i] = fut.result()
                except Exception:
                    pass

    # ── 4. Assemble hits — ACCEPT ALL chunks that have a title or snippet ─────
    #    Rationale: Gemini's grounding already filtered for relevance to the legal
    #    query. Dropping by domain kills IK results whose redirects resolve to IK
    #    pages blocked by Cloud Run. We keep everything and let the extractor judge.
    hits: List[Dict[str, Any]] = []
    seen: set = set()

    for i, chunk in enumerate(chunks):
        web = getattr(chunk, "web", None)
        if not web:
            continue

        redirect_uri = (getattr(web, "uri", "") or "")
        actual_uri   = redirect_map.get(i, redirect_uri)
        title        = (getattr(web, "title", "") or "")
        snippet      = " ".join(chunk_texts.get(i, []))[:1500]

        # Skip only truly empty results
        if not title and not snippet:
            continue

        # Tier: use resolved URL first; fall back to redirect URL; default T2
        tier = tier_of(actual_uri) or tier_of(redirect_uri) or "T2"

        # Use the cleaner URL for display; prefer resolved if different from redirect
        use_uri = actual_uri if (actual_uri and actual_uri != redirect_uri) else redirect_uri

        if use_uri in seen:
            continue
        seen.add(use_uri)

        hits.append({
            "uri":            use_uri,
            "title":          title,
            "snippet":        snippet,
            "authority_tier": tier,
        })
        if len(hits) >= num:
            break

    # Append inline-cited URLs not already in hits
    for url in inline_urls:
        if url not in seen and len(hits) < num:
            seen.add(url)
            hits.append({"uri": url, "title": url, "snippet": "", "authority_tier": tier_of(url) or "T2"})

    logger.info("[GEMINI_GROUNDING] %d/%d chunks kept for %r", len(hits), len(chunks), clean_q[:60])
    return hits


# ── Stage 4b: Serper Search ───────────────────────────────────────────────────

def _clean_for_serper(q: str) -> str:
    """Strip Boolean/site: syntax so Serper gets a plain keyword query."""
    import re
    # Remove site: operators
    q = re.sub(r'site:\S+', '', q)
    # Remove AND / OR operators
    q = re.sub(r'\bAND\b|\bOR\b', '', q)
    # Remove excess quotes and parens
    q = re.sub(r'[()"]', ' ', q)
    # Collapse whitespace
    return re.sub(r'\s+', ' ', q).strip()


def _serper_search(query: str, num: int = 5) -> List[Dict[str, Any]]:
    import os
    import httpx as _httpx
    from agents.citation_test_agent.domain_allowlist import tier_of
    serper_key = os.environ.get("SERPER_API_KEY", "")
    if not serper_key:
        logger.warning("[RUNNER] SERPER_API_KEY not set")
        return []
    try:
        with _httpx.Client(timeout=15.0) as c:
            resp = c.post(
                "https://google.serper.dev/search",
                headers={"X-API-KEY": serper_key, "Content-Type": "application/json"},
                json={"q": query, "num": num, "gl": "in", "hl": "en"},
            )
            if resp.status_code == 400 and "credits" in resp.text.lower():
                logger.error("[RUNNER] Serper API: Not enough credits")
                return [{"error": "credits_exhausted"}]
            resp.raise_for_status()
            data = resp.json()
    except Exception as exc:
        logger.warning("[RUNNER] Serper failed for %r: %s", query[:80], exc)
        return []
    results = []
    for hit in data.get("organic") or []:
        uri = str(hit.get("link") or "").strip()
        if not uri:
            continue
        tier = tier_of(uri)
        if tier in ("T1", "T2"):
            results.append({
                "uri": uri,
                "title": str(hit.get("title") or ""),
                "snippet": str(hit.get("snippet") or ""),
                "authority_tier": tier,
            })
    return results


def _build_serper_queries(planned_queries: List[str], case_query: str, case_analysis: str = "") -> List[str]:
    """
    Build an ordered, Serper-friendly query list optimised for finding similar-fact precedents.

    Priority order:
    1. site:indiankanoon.org + each planned query (direct similar-fact search)
    2. site:indiankanoon.org + case title seed (case-name search)
    3. Plain planned queries (Serper finds livelaw.in / barandbench.com naturally)
    4. site:livelaw.in and site:sci.gov.in fallbacks with key terms
    """
    import json as _json
    seen: set = set()
    result: List[str] = []

    def _add(q: str) -> None:
        q = q.strip()
        if q and len(q) > 5 and q not in seen:
            seen.add(q)
            result.append(q)

    # Extract key terms from case_analysis (dispute_nature, primary_statutes, parties)
    key_statute = ""
    dispute_type = ""
    try:
        if case_analysis and case_analysis != "{}":
            ca = _json.loads(case_analysis)
            statutes = ca.get("primary_statutes") or []
            if statutes:
                key_statute = str(statutes[0])[:60]
            dispute_type = str(ca.get("dispute_nature") or "")
    except Exception:
        pass

    # Priority 1: indiankanoon.org + each planned query (similar-fact precedent search)
    for pq in planned_queries:
        _add(f"site:indiankanoon.org {pq}")

    # Priority 2: indiankanoon.org + case title seed
    if case_query:
        short_seed = " ".join(case_query.split()[:8])
        _add(f"site:indiankanoon.org {short_seed} judgment")

    # Priority 3: statute-focused indiankanoon search
    if key_statute:
        _add(f"site:indiankanoon.org {key_statute} {dispute_type} judgment")

    # Priority 4: plain planned queries (Serper returns livelaw/barandbench organically)
    for pq in planned_queries:
        _add(pq)

    # Priority 5: livelaw.in + sci.gov.in with case seed
    if case_query:
        short_seed = " ".join(case_query.split()[:6])
        _add(f"site:livelaw.in {short_seed}")
        _add(f"site:sci.gov.in {short_seed}")

    return result


# ── Stage 5: Citation Extractor ───────────────────────────────────────────────

_EXTRACT_BATCH_SIZE = int(os.environ.get("CITATION_EXTRACT_BATCH_SIZE", "5"))
_EXTRACT_TIMEOUT = float(os.environ.get("CITATION_EXTRACT_TIMEOUT", "180"))


def _build_fact_brief(state: Dict[str, Any]) -> str:
    try:
        ca = json.loads(state.get("case_analysis", "{}") or "{}")
        parties = ca.get("parties", "")
        if isinstance(parties, dict):
            parties = f"{parties.get('petitioner', '')} vs {parties.get('respondent', '')}".strip(" vs")
        statutes = ca.get("primary_statutes") or []
        statute_str = ", ".join(statutes) if isinstance(statutes, list) else str(statutes)
        return (
            f"Parties: {parties}\n"
            f"Facts: {ca.get('case_fact_summary', '')}\n"
            f"Statutes: {statute_str}\n"
            f"Dispute: {ca.get('dispute_nature', '')}"
        )
    except Exception:
        return str(state.get("case_query", ""))


def _compact_sources(sources: list, max_snippet: int = 350) -> List[Dict[str, Any]]:
    compact = []
    for s in sources:
        if not isinstance(s, dict):
            continue
        uri = str(s.get("uri") or "").strip()
        if not uri:
            continue
        compact.append({
            "uri": uri,
            "title": str(s.get("title") or "")[:220],
            "snippet": str(s.get("snippet") or "")[:max_snippet],
            "authority_tier": str(s.get("authority_tier") or "T2"),
        })
    return compact


def _infer_court(uri: str, title: str) -> str:
    u = (uri or "").lower()
    t = (title or "").lower()
    if "sci.gov.in" in u or "supreme court of india" in t or " insc " in t:
        return "Supreme Court of India"
    if "bombayhighcourt" in u or "bombay high court" in t:
        return "Bombay High Court"
    if "delhihighcourt" in u or "delhi high court" in t:
        return "Delhi High Court"
    if "indiankanoon.org" in u:
        if "supreme court" in t or " sc " in t:
            return "Supreme Court of India"
        if "high court" in t:
            for hc in ("bombay", "delhi", "madras", "calcutta", "allahabad", "karnataka", "punjab"):
                if hc in t:
                    return f"{hc.title()} High Court"
    if ".gov.in" in u:
        return "Indian Court"
    return ""


def _infer_parties(title: str) -> str:
    title = (title or "").strip()
    if not title:
        return ""
    for sep in (" on ", " | ", " - LiveLaw", " - SCC", " - Bar & Bench"):
        if sep.lower() in title.lower():
            idx = title.lower().index(sep.lower())
            title = title[:idx].strip()
            break
    title = re.sub(r"^\[PDF\]\s*", "", title, flags=re.I).strip()
    return title


def _infer_year(title: str, uri: str) -> str:
    for text in (title, uri):
        m = re.search(r"\b(19|20)\d{2}\b", text or "")
        if m:
            return m.group(0)
    return ""


def _fallback_citations_from_sources(sources: list, state: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Build minimal citations from search metadata when LLM extraction fails."""
    fact_brief = _build_fact_brief(state)
    citations: List[Dict[str, Any]] = []
    seen: set = set()
    for s in _compact_sources(sources):
        uri = s["uri"]
        if uri in seen:
            continue
        seen.add(uri)
        title = s.get("title") or ""
        parties = _infer_parties(title)
        if not parties and not title:
            continue
        court = _infer_court(uri, title)
        snippet = s.get("snippet") or ""
        citations.append({
            "parties": parties or title[:120],
            "court": court,
            "bench": "",
            "year": _infer_year(title, uri),
            "citation_no": "",
            "facts_of_precedent": snippet[:500] if snippet else title,
            "legal_issue": "",
            "ratio": snippet[:400] if snippet else "",
            "key_principle": "",
            "key_quote": "",
            "factual_similarity": "",
            "our_argument": "",
            "distinguishing_notes": "",
            "how_helps": f"Potential precedent related to: {fact_brief[:200]}",
            "source_url": uri,
            "authority_tier": s.get("authority_tier") or "T2",
            "authority_weight": "BINDING" if court == "Supreme Court of India" else "PERSUASIVE",
            "confidence": "MEDIUM" if snippet else "LOW",
        })
    return citations


def _build_extract_prompt(state: Dict[str, Any], sources: List[Dict[str, Any]]) -> str:
    sources_json = json.dumps(sources, ensure_ascii=False)
    return (
        "You are a senior Indian law advocate with 20 years of litigation experience.\n"
        "Your task: extract and fully analyse each judgment in the search results as a usable court citation.\n\n"
        "━━━ OUR CLIENT'S CASE ━━━\n"
        f"{_build_fact_brief(state)}\n\n"
        "━━━ RESEARCH QUESTIONS ━━━\n"
        f"{str(state.get('research_questions', '[]'))[:800]}\n\n"
        "━━━ SEARCH RESULTS (T1/T2 sources only) ━━━\n"
        f"{sources_json}\n\n"
        "━━━ INSTRUCTIONS ━━━\n"
        "Extract EVERY result that is an Indian court judgment. For each one, fill ALL fields below.\n"
        "Use the snippet text, page title, and URL as your primary source.\n"
        "Where snippet is thin, use your legal knowledge of the case to enrich the fields — but NEVER invent a citation number or URL.\n\n"
        "FIELD GUIDE (fill every field — do not leave blank):\n"
        "  parties          → 'Petitioner Name vs Respondent Name' — from title or snippet\n"
        "  court            → Full court name: 'Supreme Court of India', 'Bombay High Court', etc. — infer from URL domain\n"
        "  bench            → Judge names if visible in snippet, else ''\n"
        "  year             → 4-digit year from title/snippet/URL — infer if clear, else ''\n"
        "  citation_no      → Official citation like '(2019) 5 SCC 162' — ONLY if present in snippet/title, else ''\n"
        "  facts_of_precedent → 2-3 sentences on the facts of THAT case (not our client's case)\n"
        "  legal_issue      → The precise legal question that court decided — 1 sentence\n"
        "  ratio            → The court's actual ruling/holding — 2-3 sentences. Use snippet text directly where available.\n"
        "  key_principle    → Single sentence: the legal rule this case establishes\n"
        "  key_quote        → Best verbatim quote from the snippet (max 60 words). If no quote available, use ''\n"
        "  factual_similarity → Bullet points (3-5) explaining HOW the facts of this precedent match our client's case\n"
        "  our_argument     → 2-3 sentences: exactly HOW a lawyer should cite this case in court to help our client\n"
        "  distinguishing_notes → If the opposing side could distinguish this case, note it here; else ''\n"
        "  authority_weight → BINDING (Supreme Court of India) | PERSUASIVE (High Court same jurisdiction) | PERSUASIVE_OTHER (other HC) | TRIBUNAL\n"
        "  source_url       → Exact URI from the search result — do NOT modify\n"
        "  authority_tier   → T1 (gov.in/nic.in) | T2 (indiankanoon.org, livelaw.in, etc.)\n"
        "  confidence       → HIGH (clear judgment, strong match) | MEDIUM (partial match or thin snippet)\n\n"
        "STRICT RULES:\n"
        "- Include EVERY indiankanoon.org/doc/ URL — each is a real judgment\n"
        "- NEVER skip a result because fields are incomplete — fill what you can, use '' for truly unknown fields\n"
        "- factual_similarity and our_argument MUST relate specifically to our client's case facts above\n"
        "- source_url must exactly match the uri in the search result\n\n"
        'Return ONLY valid JSON — no markdown, no explanation:\n{"citations": [{ all fields above }, ...]}'
    )


def _extract_batch_llm(state: Dict[str, Any], batch: List[Dict[str, Any]], method: str) -> List[Dict[str, Any]]:
    from agents.citation_test_agent.prompts import CLAUDE_UPSTREAM_MODEL

    prompt = _build_extract_prompt(state, batch)
    gemini_model = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")
    claude_model = os.environ.get("CLAUDE_MODEL", "claude-sonnet-4-6")
    method = (method or "gemini").lower().strip()

    attempts: List[tuple] = []
    if method == "claude":
        attempts = [("claude", claude_model), ("gemini", gemini_model)]
    else:
        attempts = [("gemini", gemini_model), ("claude", claude_model)]

    for provider, model in attempts:
        raw: Optional[str] = None
        if provider == "claude":
            raw = _claude_call(prompt, model, max_tokens=8192, timeout=_EXTRACT_TIMEOUT)
        else:
            raw = _gemini_call(prompt, model, max_tokens=8192, json_mode=True)
        citations = _parse_citations(raw)
        if citations:
            logger.info("[RUNNER] Extracted %d citations from batch of %d via %s", len(citations), len(batch), provider)
            return citations
        if raw:
            logger.warning("[RUNNER] %s batch parse returned 0 citations (preview: %s)", provider, raw[:200])
        else:
            logger.warning("[RUNNER] %s batch extraction returned empty response", provider)
    return []


def _merge_citations(existing: List[Dict[str, Any]], new: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    seen = {c.get("source_url") for c in existing if c.get("source_url")}
    merged = list(existing)
    for c in new:
        url = c.get("source_url") or ""
        if url and url in seen:
            continue
        if url:
            seen.add(url)
        merged.append(c)
    return merged


def _run_extractor(state: Dict[str, Any], sources: list, method: str) -> List[Dict[str, Any]]:
    compact = _compact_sources(sources)
    if not compact:
        return []

    all_citations: List[Dict[str, Any]] = []
    batch_size = max(1, _EXTRACT_BATCH_SIZE)
    batches = [compact[i:i + batch_size] for i in range(0, len(compact), batch_size)]
    print(f"[CITATION_TEST]   → Extracting from {len(compact)} sources in {len(batches)} batch(es)", flush=True)

    for i, batch in enumerate(batches, 1):
        print(f"[CITATION_TEST]     batch {i}/{len(batches)} ({len(batch)} sources)", flush=True)
        batch_citations = _extract_batch_llm(state, batch, method)
        all_citations = _merge_citations(all_citations, batch_citations)

    if not all_citations:
        logger.warning("[RUNNER] LLM extraction failed for all batches — using metadata fallback")
        all_citations = _fallback_citations_from_sources(compact, state)
        if all_citations:
            print(f"[CITATION_TEST]   → Fallback extracted {len(all_citations)} citation(s) from titles/URLs", flush=True)

    return all_citations


def _parse_citations(raw: Optional[str]) -> List[Dict[str, Any]]:
    if not raw:
        return []
    result = _parse_json(raw)
    if not result:
        return []
    raw_list = result.get("citations") if isinstance(result, dict) else (result if isinstance(result, list) else [])
    if not isinstance(raw_list, list):
        return []
    citations = []
    for c in raw_list:
        if not isinstance(c, dict):
            continue
        if str(c.get("authority_tier", "")).upper() == "T3":
            continue
        source_url = str(c.get("source_url") or c.get("uri") or c.get("url") or "")
        parties = str(c.get("parties") or "")
        if not parties and not source_url:
            continue
        citations.append({
            "parties":               parties,
            "court":                 str(c.get("court") or ""),
            "bench":                 str(c.get("bench") or ""),
            "year":                  str(c.get("year") or ""),
            "citation_no":           str(c.get("citation_no") or ""),
            "facts_of_precedent":    str(c.get("facts_of_precedent") or ""),
            "legal_issue":           str(c.get("legal_issue") or ""),
            "ratio":                 str(c.get("ratio") or ""),
            "key_principle":         str(c.get("key_principle") or ""),
            "key_quote":             str(c.get("key_quote") or ""),
            "factual_similarity":    str(c.get("factual_similarity") or ""),
            "our_argument":          str(c.get("our_argument") or ""),
            "distinguishing_notes":  str(c.get("distinguishing_notes") or ""),
            "how_helps":             str(c.get("how_helps") or ""),
            "source_url":            source_url,
            "authority_tier":        str(c.get("authority_tier") or "T2"),
            "authority_weight":      str(c.get("authority_weight") or "PERSUASIVE").upper(),
            "confidence":            str(c.get("confidence") or "MEDIUM").upper(),
        })
    return citations


# ── Main orchestrator ─────────────────────────────────────────────────────────

def run_test_pipeline(state: Dict[str, Any]) -> Dict[str, Any]:
    """
    Full 1-iteration pipeline.

    state keys:
      - case_context : str  — combined text from case documents (fetched by main.py)
      - case_query   : str  — auto-derived from case title if not provided
      - method       : str  — "gemini" | "claude"
      - run_id       : str  — optional
    """
    method = str(state.get("method") or "gemini").lower().strip()
    case_query = str(state.get("case_query") or "").strip()
    case_context = str(state.get("case_context") or "").strip()

    if not case_context and not case_query:
        state["error"] = "No case context or query available"
        return state

    # ── Cache check: same case + method → return cached result immediately ───
    _ck = _cache_key(str(state.get("case_id") or ""), case_query, method)
    cached = _cache_get(_ck)
    if cached:
        logger.info("[RUNNER] Cache hit for key=%s — returning %d cached citations", _ck[:8], len(cached["citations"]))
        state["citations"]      = cached["citations"]
        state["search_results"] = cached["search_results"]
        state["gaps"]           = cached["gaps"]
        state["method_used"]    = method
        state["elapsed_seconds"] = 0.0
        state["from_cache"]     = True
        return state

    # Use case title as the research query if not explicitly provided
    if not case_query and case_context:
        # Extract first line as seed query
        first_line = case_context.split("\n")[0].replace("Case Title:", "").strip()
        case_query = first_line or "Indian court judgment research"
        state["case_query"] = case_query

    print(f"\n[CITATION_TEST] ═══ Starting pipeline method={method} ═══", flush=True)
    print(f"[CITATION_TEST] Query seed: {case_query[:100]}", flush=True)
    print(f"[CITATION_TEST] Context length: {len(case_context)} chars", flush=True)
    start = time.time()

    # Stage 1: Case Analyzer
    _run_case_analyzer(state)

    # Stage 2: Research Decomposer
    _run_research_decomposer(state)

    # Stage 3: Query Planner → same Boolean queries as citation-service
    queries = _run_query_planner(state)

    # Stage 4: Search (Gemini Grounding or Serper)
    print(f"[CITATION_TEST] Stage 4 — Search ({method.upper()})", flush=True)
    all_sources: list = []
    seen_uris: set = set()
    search_error = ""

    if method == "gemini":
        # 5 parallel Gemini grounding calls for maximum citation coverage:
        #   Slots 1-3 : top planned queries (mix of recent + any-era)
        #   Slot 4    : landmark/pre-2006 Supreme Court query
        #   Slot 5    : broad fact-pattern query with different vocabulary
        from concurrent.futures import ThreadPoolExecutor as _TPE, as_completed as _ac
        import re as _re3

        top_queries = [q for q in queries[:3] if q.strip()]

        # Landmark query — forces old SC/HC cases into results
        issue_text = state.get("issue") or case_query
        _stop = {'the','a','an','is','are','was','were','of','for','in','on','at','to','and','or','with','by','that','this','have','had','has','been','its'}
        _kw_tokens = [w for w in _re3.findall(r'[a-zA-Z]{4,}', issue_text.lower()) if w not in _stop]
        _kw = ' '.join(list(dict.fromkeys(_kw_tokens))[:5])  # first 5 unique keywords, order-preserved
        landmark_query  = f"Supreme Court India landmark judgment {_kw} 1970 1980 1990 2000 2005"

        # Broad fact-pattern query using queries[3] or queries[4] for different vocabulary
        broad_query = queries[3].strip() if len(queries) > 3 and queries[3].strip() else (
            f"High Court India judgment {_kw} stamp duty revenue"
        )

        grounding_queries = top_queries + [landmark_query, broad_query]
        print(f"[CITATION_TEST]   → {len(grounding_queries)} grounding queries (parallel)", flush=True)
        for i, gq in enumerate(grounding_queries, 1):
            print(f"[CITATION_TEST]     G{i}. {gq[:90]}", flush=True)

        all_hits_ordered: List[Dict[str, Any]] = []
        with _TPE(max_workers=5) as pool:
            futs = {pool.submit(_gemini_grounding_search, q, 10): q for q in grounding_queries}
            for fut in _ac(futs, timeout=60):
                try:
                    for h in (fut.result() or []):
                        all_hits_ordered.append(_normalize_hit(h))
                except Exception as exc:
                    logger.warning("[RUNNER] Grounding query failed: %s", exc)

        for hit in all_hits_ordered:
            uri = hit["uri"]
            if uri and uri not in seen_uris:
                seen_uris.add(uri)
                all_sources.append(hit)
                if len(all_sources) >= 30:
                    break
    else:
        # Build Serper-friendly queries: indiankanoon.org first, then cleaned Boolean queries
        serper_queries = _build_serper_queries(queries, case_query, state.get("case_analysis", "{}"))
        print(f"[CITATION_TEST]   → {len(serper_queries)} Serper queries (indiankanoon-first):", flush=True)
        for i, sq in enumerate(serper_queries[:12], 1):
            print(f"[CITATION_TEST]     {i}. {sq}", flush=True)
        # Run Serper searches in parallel
        from concurrent.futures import ThreadPoolExecutor as _TPE2, as_completed as _ac2
        serper_hits: List[Dict[str, Any]] = []
        with _TPE2(max_workers=6) as pool:
            futs = {pool.submit(_serper_search, q, 5): q for q in serper_queries[:8]}
            for fut in _ac2(futs, timeout=30):
                try:
                    serper_hits.extend(fut.result() or [])
                except Exception:
                    pass
        for h in serper_hits:
            if isinstance(h, dict) and h.get("error") == "credits_exhausted":
                search_error = "Search API (Serper) credits exhausted. Please top up your credits."
                continue
            if h.get("uri") and h["uri"] not in seen_uris:
                seen_uris.add(h["uri"])
                all_sources.append(h)
                if len(all_sources) >= 20:
                    break

    print(f"[CITATION_TEST]   → {len(all_sources)} T1/T2 sources found", flush=True)

    # Gemini: grounding already provides snippet text — no extra IK fetches needed
    # Claude/Serper: results have snippets from Serper API

    state["search_results"] = all_sources

    # Stage 5: Citation Extractor
    print("[CITATION_TEST] Stage 5 — Citation Extractor", flush=True)
    citations: List[Dict[str, Any]] = []
    if all_sources:
        citations = _run_extractor(state, all_sources, method)
        # Post-fill: patch any citation that still has empty key fields from source metadata
        src_by_url = {s.get("uri") or s.get("source_url") or "": s for s in all_sources}
        for c in citations:
            src = src_by_url.get(c.get("source_url") or "")
            if not src:
                continue
            snippet = str(src.get("snippet") or "")
            title   = str(src.get("title") or "")
            if not c.get("parties") and title:
                c["parties"] = _infer_parties(title) or title[:120]
            if not c.get("ratio") and snippet:
                c["ratio"] = snippet[:400]
            if not c.get("facts_of_precedent") and snippet:
                c["facts_of_precedent"] = snippet[:500]
            if not c.get("key_principle") and snippet:
                c["key_principle"] = snippet[:200]
            if not c.get("court"):
                c["court"] = _infer_court(c.get("source_url") or "", title)
            if not c.get("year"):
                c["year"] = _infer_year(title, c.get("source_url") or "")
            if not c.get("authority_weight"):
                c["authority_weight"] = "BINDING" if c.get("court") == "Supreme Court of India" else "PERSUASIVE"
    print(f"[CITATION_TEST]   → {len(citations)} citation(s) extracted", flush=True)

    elapsed = round(time.time() - start, 2)
    state["citations"] = citations
    
    if not citations:
        if search_error:
            state["gaps"] = [search_error]
        elif not all_sources:
            state["gaps"] = ["No T1/T2 sources found via Google Grounding" if method == "gemini" else "No T1/T2 sources found via Serper"]
        else:
            state["gaps"] = ["Could not extract structured citations from sources"]
    else:
        state["gaps"] = []
    
    state["method_used"] = method
    state["elapsed_seconds"] = elapsed

    # ── Cache result so the same case returns the same judgments next time ───
    if citations:
        _cache_set(_ck, citations, all_sources, state.get("gaps") or [])
        logger.info("[RUNNER] Cached %d citations for key=%s (TTL=%ds)", len(citations), _ck[:8], _CACHE_TTL_SECONDS)

    print(f"[CITATION_TEST] ═══ Done — {len(citations)} citations in {elapsed}s ═══\n", flush=True)
    return state
