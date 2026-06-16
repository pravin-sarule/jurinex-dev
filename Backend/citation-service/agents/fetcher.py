# """
# Fetcher agent: fetch full document content from Indian Kanoon API or from URL (Google result).
# Returns raw content / HTML for Clerk to OCR, chunk, and embed.

# High-volume async architecture (JuriNex Spec v1.1.1):
#   - asyncio.Semaphore(FETCHER_SEMAPHORE_LIMIT) limits concurrent IK document downloads
#   - asyncio.gather() runs all validated candidates in parallel within the semaphore
#   - Single httpx.AsyncClient session is shared across the entire fetch run (connection pooling)
#   - Stub filter: documents < MIN_JUDGMENT_CHARS are discarded immediately
#   - Safe sync→async bridge: works from both sync call-sites (pipeline) and async (FastAPI)

# IK endpoints called per document:
#   /doc/<id>/          → full HTML + citeList + citedbyList
#   /docfragment/<id>/  → query-relevant text fragment / headline
#   /docmeta/<id>/      → lightweight metadata
#   /origdoc/<id>/      → original court copy (PDF → GCS upload)
# """

# from __future__ import annotations

# import asyncio
# import hashlib
# import json
# import logging
# import os
# import re
# import ssl
# import urllib.request
# from concurrent.futures import ThreadPoolExecutor
# from typing import Any, Dict, List, Optional

# import certifi
# import httpx
# import requests

# logger = logging.getLogger(__name__)

# # Minimum judgment text length for a fetch to be considered non-stub (CHECK 5)
# MIN_JUDGMENT_CHARS      = 500
# FETCHER_SEMAPHORE_LIMIT = max(1, int(os.environ.get("CITATION_FETCHER_SEMAPHORE_LIMIT", "10")))
# GOOGLE_FETCH_WORKERS    = max(1, min(12, int(os.environ.get("CITATION_GOOGLE_FETCH_WORKERS", "6"))))

# _IK_WEB_URL_RE   = re.compile(r"https?://(?:www\.)?indiankanoon\.org/(?:doc|docfragment)/(\d+)/?", re.I)
# _IK_SEARCH_URL_RE = re.compile(r"https?://(?:www\.)?indiankanoon\.org/search/\?", re.I)


# # ── Utility helpers ───────────────────────────────────────────────────────────

# def _strip_html(html: str) -> str:
#     """Remove tags and normalise whitespace."""
#     if not html:
#         return ""
#     text = re.sub(r"<[^>]+>", " ", html)
#     return re.sub(r"\s+", " ", text).strip()


# def _get_ik_token() -> Optional[str]:
#     return (
#         os.environ.get("INDIAN_KANOON_TOKEN")
#         or os.environ.get("INDIAN_KANOON_API_TOKEN")
#         or os.environ.get("IK_API_TOKEN")
#     )


# def _db_log(
#     run_id: Optional[str],
#     agent: str,
#     stage: str,
#     level: str,
#     msg: str,
#     meta: Optional[Dict] = None,
# ) -> None:
#     if not run_id:
#         return
#     try:
#         from db.client import agent_log_insert
#         agent_log_insert(run_id, None, agent, stage, level, msg, meta)
#     except Exception:
#         pass


# # ── Sync→async bridge ─────────────────────────────────────────────────────────

# def _run_async_safe(coro: Any) -> Any:
#     """
#     Run an async coroutine from a synchronous call-site safely.

#     • If no event loop is running (e.g. direct CLI / test): asyncio.run().
#     • If already inside a running loop (e.g. FastAPI worker): spin up a
#       dedicated thread so we don't deadlock the outer loop.
#     """
#     try:
#         loop = asyncio.get_running_loop()
#     except RuntimeError:
#         loop = None

#     if loop and loop.is_running():
#         # Submit to a fresh thread that owns its own event loop
#         with ThreadPoolExecutor(max_workers=1) as ex:
#             return ex.submit(asyncio.run, coro).result()
#     else:
#         return asyncio.run(coro)


