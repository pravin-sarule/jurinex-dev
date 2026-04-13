"""
Watchdog agent: find relevant judgements from (1) local DB, (2) Indian Kanoon API, (3) Google.

Dimension-aware multi-query logic (JuriNex Spec v1.1.1):
  - Iterates Legal Dimensions from AgentContext (3 queries each: SC / HC / Provision)
  - Runs IK searches in batches of 5 with a 200 ms stagger to avoid IP-rate-limiting
  - Applies hierarchy pre-filter: drops District Courts, Tribunals, Consumer Forums
  - Applies jurisdiction priority ranking: SC > same-state HC > other HC
  - Global deduplication by tid / external_id across all dimension queries
"""

from __future__ import annotations

import json
import logging
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

SEARCH_WORKERS          = max(1, min(10, int(os.environ.get("CITATION_WATCHDOG_WORKERS", "6"))))
IK_BATCH_SIZE           = max(1, int(os.environ.get("CITATION_IK_BATCH_SIZE", "5")))
IK_BATCH_STAGGER_SECS   = float(os.environ.get("CITATION_IK_BATCH_STAGGER_MS", "200")) / 1000.0

# ── Hierarchy filter ──────────────────────────────────────────────────────────
# docsource substrings that identify low-hierarchy courts/bodies to be dropped
_LOW_HIERARCHY_KEYWORDS: frozenset = frozenset({
    "district court", "district judge", "munsiff", "civil judge",
    "sessions court", "judicial magistrate", "executive magistrate",
    "tribunal", "consumer forum", "consumer court", "consumer commission",
    "labour court", "industrial tribunal", "armed forces tribunal",
    "drt", "drat",          # Debt Recovery Tribunal / Appellate
    "sat",                  # Securities Appellate Tribunal
    "itat",                 # Income Tax Appellate Tribunal
    "cestat",               # Customs Excise & Service Tax Appellate Tribunal
    "ngt", "ngtt",          # National Green Tribunal
    "aat",                  # Airports Authority of India Tribunal
})


def _db_log(
    run_id: Optional[str],
    agent: str,
    stage: str,
    level: str,
    msg: str,
    meta: Optional[Dict] = None,
) -> None:
    if not run_id:
        return
    try:
        from db.client import agent_log_insert
        agent_log_insert(run_id, None, agent, stage, level, msg, meta)
    except Exception:
        pass


def _is_low_hierarchy(docsource: str) -> bool:
    """True when the result comes from a District Court, Tribunal, or similar low-level body."""
    ds = (docsource or "").lower()
    return any(kw in ds for kw in _LOW_HIERARCHY_KEYWORDS)


# State → canonical HC name (lower-case for matching)
_STATE_TO_HC_LOWER: Dict[str, str] = {
    "andhra pradesh":   "andhra pradesh high court",
    "telangana":        "telangana high court",
    "delhi":            "delhi high court",
    "gujarat":          "gujarat high court",
    "karnataka":        "karnataka high court",
    "kerala":           "kerala high court",
    "madhya pradesh":   "madhya pradesh high court",
    "maharashtra":      "bombay high court",
    "goa":              "bombay high court",
    "punjab":           "punjab and haryana high court",
    "haryana":          "punjab and haryana high court",
    "rajasthan":        "rajasthan high court",
    "tamil nadu":       "madras high court",
    "uttar pradesh":    "allahabad high court",
    "west bengal":      "calcutta high court",
    "odisha":           "orissa high court",
    "assam":            "gauhati high court",
    "himachal pradesh": "himachal pradesh high court",
    "uttarakhand":      "uttarakhand high court",
    "chhattisgarh":     "chhattisgarh high court",
    "jharkhand":        "jharkhand high court",
    "jammu":            "jammu and kashmir high court",
    "kashmir":          "jammu and kashmir high court",
    "sikkim":           "sikkim high court",
    "meghalaya":        "meghalaya high court",
    "manipur":          "manipur high court",
    "tripura":          "tripura high court",
}


