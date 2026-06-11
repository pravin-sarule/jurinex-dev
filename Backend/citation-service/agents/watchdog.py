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
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from urllib.parse import urlparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

SEARCH_WORKERS          = max(1, min(10, int(os.environ.get("CITATION_WATCHDOG_WORKERS", "6"))))
IK_BATCH_SIZE           = max(1, int(os.environ.get("CITATION_IK_BATCH_SIZE", "5")))
IK_BATCH_STAGGER_SECS   = float(os.environ.get("CITATION_IK_BATCH_STAGGER_MS", "200")) / 1000.0
_GROUNDING_ALLOWED_SITES: Tuple[str, ...] = (
    "indiankanoon.org",
    "casemine.com",
    "app.bharatlaw.ai",
    "lawfinderlive.com",
    "judgments.ecourts.gov.in",
)

# ── Default prompt for IK candidate re-ranking (DB-overridable) ───────────────
_RERANK_IK_PROMPT = (
    "You are a senior Indian legal research analyst.\n\n"
    "Rate each judgment below for relevance to the legal dispute. "
    "Score 0-5 where:\n"
    "  5=directly on point (same facts/provision/controversy)\n"
    "  3-4=useful precedent on one key issue\n"
    "  1-2=tangentially relevant\n"
    "  0=wrong area or no connection\n\n"
    "DISPUTE:\n{controversy_text}\n\n"
    "JUDGMENTS:\n{judgments_list}\n\n"
    "Return a JSON array with one object per judgment in the SAME ORDER:\n"
    '[{{"index":1,"score":<0-5>}},{{"index":2,"score":<0-5>}},...]\n'
    "Return ONLY the JSON array."
)


def _google_source_type_for_link(link: str) -> str:
    host = (urlparse(str(link or "")).netloc or "").lower()
    if host.startswith("www."):
        host = host[4:]
    if host.endswith("indiankanoon.org"):
        return "indian_kanoon"
    if host.endswith("casemine.com"):
        return "casemine"
    if host.endswith("app.bharatlaw.ai"):
        return "bharatlaw"
    if host.endswith("lawfinderlive.com"):
        return "lawfinderlive"
    if host.endswith("judgments.ecourts.gov.in"):
        return "ecourts"
    return "google_grounding"


def _is_allowed_grounding_link(link: str) -> bool:
    host = (urlparse(str(link or "")).netloc or "").lower()
    if host.startswith("www."):
        host = host[4:]
    return any(host == site or host.endswith(f".{site}") for site in _GROUNDING_ALLOWED_SITES)

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


def _is_pending_result(candidate: Dict[str, Any]) -> bool:
    """
    True when the India Kanoon result represents a Pending (undecided) case.

    Filters per JuriNex Spec v1.1 Section 6 — Status filter:
      Include: Approved only. Exclude: Pending, Draft, Unknown.

    Checks:
      1. Explicit 'status' field from IK API ("pending", "draft")
      2. 'publishdate' field absent or explicitly null (no date = not yet published)
      3. 'docsource' or 'title' contain the word "pending"
    """
    # Check explicit status field from IK API response
    status = str(candidate.get("status") or "").strip().lower()
    if status in ("pending", "draft", "unknown"):
        return True

    # If publishdate is explicitly null/empty in the raw doc field it was not yet decided
    raw_doc = candidate.get("_raw_doc") or {}
    if isinstance(raw_doc, dict):
        pub = raw_doc.get("publishdate")
        if pub is None or str(pub or "").strip() in ("", "null", "None"):
            # Only reject if there is an explicit null (not just missing key)
            if "publishdate" in raw_doc and not pub:
                return True

    # Check docsource string for "pending" keyword
    docsource = (candidate.get("docsource") or "").lower()
    if "pending" in docsource:
        return True

    # Check title for "pending" keyword (e.g., "CBI vs Arjun Singh — Pending")
    title = (candidate.get("title") or "").lower()
    if " pending" in title or title.startswith("pending "):
        return True

    return False


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
    q_type = str(candidate.get("_query_type") or "").strip().lower()
    if q_type == "provision" and _is_low_hierarchy(ds):
        return 0
    return -1


# ── Local DB ──────────────────────────────────────────────────────────────────

def _search_local(
    query: str,
    limit: int = 10,
    run_id: Optional[str] = None,
    case_state: str = "",
    dimension_id: Any = None,
    dimension_name: str = "",
    query_type: str = "keyword",
) -> List[Dict[str, Any]]:
    """Search local DB (judgements table)."""
    try:
        from db.client import judgement_search_local
        _db_log(run_id, "watchdog", "watchdog", "INFO", f"🏛 Searching Local DB for: {query[:80]!r}")
        rows = judgement_search_local(
            query,
            limit=limit,
            case_state=case_state,
            approved_only=True,
            exclude_low_hierarchy=True,
        )
        for r in rows:
            r["_source"] = "local"
            r["_dimension_id"] = dimension_id
            r["_dimension_name"] = dimension_name or ""
            r["dimension_id"] = dimension_id
            r["dimension_name"] = dimension_name or ""
            r["_query_type"] = query_type
            r["_query"] = query
        logger.info("[WATCHDOG] 🏛  SOURCE=local_db → %d result(s) for query: %r", len(rows), query[:80])
        for r in rows:
            _cid = str(r.get("canonical_id") or r.get("id") or "").strip() or "—"
            logger.info(
                "  ├─ [LOCAL_DB]  canonical_id=%s | title=%-45s | citation=%-20s | court=%s",
                _cid,
                (r.get("title") or "?")[:45],
                (r.get("primary_citation") or "—")[:20],
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


# ── Qdrant semantic search removed — citation service uses ES keyword search ──
# ── Elasticsearch keyword search ─────────────────────────────────────────────

def _fetch_admin_canonical_ids(run_id: Optional[str] = None) -> List[str]:
    """Return canonical_ids of all admin-uploaded judgments from PostgreSQL."""
    _admin_source_types = [
        "admin", "admin_upload", "admin-upload", "admin uploaded",
        "admin-uploaded", "adminupload", "manual_upload", "manual-upload",
        "judgment_upload", "judgement_upload",
    ]
    try:
        from db.connections import get_pg_conn
        conn = get_pg_conn()
        if not conn:
            return []
        try:
            cids: List[str] = []
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT canonical_id FROM judgments "
                    "WHERE LOWER(COALESCE(source_type,'')) = ANY(%s) "
                    "AND canonical_id IS NOT NULL AND canonical_id <> ''",
                    (_admin_source_types,),
                )
                for row in (cur.fetchall() or []):
                    cid = str(row[0] if isinstance(row, tuple) else row.get("canonical_id") or "").strip()
                    if cid:
                        cids.append(cid)
            return cids
        finally:
            conn.close()
    except Exception as exc:
        logger.warning("[WATCHDOG] _fetch_admin_canonical_ids failed: %s", exc)
        return []