# # ── Async IK fetch core ───────────────────────────────────────────────────────

# async def _fetch_ik_candidates_async(
#     candidates: List[Dict[str, Any]],
#     query: str,
#     run_id: Optional[str],
#     user_id: Optional[str],
#     fetch_origdoc: bool,
#     maxcites: int,
#     maxcitedby: int,
# ) -> List[Dict[str, Any]]:
#     """
#     Core async implementation.
#     Uses a single httpx.AsyncClient (connection pool) shared across all fetches
#     and an asyncio.Semaphore to cap concurrent in-flight requests at
#     FETCHER_SEMAPHORE_LIMIT (default 10).
#     """
#     sem = asyncio.Semaphore(FETCHER_SEMAPHORE_LIMIT)

#     # Shared httpx client for the entire batch — reuses TCP connections
#     async with httpx.AsyncClient(
#         timeout=httpx.Timeout(30.0, connect=10.0),
#         limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
#         follow_redirects=True,
#     ) as _client:  # noqa: F841  (kept for connection pooling; actual calls go through urllib via sync helper)

#         async def _fetch_one(c: Dict[str, Any]) -> Optional[Dict[str, Any]]:
#             tid   = c.get("external_id")
#             title = (c.get("title") or f"tid:{tid}")[:70]
#             if not tid:
#                 return None

#             async with sem:
#                 _db_log(run_id, "fetcher", "fetcher", "INFO",
#                         f"  📄 Fetching IK doc #{tid}: {title}")
#                 # ik_enrich_candidate_cached is synchronous (does its own urllib calls);
#                 # run it in the default thread pool so the event loop stays free.
#                 try:
#                     result = await asyncio.to_thread(
#                         _fetch_one_ik_sync,
#                         c, query, run_id, user_id, fetch_origdoc, maxcites, maxcitedby,
#                     )
#                     return result
#                 except Exception as exc:
#                     logger.warning("[FETCHER] async worker error for tid=%s: %s", tid, exc)
#                     _db_log(run_id, "fetcher", "fetcher", "WARNING",
#                             f"  ⚠ IK doc #{tid} worker crashed: {exc}")
#                     return None

#         tasks = [_fetch_one(c) for c in candidates]
#         raw_results = await asyncio.gather(*tasks, return_exceptions=True)

#     out: List[Dict[str, Any]] = []
#     for r in raw_results:
#         if isinstance(r, BaseException):
#             logger.warning("[FETCHER] gather exception: %s", r)
#         elif r is not None:
#             out.append(r)
#     return out


# def _fetch_one_ik_sync(
#     c: Dict[str, Any],
#     query: str,
#     run_id: Optional[str],
#     user_id: Optional[str],
#     fetch_origdoc: bool,
#     maxcites: int,
#     maxcitedby: int,
# ) -> Optional[Dict[str, Any]]:
#     """
#     Synchronous single-document IK fetch (called from asyncio.to_thread).
#     Uses ik_enrich_candidate_cached (DB-cached, hits all 4 endpoints).
#     Falls back to bare /doc/<id>/ if the service module is not importable.
#     Discards stubs (< MIN_JUDGMENT_CHARS).
#     """
#     tid   = c.get("external_id")
#     title = (c.get("title") or f"tid:{tid}")[:70]

#     try:
#         from services.indian_kanoon import ik_enrich_candidate_cached, build_ik_report_fields
#         use_ik_service = True
#     except ImportError:
#         use_ik_service = False
#         logger.warning("[FETCHER] services.indian_kanoon not importable — using bare /doc/ fallback")

#     if use_ik_service:
#         enriched = ik_enrich_candidate_cached(
#             doc_id=tid, query=query, fetch_origdoc=fetch_origdoc,
#             maxcites=maxcites, maxcitedby=maxcitedby,
#             run_id=run_id, user_id=user_id,
#         )
#         fields = build_ik_report_fields(enriched)

