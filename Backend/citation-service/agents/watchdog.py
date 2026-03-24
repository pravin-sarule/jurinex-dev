"""
Watchdog agent: find relevant judgements from (1) local DB, (2) Indian Kanoon API, (3) Google search.
Returns merged, ranked candidate list for Fetcher/Clerk and for report building.
"""

from __future__ import annotations

import json
import logging
import os
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)
SEARCH_WORKERS = max(1, min(10, int(os.environ.get("CITATION_WATCHDOG_WORKERS", "6"))))


def _db_log(run_id: Optional[str], agent: str, stage: str, level: str, msg: str, meta: Optional[Dict] = None) -> None:
    if not run_id:
        return
    try:
        from db.client import agent_log_insert
        agent_log_insert(run_id, None, agent, stage, level, msg, meta)
    except Exception:
        pass


def _search_local(query: str, limit: int = 10, run_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """Search local DB (judgements table). Returns list of judgement rows (id, title, primary_citation, court, ratio, source, canonical_id)."""
    try:
        from db.client import judgement_search_local
        _db_log(run_id, "watchdog", "watchdog", "INFO", f"🏛 Searching Local DB for: {query[:80]!r}")
        rows = judgement_search_local(query, limit=limit)
        for r in rows:
            r["_source"] = "local"
        logger.info("[WATCHDOG] 🏛  SOURCE=local_db       → %d result(s) for query: %r", len(rows), query[:80])
        for r in rows:
            logger.info(
                "  ├─ [LOCAL_DB]        title=%-55s | citation=%-25s | court=%s",
                (r.get("title") or "?")[:55],
                (r.get("primary_citation") or "—")[:25],
                (r.get("court") or "?")[:30],
            )
        titles = [r.get("title") or "?" for r in rows[:5]]
        title_str = ", ".join(t[:50] for t in titles) + (f" … +{len(rows)-5} more" if len(rows) > 5 else "")
        _db_log(run_id, "watchdog", "watchdog", "INFO",
                f"🏛 Local DB → {len(rows)} judgment(s) found" + (f": {title_str}" if rows else ""),
                {"source": "local_db", "count": len(rows), "titles": titles})
        return rows
    except Exception as e:
        logger.warning("Local search failed: %s", e)
        _db_log(run_id, "watchdog", "watchdog", "WARNING", f"🏛 Local DB search failed: {e}")
        return []


def _search_indian_kanoon(query: str, limit: int = 10, run_id: Optional[str] = None, user_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """Call Indian Kanoon API search. Requires INDIAN_KANOON_API_TOKEN (or INDIAN_KANOON_TOKEN / IK_API_TOKEN). Returns list of { tid, title, headline, docsource }."""
    token = (
        os.environ.get("INDIAN_KANOON_TOKEN")
        or os.environ.get("INDIAN_KANOON_API_TOKEN")
        or os.environ.get("IK_API_TOKEN")
    )
    if not token:
        logger.warning("INDIAN_KANOON_API_TOKEN not set; skipping Indian Kanoon search.")
        _db_log(run_id, "watchdog", "watchdog", "WARNING", "📚 Indian Kanoon skipped — API token not configured")
        return []

    try:
        import urllib.parse
        import urllib.error
        _db_log(run_id, "watchdog", "watchdog", "INFO", f"📚 Querying Indian Kanoon API: {query[:80]!r}")
        url = "https://api.indiankanoon.org/search/?formInput=" + urllib.parse.quote(query) + "&pagenum=0"
        req = urllib.request.Request(url, method="POST")
        req.add_header("Authorization", f"Token {token}")
        req.add_header("Accept", "application/json")
        req.add_header("User-Agent", "Mozilla/5.0 (compatible; JurinexCitation/1.0)")
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                raw = resp.read()
                data = json.loads(raw.decode("utf-8", errors="replace"))
        except urllib.error.HTTPError as e:
            body = ""
            try:
                body = e.read().decode("utf-8", errors="replace")[:200]
            except Exception:
                body = ""
            logger.warning("Indian Kanoon search HTTP %s for query %r: %s", getattr(e, "code", "?"), query[:80], body)
            _db_log(run_id, "watchdog", "watchdog", "WARNING", f"📚 Indian Kanoon HTTP {getattr(e,'code','?')} — {body[:100]}")
            return []
        docs = data.get("docs") or data.get("results") or []
        out = []
        for d in docs[:limit]:
            out.append({
                "external_id": str(d.get("tid", "")),
                "title": d.get("title", ""),
                "snippet": d.get("headline", ""),
                "docsource": d.get("docsource", ""),
                "_source": "indian_kanoon",
            })
        logger.info("[WATCHDOG] 📚  SOURCE=indian_kanoon  → %d result(s) for query: %r", len(out), query[:80])
        for c in out:
            logger.info(
                "  ├─ [INDIAN_KANOON]   title=%-55s | tid=%-12s | docsource=%s",
                (c.get("title") or "?")[:55],
                (c.get("external_id") or "?")[:12],
                (c.get("docsource") or "?")[:30],
            )
            _db_log(run_id, "watchdog", "watchdog", "INFO",
                    f"  📚 IK: {(c.get('title') or '?')[:70]} | tid={c.get('external_id','?')} | {c.get('docsource','?')[:25]}",
                    {"source": "indian_kanoon", "tid": c.get("external_id"), "title": c.get("title")})
        titles = [c.get("title") or "?" for c in out[:5]]
        _db_log(run_id, "watchdog", "watchdog", "INFO",
                f"📚 Indian Kanoon → {len(out)} candidate(s)" + (f" for: {query[:60]!r}" if len(out) == 0 else ""),
                {"source": "indian_kanoon", "count": len(out), "titles": titles})
        try:
            from utils.usage_tracker import record_ik
            record_ik(run_id, user_id or "anonymous", "search", count=1)
        except Exception:
            pass
        return out
    except Exception as e:
        logger.warning("Indian Kanoon search failed: %s", e)
        _db_log(run_id, "watchdog", "watchdog", "WARNING", f"📚 Indian Kanoon search failed: {e}")
        return []


def _use_serper_for_google_search() -> bool:
    """
    Use Serper API only when explicitly configured (e.g. WATCHDOG_USE_CLAUDE_SEARCH or
    WATCHDOG_GOOGLE_SEARCH_PROVIDER=serper). Default is Google Grounding via Gemini.
    """
    provider = (os.environ.get("WATCHDOG_GOOGLE_SEARCH_PROVIDER") or "google_grounding").strip().lower()
    use_claude = (os.environ.get("WATCHDOG_USE_CLAUDE_SEARCH") or "").strip().lower() in ("1", "true", "yes", "on")
    return use_claude or provider == "serper"


def _search_google_grounding(query: str, num_results: int = 5, run_id: Optional[str] = None, user_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """Google Search via Gemini's Grounding with Google Search (default for all models)."""
    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        logger.warning("GEMINI_API_KEY not set; skipping Google Search grounding.")
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
            "Focus on site:indiankanoon.org OR site:supremecourtofindia.nic.in OR site:judgments.ecourts.gov.in. "
            f"Return up to {num_results} most relevant judgment URLs with titles."
        )
        grounding_tool = types.Tool(google_search=types.GoogleSearch())
        config = types.GenerateContentConfig(
            tools=[grounding_tool],
            max_output_tokens=2048,
        )
        client = genai.Client(api_key=api_key)
        response = client.models.generate_content(
            model=model,
            contents=search_query,
            config=config,
        )

        results: List[Dict[str, Any]] = []
        if response.candidates:
            cand = response.candidates[0]
            gm = getattr(cand, "grounding_metadata", None) or getattr(cand, "groundingMetadata", None)
            if gm:
                chunks = getattr(gm, "grounding_chunks", None) or getattr(gm, "groundingChunks", None) or []
                for i, ch in enumerate(chunks[:num_results]):
                    web = getattr(ch, "web", None) if hasattr(ch, "web") else (ch.get("web") if isinstance(ch, dict) else None)
                    if not web:
                        continue
                    uri = getattr(web, "uri", None) or (web.get("uri") if isinstance(web, dict) else None)
                    title = getattr(web, "title", None) or (web.get("title") if isinstance(web, dict) else None) or ""
                    uri_str = str(uri).strip()
                    if uri_str and (uri_str.startswith("http://") or uri_str.startswith("https://")):
                        results.append({
                            "title": str(title) if title else f"Result {i+1}",
                            "link": uri_str,
                            "snippet": (response.text or "")[:200] if response.text else "",
                            "_source": "google",
                        })

        logger.info("[WATCHDOG] 🌐  SOURCE=google_search (Grounding) → %d result(s) for query: %r",
                    len(results), query[:80])
        for g in results:
            logger.info(
                "  ├─ [GOOGLE_SEARCH]   title=%-55s | url=%s",
                (g.get("title") or "?")[:55],
                (g.get("link") or "?")[:80],
            )
            _db_log(run_id, "watchdog", "watchdog", "INFO",
                    f"  🌐 Google (Grounding): {(g.get('title') or '?')[:70]} | {(g.get('link') or '')[:60]}",
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
        logger.warning("Google Search (Grounding) failed: %s", e)
        _db_log(run_id, "watchdog", "watchdog", "WARNING", f"🌐 Google Search (Grounding) failed: {e}")
        return []


def _search_google_serper(query: str, num_results: int = 5, run_id: Optional[str] = None, user_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """Serper API for Indian law judgements. Used only when WATCHDOG_USE_CLAUDE_SEARCH or WATCHDOG_GOOGLE_SEARCH_PROVIDER=serper."""
    api_key = os.environ.get("SERPER_API_KEY")
    if not api_key:
        logger.warning("SERPER_API_KEY not set; skipping Serper search.")
        _db_log(run_id, "watchdog", "watchdog", "WARNING",
                "🌐 Serper skipped — SERPER_API_KEY not configured")
        return []

    try:
        _db_log(run_id, "watchdog", "watchdog", "INFO", f"🌐 Querying Serper API: {query[:80]!r}")
        search_query = f"{query} Indian law judgement Supreme Court High Court site:indiankanoon.org OR site:supremecourtofindia.nic.in OR site:judgments.ecourts.gov.in"
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
        organic = data.get("organic", [])
        results = [
            {
                "title": item.get("title", ""),
                "link": item.get("link", ""),
                "snippet": item.get("snippet", ""),
                "_source": "google",
            }
            for item in organic[:num_results]
        ]
        logger.info("[WATCHDOG] 🌐  SOURCE=google_search (Serper) → %d result(s) for query: %r",
                    len(results), query[:80])
        for g in results:
            logger.info(
                "  ├─ [GOOGLE_SEARCH]   title=%-55s | url=%s",
                (g.get("title") or "?")[:55],
                (g.get("link") or "?")[:80],
            )
            _db_log(run_id, "watchdog", "watchdog", "INFO",
                    f"  🌐 Serper: {(g.get('title') or '?')[:70]} | {(g.get('link') or '')[:60]}",
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
        logger.warning("Serper search failed: %s", e)
        _db_log(run_id, "watchdog", "watchdog", "WARNING", f"🌐 Serper failed: {e}")
        return []


def _search_google(query: str, num_results: int = 5, run_id: Optional[str] = None, user_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """
    Google search: uses Gemini Google Grounding by default.
    Falls back to Serper only when WATCHDOG_USE_CLAUDE_SEARCH or WATCHDOG_GOOGLE_SEARCH_PROVIDER=serper.
    """
    if _use_serper_for_google_search():
        return _search_google_serper(query, num_results=num_results, run_id=run_id, user_id=user_id)
    result = _search_google_grounding(query, num_results=num_results, run_id=run_id, user_id=user_id)
    if not result and os.environ.get("SERPER_API_KEY"):
        logger.info("[WATCHDOG] Google Grounding returned no results; falling back to Serper")
        return _search_google_serper(query, num_results=num_results, run_id=run_id, user_id=user_id)
    return result


def run_watchdog(
    query: str,
    max_local: int = 10,
    max_ik: int = 10,
    max_google: int = 5,
    keyword_sets: Optional[List[str]] = None,
    run_id: Optional[str] = None,
    user_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Run Watchdog: search local DB first, then Indian Kanoon API, then Google.
    If keyword_sets is provided, run search for each query; for each query where IK returns 0,
    run Google fallback (CHECK 4). Merge and dedupe candidates.
    Returns:
      - local: list of judgement records from DB (already have full metadata).
      - candidates_ik: list from Indian Kanoon (need fetch + clerk).
      - candidates_google: list from Google (need fetch + clerk).
      - all_judgement_ids: local judgement IDs to include in report.
    """
    def _unique_nonempty(items: List[str]) -> List[str]:
        seen = set()
        out: List[str] = []
        for it in items:
            val = (it or "").strip()
            if not val or val in seen:
                continue
            seen.add(val)
            out.append(val)
        return out

    query = (query or "").strip()
    queries = keyword_sets if keyword_sets else ([query] if query else [])
    if not queries:
        return {"error": "query or keyword_sets required", "local": [], "candidates_ik": [], "candidates_google": [], "all_judgement_ids": []}

    # Use first query for local search; run IK + Google per query when multiple
    primary_query = queries[0] if queries else query
    logger.info("╔══ WATCHDOG ══════════════════════════════════════════════╗")
    logger.info("║ Queries: %d (primary: %-40s) ║", len(queries), primary_query[:40])
    logger.info("║ Searching: Local DB → Indian Kanoon API → Google Search   ║")
    logger.info("╚══════════════════════════════════════════════════════════╝")
    _db_log(run_id, "watchdog", "watchdog", "INFO",
            f"🐕 Watchdog started — {len(queries)} keyword set(s) | Searching: Local DB → Indian Kanoon → Google",
            {"keyword_count": len(queries), "primary_query": primary_query[:120]})

    local = _search_local(primary_query, limit=max_local, run_id=run_id)
    seen_ik: Dict[str, Any] = {}
    seen_google: Dict[str, Any] = {}
    per_ik = max(1, max_ik // len(queries)) if len(queries) > 1 else max_ik
    per_google = max(1, max_google // len(queries)) if len(queries) > 1 else max_google

    def _run_one_query(args: tuple[int, str]) -> tuple[int, str, List[Dict[str, Any]], List[Dict[str, Any]]]:
        qi, q = args
        q = (q or "").strip()
        if not q:
            return qi, q, [], []
        _db_log(run_id, "watchdog", "watchdog", "INFO", f"🔎 Keyword set {qi}/{len(queries)}: {q[:80]!r}")
        ik_results = _search_indian_kanoon(q, limit=per_ik, run_id=run_id, user_id=user_id)
        if not ik_results:
            logger.info("[WATCHDOG] IK returned 0 for query %r → Google fallback", q[:60])
            _db_log(run_id, "watchdog", "watchdog", "INFO",
                    f"📚 Indian Kanoon returned 0 for this query → falling back to Google")
            google_results = _search_google(q, num_results=per_google, run_id=run_id, user_id=user_id)
            return qi, q, [], google_results
        google_results = _search_google(q, num_results=per_google, run_id=run_id, user_id=user_id)
        return qi, q, ik_results, google_results

    active_queries = [(qi, q) for qi, q in enumerate(queries, 1) if (q or "").strip()]
    max_workers = min(SEARCH_WORKERS, max(1, len(active_queries)))
    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        futures = {pool.submit(_run_one_query, item): item for item in active_queries}
        ordered_results: List[tuple[int, str, List[Dict[str, Any]], List[Dict[str, Any]]]] = []
        for fut in as_completed(futures):
            try:
                ordered_results.append(fut.result())
            except Exception as exc:
                qi, q = futures[fut]
                logger.warning("[WATCHDOG] Query worker failed for keyword set %d (%r): %s", qi, q[:60], exc)
        for _, _, ik_results, google_results in sorted(ordered_results, key=lambda row: row[0]):
            for c in ik_results:
                eid = c.get("external_id") or c.get("tid") or ""
                if eid and eid not in seen_ik:
                    seen_ik[eid] = c
            for g in google_results:
                link = g.get("link") or ""
                if link and link not in seen_google:
                    seen_google[link] = g

    candidates_ik = list(seen_ik.values())
    candidates_google = list(seen_google.values())

    all_judgement_ids = [r["id"] for r in local]

    logger.info(
        "╔══ WATCHDOG SUMMARY ══════════════════════════════════════╗\n"
        "║  🏛  Local DB:       %3d judgement(s) (ready for report) ║\n"
        "║  📚  Indian Kanoon:  %3d candidate(s) (need fetch+clerk) ║\n"
        "║  🌐  Google Search:  %3d candidate(s) (need fetch+clerk) ║\n"
        "╚══════════════════════════════════════════════════════════╝",
        len(local), len(candidates_ik), len(candidates_google),
    )

    ik_enabled = bool(
        os.environ.get("INDIAN_KANOON_TOKEN")
        or os.environ.get("INDIAN_KANOON_API_TOKEN")
        or os.environ.get("IK_API_TOKEN")
    )
    google_enabled = (
        bool(os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY"))
        if not _use_serper_for_google_search()
        else bool(os.environ.get("SERPER_API_KEY"))
    )
    search_keywords_by_route = {
        "local": _unique_nonempty([primary_query]) if primary_query else [],
        "indian_kanoon": _unique_nonempty(queries) if ik_enabled else [],
        "google": _unique_nonempty(queries) if google_enabled else [],
    }

    _db_log(run_id, "watchdog", "watchdog", "INFO",
            f"✅ Watchdog complete — 🏛 Local DB: {len(local)} | 📚 Indian Kanoon: {len(candidates_ik)} candidates | 🌐 Google: {len(candidates_google)} candidates",
            {"local_count": len(local), "ik_count": len(candidates_ik), "google_count": len(candidates_google)})

    return {
        "local": local,
        "candidates_ik": candidates_ik,
        "candidates_google": candidates_google,
        "all_judgement_ids": all_judgement_ids,
        "search_keywords_by_route": search_keywords_by_route,
    }