_ADMIN_SOURCE_KEYWORD_VALUES = [
    "admin", "admin_upload", "admin-upload", "admin uploaded",
    "admin-uploaded", "adminupload", "manual_upload", "manual-upload",
    "judgment_upload", "judgement_upload",
]

_LOW_HIERARCHY_PHRASES = [
    "district court", "district judge", "sessions court",
    "magistrate", "tribunal", "consumer forum", "consumer commission",
]


def _es_rows_from_hits(
    hits: List[Dict[str, Any]],
    case_state: str = "",
) -> List[Dict[str, Any]]:
    """Convert raw ES hits to watchdog-compatible row dicts."""
    out: List[Dict[str, Any]] = []
    for h in hits:
        src = h.get("_source") or {}
        es_score = float(h.get("_score") or 0.0)
        cid = str(src.get("canonical_id") or h.get("_id") or "").strip()
        if not cid:
            continue
        src_type = str(src.get("source_type") or "").strip().lower()
        is_admin = (
            src_type in set(_ADMIN_SOURCE_KEYWORD_VALUES)
            or src_type.startswith("admin")
        )
        court = str(src.get("court_code") or src.get("court_name") or "").strip()
        c_lower = court.lower()
        local_rank = 300 if "supreme" in c_lower else (
            (225 if (case_state or "").lower() in c_lower else 200) if "high" in c_lower else 100
        )
        out.append({
            "id":               cid,
            "canonical_id":     cid,
            "title":            src.get("case_name") or src.get("title") or "",
            "court":            court,
            "primary_citation": src.get("primary_citation") or "",
            "ratio":            src.get("holding_text") or src.get("summary_text") or "",
            "full_text":        src.get("full_text") or "",
            "source_type":      src_type,
            "is_local_admin":   is_admin,
            "has_analysis_report": bool(src.get("holding_text") or src.get("summary_text")),
            "_es_score":        es_score,
            "_local_rank":      local_rank,
        })
    return out


def _es_search_one_keyword(
    query: str,
    es: Any,
    limit: int,
    case_state: str = "",
) -> List[Dict[str, Any]]:
    """
    Run one ES multi_match query covering case_name, citations, and full text.
    Includes admin uploads regardless of verification_status via a should-filter.
    Returns watchdog row dicts tagged with _es_score.
    """
    try:
        resp = es.search(
            index="judgments",
            size=limit,
            query={
                "bool": {
                    "must": [{
                        "multi_match": {
                            "query": query,
                            "fields": [
                                "case_name^4",
                                "primary_citation^3",
                                "summary_text^2",
                                "holding_text^2",
                                "facts_text",
                                "full_text",
                            ],
                            "type": "best_fields",
                            "fuzziness": "AUTO",
                            "operator": "or",
                        }
                    }],
                    # Include verified judgments OR admin-uploaded ones
                    "filter": [{
                        "bool": {
                            "should": [
                                {"terms": {"verification_status.keyword": [
                                    "APPROVED", "VERIFIED", "VERIFIED_WARN", "GREEN"
                                ]}},
                                {"terms": {"source_type.keyword": _ADMIN_SOURCE_KEYWORD_VALUES}},
                            ],
                            "minimum_should_match": 1,
                        }
                    }],
                    "must_not": [
                        {"match_phrase": {"court_code": ph}}
                        for ph in _LOW_HIERARCHY_PHRASES
                    ],
                }
            },
        )
        hits = resp.get("hits", {}).get("hits", [])
        return _es_rows_from_hits(hits, case_state=case_state)
    except Exception as exc:
        logger.warning("[WATCHDOG_ES] ES search failed for %r: %s", query[:60], exc)
        return []