#         # Log per-endpoint outcomes
#         for entry in (enriched.get("_api_log") or []):
#             ep = entry.get("endpoint", "")
#             st = entry.get("status", "")
#             if ep == "CACHE":
#                 _db_log(run_id, "fetcher", "fetcher", "INFO",
#                         f"  🗄 CACHE HIT #{tid} (age={entry.get('age_hours','?')}h) — IK API skipped",
#                         {"tid": tid, "cache_hit": True, "age_hours": entry.get("age_hours")})
#             elif "/doc/" in ep and "fragment" not in ep and "meta" not in ep:
#                 _db_log(run_id, "fetcher", "fetcher", "INFO" if st == "OK" else "WARNING",
#                         f"  📄 /doc/{tid}/ → {st} | {entry.get('chars', 0):,} chars "
#                         f"| cites={entry.get('cite_count', 0)} citedBy={entry.get('citedby_count', 0)}",
#                         {"endpoint": ep, "status": st, "chars": entry.get("chars")})
#             elif "/docfragment/" in ep:
#                 _db_log(run_id, "fetcher", "fetcher", "INFO" if st in ("OK", "SKIPPED") else "WARNING",
#                         f"  🔍 /docfragment/{tid}/ → {st}"
#                         + (" | headline found" if entry.get("has_headline") else ""),
#                         {"endpoint": ep, "status": st})
#             elif "/docmeta/" in ep:
#                 _db_log(run_id, "fetcher", "fetcher", "INFO" if st in ("OK", "SKIPPED") else "WARNING",
#                         f"  📋 /docmeta/{tid}/ → {st} | "
#                         f"publishdate={entry.get('publishdate','?')} numcites={entry.get('numcites','?')}",
#                         {"endpoint": ep, "status": st,
#                          "publishdate": entry.get("publishdate"), "numcites": entry.get("numcites")})
#             elif "/origdoc/" in ep:
#                 _db_log(run_id, "fetcher", "fetcher",
#                         "INFO" if "OK" in st or st == "SKIPPED" else "WARNING",
#                         f"  📎 /origdoc/{tid}/ → {st}"
#                         + (" | PDF→GCS" if entry.get("is_pdf") and entry.get("gcs_url") else ""),
#                         {"endpoint": ep, "status": st, "is_pdf": entry.get("is_pdf"),
#                          "gcs_url": (entry.get("gcs_url") or "")[:80]})

#         raw_content = fields.get("raw_content") or ""
#         doc_html    = fields.get("doc_html") or ""
#         if not raw_content and doc_html:
#             raw_content = _strip_html(doc_html)

#         # ── Stub check: force live re-fetch when cache payload is too short ──
#         if len(raw_content) < MIN_JUDGMENT_CHARS and enriched.get("_cache_hit"):
#             _db_log(run_id, "fetcher", "fetcher", "INFO",
#                     f"  🔄 Cache payload for #{tid} incomplete — forcing live re-fetch")
#             enriched = ik_enrich_candidate_cached(
#                 doc_id=tid, query=query, fetch_origdoc=fetch_origdoc,
#                 maxcites=maxcites, maxcitedby=maxcitedby,
#                 cache_ttl_hours=0, force_refresh=True,
#                 run_id=run_id, user_id=user_id,
#             )
#             fields = build_ik_report_fields(enriched)
#             raw_content = fields.get("raw_content") or ""
#             doc_html    = fields.get("doc_html") or ""
#             if not raw_content and doc_html:
#                 raw_content = _strip_html(doc_html)

#         # ── Stub filter: discard if still too short ───────────────────────────
#         if len(raw_content) < MIN_JUDGMENT_CHARS:
#             logger.warning("[FETCHER] IK doc %s is a stub (%d chars < %d) — discarded",
#                            tid, len(raw_content), MIN_JUDGMENT_CHARS)
#             _db_log(run_id, "fetcher", "fetcher", "WARNING",
#                     f"  🗑 IK doc #{tid} discarded — stub ({len(raw_content)} chars < {MIN_JUDGMENT_CHARS})")
#             return None