def _jurisdiction_priority(candidate: Dict[str, Any], case_state: str) -> int:
    """
    Returns a priority score (higher = better) for post-search ranking.

      3  Supreme Court
      2  Same-state High Court (resolved via _STATE_TO_HC_LOWER mapping)
      1  Other High Court
      0  Unknown / already filtered
    """
    ds = (candidate.get("docsource") or "").lower()
    if not ds:
        return 0
    if "supreme court" in ds:
        return 3
    state = (case_state or "").lower().strip()
    if state:
        # Direct substring match (e.g. "delhi" in "delhi high court")
        if state in ds:
            return 2
        # Mapped HC name match (e.g. "maharashtra" → "bombay high court")
        hc = _STATE_TO_HC_LOWER.get(state, "")
        if hc and hc in ds:
            return 2
    if "high court" in ds:
        return 1
    return 0


# ── Local DB ──────────────────────────────────────────────────────────────────

def _search_local(
    query: str,
    limit: int = 10,
    run_id: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Search local DB (judgements table)."""
    try:
        from db.client import judgement_search_local
        _db_log(run_id, "watchdog", "watchdog", "INFO", f"🏛 Searching Local DB for: {query[:80]!r}")
        rows = judgement_search_local(query, limit=limit)
        for r in rows:
            r["_source"] = "local"
        logger.info("[WATCHDOG] 🏛  SOURCE=local_db → %d result(s) for query: %r", len(rows), query[:80])
        for r in rows:
            logger.info(
                "  ├─ [LOCAL_DB]  title=%-55s | citation=%-25s | court=%s",
                (r.get("title") or "?")[:55],
                (r.get("primary_citation") or "—")[:25],
                (r.get("court") or "?")[:30],
            )
        titles = [r.get("title") or "?" for r in rows[:5]]
        title_str = ", ".join(t[:50] for t in titles) + (f" … +{len(rows) - 5} more" if len(rows) > 5 else "")
        _db_log(run_id, "watchdog", "watchdog", "INFO",
                f"🏛 Local DB → {len(rows)} judgment(s)" + (f": {title_str}" if rows else ""),
                {"source": "local_db", "count": len(rows), "titles": titles})
        return rows
    except Exception as e:
        logger.warning("Local search failed: %s", e)
        _db_log(run_id, "watchdog", "watchdog", "WARNING", f"🏛 Local DB search failed: {e}")
        return []


# ── Indian Kanoon search ──────────────────────────────────────────────────────

def _get_ik_token() -> Optional[str]:
    return (
        os.environ.get("INDIAN_KANOON_TOKEN")
        or os.environ.get("INDIAN_KANOON_API_TOKEN")
        or os.environ.get("IK_API_TOKEN")
    )


def _search_indian_kanoon(
    query: str,
    limit: int = 10,
    run_id: Optional[str] = None,
    user_id: Optional[str] = None,
    dimension_id: Any = None,
    dimension_name: str = "",
    query_type: str = "keyword",
) -> List[Dict[str, Any]]:
    """
    Call IK /search/ API for one query.
    Tags each result with _dimension_id, _dimension_name, _query_type for traceability.
    Returns list of candidate dicts.
    """
    token = _get_ik_token()
    if not token:
        logger.warning("[WATCHDOG] INDIAN_KANOON_TOKEN not set; skipping IK search.")
        _db_log(run_id, "watchdog", "watchdog", "WARNING", "📚 Indian Kanoon skipped — token not configured")
        return []

    try:
        _db_log(run_id, "watchdog", "watchdog", "INFO",
                f"📚 IK [{query_type}|dim={dimension_id}] {query[:80]!r}")
        url = ("https://api.indiankanoon.org/search/?formInput="
               + urllib.parse.quote(query) + "&pagenum=0")
        req = urllib.request.Request(url, method="POST")
        req.add_header("Authorization", f"Token {token}")
        req.add_header("Accept", "application/json")
        req.add_header("User-Agent", "Mozilla/5.0 (compatible; JurinexCitation/1.0)")
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = json.loads(resp.read().decode("utf-8", errors="replace"))
        except urllib.error.HTTPError as e:
            body = ""
            try:
                body = e.read().decode("utf-8", errors="replace")[:200]
            except Exception:
                pass
            logger.warning("[WATCHDOG] IK HTTP %s for %r: %s", getattr(e, "code", "?"), query[:80], body)
            _db_log(run_id, "watchdog", "watchdog", "WARNING",
                    f"📚 IK HTTP {getattr(e, 'code', '?')} — {body[:100]}")
            return []

        docs = data.get("docs") or data.get("results") or []
        out: List[Dict[str, Any]] = []
        for d in docs[:limit]:
            out.append({
                "external_id":      str(d.get("tid", "")),
                "title":            d.get("title", ""),
                "snippet":          d.get("headline", ""),
                "docsource":        d.get("docsource", ""),
                "_source":          "indian_kanoon",
                "_dimension_id":    dimension_id,
                "_dimension_name":  dimension_name,
                "_query_type":      query_type,
                "_query":           query,
            })
        logger.info("[WATCHDOG] 📚 IK [%s|dim=%s] → %d result(s) for %r",
                    query_type, dimension_id, len(out), query[:60])
        for c in out:
            _db_log(run_id, "watchdog", "watchdog", "INFO",
                    f"  📚 {c.get('title','?')[:70]} | tid={c.get('external_id','?')} | {c.get('docsource','?')[:25]}",
                    {"source": "indian_kanoon", "tid": c.get("external_id"), "title": c.get("title"),
                     "dimension_id": dimension_id, "query_type": query_type})
        try:
            from utils.usage_tracker import record_ik
            record_ik(run_id, user_id or "anonymous", "search", count=1)
        except Exception:
            pass
        return out
    except Exception as e:
        logger.warning("[WATCHDOG] IK search failed for %r: %s", query[:60], e)
        _db_log(run_id, "watchdog", "watchdog", "WARNING", f"📚 IK search failed: {e}")
        return []


# ── Google search ─────────────────────────────────────────────────────────────

def _use_serper_for_google_search() -> bool:
    provider = (os.environ.get("WATCHDOG_GOOGLE_SEARCH_PROVIDER") or "google_grounding").strip().lower()
    use_claude = (os.environ.get("WATCHDOG_USE_CLAUDE_SEARCH") or "").strip().lower() in ("1", "true", "yes", "on")
    return use_claude or provider == "serper"


def _search_google_grounding(
    query: str,
    num_results: int = 5,
    run_id: Optional[str] = None,
    user_id: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Google Search via Gemini Grounding (default)."""
    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        logger.warning("[WATCHDOG] GEMINI_API_KEY not set; skipping Google Search grounding.")
        _db_log(run_id, "watchdog", "watchdog", "WARNING",
                "🌐 Google Search skipped — GEMINI_API_KEY not configured")
        return []
    try:
        from google import genai
        from google.genai import types

        _db_log(run_id, "watchdog", "watchdog", "INFO",
                f"🌐 Querying Google Search (Gemini Grounding): {query[:80]!r}")
        model = os.environ.get("GEMINI_MODEL", "gemini-2.0-flash")
        search_query = (
            f"Search for relevant Indian law judgments about: {query}. "
            "Focus on site:indiankanoon.org OR site:supremecourtofindia.nic.in OR "
            "site:judgments.ecourts.gov.in. "
            f"Return up to {num_results} most relevant judgment URLs with titles."
        )
        grounding_tool = types.Tool(google_search=types.GoogleSearch())
        config = types.GenerateContentConfig(tools=[grounding_tool], max_output_tokens=2048)
        client = genai.Client(api_key=api_key)
        response = client.models.generate_content(model=model, contents=search_query, config=config)

        results: List[Dict[str, Any]] = []
        if response.candidates:
            cand = response.candidates[0]
            gm = getattr(cand, "grounding_metadata", None) or getattr(cand, "groundingMetadata", None)
            if gm:
                chunks = getattr(gm, "grounding_chunks", None) or getattr(gm, "groundingChunks", None) or []
                for i, ch in enumerate(chunks[:num_results]):
                    web = (getattr(ch, "web", None) if hasattr(ch, "web")
                           else (ch.get("web") if isinstance(ch, dict) else None))
                    if not web:
                        continue
                    uri   = getattr(web, "uri",   None) or (web.get("uri")   if isinstance(web, dict) else None)
                    title = getattr(web, "title", None) or (web.get("title") if isinstance(web, dict) else None) or ""
                    uri_str = str(uri).strip()
                    if uri_str and uri_str.startswith("http"):
                        results.append({
                            "title":   str(title) if title else f"Result {i + 1}",
                            "link":    uri_str,
                            "snippet": (response.text or "")[:200] if response.text else "",
                            "_source": "google",
                        })
        logger.info("[WATCHDOG] 🌐 Google Grounding → %d result(s) for %r", len(results), query[:60])
        for g in results:
            _db_log(run_id, "watchdog", "watchdog", "INFO",
                    f"  🌐 Google: {g.get('title','?')[:70]} | {g.get('link','')[:60]}",
                    {"source": "google", "title": g.get("title"), "url": g.get("link")})
        _db_log(run_id, "watchdog", "watchdog", "INFO",
                f"🌐 Google Search (Grounding) → {len(results)} result(s)",
                {"source": "google_search", "count": len(results)})
        try:
            from utils.usage_tracker import record_gemini
            record_gemini(run_id, user_id or "anonymous", "grounding", is_grounding=True)
        except Exception:
            pass
        return results
    except Exception as e:
        logger.warning("[WATCHDOG] Google Grounding failed: %s", e)
        _db_log(run_id, "watchdog", "watchdog", "WARNING", f"🌐 Google Grounding failed: {e}")
        return []


def _search_google_serper(
    query: str,
    num_results: int = 5,
    run_id: Optional[str] = None,
    user_id: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Serper API fallback."""
    api_key = os.environ.get("SERPER_API_KEY")
    if not api_key:
        logger.warning("[WATCHDOG] SERPER_API_KEY not set; skipping Serper search.")
        _db_log(run_id, "watchdog", "watchdog", "WARNING", "🌐 Serper skipped — API key not configured")
        return []
    try:
        _db_log(run_id, "watchdog", "watchdog", "INFO", f"🌐 Querying Serper API: {query[:80]!r}")
        search_query = (
            f"{query} Indian law judgement Supreme Court High Court "
            "site:indiankanoon.org OR site:supremecourtofindia.nic.in OR "
            "site:judgments.ecourts.gov.in"
        )
        payload = {"q": search_query, "num": num_results}
        body = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            "https://google.serper.dev/search",
            data=body,
            headers={"X-API-KEY": api_key, "Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode())
        results = [
            {"title": item.get("title", ""), "link": item.get("link", ""),
             "snippet": item.get("snippet", ""), "_source": "google"}
            for item in (data.get("organic") or [])[:num_results]
        ]
        logger.info("[WATCHDOG] 🌐 Serper → %d result(s) for %r", len(results), query[:60])
        for g in results:
            _db_log(run_id, "watchdog", "watchdog", "INFO",
                    f"  🌐 Serper: {g.get('title','?')[:70]} | {g.get('link','')[:60]}",
                    {"source": "google", "title": g.get("title"), "url": g.get("link")})
        _db_log(run_id, "watchdog", "watchdog", "INFO",
                f"🌐 Serper → {len(results)} result(s)",
                {"source": "google_search", "count": len(results)})
        try:
            from utils.usage_tracker import record_serper
            record_serper(run_id, user_id or "anonymous", searches=1)
        except Exception:
            pass
        return results
    except Exception as e:
        logger.warning("[WATCHDOG] Serper failed: %s", e)
        _db_log(run_id, "watchdog", "watchdog", "WARNING", f"🌐 Serper failed: {e}")
        return []


def _search_google(
    query: str,
    num_results: int = 5,
    run_id: Optional[str] = None,
    user_id: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Google search: Gemini Grounding by default; falls back to Serper."""
    if _use_serper_for_google_search():
        return _search_google_serper(query, num_results=num_results, run_id=run_id, user_id=user_id)
    result = _search_google_grounding(query, num_results=num_results, run_id=run_id, user_id=user_id)
    if not result and os.environ.get("SERPER_API_KEY"):
        logger.info("[WATCHDOG] Google Grounding returned 0; falling back to Serper")
        return _search_google_serper(query, num_results=num_results, run_id=run_id, user_id=user_id)
    return result


# ── Dimension query builder ───────────────────────────────────────────────────

def _build_dimension_query_tasks(
    dimensions: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """
    Expand dimensions into flat query-task dicts.
    Each task: { query, q_type, dimension_id, dimension_name }
    """
    tasks: List[Dict[str, Any]] = []
    for dim in dimensions:
        dim_id   = dim.get("dimension_id", "?")
        dim_name = dim.get("name", "")
        qs       = dim.get("queries") or {}
        for q_type, q_key in (("sc", "sc_query"), ("hc", "hc_query"), ("provision", "provision_query")):
            q = (qs.get(q_key) or "").strip()
            if q:
                tasks.append({
                    "query":          q,
                    "q_type":         q_type,
                    "dimension_id":   dim_id,
                    "dimension_name": dim_name,
                })
    return tasks


# ── Main watchdog entry point ─────────────────────────────────────────────────

def run_watchdog(
    query: str,
    max_local: int = 10,
    max_ik: int = 10,
    max_google: int = 5,
    keyword_sets: Optional[List[str]] = None,
    dimensions: Optional[List[Dict[str, Any]]] = None,
    case_state: str = "",
    run_id: Optional[str] = None,
    user_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Run Watchdog: Local DB → Indian Kanoon API (dimension-aware) → Google.

    Dimension-aware mode (when `dimensions` is provided):
      • Expands 3 queries per dimension (SC / HC / Provision)
      • Sends queries in batches of IK_BATCH_SIZE with IK_BATCH_STAGGER_SECS delay
      • Drops results from low-hierarchy courts (District Court, Tribunal, etc.)
      • Ranks surviving results: SC > same-state HC > other HC
      • Global deduplication by tid / external_id across ALL dimension queries

    Legacy mode (no dimensions): falls back to keyword_sets / single query.

    When max_ik=0: IK search is skipped entirely.

    Returns:
      local, candidates_ik, candidates_google, all_judgement_ids,
      search_keywords_by_route, dropped_low_hierarchy_count
    """

    def _unique_nonempty(items: List[str]) -> List[str]:
        seen: set = set()
        out: List[str] = []
        for it in items:
            val = (it or "").strip()
            if val and val not in seen:
                seen.add(val)
                out.append(val)
        return out

    skip_ik = (max_ik == 0)
    query = (query or "").strip()

    # ── Build flat keyword list for legacy / Google paths ─────────────────────
    if dimensions:
        all_dim_queries = [t["query"] for t in _build_dimension_query_tasks(dimensions)]
        keyword_list = all_dim_queries if all_dim_queries else ([query] if query else [])
    elif keyword_sets:
        keyword_list = [q for q in keyword_sets if (q or "").strip()]
    else:
        keyword_list = [query] if query else []

    if not keyword_list and not dimensions:
        return {
            "error": "query or keyword_sets or dimensions required",
            "local": [], "candidates_ik": [], "candidates_google": [],
            "all_judgement_ids": [], "search_keywords_by_route": {},
            "dropped_low_hierarchy_count": 0,
        }

    primary_query = keyword_list[0] if keyword_list else query
    ik_mode = "SKIPPED" if skip_ik else ("dimension-aware" if dimensions else "keyword")

    logger.info("╔══ WATCHDOG ══════════════════════════════════════════════╗")
    logger.info("║  Primary query : %-42s ║", primary_query[:42])
    logger.info("║  IK mode       : %-42s ║", ik_mode[:42])
    logger.info("║  Dimensions    : %-42s ║", str(len(dimensions) if dimensions else 0))
    logger.info("╚══════════════════════════════════════════════════════════╝")
    _db_log(run_id, "watchdog", "watchdog", "INFO",
            f"🐕 Watchdog started — IK mode={ik_mode} | "
            f"dims={len(dimensions) if dimensions else 0} | queries={len(keyword_list)}",
            {"ik_mode": ik_mode, "dimension_count": len(dimensions) if dimensions else 0,
             "keyword_count": len(keyword_list), "primary_query": primary_query[:120]})

    # ── 1. Local DB search ────────────────────────────────────────────────────
    local = _search_local(primary_query, limit=max_local, run_id=run_id)

    # ── 2. Indian Kanoon — dimension-aware batched search ────────────────────
    seen_tids: Dict[str, Dict[str, Any]] = {}
    dropped_low_hierarchy = 0

    if not skip_ik:
        if dimensions:
            # ── Dimension mode: batch 5 tasks at a time with 200 ms stagger ──
            tasks = _build_dimension_query_tasks(dimensions)
            per_query_limit = max(2, max_ik // max(len(tasks), 1))
            batches = [tasks[i: i + IK_BATCH_SIZE] for i in range(0, len(tasks), IK_BATCH_SIZE)]

            logger.info("[WATCHDOG] Dimension IK search: %d queries → %d batch(es) of %d",
                        len(tasks), len(batches), IK_BATCH_SIZE)
            _db_log(run_id, "watchdog", "watchdog", "INFO",
                    f"📚 IK dimension search — {len(tasks)} queries across {len(batches)} batch(es) "
                    f"(stagger={IK_BATCH_STAGGER_SECS * 1000:.0f}ms)",
                    {"total_queries": len(tasks), "batch_count": len(batches),
                     "batch_size": IK_BATCH_SIZE, "per_query_limit": per_query_limit})

            for batch_idx, batch in enumerate(batches):
                if batch_idx > 0:
                    time.sleep(IK_BATCH_STAGGER_SECS)

                batch_workers = min(SEARCH_WORKERS, len(batch))
                with ThreadPoolExecutor(max_workers=batch_workers) as pool:
                    fut_map = {
                        pool.submit(
                            _search_indian_kanoon,
                            t["query"],
                            per_query_limit,
                            run_id,
                            user_id,
                            t["dimension_id"],
                            t["dimension_name"],
                            t["q_type"],
                        ): t
                        for t in batch
                    }
                    for fut in as_completed(fut_map):
                        task = fut_map[fut]
                        try:
                            results = fut.result(timeout=20)
                        except Exception as exc:
                            logger.warning("[WATCHDOG] IK task failed for %r: %s",
                                           task.get("query", "")[:60], exc)
                            _db_log(run_id, "watchdog", "watchdog", "WARNING",
                                    f"📚 IK query failed [{task.get('q_type')}|dim="
                                    f"{task.get('dimension_id')}]: {exc}")
                            results = []

                        for candidate in results:
                            tid = (candidate.get("external_id") or "").strip()
                            if not tid:
                                continue

                            # ── Hierarchy pre-filter ──────────────────────────
                            if _is_low_hierarchy(candidate.get("docsource", "")):
                                dropped_low_hierarchy += 1
                                logger.debug(
                                    "[WATCHDOG] Dropped low-hierarchy: %s (%s)",
                                    candidate.get("title", "?")[:60],
                                    candidate.get("docsource", ""),
                                )
                                continue

                            # ── Global deduplication ──────────────────────────
                            if tid not in seen_tids:
                                candidate["_jurisdiction_priority"] = _jurisdiction_priority(
                                    candidate, case_state
                                )
                                seen_tids[tid] = candidate

        else:
            # ── Legacy keyword mode ───────────────────────────────────────────
            per_ik = max(1, max_ik // len(keyword_list)) if len(keyword_list) > 1 else max_ik

            def _run_ik_keyword(args: Tuple[int, str]) -> Tuple[int, List[Dict[str, Any]]]:
                qi, q = args
                q = (q or "").strip()
                if not q:
                    return qi, []
                return qi, _search_indian_kanoon(q, limit=per_ik, run_id=run_id, user_id=user_id)

            active = [(qi, q) for qi, q in enumerate(keyword_list, 1) if (q or "").strip()]
            # Still batch in groups of IK_BATCH_SIZE
            batches = [active[i: i + IK_BATCH_SIZE] for i in range(0, len(active), IK_BATCH_SIZE)]
            for batch_idx, batch in enumerate(batches):
                if batch_idx > 0:
                    time.sleep(IK_BATCH_STAGGER_SECS)
                with ThreadPoolExecutor(max_workers=min(SEARCH_WORKERS, len(batch))) as pool:
                    futs = {pool.submit(_run_ik_keyword, item): item for item in batch}
                    for fut in as_completed(futs):
                        try:
                            _, results = fut.result(timeout=20)
                        except Exception as exc:
                            qi, q = futs[fut]
                            logger.warning("[WATCHDOG] Keyword IK failed #%d %r: %s", qi, q[:60], exc)
                            results = []
                        for c in results:
                            tid = (c.get("external_id") or "").strip()
                            if not tid:
                                continue
                            if _is_low_hierarchy(c.get("docsource", "")):
                                dropped_low_hierarchy += 1
                                continue
                            if tid not in seen_tids:
                                c["_jurisdiction_priority"] = _jurisdiction_priority(c, case_state)
                                seen_tids[tid] = c

    # ── Sort IK candidates by jurisdiction priority (SC first) ───────────────
    candidates_ik = sorted(
        seen_tids.values(),
        key=lambda c: c.get("_jurisdiction_priority", 0),
        reverse=True,
    )

    # ── 3. Google search ──────────────────────────────────────────────────────
    # Run Google for primary query + first query of each dimension (deduped)
    google_queries: List[str] = []
    if dimensions:
        for dim in dimensions:
            sc_q = ((dim.get("queries") or {}).get("sc_query") or "").strip()
            if sc_q and sc_q not in google_queries:
                google_queries.append(sc_q)
    if not google_queries:
        google_queries = [primary_query] if primary_query else []
    # Cap Google to avoid quota burn: first 3 unique queries
    google_queries = google_queries[:3]

    seen_google: Dict[str, Dict[str, Any]] = {}
    per_google = max(1, max_google // max(len(google_queries), 1))

    def _run_google_one(q: str) -> List[Dict[str, Any]]:
        return _search_google(q, num_results=per_google, run_id=run_id, user_id=user_id)

    with ThreadPoolExecutor(max_workers=min(SEARCH_WORKERS, max(1, len(google_queries)))) as pool:
        gfuts = {pool.submit(_run_google_one, q): q for q in google_queries}
        for fut in as_completed(gfuts):
            try:
                for g in fut.result(timeout=20):
                    link = (g.get("link") or "").strip()
                    if link and link not in seen_google:
                        seen_google[link] = g
            except Exception as exc:
                logger.warning("[WATCHDOG] Google worker failed: %s", exc)

    candidates_google = list(seen_google.values())

    # ── Summary ───────────────────────────────────────────────────────────────
    all_judgement_ids = [r["id"] for r in local if r.get("id")]

    logger.info(
        "╔══ WATCHDOG SUMMARY ══════════════════════════════════════╗\n"
        "║  🏛  Local DB       : %3d judgement(s) (ready)           ║\n"
        "║  📚  Indian Kanoon  : %3d candidate(s) (need fetch+clerk) ║\n"
        "║  🌐  Google Search  : %3d candidate(s) (need fetch+clerk) ║\n"
        "║  🚫  Dropped (hier) : %3d (District Court / Tribunal)     ║\n"
        "╚══════════════════════════════════════════════════════════╝",
        len(local), len(candidates_ik), len(candidates_google), dropped_low_hierarchy,
    )

    ik_enabled = bool(_get_ik_token())
    google_enabled = (
        bool(os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY"))
        if not _use_serper_for_google_search()
        else bool(os.environ.get("SERPER_API_KEY"))
    )
    search_keywords_by_route = {
        "local":         _unique_nonempty([primary_query]),
        "indian_kanoon": _unique_nonempty(keyword_list) if ik_enabled and not skip_ik else [],
        "google":        _unique_nonempty(google_queries) if google_enabled else [],
    }

    _db_log(run_id, "watchdog", "watchdog", "INFO",
            f"✅ Watchdog done — 🏛 {len(local)} local | 📚 {len(candidates_ik)} IK | "
            f"🌐 {len(candidates_google)} Google | 🚫 {dropped_low_hierarchy} dropped",
            {"local_count": len(local), "ik_count": len(candidates_ik),
             "google_count": len(candidates_google),
             "dropped_low_hierarchy": dropped_low_hierarchy})

    return {
        "local":                     local,
        "candidates_ik":             candidates_ik,
        "candidates_google":         candidates_google,
        "all_judgement_ids":         all_judgement_ids,
        "search_keywords_by_route":  search_keywords_by_route,
        "dropped_low_hierarchy_count": dropped_low_hierarchy,
    }