def _search_local_by_keywords(
    keyword_sets: List[str],
    max_total: int = 30,
    case_state: str = "",
    run_id: Optional[str] = None,
    controversy_query: str = "",
) -> List[Dict[str, Any]]:
    """
    Hybrid local search over local+IK judgments.

    For each keyword, runs ES multi_match and tracks which judgments were returned.
    _keyword_score = number of keyword queries that matched the judgment.
    Also performs semantic lookup in Qdrant using controversy_query (if provided),
    then merges and deduplicates canonical_ids.
    Admin judgments force-included with _keyword_score=0 when not found by any query.
    Results sorted by keyword score first, then semantic similarity.
    Falls back to PostgreSQL _search_local when ES is unavailable.
    """
    if not keyword_sets:
        return []

    from db.connections import get_es_client, elasticsearch_init_failed
    es = get_es_client()

    if not es or elasticsearch_init_failed():
        logger.warning("[WATCHDOG_ES] ES unavailable — falling back to PG keyword search")
        return _search_local_pg_keywords(keyword_sets, max_total, case_state, run_id)

    per_query = max(10, (max_total * 2) // max(len(keyword_sets), 1))
    cid_map: Dict[str, Dict[str, Any]] = {}

    for i, kw in enumerate(keyword_sets):
        kw = (kw or "").strip()
        if not kw:
            continue
        rows = _es_search_one_keyword(kw, es, per_query, case_state=case_state)
        for r in rows:
            cid = str(r.get("canonical_id") or r.get("id") or "").strip()
            if not cid:
                continue
            if cid not in cid_map:
                cid_map[cid] = {
                    "row": dict(r),
                    "keyword_score": 0,
                    "matched_queries": [],
                    "dimension_ids": [],
                    "dimension_names": [],
                }
            entry = cid_map[cid]
            entry["keyword_score"] += 1
            entry["matched_queries"].append(kw[:60])
            if (i + 1) not in entry["dimension_ids"]:
                entry["dimension_ids"].append(i + 1)
            if "Keyword Query" not in entry["dimension_names"]:
                entry["dimension_names"].append("Keyword Query")

    # ── Admin-first: Qdrant search on judgment-service-embeddings ────────────
    # Always run this regardless of controversy_query so admin uploads are
    # always surfaced first with highest priority in the merged result set.
    admin_collection = os.environ.get("ADMIN_QDRANT_COLLECTION", "judgment-service-embeddings")
    admin_sem_query = (controversy_query or " ".join(keyword_sets[:3]) or "").strip()
    try:
        from db.client import fetch_admin_judgments_semantic
        admin_rows = fetch_admin_judgments_semantic(
            query=admin_sem_query,
            limit=20,
        )
        for r in admin_rows:
            cid = str(r.get("canonical_id") or r.get("id") or "").strip()
            if not cid:
                continue
            sem = float(r.get("_semantic_score") or 0.0)
            if cid not in cid_map:
                cid_map[cid] = {
                    "row": dict(r),
                    "keyword_score": 0,
                    "semantic_score": sem,
                    "matched_queries": [],
                    "dimension_ids": [],
                    "dimension_names": [],
                }
            else:
                entry = cid_map[cid]
                entry["semantic_score"] = max(float(entry.get("semantic_score") or 0.0), sem)
                if not entry.get("row"):
                    entry["row"] = dict(r)
        logger.info(
            "[WATCHDOG_ES] Admin-first (judgment-service-embeddings) → %d judgment(s)",
            len(admin_rows),
        )
        _db_log(
            run_id, "watchdog", "watchdog", "INFO",
            f"🏛 Admin-first (judgment-service-embeddings) → {len(admin_rows)} judgment(s)",
            {"source": "admin_qdrant", "count": len(admin_rows), "collection": admin_collection},
        )
    except Exception as exc:
        logger.warning("[WATCHDOG_ES] Admin-first Qdrant lookup failed: %s", exc)

    # Semantic local recall: Qdrant nearest-neighbours for controversy query.
    sem_query = (controversy_query or "").strip()
    if sem_query:
        try:
            from db.client import judgement_search_semantic
            qdrant_collection = os.environ.get("QDRANT_COLLECTION", "legal_embeddings_v2")
            sem_rows = judgement_search_semantic(
                sem_query,
                limit=10,
                case_state=case_state,
                approved_only=True,
                exclude_low_hierarchy=True,
                qdrant_collection=qdrant_collection,
            )
            for r in sem_rows:
                cid = str(r.get("canonical_id") or r.get("id") or "").strip()
                if not cid:
                    continue
                if cid not in cid_map:
                    cid_map[cid] = {
                        "row": dict(r),
                        "keyword_score": 0,
                        "semantic_score": float(r.get("_semantic_score") or r.get("_similarity_score") or 0.0),
                        "matched_queries": [],
                        "dimension_ids": [],
                        "dimension_names": [],
                    }
                    continue
                entry = cid_map[cid]
                entry["semantic_score"] = max(
                    float(entry.get("semantic_score") or 0.0),
                    float(r.get("_semantic_score") or r.get("_similarity_score") or 0.0),
                )
                if not entry.get("row"):
                    entry["row"] = dict(r)
            logger.info("[WATCHDOG_ES] Qdrant semantic local → %d judgment(s)", len(sem_rows))
            _db_log(
                run_id, "watchdog", "watchdog", "INFO",
                f"🏛 Qdrant semantic local → {len(sem_rows)} judgment(s)",
                {"source": "qdrant_semantic", "count": len(sem_rows), "collection": qdrant_collection},
            )
        except Exception as exc:
            logger.warning("[WATCHDOG_ES] Qdrant semantic lookup failed: %s", exc)

    # Force-include admin judgments not returned by any keyword query
    admin_cids = _fetch_admin_canonical_ids(run_id=run_id)
    missing_admin = [c for c in admin_cids if c not in cid_map]
    if missing_admin:
        try:
            # Batch ES mget for missing admin cids
            mres = es.mget(index="judgments", body={"ids": missing_admin[:100]})
            for d in (mres.get("docs") or []):
                if not d.get("found"):
                    continue
                src = d.get("_source") or {}
                cid = str(src.get("canonical_id") or d.get("_id") or "").strip()
                if cid and cid not in cid_map:
                    src_type = str(src.get("source_type") or "").strip().lower()
                    court = str(src.get("court_code") or "").strip()
                    cid_map[cid] = {
                        "row": {
                            "id": cid, "canonical_id": cid,
                            "title": src.get("case_name") or "",
                            "court": court,
                            "primary_citation": src.get("primary_citation") or "",
                            "ratio": src.get("holding_text") or src.get("summary_text") or "",
                            "full_text": src.get("full_text") or "",
                            "source_type": src_type,
                            "is_local_admin": True,
                            "has_analysis_report": bool(src.get("holding_text") or src.get("summary_text")),
                            "_es_score": 0.0,
                        },
                        "keyword_score": 0,
                        "semantic_score": 0.0,
                        "matched_queries": [],
                        "dimension_ids": [],
                        "dimension_names": [],
                    }
        except Exception as exc:
            logger.warning("[WATCHDOG_ES] Admin mget failed: %s", exc)

    # Build output rows tagged with _keyword_score
    out: List[Dict[str, Any]] = []
    for cid, entry in cid_map.items():
        r = entry["row"]
        ks = entry["keyword_score"]
        sem = float(entry.get("semantic_score") or r.get("_semantic_score") or r.get("_similarity_score") or 0.0)
        is_admin = bool(r.get("is_local_admin"))
        dim_ids = entry["dimension_ids"]
        dim_names = entry["dimension_names"]
        primary_dim_id = dim_ids[0] if dim_ids else None
        primary_dim_name = dim_names[0] if dim_names else ""
        out.append({
            **r,
            "_source":              "local",
            "_dimension_id":        primary_dim_id,
            "_dimension_name":      primary_dim_name,
            "dimension_id":         primary_dim_id,
            "dimension_name":       primary_dim_name,
            "_query_type":          "keyword",
            "_dimension_ids":       dim_ids,
            "_dimension_names":     dim_names,
            "_keyword_score":       ks,
            "_semantic_score":      sem,
            "_similarity_score":    sem if sem > 0 else float(ks),
            "is_local_admin":       is_admin,
            "_needs_clerk_analysis": not bool(r.get("has_analysis_report")),
        })

    out.sort(
        key=lambda r: (
            # Admin-uploaded judgments always surface first
            1 if r.get("is_local_admin") else 0,
            float(r.get("_keyword_score", 0) or 0.0),
            float(r.get("_semantic_score", 0.0) or 0.0),
            float(r.get("_es_score", 0.0) or 0.0),
        ),
        reverse=True,
    )
    result = out[:max_total]

    scored_count = sum(1 for r in result if r.get("_keyword_score", 0) > 0)
    admin_zero = len(result) - scored_count
    logger.info("[WATCHDOG_ES] ES keyword local → %d judgment(s) (%d scored, %d admin-zero)",
                len(result), scored_count, admin_zero)
    _db_log(run_id, "watchdog", "watchdog", "INFO",
            f"🏛 ES keyword local → {len(result)} judgment(s) ({scored_count} keyword-matched, {admin_zero} admin-0)",
            {"source": "es_keyword", "count": len(result),
             "scored": scored_count, "admin_zero": admin_zero,
             "keyword_count": len(keyword_sets)})
    return result


def _search_local_pg_keywords(
    keyword_sets: List[str],
    max_total: int = 30,
    case_state: str = "",
    run_id: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """PG ILIKE fallback when ES is unavailable."""
    per_query = max(10, (max_total * 2) // max(len(keyword_sets), 1))
    cid_map: Dict[str, Dict[str, Any]] = {}
    for i, kw in enumerate(keyword_sets):
        kw = (kw or "").strip()
        if not kw:
            continue
        rows = _search_local(kw, limit=per_query, run_id=run_id, case_state=case_state,
                             dimension_id=i + 1, dimension_name="Keyword Query", query_type="keyword")
        for r in rows:
            cid = str(r.get("canonical_id") or r.get("id") or "").strip()
            if not cid:
                continue
            if cid not in cid_map:
                cid_map[cid] = {"row": dict(r), "keyword_score": 0,
                                "dimension_ids": [], "dimension_names": []}
            e = cid_map[cid]
            e["keyword_score"] += 1
            if (i + 1) not in e["dimension_ids"]:
                e["dimension_ids"].append(i + 1)

    admin_cids = _fetch_admin_canonical_ids(run_id=run_id)
    for cid in admin_cids:
        if cid not in cid_map:
            try:
                from db.client import judgements_fetch_by_canonical_ids
                rows = judgements_fetch_by_canonical_ids([cid], approved_only=False, exclude_low_hierarchy=False)
                if rows:
                    cid_map[cid] = {"row": dict(rows[0]), "keyword_score": 0,
                                    "dimension_ids": [], "dimension_names": []}
            except Exception:
                pass

    out: List[Dict[str, Any]] = []
    for cid, entry in cid_map.items():
        r = entry["row"]
        ks = entry["keyword_score"]
        dim_ids = entry["dimension_ids"]
        out.append({
            **r, "_source": "local",
            "_dimension_id": dim_ids[0] if dim_ids else None,
            "_dimension_name": "Keyword Query" if dim_ids else "",
            "dimension_id": dim_ids[0] if dim_ids else None,
            "_query_type": "keyword",
            "_dimension_ids": dim_ids, "_dimension_names": ["Keyword Query"] if dim_ids else [],
            "_keyword_score": ks, "_similarity_score": float(ks),
            "is_local_admin": bool(r.get("is_local_admin")),
            "_needs_clerk_analysis": not bool(r.get("has_analysis_report")),
        })
    out.sort(key=lambda r: float(r.get("_keyword_score", 0)), reverse=True)
    return out[:max_total]


def _lookup_ik_candidates_in_es(
    ik_candidates: List[Dict[str, Any]],
    run_id: Optional[str] = None,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """
    Split IK pre-fetched candidates into (already_in_es, needs_clerk).

    Queries ik_document_assets by IK tid (doc_id) → canonical_id.
    Then ES mget by canonical_id for those that exist.
    Returns:
      already_in_es — full ES-hydrated rows tagged _from_es=True, _needs_clerk_analysis=False
      needs_clerk   — original IK candidates not found in ES (Clerk must fetch them)
    """
    if not ik_candidates:
        return [], []

    from db.connections import get_es_client, elasticsearch_init_failed, get_pg_conn
    es = get_es_client()
    if not es or elasticsearch_init_failed():
        return [], ik_candidates  # all need Clerk

    # Build map: tid → original candidate
    tid_to_cand: Dict[str, Dict[str, Any]] = {}
    for c in ik_candidates:
        tid = str(c.get("external_id") or "").strip()
        if tid:
            tid_to_cand[tid] = c

    if not tid_to_cand:
        return [], ik_candidates

    # Query PG ik_document_assets to map doc_id (IK tid) → canonical_id
    tid_to_cid: Dict[str, str] = {}
    conn = get_pg_conn()
    if conn:
        try:
            tids_list = list(tid_to_cand.keys())
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT doc_id, canonical_id FROM ik_document_assets "
                    "WHERE doc_id = ANY(%s) AND canonical_id IS NOT NULL AND canonical_id <> ''",
                    (tids_list,)
                )
                for row in (cur.fetchall() or []):
                    if isinstance(row, tuple):
                        d, c = str(row[0] or "").strip(), str(row[1] or "").strip()
                    else:
                        d, c = str(row.get("doc_id") or "").strip(), str(row.get("canonical_id") or "").strip()
                    if d and c:
                        tid_to_cid[d] = c
        except Exception as exc:
            logger.warning("[WATCHDOG_ES] ik_document_assets lookup failed: %s", exc)
        finally:
            conn.close()

    if not tid_to_cid:
        return [], ik_candidates  # none stored yet

    # ES mget for known canonical_ids
    cids = list(set(tid_to_cid.values()))
    cid_to_es: Dict[str, Dict[str, Any]] = {}
    try:
        mres = es.mget(index="judgments", body={"ids": cids})
        for d in (mres.get("docs") or []):
            if not d.get("found"):
                continue
            src = d.get("_source") or {}
            cid = str(src.get("canonical_id") or d.get("_id") or "").strip()
            if cid:
                cid_to_es[cid] = src
    except Exception as exc:
        logger.warning("[WATCHDOG_ES] ES mget for IK candidates failed: %s", exc)
        return [], ik_candidates

    already_in_es: List[Dict[str, Any]] = []
    needs_clerk: List[Dict[str, Any]] = []

    for c in ik_candidates:
        tid = str(c.get("external_id") or "").strip()
        cid = tid_to_cid.get(tid, "")
        src = cid_to_es.get(cid) if cid else None

        if src:
            src_type = str(src.get("source_type") or "indian_kanoon").strip().lower()
            court = str(src.get("court_code") or src.get("court_name") or c.get("docsource") or "").strip()
            row = {
                **c,  # keep original IK metadata (tid, title, snippet, docsource)
                "id":               cid,
                "canonical_id":     cid,
                "title":            src.get("case_name") or c.get("title") or "",
                "court":            court,
                "primary_citation": src.get("primary_citation") or "",
                "ratio":            src.get("holding_text") or src.get("summary_text") or "",
                "full_text":        src.get("full_text") or "",
                "source_type":      src_type,
                "is_local_admin":   False,
                "_source":          "indian_kanoon",
                "_from_es":         True,
                "_needs_clerk_analysis": False,  # already enriched in ES
                "_keyword_score":   0,
                "_similarity_score": 0.0,
            }
            already_in_es.append(row)
            logger.info("[WATCHDOG_ES] IK tid=%s already in ES (canonical_id=%s)", tid, cid)
        else:
            needs_clerk.append(c)

    logger.info("[WATCHDOG_ES] IK ES lookup: %d already-in-ES, %d need Clerk",
                len(already_in_es), len(needs_clerk))
    _db_log(run_id, "watchdog", "watchdog", "INFO",
            f"📚 IK ES lookup: {len(already_in_es)} already fetched, {len(needs_clerk)} need Clerk",
            {"ik_in_es": len(already_in_es), "ik_needs_clerk": len(needs_clerk)})
    return already_in_es, needs_clerk


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
    Call IK /search/ API for one query via the centralized ik_search() service
    (which includes 3-attempt exponential-backoff retry for SSL / timeout errors).
    Tags each result with _dimension_id, _dimension_name, _query_type for traceability.
    Returns list of candidate dicts.
    """
    token = _get_ik_token()
    if not token:
        logger.warning("[WATCHDOG] INDIAN_KANOON_TOKEN not set; skipping IK search.")
        _db_log(run_id, "watchdog", "watchdog", "WARNING", "📚 Indian Kanoon skipped — token not configured")
        return []

    try:
        from services.indian_kanoon import ik_search as _ik_search_svc
        _db_log(run_id, "watchdog", "watchdog", "INFO",
                f"📚 IK [{query_type}|dim={dimension_id}] {query[:80]!r}")
        resp = _ik_search_svc(query, pagenum=0, doctypes="judgments")
        if resp is None:
            logger.warning("[WATCHDOG] IK search returned None for %r", query[:60])
            _db_log(run_id, "watchdog", "watchdog", "WARNING", f"📚 IK search returned no response for: {query[:80]!r}")
            return []

        docs = resp.get("docs") or resp.get("results") or []
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
                "dimension_id":     dimension_id,
                "dimension_name":   dimension_name,
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


def _google_query_with_legal_bias(query: str) -> str:
    """Bias generic queries toward actual Indian judgment results."""
    q = str(query or "").strip()
    if not q:
        return ""
    low = q.lower()
    if "indiankanoon.org" in low or "indian court judgment" in low:
        return q
    return f"{q} Indian court judgment site:indiankanoon.org"


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
        model = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")
        biased_query = _google_query_with_legal_bias(query)
        allowed_sites = " OR ".join(f"site:{s}" for s in _GROUNDING_ALLOWED_SITES)
        search_query = (
            "You are a legal search assistant. Perform a Google Search for the following query. "
            "You MUST return the results as a strict JSON array of objects with keys: "
            "'title', 'url', and 'snippet'. Do not include markdown or conversational text.\n\n"
            f"QUERY: {biased_query}\n"
            f"CONSTRAINTS: Strictly limit results to {allowed_sites}. "
            f"Return up to {num_results} items."
        )
        grounding_tool = types.Tool(google_search=types.GoogleSearch())
        config = types.GenerateContentConfig(tools=[grounding_tool], max_output_tokens=2048)
        client = genai.Client(api_key=api_key)
        response = None
        for attempt in range(3):
            try:
                response = client.models.generate_content(model=model, contents=search_query, config=config)
                break
            except Exception as exc:
                msg = str(exc or "")
                is_rate_limited = ("429" in msg) or ("RESOURCE_EXHAUSTED" in msg.upper())
                if is_rate_limited and attempt < 2:
                    logger.warning(
                        "[WATCHDOG] Google Grounding rate-limited (attempt %d/3) for %r; retrying in 5s",
                        attempt + 1, query[:80],
                    )
                    time.sleep(5)
                    continue
                raise

        results: List[Dict[str, Any]] = []
        # Primary parser: strict JSON array from model text.
        resp_text = (getattr(response, "text", None) or "").strip()
        if resp_text:
            try:
                cleaned = re.sub(r"^```(?:json)?\s*", "", resp_text, flags=re.I)
                cleaned = re.sub(r"```\s*$", "", cleaned).strip()
                parsed = json.loads(cleaned)
                if isinstance(parsed, list):
                    for i, item in enumerate(parsed[:num_results], 1):
                        if not isinstance(item, dict):
                            continue
                        uri_str = str(item.get("url") or item.get("link") or "").strip()
                        if not uri_str or not uri_str.startswith("http") or not _is_allowed_grounding_link(uri_str):
                            continue
                        title = str(item.get("title") or f"Result {i}").strip()
                        snippet = str(item.get("snippet") or "")[:500]
                        results.append({
                            "title": title,
                            "link": uri_str,
                            "external_id": uri_str,
                            "snippet": snippet,
                            "_source": "google",
                            "source_type": _google_source_type_for_link(uri_str),
                        })
            except Exception as _json_exc:
                logger.info("[WATCHDOG] Grounding JSON parse fallback engaged: %s", _json_exc)

        # Fallback parser: grounding metadata chunks.
        if not results and response.candidates:
            cand = response.candidates[0]
            gm = getattr(cand, "grounding_metadata", None) or getattr(cand, "groundingMetadata", None)
            if gm:
                chunks = getattr(gm, "grounding_chunks", None) or getattr(gm, "groundingChunks", None) or []
                for i, ch in enumerate(chunks[:num_results]):
                    web = (getattr(ch, "web", None) if hasattr(ch, "web")
                           else (ch.get("web") if isinstance(ch, dict) else None))
                    if not web:
                        continue
                    uri = getattr(web, "uri", None) or (web.get("uri") if isinstance(web, dict) else None)
                    title = getattr(web, "title", None) or (web.get("title") if isinstance(web, dict) else None) or ""
                    uri_str = str(uri).strip()
                    if uri_str and uri_str.startswith("http") and _is_allowed_grounding_link(uri_str):
                        results.append({
                            "title": str(title) if title else f"Result {i + 1}",
                            "link": uri_str,
                            "external_id": uri_str,
                            "snippet": resp_text[:200] if resp_text else "",
                            "_source": "google",
                            "source_type": _google_source_type_for_link(uri_str),
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
        biased_query = _google_query_with_legal_bias(query)
        search_query = (
            f"{biased_query} Indian law judgement Supreme Court High Court "
            "site:indiankanoon.org OR site:casemine.com OR site:app.bharatlaw.ai OR "
            "site:lawfinderlive.com OR site:judgments.ecourts.gov.in"
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
        results = []
        for item in (data.get("organic") or []):
            link = item.get("link", "")
            if not _is_allowed_grounding_link(link):
                continue
            results.append({
                "title": item.get("title", ""),
                "link": link,
                "snippet": item.get("snippet", ""),
                "_source": "google",
                "source_type": _google_source_type_for_link(link),
            })
            if len(results) >= num_results:
                break
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


def _search_web_claude(
    query: str,
    num_results: int = 5,
    run_id: Optional[str] = None,
    user_id: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Web search via Claude web_search tool (Brave-backed)."""
    try:
        from claude_proxy import forward_to_claude
    except Exception as exc:
        logger.warning("[WATCHDOG] Claude proxy unavailable: %s", exc)
        return []

    model = os.environ.get("CLAUDE_MODEL", "claude-sonnet-4-20250514")
    biased_query = _google_query_with_legal_bias(query)
    prompt = (
        "You are a legal search assistant. Use web search to find Indian court judgments for this query.\n"
        f"Query: {biased_query}\n\n"
        f"Return ONLY strict JSON array (max {num_results}) with keys: "
        "title, url, snippet."
    )
    try:
        resp = forward_to_claude({
            "model": model,
            "max_tokens": 1400,
            "temperature": 0.0,
            "anthropic_beta": ["web-search-2025-03-05"],
            "tools": [{
                "type": "web_search_20250305",
                "name": "web_search",
                "max_uses": 3,
            }],
            "messages": [{"role": "user", "content": prompt}],
        })
        blocks = resp.get("content") or []
        text_parts: List[str] = []
        for b in blocks:
            if isinstance(b, dict) and b.get("type") == "text":
                text_parts.append(str(b.get("text") or ""))
        txt = "\n".join(t for t in text_parts if t).strip()
        if not txt:
            return []
        cleaned = re.sub(r"^```(?:json)?\s*", "", txt, flags=re.I)
        cleaned = re.sub(r"```\s*$", "", cleaned).strip()
        parsed: Any = None
        try:
            parsed = json.loads(cleaned)
        except Exception:
            # Claude often returns explanatory text around JSON; try bracket extraction.
            m = re.search(r"\[\s*\{.*\}\s*\]", cleaned, flags=re.S)
            if m:
                try:
                    parsed = json.loads(m.group(0))
                except Exception:
                    parsed = None

        out: List[Dict[str, Any]] = []
        if isinstance(parsed, list):
            for i, item in enumerate(parsed[:num_results], 1):
                if not isinstance(item, dict):
                    continue
                u = str(item.get("url") or item.get("link") or "").strip()
                if not u or not u.startswith("http"):
                    continue
                out.append({
                    "title": str(item.get("title") or f"Result {i}"),
                    "link": u,
                    "external_id": u,
                    "snippet": str(item.get("snippet") or "")[:500],
                    "_source": "google",
                    "source_type": _google_source_type_for_link(u),
                })

        # Fallback: URL extraction from plain text response when JSON isn't parseable.
        if not out:
            seen_urls: set = set()
            urls = re.findall(r"https?://[^\s\]\)\"'>]+", txt)
            for i, raw_u in enumerate(urls, 1):
                u = str(raw_u).strip().rstrip(".,;")
                if not u.startswith("http") or u in seen_urls:
                    continue
                seen_urls.add(u)
                if not _is_allowed_grounding_link(u):
                    continue
                out.append({
                    "title": f"Web result {i}",
                    "link": u,
                    "external_id": u,
                    "snippet": txt[:500],
                    "_source": "google",
                    "source_type": _google_source_type_for_link(u),
                })
                if len(out) >= num_results:
                    break

        if not out:
            logger.warning("[WATCHDOG] Claude web search returned no parseable URLs. text_preview=%r", txt[:240])
        _db_log(run_id, "watchdog", "watchdog", "INFO",
                f"🌐 Claude web search → {len(out)} result(s)",
                {"source": "claude_web_search", "count": len(out)})
        return out
    except Exception as exc:
        logger.warning("[WATCHDOG] Claude web search failed: %s", exc)
        _db_log(run_id, "watchdog", "watchdog", "WARNING", f"🌐 Claude web search failed: {exc}")
        return []


def _search_google(
    query: str,
    num_results: int = 5,
    run_id: Optional[str] = None,
    user_id: Optional[str] = None,
    provider: str = "grounding",
) -> List[Dict[str, Any]]:
    """Google search route uses Gemini Grounding and legal-site allowlist."""
    p = (provider or "grounding").strip().lower()
    if p == "claude":
        return _search_web_claude(query, num_results=num_results, run_id=run_id, user_id=user_id)
    if p == "serper":
        return _search_google_serper(query, num_results=num_results, run_id=run_id, user_id=user_id)
    result = _search_google_grounding(query, num_results=num_results, run_id=run_id, user_id=user_id)
    if not result and _use_serper_for_google_search():
        logger.info("[WATCHDOG] Google Grounding returned 0; falling back to Serper")
        return _search_google_serper(query, num_results=num_results, run_id=run_id, user_id=user_id)
    return result




def _district_court_like(court: Any) -> bool:
    """True for typical district-level bodies (not standalone tribunals like ITAT)."""
    c = str(court or "").strip().lower()
    if not c:
        return False
    keys = (
        "district court", "sessions court", "munsiff", "civil judge",
        "judicial magistrate", "executive magistrate", "metropolitan magistrate",
        "family court",
    )
    return any(k in c for k in keys)


def _hints_from_local_rows(local: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    """Per-canonical_id hints for Librarian / Auditor / ReportBuilder (Watchdog local path)."""
    out: Dict[str, Dict[str, Any]] = {}
    for r in local or []:
        jid = str(r.get("canonical_id") or r.get("id") or "").strip()
        if not jid:
            continue
        tags = list(r.get("citation_tags") or [])
        out[jid] = {
            "_source": r.get("_source"),
            "_query_types": r.get("_query_types") or ([] if not r.get("_query_type") else [r.get("_query_type")]),
            "_similarity_score": float(r.get("_similarity_score") or 0.0),
            "_provision_best_score": float(r.get("_provision_best_score") or 0.0),
            "_dimension_id": r.get("_dimension_id"),
            "_dimension_name": r.get("_dimension_name"),
            "dimension_id": r.get("dimension_id", r.get("_dimension_id")),
            "dimension_name": r.get("dimension_name", r.get("_dimension_name")),
            "_dimension_ids": list(r.get("_dimension_ids") or ([] if r.get("_dimension_id") is None else [r.get("_dimension_id")])),
            "_dimension_names": list(r.get("_dimension_names") or ([] if not r.get("_dimension_name") else [r.get("_dimension_name")])),
            "is_local_admin": bool(r.get("is_local_admin")),
            "is_provision_match": bool(r.get("is_provision_match")),
            "_provision_focus_district": bool(r.get("_provision_focus_district")),
            "relevance_badge_hint": r.get("relevance_badge_hint"),
            "citation_tags": tags,
            "_needs_clerk_analysis": bool(r.get("_needs_clerk_analysis")),
            "source_type": r.get("source_type"),
        }
    return out


# ── Phase 3: IK candidate re-ranking via Gemini ──────────────────────────────

def _rerank_ik_candidates_gemini(
    candidates: List[Dict[str, Any]],
    controversy_map: Optional[Dict[str, Any]],
    run_id: Optional[str],
    user_id: Optional[str],
    min_score: int = 2,
) -> List[Dict[str, Any]]:
    """
    Re-rank IK candidates using a Gemini LLM call against the controversy map.
    Drops candidates with relevance score < min_score (default 2 out of 5).
    Skips re-ranking if controversy_map is absent or candidate list is empty.
    """
    if not candidates or not controversy_map:
        return candidates

    _cm = controversy_map or {}
    controversy_text = (
        f"Dispute: {_cm.get('central_controversy', '')}\n"
        f"Trigger: {_cm.get('factual_trigger', '')}\n"
        f"Claim: {_cm.get('legal_claim', '')}"
    ).strip()

    # Build a compact list of candidates for the prompt
    lines: List[str] = []
    for i, c in enumerate(candidates):
        title = str(c.get("title") or c.get("doc_title") or "").strip() or "(untitled)"
        court = str(c.get("docsource") or "").strip()
        snippet = str(c.get("headline") or c.get("snippet") or "")[:200].strip()
        line = f"[{i + 1}] {title}"
        if court:
            line += f" ({court})"
        if snippet:
            line += f" — {snippet}"
        lines.append(line)

    _rerank_template = _RERANK_IK_PROMPT
    _rerank_temp = 0.0
    _rerank_max_tokens = 512
    try:
        from utils.prompt_resolver import resolve_prompt as _resolve_prompt
        _pc = _resolve_prompt(
            name="WatchdogIKReranker",
            agent_type="citation",
            default_prompt=_RERANK_IK_PROMPT,
            default_model=os.environ.get("GEMINI_MODEL", "gemini-2.5-flash"),
            default_temperature=0.0,
            default_max_tokens=512,
        )
        _rerank_template = _pc.prompt
        _rerank_temp = _pc.temperature
        _rerank_max_tokens = _pc.max_tokens
    except Exception as _exc:
        logger.debug("[WATCHDOG] prompt_resolver unavailable for IKReranker: %s", _exc)

    prompt = _rerank_template.format(
        controversy_text=controversy_text,
        judgments_list="\n".join(lines),
    )

    try:
        from agents.base_agent import BaseAgent
        _tmp = BaseAgent()
        raw = _tmp._gemini(
            prompt,
            max_tokens=_rerank_max_tokens,
            temperature=_rerank_temp,
            run_id=run_id,
            user_id=user_id or "anonymous",
            operation="ik_rerank",
        )
        text = (raw or "").strip()
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"```\s*$", "", text).strip()
        items = json.loads(text)
        if not isinstance(items, list):
            raise ValueError("not a list")

        # Map index → score
        score_map: Dict[int, float] = {}
        for item in items:
            if isinstance(item, dict):
                idx = int(item.get("index") or 0)
                score = float(item.get("score") or 0)
                score_map[idx] = score

        # Annotate + filter
        scored: List[tuple] = []
        for i, c in enumerate(candidates):
            score = score_map.get(i + 1, 3.0)  # default to 3 if missing
            if score >= min_score:
                c["_ik_relevance_score"] = score
                scored.append((c, score))

        # Sort by score descending (preserve jurisdiction priority within same score)
        scored.sort(key=lambda x: (x[1], x[0].get("_jurisdiction_priority", 0)), reverse=True)
        result = [c for c, _ in scored]
        dropped = len(candidates) - len(result)
        logger.info(
            "[WATCHDOG] IK re-rank: %d → %d candidates (dropped %d with score < %d)",
            len(candidates), len(result), dropped, min_score,
        )
        return result
    except Exception as exc:
        logger.warning("[WATCHDOG] IK re-rank failed (%s) — returning original order", exc)
        return candidates


# ── Main watchdog entry point ─────────────────────────────────────────────────

def run_watchdog(
    query: str,
    max_local: int = 10,
    max_ik: int = 10,
    max_google: int = 5,
    keyword_sets: Optional[List[str]] = None,
    keyword_data: Optional[Dict[str, Any]] = None,
    retrieval_method: str = "indiankanoon",
    web_search_provider: str = "grounding",
    web_context_query: str = "",
    case_state: str = "",
    run_id: Optional[str] = None,
    user_id: Optional[str] = None,
    controversy_map: Optional[Dict[str, Any]] = None,
    keyword_mode: bool = True,
    # Deprecated — ignored; kept for call-site backward compat only
    dimensions: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """
    Run Watchdog: Local DB (ES keyword) → Indian Kanoon API → Google.

    Always uses keyword_sets for local DB search (ES multi_match).
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

    def _build_google_queries(
        primary_seed: str,
        controversy: Optional[Dict[str, Any]],
        kw_data: Optional[Dict[str, Any]],
    ) -> List[str]:
        """
        Keep Google query volume intentionally small:
          - 1 controversy_query seed
          - up to 2 tier_4 / tier_3 tokens
        Never use tier_1 / tier_2 for Google.
        """
        cm = controversy or {}
        tiers = (kw_data or {}).get("tiers") if isinstance(kw_data, dict) else {}
        t3 = list((tiers or {}).get("tier_3") or [])
        t4 = list((tiers or {}).get("tier_4") or [])

        out: List[str] = []
        seen: set = set()

        seed = str(cm.get("controversy_query") or cm.get("central_controversy") or primary_seed or "").strip()
        if seed and seed not in seen:
            out.append(seed)
            seen.add(seed)

        # Prioritize landmark (tier_4) over doctrinal (tier_3) for web lookups.
        tier34 = [str(x).strip() for x in (t4 + t3) if str(x).strip()]
        for q in tier34:
            if q in seen:
                continue
            seen.add(q)
            out.append(q)
            if len(out) >= 3:
                break
        return out[:3]

    def _dedupe_local_rows(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        def _same_state_hc(court: Any) -> bool:
            c = str(court or "").strip().lower()
            if "high" not in c:
                return False
            st = (case_state or "").strip().lower()
            if not st:
                return False
            if st in c:
                return True
            return st == "maharashtra" and "bombay high court" in c

        def _priority_tier(row: Dict[str, Any]) -> int:
            court = row.get("court") or row.get("court_code")
            c = str(court or "").strip().lower()
            if "supreme" in c:
                return 3
            if _same_state_hc(court):
                return 2
            if row.get("_provision_focus_district"):
                return 1
            return int(row.get("_priority_tier", 0) or 0)

        seen: Dict[str, Dict[str, Any]] = {}
        for r in rows:
            key = (
                str(r.get("id") or "").strip()
                or str(r.get("external_id") or "").strip()
                or str(r.get("canonical_id") or "").strip()
                or f"{str(r.get('title') or '').strip()}::{str(r.get('primary_citation') or '').strip()}"
            )
            if not key:
                continue
            dim_id = r.get("_dimension_id")
            dim_name = r.get("_dimension_name")
            q_type = r.get("_query_type")
            if key not in seen:
                c = dict(r)
                c["_dimension_ids"] = [dim_id] if dim_id is not None else []
                c["_dimension_names"] = [dim_name] if dim_name else []
                c["_query_types"] = [q_type] if q_type else []
                seen[key] = c
                continue
            ex = seen[key]
            if dim_id is not None and dim_id not in ex.get("_dimension_ids", []):
                ex.setdefault("_dimension_ids", []).append(dim_id)
            if dim_name and dim_name not in ex.get("_dimension_names", []):
                ex.setdefault("_dimension_names", []).append(dim_name)
            if q_type and q_type not in ex.get("_query_types", []):
                ex.setdefault("_query_types", []).append(q_type)
            ex["_local_rank"] = max(ex.get("_local_rank", 0), r.get("_local_rank", 0))
            ex["_priority_tier"] = max(int(ex.get("_priority_tier", 0) or 0), int(r.get("_priority_tier", 0) or 0))
            if r.get("_needs_clerk_analysis"):
                ex["_needs_clerk_analysis"] = True
            if r.get("dimension_id") is not None:
                ex["dimension_id"] = r.get("dimension_id")
            if r.get("dimension_name"):
                ex["dimension_name"] = r.get("dimension_name")
        out = list(seen.values())
        # Within each dimension: Tier1 SC > Tier2 same-state HC > Tier3 district provision matches.
        # Then local rank + semantic similarity as tie-breakers.
        out.sort(
            key=lambda r: (
                str(r.get("_dimension_id") if r.get("_dimension_id") is not None else r.get("dimension_id") or ""),
                -_priority_tier(r),
                -(int(r.get("_local_rank", 0) or 0)),
                -(float(r.get("_similarity_score", 0.0) or 0.0)),
            )
        )
        return out

    skip_ik = (max_ik == 0)
    query = (query or "").strip()
    retrieval_method = str(retrieval_method or "indiankanoon").strip().lower()

    # ── Build search query list from keyword_sets ──────────────────────────────
    ks_list = [ks for ks in (keyword_sets or []) if (ks or "").strip()]
    keyword_list = ks_list if ks_list else ([query] if query else [])
    ik_google_queries = keyword_list

    if not keyword_list and not (web_context_query or "").strip():
        return {
            "error": "query or keyword_sets required",
            "local": [], "candidates_ik": [], "candidates_google": [],
            "all_judgement_ids": [], "search_keywords_by_route": {},
            "dropped_low_hierarchy_count": 0,
        }

    primary_query = keyword_list[0] if keyword_list else query
    ik_mode = "SKIPPED" if skip_ik else "keyword"

    logger.info("╔══ WATCHDOG ══════════════════════════════════════════════╗")
    logger.info("║  Primary query : %-42s ║", primary_query[:42])
    logger.info("║  IK mode       : %-42s ║", ik_mode[:42])
    logger.info("║  Keywords      : %-42s ║", str(len(keyword_list)))
    logger.info("╚══════════════════════════════════════════════════════════╝")
    _db_log(run_id, "watchdog", "watchdog", "INFO",
            f"🐕 Watchdog started — retrieval={retrieval_method} | IK mode={ik_mode} | queries={len(keyword_list)}",
            {"retrieval_method": retrieval_method, "ik_mode": ik_mode, "keyword_count": len(keyword_list), "primary_query": primary_query[:120]})

    web_only_mode = retrieval_method in ("web", "claude", "claude_web", "serper", "web_only")

    # ── 1. Local DB search (ES/Qdrant hybrid) ────────────────────────────────
    if web_only_mode:
        local: List[Dict[str, Any]] = []
        logger.info("[WATCHDOG] Web-only mode — skipping local DB retrieval")
    else:
        local = _search_local_by_keywords(
            keyword_sets=keyword_list,
            max_total=max_local,
            case_state=case_state,
            run_id=run_id,
            controversy_query=str((controversy_map or {}).get("controversy_query") or ""),
        )[:max_local]
        logger.info("[WATCHDOG] Local ES keyword → %d results (from %d tokens)", len(local), len(keyword_list))

    # ── 2. Indian Kanoon — keyword batched search ─────────────────────────────
    seen_tids: Dict[str, Dict[str, Any]] = {}
    dropped_low_hierarchy = 0

    if (not skip_ik) and (not web_only_mode):
        _ik_list = ik_google_queries if ik_google_queries else keyword_list
        per_ik = max(1, max_ik // len(_ik_list)) if len(_ik_list) > 1 else max_ik

        def _run_ik_keyword(args: Tuple[int, str]) -> Tuple[int, List[Dict[str, Any]]]:
            qi, q = args
            q = (q or "").strip()
            if not q:
                return qi, []
            return qi, _search_indian_kanoon(q, limit=per_ik, run_id=run_id, user_id=user_id)

        active = [(qi, q) for qi, q in enumerate(_ik_list, 1) if (q or "").strip()]
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
                        if _is_pending_result(c):
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

    # Phase 3: re-rank IK candidates with Gemini relevance scoring
    if candidates_ik and controversy_map:
        candidates_ik = _rerank_ik_candidates_gemini(
            candidates_ik,
            controversy_map=controversy_map,
            run_id=run_id,
            user_id=user_id,
        )

    # ── 3. Web search (optional per retrieval method) ─────────────────────────
    candidates_google: List[Dict[str, Any]] = []
    if max_google > 0:
        provider = str(web_search_provider or "").strip().lower()
        if provider == "claude":
            # Direct Claude web mode: DO NOT use tier keyword fan-out.
            direct_q = (web_context_query or query or primary_query or "").strip()
            google_queries = [direct_q] if direct_q else []
        else:
            google_queries = _build_google_queries(primary_query, controversy_map, keyword_data)
            if not google_queries:
                google_queries = [primary_query] if primary_query else []
        try:
            # Hard-cap to avoid provider rate limits.
            max_google_queries = int(os.environ.get("CITATION_MAX_GOOGLE_QUERIES", "3"))
        except Exception:
            max_google_queries = 3
        max_google_queries = 1 if provider == "claude" else max(1, min(3, max_google_queries))
        google_queries = google_queries[:max_google_queries]

        seen_google: Dict[str, Dict[str, Any]] = {}
        per_google = max(1, max_google // max(len(google_queries), 1))

        # Sequential web calls (rate-limit safe): no parallel fan-out.
        for q in google_queries:
            try:
                results = _search_google(
                    q,
                    num_results=per_google,
                    run_id=run_id,
                    user_id=user_id,
                    provider=provider or web_search_provider,
                ) or []
                for g in results:
                    link = (g.get("link") or "").strip()
                    if link and link not in seen_google:
                        seen_google[link] = g
            except Exception as exc:
                logger.warning("[WATCHDOG] Web query failed for %r: %s", q[:80], exc)
            time.sleep(2)

        candidates_google = list(seen_google.values())
    else:
        google_queries = []

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
        "local":         _unique_nonempty(keyword_list),
        "indian_kanoon": _unique_nonempty(keyword_list) if ik_enabled and not skip_ik else [],
        "google":        _unique_nonempty(google_queries) if google_enabled else [],
    }

    _db_log(run_id, "watchdog", "watchdog", "INFO",
            f"✅ Watchdog done — 🏛 {len(local)} local | 📚 {len(candidates_ik)} IK | "
            f"🌐 {len(candidates_google)} web | 🚫 {dropped_low_hierarchy} dropped",
            {"retrieval_method": retrieval_method, "local_count": len(local), "ik_count": len(candidates_ik),
             "google_count": len(candidates_google),
             "dropped_low_hierarchy": dropped_low_hierarchy})

    needing_clerk: List[str] = []
    _seen_nc = set()
    if not web_only_mode:
        for r in local:
            if not r.get("_needs_clerk_analysis"):
                continue
            cid = str(r.get("canonical_id") or r.get("id") or "").strip()
            if cid and cid not in _seen_nc:
                _seen_nc.add(cid)
                needing_clerk.append(cid)
    if needing_clerk:
        logger.info("[WATCHDOG] %d local hit(s) missing analysis_report — queued for Clerk enrich",
                    len(needing_clerk))

    return {
        "local":                     local,
        "candidates_ik":             candidates_ik,
        "candidates_google":         candidates_google,
        "all_judgement_ids":         all_judgement_ids,
        "search_keywords_by_route":  search_keywords_by_route,
        "dropped_low_hierarchy_count": dropped_low_hierarchy,
        "local_judgement_hints":     _hints_from_local_rows(local),
        "local_canonical_ids_needing_analysis": needing_clerk,
    }