#         orig_url = fields.get("original_copy_url") or ""
#         _db_log(run_id, "fetcher", "fetcher", "INFO",
#                 f"  ✓ IK #{tid}: {title} — {len(raw_content):,} chars"
#                 + (f" | origdoc={orig_url[:60]}" if orig_url else "")
#                 + (f" | cites={len(fields.get('cite_list') or [])}"
#                    f" citedBy={len(fields.get('cited_by_list') or [])}"),
#                 {"tid": tid, "chars": len(raw_content), "original_copy_url": orig_url})
#         return {
#             "external_id":            tid,
#             "title":                  c.get("title") or fields.get("title", ""),
#             "doc_html":               doc_html,
#             "raw_content":            raw_content[:500_000],
#             "docsource":              c.get("docsource") or fields.get("docsource", ""),
#             "source":                 "indian_kanoon",
#             "cite_list":              fields.get("cite_list") or [],
#             "cited_by_list":          fields.get("cited_by_list") or [],
#             "ik_fragment_headline":   fields.get("ik_fragment_headline") or "",
#             "ik_fragment_html":       fields.get("ik_fragment_html") or "",
#             "ik_form_input":          fields.get("ik_form_input") or "",
#             "ik_doc_meta":            fields.get("ik_doc_meta") or {},
#             "original_copy_url":      orig_url,
#             "original_copy_gcs_path": fields.get("original_copy_gcs_path") or "",
#             "is_original_copy_pdf":   fields.get("is_original_copy_pdf") or False,
#             "origdoc_html_content":   fields.get("origdoc_html_content") or "",
#             # Preserve dimension metadata from Watchdog search
#             "_dimension_id":          c.get("_dimension_id"),
#             "_dimension_name":        c.get("_dimension_name", ""),
#             "_query_type":            c.get("_query_type", ""),
#         }

#     else:
#         # ── Bare fallback: /doc/<id>/ only ────────────────────────────────────
#         token = _get_ik_token()
#         if not token:
#             return None
#         try:
#             url = f"https://api.indiankanoon.org/doc/{tid}/"
#             req = urllib.request.Request(url, method="POST")
#             req.add_header("Authorization", f"Token {token}")
#             req.add_header("Accept", "application/json")
#             req.add_header("User-Agent", "Mozilla/5.0 (compatible; JurinexCitation/1.0)")
#             with urllib.request.urlopen(req, timeout=30) as resp:
#                 data = json.loads(resp.read().decode())
#         except Exception as e:
#             logger.warning("[FETCHER] IK doc fallback failed for %s: %s", tid, e)
#             return None
#         doc_html    = data.get("doc") or ""
#         raw_content = _strip_html(doc_html)
#         if len(raw_content) < MIN_JUDGMENT_CHARS:
#             return None
#         return {
#             "external_id":  tid,
#             "title":        c.get("title") or data.get("title", ""),
#             "doc_html":     doc_html,
#             "raw_content":  raw_content[:500_000],
#             "docsource":    c.get("docsource", ""),
#             "source":       "indian_kanoon",
#             "cite_list":    data.get("citeList") or [],
#             "cited_by_list": data.get("citedbyList") or [],
#             "_dimension_id":   c.get("_dimension_id"),
#             "_dimension_name": c.get("_dimension_name", ""),
#             "_query_type":     c.get("_query_type", ""),
#         }


# # ── Public API ────────────────────────────────────────────────────────────────

# def fetch_ik_candidates(
#     candidates: List[Dict[str, Any]],
#     query: str = "",
#     run_id: Optional[str] = None,
#     user_id: Optional[str] = None,
#     fetch_origdoc: bool = True,
#     maxcites: int = 10,
#     maxcitedby: int = 10,
# ) -> List[Dict[str, Any]]:
#     """
#     Fetch full document content for all IK candidates in parallel.

