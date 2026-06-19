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
            config_kwargs: Dict[str, Any] = {"temperature": 0.1, "max_output_tokens": max_tokens}
            if json_mode:
                config_kwargs["response_mime_type"] = "application/json"
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
        max_tokens=4096,
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
        max_tokens=4096,
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
        max_tokens=4096,
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


# ── Stage 4a: Gemini Search (Google Grounding) ───────────────────────────────

def _gemini_grounding_search(query: str, num: int = 5):
    """
    Gemini 2.5 Flash grounding returns web_search_queries (not grounding_chunks).
    Strategy: use Gemini to generate optimised search queries, then execute via Serper.
    This is the correct approach for google-genai SDK >= 2.5.
    """
    import os, re, time as _t
    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        return _serper_search(f"site:indiankanoon.org {query}", num=num)

    # Step 1: ask Gemini to produce the best search queries via grounding
    web_queries: List[str] = []
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
                        f"Find Indian court judgments relevant to: {query}. "
                        f"Focus on indiankanoon.org, sci.gov.in, livelaw.in results."
                    ),
                    config=cfg,
                )
                # Extract web_search_queries from search_entry_point
                for cand in (resp.candidates or []):
                    gm = getattr(cand, "grounding_metadata", None)
                    if not gm:
                        continue
                    sep = getattr(gm, "search_entry_point", None)
                    if sep:
                        wq = getattr(sep, "web_search_queries", None) or []
                        web_queries.extend(wq)
                    # Also try top-level web_search_queries
                    wq2 = getattr(gm, "web_search_queries", None) or []
                    web_queries.extend(wq2)
                break
            except Exception as exc:
                msg = str(exc)
                if ("429" in msg or "RESOURCE_EXHAUSTED" in msg.upper()) and attempt == 0:
                    _t.sleep(5)
                    continue
                logger.warning("[GROUNDING] Gemini query generation failed: %s", exc)
                break
    except Exception as exc:
        logger.warning("[GROUNDING] client error: %s", exc)

    # Deduplicate and add original query as fallback
    seen: set = set()
    final_queries: List[str] = []
    for q in (web_queries + [query]):
        q = q.strip()
        if q and q not in seen:
            seen.add(q)
            final_queries.append(q)

    logger.info("[GROUNDING] web_search_queries from Gemini: %s", final_queries)

    # Step 2: execute each query via Serper with indiankanoon.org priority
    all_results: list = []
    seen_uris: set = set()

    def _add(hits):
        for h in hits:
            uri = h["uri"] if isinstance(h, dict) else h.uri
            if uri not in seen_uris:
                seen_uris.add(uri)
                all_results.append(h)

    for q in final_queries[:5]:
        _add(_serper_search(f"site:indiankanoon.org {q}", num=5))
        if len(all_results) >= num:
            break

    # If still short, try livelaw and plain queries
    if len(all_results) < num:
        for q in final_queries[:3]:
            _add(_serper_search(f"site:livelaw.in {q}", num=3))
            _add(_serper_search(q, num=5))
            if len(all_results) >= num:
                break

    logger.info("[GROUNDING] %d T1/T2 results found via Gemini+Serper", len(all_results))
    return all_results[:num]


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
        "You are a legal citation extraction specialist for Indian law.\n\n"
        f"OUR CLIENT'S CASE:\n{_build_fact_brief(state)}\n\n"
        f"Research questions:\n{str(state.get('research_questions', '[]'))[:600]}\n\n"
        f"SEARCH RESULTS:\n{sources_json}\n\n"
        "Extract ALL Indian court judgment candidates from these results (T1/T2 only).\n"
        "Rules:\n"
        "- INCLUDE every indiankanoon.org/doc/ and sci.gov.in result — they are real judgments\n"
        "- Set parties from the page title if needed (e.g. 'A vs B')\n"
        "- Infer court from URL domain when not explicit\n"
        "- NEVER skip a result because ratio is missing — use snippet or title instead\n"
        "- Do NOT fabricate citation numbers not present in title/snippet/URL\n"
        "- source_url must match the result uri exactly\n\n"
        "For each citation return: parties, court, bench, year, citation_no, facts_of_precedent, "
        "legal_issue, ratio, key_principle, key_quote, factual_similarity, our_argument, "
        "distinguishing_notes, authority_weight (BINDING/PERSUASIVE/PERSUASIVE_OTHER/TRIBUNAL), "
        "source_url, authority_tier, confidence (HIGH/MEDIUM).\n\n"
        'Return ONLY JSON: {"citations": [{...}, ...]}'
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

    if method == "gemini":
        for q in queries[:9]:
            hits = _gemini_grounding_search(q, num=4)
            for h in hits:
                hit = _normalize_hit(h)
                uri = hit["uri"]
                if uri and uri not in seen_uris:
                    seen_uris.add(uri)
                    all_sources.append(hit)
    else:
        # Build Serper-friendly queries: indiankanoon.org first, then cleaned Boolean queries
        serper_queries = _build_serper_queries(queries, case_query, state.get("case_analysis", "{}"))
        print(f"[CITATION_TEST]   → {len(serper_queries)} Serper queries (indiankanoon-first):", flush=True)
        for i, sq in enumerate(serper_queries[:12], 1):
            print(f"[CITATION_TEST]     {i}. {sq}", flush=True)
        for q in serper_queries[:12]:
            hits = _serper_search(q, num=5)
            for h in hits:
                if h["uri"] not in seen_uris:
                    seen_uris.add(h["uri"])
                    all_sources.append(h)
            if len(all_sources) >= 20:
                break

    print(f"[CITATION_TEST]   → {len(all_sources)} T1/T2 sources found", flush=True)
    state["search_results"] = all_sources

    # Stage 5: Citation Extractor
    print("[CITATION_TEST] Stage 5 — Citation Extractor", flush=True)
    citations: List[Dict[str, Any]] = []
    if all_sources:
        citations = _run_extractor(state, all_sources, method)
    print(f"[CITATION_TEST]   → {len(citations)} citation(s) extracted", flush=True)

    elapsed = round(time.time() - start, 2)
    state["citations"] = citations
    state["gaps"] = [] if citations else ["No T1/T2 sources found" if not all_sources else "Could not extract structured citations"]
    state["method_used"] = method
    state["elapsed_seconds"] = elapsed

    print(f"[CITATION_TEST] ═══ Done — {len(citations)} citations in {elapsed}s ═══\n", flush=True)
    return state