#     Uses asyncio.Semaphore(FETCHER_SEMAPHORE_LIMIT) to cap concurrent API calls,
#     asyncio.gather() for parallel execution, and a single httpx.AsyncClient
#     session for connection pooling across the entire batch.

#     Stubs (< MIN_JUDGMENT_CHARS) are discarded silently.
#     Returns list of enriched dicts ready for Clerk ingestion.
#     """
#     if not candidates:
#         return []

#     _db_log(run_id, "fetcher", "fetcher", "INFO",
#             f"📡 IK fetch — {len(candidates)} candidate(s) | "
#             f"semaphore={FETCHER_SEMAPHORE_LIMIT} | min_chars={MIN_JUDGMENT_CHARS}",
#             {"total": len(candidates), "semaphore_limit": FETCHER_SEMAPHORE_LIMIT})

#     out = _run_async_safe(
#         _fetch_ik_candidates_async(
#             candidates, query, run_id, user_id, fetch_origdoc, maxcites, maxcitedby,
#         )
#     )

#     skipped = len(candidates) - len(out)
#     _db_log(run_id, "fetcher", "fetcher", "INFO",
#             f"✅ IK fetch done — {len(out)}/{len(candidates)} fetched"
#             + (f", {skipped} stub/error" if skipped else ""),
#             {"fetched": len(out), "skipped": skipped})
#     logger.info("[FETCHER] IK fetch complete: %d/%d fetched, %d skipped",
#                 len(out), len(candidates), skipped)
#     return out


# def fetch_google_candidates(
#     candidates: List[Dict[str, Any]],
#     run_id: Optional[str] = None,
#     user_id: Optional[str] = None,
# ) -> List[Dict[str, Any]]:
#     """
#     Fetch URL content for Google candidates.
#     IK web URLs (indiankanoon.org/doc/{tid}/) are routed to the IK API automatically.
#     Stubs (< MIN_JUDGMENT_CHARS) are discarded.
#     """
#     if not candidates:
#         return []

#     _db_log(run_id, "fetcher", "fetcher", "INFO",
#             f"📡 Google URL fetch — {len(candidates)} URL(s)…",
#             {"total": len(candidates)})

#     def _read_url_with_ssl_retry(link: str, title: str) -> str:
#         """
#         Fetch URL content with robust SSL handling:
#         1) requests + certifi CA bundle
#         2) retry once
#         3) optional dev fallback via unverified SSL context
#         """
#         allow_unverified = (os.environ.get("CITATION_ALLOW_INSECURE_SSL_FALLBACK") or "1").strip().lower() in (
#             "1", "true", "yes", "on"
#         )
#         last_err: Optional[Exception] = None
#         for attempt in range(1, 3):
#             try:
#                 resp = requests.get(
#                     link,
#                     headers={"User-Agent": "Mozilla/5.0 (compatible; JurinexCitation/1.0)"},
#                     timeout=15,
#                     verify=certifi.where(),
#                 )
#                 resp.raise_for_status()
#                 content_type = (resp.headers.get("Content-Type") or "").lower()
#                 if "pdf" in content_type or link.lower().endswith(".pdf"):
#                     return "[PDF content not extracted in fetcher; URL stored for reference.]"
#                 resp.encoding = resp.encoding or "utf-8"
#                 return (resp.text or "")[:300_000]
#             except Exception as exc:
#                 last_err = exc
#                 logger.warning(
#                     "[FETCHER] GET attempt %d failed %s: %s",
#                     attempt, link[:80], exc,
#                 )
#                 if attempt < 2:
#                     continue

#         if allow_unverified:
#             try:
#                 _db_log(run_id, "fetcher", "fetcher", "WARNING",
#                         f"  ⚠ SSL verify failed; trying insecure dev fallback: {title}")
#                 req = urllib.request.Request(link, method="GET")
#                 req.add_header("User-Agent", "Mozilla/5.0 (compatible; JurinexCitation/1.0)")
#                 ctx = ssl._create_unverified_context()
#                 with urllib.request.urlopen(req, timeout=15, context=ctx) as resp:
#                     raw = resp.read()
#                     content_type = (resp.headers.get("Content-Type") or "").lower()
#                 if "pdf" in content_type or link.lower().endswith(".pdf"):
#                     return "[PDF content not extracted in fetcher; URL stored for reference.]"
#                 return raw.decode("utf-8", errors="replace")[:300_000]
#             except Exception as exc:
#                 last_err = exc
#         if last_err:
#             logger.warning("[FETCHER] Exhausted retries for %s: %s", link[:80], last_err)
#         return ""

#     def _fetch_one_google(c: Dict[str, Any]) -> Optional[Dict[str, Any]]:
#         link  = c.get("link", "")
#         title = (c.get("title") or link)[:70]
#         if not link:
#             return None

#         if _IK_SEARCH_URL_RE.match(link):
#             _db_log(run_id, "fetcher", "fetcher", "INFO",
#                     f"  ↷ Skip IK search page: {title}")
#             return None

#         # Redirect IK web URLs to IK API
#         ik_match = _IK_WEB_URL_RE.match(link)
#         if ik_match:
#             tid = ik_match.group(1)
#             _db_log(run_id, "fetcher", "fetcher", "INFO",
#                     f"  🔀 IK web URL → API (tid={tid}): {title}")
#             ik_results = fetch_ik_candidates(
#                 [{"external_id": tid, "title": c.get("title", "")}],
#                 query=c.get("snippet", "") or c.get("title", ""),
#                 run_id=run_id, user_id=user_id, fetch_origdoc=False,
#             )
#             if ik_results:
#                 return {"batched_results": ik_results}
#             _db_log(run_id, "fetcher", "fetcher", "INFO",
#                     f"  ↷ IK API unavailable for tid={tid} — falling back to direct GET")

#         _db_log(run_id, "fetcher", "fetcher", "INFO",
#                 f"  🌐 GET: {title} | {link[:60]}")
#         try:
#             content = _read_url_with_ssl_retry(link, title)
#             if not content:
#                 _db_log(run_id, "fetcher", "fetcher", "WARNING",
#                         f"  ⚠ URL fetch returned empty after retry: {link[:60]}")
#                 return None

#             # ── Stub filter ───────────────────────────────────────────────────
#             if len(content) < MIN_JUDGMENT_CHARS:
#                 logger.warning("[FETCHER] Google URL stub (%d chars) — discard: %s",
#                                len(content), link[:80])
#                 _db_log(run_id, "fetcher", "fetcher", "WARNING",
#                         f"  🗑 Stub ({len(content)} chars) — discarded: {link[:60]}")
#                 return None

#             _db_log(run_id, "fetcher", "fetcher", "INFO",
#                     f"  ✓ Fetched: {title} — {len(content):,} chars")
#             return {
#                 "link":        link,
#                 "title":       c.get("title", ""),
#                 "snippet":     c.get("snippet", ""),
#                 "raw_content": content,
#                 "source":      "google",
#                 "source_type": c.get("source_type") or "google_grounding",
#                 "source_url":  link,
#             }
#         except Exception as e:
#             logger.warning("[FETCHER] GET failed %s: %s", link[:80], e)
#             _db_log(run_id, "fetcher", "fetcher", "WARNING",
#                     f"  ⚠ GET failed: {link[:60]} — {e}")
#             return None

#     out: List[Dict[str, Any]] = []
#     skipped = 0
#     from concurrent.futures import ThreadPoolExecutor, as_completed as _as_completed
#     with ThreadPoolExecutor(max_workers=min(GOOGLE_FETCH_WORKERS, len(candidates) or 1)) as pool:
#         futs = {pool.submit(_fetch_one_google, c): c for c in candidates}
#         for fut in _as_completed(futs):
#             try:
#                 result = fut.result(timeout=90)
#                 if not result:
#                     skipped += 1
#                 elif "batched_results" in result:
#                     out.extend(result["batched_results"])
#                 else:
#                     out.append(result)
#             except Exception as exc:
#                 logger.warning("[FETCHER] Google worker error: %s", exc)
#                 skipped += 1

#     _db_log(run_id, "fetcher", "fetcher", "INFO",
#             f"✅ Google fetch done — {len(out)}/{len(candidates)} fetched"
#             + (f", {skipped} skipped" if skipped else ""),
#             {"fetched": len(out), "skipped": skipped})
#     return out
# ─────────────────────────────────────────────────────────────
# 🔥 NEW: RELEVANCE ENGINE
# ─────────────────────────────────────────────────────────────

def _normalize(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").lower()).strip()


def _extract_keywords(query: str) -> set:
    stopwords = {"the", "is", "in", "of", "and", "for", "to", "a"}
    words = re.findall(r"\w+", query.lower())
    return {w for w in words if w not in stopwords and len(w) > 2}


def _legal_keywords_boost(text: str) -> int:
    legal_terms = [
        "section", "act", "ipc", "crpc", "constitution",
        "offence", "petition", "appeal", "tribunal", "court",
        "liability", "negligence", "contract", "bail", "criminal"
    ]
    return sum(1 for t in legal_terms if t in text.lower())


def _score_candidate(candidate: Dict[str, Any], query: str) -> float:
    query_words = _extract_keywords(query)

    title = _normalize(candidate.get("title", ""))
    snippet = _normalize(candidate.get("snippet", ""))

    text = f"{title} {snippet}"

    overlap = sum(1 for w in query_words if w in text)
    legal_boost = _legal_keywords_boost(text)

    return overlap * 2 + legal_boost


def _filter_and_rank_candidates(
    candidates: List[Dict[str, Any]],
    query: str,
    top_k: int = 15
) -> List[Dict[str, Any]]:

    scored = []

    for c in candidates:
        score = _score_candidate(c, query)

        if score <= 1:
            continue  # HARD FILTER

        c["_relevance_score"] = score
        scored.append(c)

    scored.sort(key=lambda x: x["_relevance_score"], reverse=True)

    return scored[:top_k]


def _prioritize_local_db(candidates: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    try:
        from db.client import judgement_exists
    except Exception:
        return candidates

    local_first = []
    others = []

    for c in candidates:
        try:
            if judgement_exists(c.get("external_id")):
                local_first.append(c)
            else:
                others.append(c)
        except Exception:
            others.append(c)

    return local_first + others


# ─────────────────────────────────────────────────────────────
# 🔥 MODIFICATION: MAIN FETCH ENTRY
# ─────────────────────────────────────────────────────────────

def fetch_ik_candidates(
    candidates: List[Dict[str, Any]],
    query: str = "",
    run_id: Optional[str] = None,
    user_id: Optional[str] = None,
    fetch_origdoc: bool = True,
    maxcites: int = 10,
    maxcitedby: int = 10,
) -> List[Dict[str, Any]]:

    if not candidates:
        return []

    _db_log(run_id, "fetcher", "fetcher", "INFO",
            f"📡 IK fetch — {len(candidates)} candidates")

    # ✅ STEP 1: Filter + Rank
    filtered_candidates = _filter_and_rank_candidates(candidates, query)

    # ✅ STEP 2: Prioritize local DB
    filtered_candidates = _prioritize_local_db(filtered_candidates)

    _db_log(run_id, "fetcher", "fetcher", "INFO",
            f"🎯 Filtered {len(filtered_candidates)}/{len(candidates)} relevant candidates")

    # ✅ STEP 3: Fetch async
    out = _run_async_safe(
        _fetch_ik_candidates_async(
            filtered_candidates,
            query,
            run_id,
            user_id,
            fetch_origdoc,
            maxcites,
            maxcitedby,
        )
    )

    return out
