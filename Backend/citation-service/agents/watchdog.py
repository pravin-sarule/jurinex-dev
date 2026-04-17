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

import asyncio
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


# ── Qdrant semantic local search ─────────────────────────────────────────────

def _qdrant_search_one(
    vector: List[float],
    qdrant_client: Any,
    fetch_limit: int,
    score_threshold: Optional[float] = None,
    query_filter: Optional[Any] = None,
) -> List[Any]:
    """Run one Qdrant cosine similarity query on ``legal_embeddings_v2``; tries query_points then search()."""
    qdrant_collection = os.environ.get("QDRANT_COLLECTION", "legal_embeddings_v2").strip() or "legal_embeddings_v2"
    kwargs_qp: Dict[str, Any] = {
        "collection_name": qdrant_collection,
        "query": vector,
        "limit": fetch_limit,
        "with_payload": True,
    }
    if score_threshold is not None:
        kwargs_qp["score_threshold"] = score_threshold
    if query_filter is not None:
        kwargs_qp["query_filter"] = query_filter
    try:
        try:
            qp = qdrant_client.query_points(**kwargs_qp)
        except TypeError:
            kwargs_qp.pop("score_threshold", None)
            qp = qdrant_client.query_points(**kwargs_qp)
        return list(getattr(qp, "points", None) or [])
    except Exception:
        kwargs_s: Dict[str, Any] = {
            "collection_name": qdrant_collection,
            "query_vector": vector,
            "limit": fetch_limit,
            "with_payload": True,
        }
        if score_threshold is not None:
            kwargs_s["score_threshold"] = score_threshold
        if query_filter is not None:
            kwargs_s["query_filter"] = query_filter
        try:
            return qdrant_client.search(**kwargs_s) or []
        except TypeError:
            kwargs_s.pop("score_threshold", None)
            try:
                return qdrant_client.search(**kwargs_s) or []
            except Exception as exc2:
                logger.warning("[WATCHDOG_QDRANT] search() fallback failed: %s", exc2)
                return []


# Admin source_type values used to identify admin-uploaded judgments
_ADMIN_SOURCE_TYPES = frozenset({
    "admin", "admin_upload", "admin-upload", "admin uploaded",
    "admin-uploaded", "adminupload", "manual_upload", "manual-upload",
    "judgment_upload", "judgement_upload",
})


def _fetch_admin_canonical_ids(run_id: Optional[str] = None) -> List[str]:
    """
    Query PostgreSQL for canonical_ids of all admin-uploaded judgments.
    Checks both judgments.source_type and the admin upload table.
    Returns a list of canonical_id strings (format: v-sc-YYYY-xxxxx or similar).
    """
    try:
        from db.connections import get_pg_conn
        conn = get_pg_conn()
        if not conn:
            return []
        try:
            cids: List[str] = []
            admin_types = list(_ADMIN_SOURCE_TYPES)
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT canonical_id FROM judgments
                     WHERE LOWER(COALESCE(source_type,'')) = ANY(%s)
                       AND canonical_id IS NOT NULL AND canonical_id <> ''
                    """,
                    (admin_types,),
                )
                for row in (cur.fetchall() or []):
                    cid = str(row[0] if isinstance(row, tuple) else row.get("canonical_id") or "").strip()
                    if cid:
                        cids.append(cid)
            # Also check the admin upload table
            try:
                from db.client import _resolve_admin_upload_table  # noqa: PLC2701
                upload_table = _resolve_admin_upload_table(conn) or ""
                if upload_table:
                    with conn.cursor() as cur2:
                        cur2.execute(
                            f"SELECT canonical_id FROM {upload_table} WHERE canonical_id IS NOT NULL AND canonical_id <> ''"
                        )
                        for row in (cur2.fetchall() or []):
                            cid = str(row[0] if isinstance(row, tuple) else row.get("canonical_id") or "").strip()
                            if cid and cid not in cids:
                                cids.append(cid)
            except Exception:
                pass
            logger.info("[WATCHDOG_QDRANT] Admin canonical_ids from DB: %d", len(cids))
            _db_log(run_id, "watchdog", "watchdog", "INFO",
                    f"🔑 Admin canonical_ids: {len(cids)} found in DB",
                    {"count": len(cids), "sample": cids[:5]})
            return cids
        finally:
            conn.close()
    except Exception as exc:
        logger.warning("[WATCHDOG_QDRANT] _fetch_admin_canonical_ids failed: %s", exc)
        return []


def _search_local_semantic(
    tasks: List[Dict[str, Any]],
    max_total: int = 10,
    case_state: str = "",
    run_id: Optional[str] = None,
    user_id: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """
    Semantic local DB search via Qdrant vector similarity.

    Pipeline per dimension task (query + dim metadata):
      1. Embed query with Gemini  → float vector
      2. Qdrant similarity search → top chunk points (payload has canonical_id + score)
      3. Batch PostgreSQL fetch   → full judgment rows for all unique canonical_ids
      4. Filter + rank            → hierarchy rank, similarity score, admin flag
      5. Tag with dimension info  → _dimension_id, _dimension_name, _query_type,
                                    is_local_admin, _similarity_score

    All tasks are embedded in parallel (ThreadPoolExecutor) to reduce latency.
    A single batched PG query retrieves all canonical_ids at once.
    Results are deduplicated by canonical_id, merging dimension metadata.
    """
    if not tasks:
        return []

    from db.connections import elasticsearch_init_failed, get_es_client, get_qdrant_client
    from db.client import get_query_embeddings_batch, judgements_fetch_by_canonical_ids

    qdr = get_qdrant_client()
    if not qdr:
        _db_log(run_id, "watchdog", "watchdog", "WARNING",
                "🏛 Qdrant client unavailable — semantic local search skipped")
        return []

    # Force ES client probe so elasticsearch_init_failed() reflects reachability for this process.
    get_es_client()
    es_unreachable = elasticsearch_init_failed()
    # No score threshold at Qdrant fetch time — we apply it after DB lookup below,
    # once we know whether each result is admin-uploaded or not.
    qdrant_score_threshold: Optional[float] = None
    # Similarity threshold applied after DB hydration — non-admin judgments only.
    # Admin uploads are always included regardless of score.
    _MIN_SCORE_NON_ADMIN = float(os.environ.get("CITATION_QDRANT_MIN_SCORE", "0.65"))

    # Fetch window: large enough to capture admin chunks that rank lower than IK chunks
    # for the same query but are still genuinely relevant.
    per_task_limit = max(30, (max_total * 6) // max(len(tasks), 1))
    if es_unreachable:
        per_task_limit = max(per_task_limit * 2, 60)

    # ── 1. Embed all dimension queries (sc / hc / provision) in one Gemini batch ─
    vectors_all = get_query_embeddings_batch([str(t.get("query") or "") for t in tasks])
    task_vectors: Dict[int, Optional[List[float]]] = {}
    for idx, t in enumerate(tasks):
        v = vectors_all[idx] if idx < len(vectors_all) else []
        task_vectors[idx] = v if v else None

    embedded_count = sum(1 for v in task_vectors.values() if v)
    logger.info("[WATCHDOG_QDRANT] Embedded %d/%d task queries", embedded_count, len(tasks))
    _db_log(run_id, "watchdog", "watchdog", "INFO",
            f"🔢 Qdrant embed: {embedded_count}/{len(tasks)} queries vectorised")

    if not embedded_count:
        logger.warning("[WATCHDOG_QDRANT] No embeddings produced — Gemini API unavailable?")
        return []

    # ── 2. Qdrant similarity search per embedded query ────────────────────────
    # Map: canonical_id → {best_score, dimension_ids[], dimension_names[], query_types[]}
    cid_meta: Dict[str, Dict[str, Any]] = {}
    qdrant_judgment_uuids: set = set()

    def _search_one(idx_task: Tuple[int, Dict]) -> Tuple[int, List[Any]]:
        idx, t = idx_task
        vec = task_vectors.get(idx)
        if not vec:
            return idx, []
        return idx, _qdrant_search_one(vec, qdr, per_task_limit, qdrant_score_threshold)

    with ThreadPoolExecutor(max_workers=min(SEARCH_WORKERS, embedded_count)) as pool:
        for idx, points in pool.map(_search_one, enumerate(tasks)):
            t = tasks[idx]
            dim_id   = t.get("dimension_id")
            dim_name = t.get("dimension_name") or ""
            q_type   = t.get("q_type") or "semantic"
            query_txt = t.get("query") or ""

            for p in points:
                payload = getattr(p, "payload", None) or {}
                cid = str(payload.get("canonical_id") or "").strip()
                ju = str(payload.get("judgment_uuid") or "").strip()
                if ju:
                    qdrant_judgment_uuids.add(ju)
                if not cid:
                    continue
                score = float(getattr(p, "score", 0) or 0)
                if cid not in cid_meta:
                    cid_meta[cid] = {
                        "best_score":      score,
                        "provision_best_score": score if q_type == "provision" else 0.0,
                        "dimension_ids":   [dim_id] if dim_id is not None else [],
                        "dimension_names": [dim_name] if dim_name else [],
                        "query_types":     [q_type] if q_type else [],
                        "queries":         [query_txt] if query_txt else [],
                    }
                else:
                    m = cid_meta[cid]
                    m["best_score"] = max(m["best_score"], score)
                    if q_type == "provision":
                        m["provision_best_score"] = max(
                            float(m.get("provision_best_score") or 0.0), score,
                        )
                    if dim_id is not None and dim_id not in m["dimension_ids"]:
                        m["dimension_ids"].append(dim_id)
                    if dim_name and dim_name not in m["dimension_names"]:
                        m["dimension_names"].append(dim_name)
                    if q_type and q_type not in m["query_types"]:
                        m["query_types"].append(q_type)

    logger.info("[WATCHDOG_QDRANT] Unique canonical_ids from Qdrant: %d", len(cid_meta))
    _db_log(run_id, "watchdog", "watchdog", "INFO",
            f"🔍 Qdrant similarity: {len(cid_meta)} unique canonical_ids found",
            {"canonical_id_count": len(cid_meta)})

    if not cid_meta and not task_vectors:
        return []

    # ── 2b. Targeted admin search ─────────────────────────────────────────────
    # Admin uploads are always included — no score threshold applied.
    # We still run a Qdrant payload-filtered search so we can record the best
    # similarity score for ranking, but we force-include every admin canonical_id
    # regardless of score.  Any admin cid not found in Qdrant at all is still
    # added to cid_meta with score=0.0 so it reaches the PG fetch step.
    admin_cids_all = _fetch_admin_canonical_ids(run_id=run_id)
    admin_cids_to_search = [c for c in admin_cids_all if c not in cid_meta]

    if admin_cids_to_search:
        logger.info("[WATCHDOG_QDRANT] Admin targeted search: %d canonical_ids not in natural results",
                    len(admin_cids_to_search))
        _admin_filter = None
        if any(v for v in task_vectors.values()):
            try:
                from qdrant_client.http import models as _qm
                _admin_filter = _qm.Filter(
                    must=[_qm.FieldCondition(
                        key="canonical_id",
                        match=_qm.MatchAny(any=admin_cids_to_search[:500]),
                    )]
                )
            except Exception as _fe:
                logger.warning("[WATCHDOG_QDRANT] Could not build admin filter: %s", _fe)

        _new_admin: List[str] = []

        if _admin_filter is not None:
            fetch_limit_admin = max(30, per_task_limit)
            for idx, vec in task_vectors.items():
                if not vec:
                    continue
                t = tasks[idx]
                dim_id    = t.get("dimension_id")
                dim_name  = t.get("dimension_name") or ""
                q_type    = t.get("q_type") or "semantic"
                query_txt = t.get("query") or ""
                admin_pts = _qdrant_search_one(vec, qdr, fetch_limit_admin, None, _admin_filter)
                for p in admin_pts:
                    payload = getattr(p, "payload", None) or {}
                    cid = str(payload.get("canonical_id") or "").strip()
                    if not cid or cid not in admin_cids_to_search:
                        continue
                    score = float(getattr(p, "score", 0) or 0)
                    # No score filter — admin uploads are always included
                    ju = str(payload.get("judgment_uuid") or "").strip()
                    if ju:
                        qdrant_judgment_uuids.add(ju)
                    if cid not in cid_meta:
                        cid_meta[cid] = {
                            "best_score":           score,
                            "provision_best_score": score if q_type == "provision" else 0.0,
                            "dimension_ids":        [dim_id] if dim_id is not None else [],
                            "dimension_names":      [dim_name] if dim_name else [],
                            "query_types":          [q_type] if q_type else [],
                            "queries":              [query_txt] if query_txt else [],
                        }
                        _new_admin.append(cid)
                    else:
                        m = cid_meta[cid]
                        m["best_score"] = max(m["best_score"], score)
                        if q_type == "provision":
                            m["provision_best_score"] = max(float(m.get("provision_best_score") or 0.0), score)
                        if dim_id is not None and dim_id not in m["dimension_ids"]:
                            m["dimension_ids"].append(dim_id)
                        if dim_name and dim_name not in m["dimension_names"]:
                            m["dimension_names"].append(dim_name)
                        if q_type and q_type not in m["query_types"]:
                            m["query_types"].append(q_type)

        # Force-include admin cids that Qdrant didn't return at all (score=0.0)
        # Cap at _ADMIN_ZERO_SCORE_MAX to avoid flooding the pool with irrelevant
        # judgments when the admin DB contains many unembedded or off-topic uploads.
        _ADMIN_ZERO_SCORE_MAX = 30
        _zero_score_count = 0
        _first_task = tasks[0] if tasks else {}
        for cid in admin_cids_to_search:
            if cid not in cid_meta:
                if _zero_score_count >= _ADMIN_ZERO_SCORE_MAX:
                    continue
                cid_meta[cid] = {
                    "best_score":           0.0,
                    "provision_best_score": 0.0,
                    "dimension_ids":        [_first_task.get("dimension_id")] if _first_task.get("dimension_id") is not None else [],
                    "dimension_names":      [_first_task.get("dimension_name") or ""] if _first_task.get("dimension_name") else [],
                    "query_types":          ["semantic"],
                    "queries":              [_first_task.get("query") or ""] if _first_task.get("query") else [],
                }
                _new_admin.append(cid)
                _zero_score_count += 1

        _new_admin = list(dict.fromkeys(_new_admin))  # deduplicate, preserve order
        logger.info("[WATCHDOG_QDRANT] Admin targeted search: %d new admin canonical_ids added (no threshold)",
                    len(_new_admin))
        _db_log(run_id, "watchdog", "watchdog", "INFO",
                f"✅ Admin targeted: {len(_new_admin)} admin judgment(s) force-included",
                {"new_admin_cids": _new_admin[:10], "total_admin": len(admin_cids_all)})

    if not cid_meta:
        return []

    # ── 3. Batch PostgreSQL fetch ─────────────────────────────────────────────
    # Hydrate full PG rows for all Qdrant hits (no verification_status filter — spec UI still shows source).
    db_rows = judgements_fetch_by_canonical_ids(
        list(cid_meta.keys()),
        approved_only=False,
        exclude_low_hierarchy=False,
        judgment_uuids=list(qdrant_judgment_uuids),
    )
    logger.info("[WATCHDOG_QDRANT] DB returned %d row(s) for %d canonical_id(s)",
                len(db_rows), len(cid_meta))
    _db_log(run_id, "watchdog", "watchdog", "INFO",
            f"🏛 DB fetch: {len(db_rows)}/{len(cid_meta)} rows retrieved",
            {"db_rows": len(db_rows), "requested": len(cid_meta)})

    # ── 4 & 5. Rank, tag, attach dimension metadata ───────────────────────────
    def _court_rank_base(court: Any) -> int:
        c = str(court or "").strip().lower()
        if "supreme" in c:
            return 300
        if "high" in c:
            score = 200
            st = (case_state or "").strip().lower()
            if st and st in c:
                score += 25
            if st == "maharashtra" and "bombay high court" in c:
                score += 25
            return score
        return 100

    def _same_state_high_court(court: Any) -> bool:
        c = str(court or "").strip().lower()
        if "high" not in c:
            return False
        st = (case_state or "").strip().lower()
        if not st:
            return False
        if st in c:
            return True
        if st == "maharashtra" and "bombay high court" in c:
            return True
        return False

    out: List[Dict[str, Any]] = []
    for r in db_rows:
        cid = str(r.get("canonical_id") or "").strip()
        meta = cid_meta.get(cid) or {}
        dim_ids   = meta.get("dimension_ids") or []
        dim_names = meta.get("dimension_names") or []
        q_types   = meta.get("query_types") or []
        sim_score = meta.get("best_score", 0.0)
        prov_best = float(meta.get("provision_best_score") or 0.0)
        court_val = r.get("court") or r.get("court_code")
        # Admin flag comes entirely from the DB row returned by judgements_fetch_by_canonical_ids.
        # That function checks both judgments.source_type and judgment_uploads table.
        is_admin = bool(r.get("is_local_admin"))
        # Non-admin judgments are filtered by the strict score floor.
        # Admin uploads are always included — no score threshold.
        if not is_admin and sim_score < _MIN_SCORE_NON_ADMIN:
            logger.debug(
                "[WATCHDOG_QDRANT] Dropped low-score non-admin: canonical_id=%s score=%.3f < threshold=%.2f",
                cid, sim_score, _MIN_SCORE_NON_ADMIN,
            )
            continue
        if is_admin:
            logger.info(
                "[WATCHDOG_QDRANT] ✅ Admin judgment included: canonical_id=%s score=%.3f (no threshold)",
                cid, sim_score,
            )
        is_dist = _district_court_like(court_val)
        prov_strong = "provision" in q_types and prov_best >= 0.80
        provision_focus = bool(
            is_dist and (prov_strong or is_admin)
        )

        lr = _court_rank_base(court_val)
        if is_dist:
            if is_admin:
                lr = max(lr, 245)
            elif prov_strong:
                lr = max(lr, 60)
            else:
                lr = min(lr, 40) if lr < 200 else 40

        is_sc = "supreme" in str(court_val or "").strip().lower()
        same_state_hc = _same_state_high_court(court_val)
        # 3-tier priority:
        #  3: Supreme Court
        #  2: High Court (same state)
        #  1: District Court (provision match)
        #  0: everything else (kept, but lower)
        priority_tier = 3 if is_sc else (2 if same_state_hc else (1 if provision_focus else 0))

        # Primary dimension = first one attached (highest priority from Qdrant order)
        primary_dim_id   = dim_ids[0] if dim_ids else None
        primary_dim_name = dim_names[0] if dim_names else ""
        primary_q_type   = q_types[0] if q_types else "semantic"

        cit_tags: List[str] = []
        rel_hint: Optional[str] = None
        if provision_focus:
            cit_tags.append("PROVISION FOCUS - DISTRICT COURT")
            rel_hint = "MEDIUM"

        has_analysis = bool(r.get("has_analysis_report"))
        needs_clerk = not has_analysis

        # Ensure admin source_type propagates correctly through the pipeline
        resolved_source_type = str(r.get("source_type") or "").strip().lower()
        if is_admin:
            resolved_source_type = resolved_source_type or "admin-uploaded"

        row = {
            **r,
            # Watchdog-standard tags (used by deduplication + clerk)
            "_source":          "local",
            "_dimension_id":    primary_dim_id,
            "_dimension_name":  primary_dim_name,
            "dimension_id":     primary_dim_id,
            "dimension_name":   primary_dim_name,
            "_query_type":      primary_q_type,
            "_query":           (tasks[0].get("query") or "") if tasks else "",
            "_dimension_ids":   dim_ids,
            "_dimension_names": dim_names,
            "_query_types":     q_types,
            "_similarity_score": sim_score,
            "_provision_best_score": prov_best,
            "_local_rank":      lr,
            "_priority_tier":   priority_tier,
            # Admin source flag — passed through to report_builder → frontend
            "is_local_admin":   is_admin,
            "source_type":      resolved_source_type,
            "is_provision_match": bool(is_admin and "provision" in q_types),
            "_provision_focus_district": provision_focus,
            "citation_tags":    cit_tags,
            "relevance_badge_hint": rel_hint,
            # Qdrant semantic path: Clerk enriches citation_data.analysis_report when absent
            "_from_qdrant_semantic": True,
            "_needs_clerk_analysis": needs_clerk,
        }
        out.append(row)
        logger.info(
            "  ├─ [QDRANT_LOCAL] canonical_id=%s | title=%-40s | score=%.3f | admin=%s | source_type=%s | court=%s",
            cid or "—",
            (r.get("title") or r.get("case_name") or "?")[:40],
            sim_score,
            is_admin,
            resolved_source_type or "—",
            (r.get("court") or "?")[:30],
        )

    # Do NOT demote or drop district-court provision matches.
    # Sort: scored results always beat zero-score admin force-includes, then by
    # court priority tier, local rank, and similarity within each scored group.
    out.sort(
        key=lambda r: (
            int(float(r.get("_similarity_score", 0.0)) > 0),  # 1=scored, 0=zero-score admin
            int(r.get("_priority_tier", 0)),
            int(r.get("_local_rank", 0)),
            float(r.get("_similarity_score", 0.0)),
        ),
        reverse=True,
    )
    result = out[:max_total]

    titles = [(r.get("title") or r.get("case_name") or "?") for r in result[:5]]
    title_str = ", ".join(t[:50] for t in titles) + (f" … +{len(result) - 5} more" if len(result) > 5 else "")
    logger.info("[WATCHDOG_QDRANT] Semantic local → %d result(s): %s", len(result), title_str)
    _db_log(run_id, "watchdog", "watchdog", "INFO",
            f"🏛 Semantic local DB → {len(result)} judgment(s)" + (f": {title_str}" if result else ""),
            {"source": "qdrant_semantic", "count": len(result), "titles": titles})

    return result


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
        allowed_sites = " OR ".join(f"site:{s}" for s in _GROUNDING_ALLOWED_SITES)
        search_query = (
            f"Search for relevant Indian law judgments about: {query}. "
            f"Strictly limit results to {allowed_sites}. "
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
                    if uri_str and uri_str.startswith("http") and _is_allowed_grounding_link(uri_str):
                        results.append({
                            "title":   str(title) if title else f"Result {i + 1}",
                            "link":    uri_str,
                            "snippet": (response.text or "")[:200] if response.text else "",
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
        search_query = (
            f"{query} Indian law judgement Supreme Court High Court "
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


def _search_google(
    query: str,
    num_results: int = 5,
    run_id: Optional[str] = None,
    user_id: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Google search route uses Gemini Grounding and legal-site allowlist."""
    result = _search_google_grounding(query, num_results=num_results, run_id=run_id, user_id=user_id)
    if not result and _use_serper_for_google_search():
        logger.info("[WATCHDOG] Google Grounding returned 0; falling back to Serper")
        return _search_google_serper(query, num_results=num_results, run_id=run_id, user_id=user_id)
    return result


# ── Dimension query builder ───────────────────────────────────────────────────

def _build_qdrant_dimension_tasks(
    dimensions: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """
    Tasks for Qdrant semantic local search: SC + HC + provision + semantic queries.

    Four query types are used per dimension:
      sc        — Supreme Court-focused phrase (8-15 words, IK-optimised)
      hc        — High Court-focused phrase (8-15 words)
      provision — Statute/section-focused phrase (8-15 words)
      semantic  — Rich 25-60 word descriptive phrase that encodes full dimension
                  context (facts, outcome, legal principle, section numbers).
                  Falls back to reasoning + sc + hc + provision concatenation.

    Using all four guarantees that:
    - Admin-uploaded HC judgments are found (hc query)
    - Provision-specific judgments are found (provision query)
    - Semantically rich matches are found via denser embedding (semantic query)
    """
    tasks: List[Dict[str, Any]] = []
    for dim in dimensions:
        dim_id = dim.get("dimension_id", "?")
        dim_name = dim.get("name", "")
        qs = dim.get("queries") or {}
        reasoning = (dim.get("reasoning") or "").strip()

        # Standard 3-tier queries
        for q_type, q_key in (("sc", "sc_query"), ("hc", "hc_query"), ("provision", "provision_query")):
            q = (qs.get(q_key) or "").strip()
            if q:
                tasks.append({
                    "query": q,
                    "q_type": q_type,
                    "dimension_id": dim_id,
                    "dimension_name": dim_name,
                })

        # Semantic query: rich context for dense vector search — finds admin-uploaded
        # judgments whose text doesn't match short IK-style keyword phrases.
        sem_q = (qs.get("semantic_query") or "").strip()
        if not sem_q:
            # Synthesise: dimension name + reasoning + all 3 queries
            sc_q = (qs.get("sc_query") or "").strip()
            hc_q = (qs.get("hc_query") or "").strip()
            pv_q = (qs.get("provision_query") or "").strip()
            sem_q = " ".join(filter(None, [dim_name, reasoning, sc_q, hc_q, pv_q]))
        if sem_q:
            tasks.append({
                "query": sem_q,
                "q_type": "semantic",
                "dimension_id": dim_id,
                "dimension_name": dim_name,
            })

    return tasks


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


def _build_single_dimension_query_tasks(dim: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Build query-task dicts for one dimension."""
    return _build_dimension_query_tasks([dim])


def _build_single_qdrant_dimension_tasks(dim: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Build Qdrant query-task dicts for one dimension."""
    return _build_qdrant_dimension_tasks([dim])


def _run_async(coro):
    """Run a coroutine from this synchronous module."""
    return asyncio.run(coro)


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
            default_model=os.environ.get("GEMINI_MODEL", "gemini-2.0-flash"),
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
    dimensions: Optional[List[Dict[str, Any]]] = None,
    case_state: str = "",
    run_id: Optional[str] = None,
    user_id: Optional[str] = None,
    controversy_map: Optional[Dict[str, Any]] = None,
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
            if r.get("_from_qdrant_semantic"):
                ex["_from_qdrant_semantic"] = True
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

    # ── Build local/search query list from legal dimensions (preferred) ───────
    if dimensions:
        all_dim_queries = [t["query"] for t in _build_dimension_query_tasks(dimensions)]
        keyword_list = all_dim_queries if all_dim_queries else ([query] if query else [])
        # In dimension mode IK/Google use the same dimension queries
        ik_google_queries = keyword_list
    else:
        ks_list = [ks for ks in (keyword_sets or []) if (ks or "").strip()]
        # Qdrant semantic search uses the full controversy_query (long = better embedding)
        keyword_list = [query] if query else ks_list
        # IK/Google keyword search MUST use short phrases (≤12 words).
        # ks_list comes from LDE fallback (factual_trigger, legal_claim, central_controversy
        # truncated to 12 words). If empty, fall back to query but still cap to 12 words.
        if ks_list:
            ik_google_queries = ks_list
        elif query:
            # Strip common question preamble so IK can find matches
            _q = re.sub(r'^(?:did|does|was|were|is|are|whether|how|what|why|when)\s+(?:the\s+)?', '', query.strip(), flags=re.I)
            _q = re.sub(r'^(?:high|supreme|bombay|delhi|madras|allahabad|calcutta|gujarat|karnataka|kerala|punjab|haryana|rajasthan|orissa|andhra|telangana)\s+court\s+\w+\s+', '', _q, flags=re.I)
            ik_google_queries = [" ".join(_q.split()[:12])] if _q.strip() else [query]
        else:
            ik_google_queries = []

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
    if dimensions:
        for t in _build_dimension_query_tasks(dimensions):
            logger.info(
                "[WATCHDOG] DIM_QUERY [dim=%s|%s] %s",
                t.get("dimension_id"),
                t.get("q_type"),
                (t.get("query") or "")[:180],
            )
    _db_log(run_id, "watchdog", "watchdog", "INFO",
            f"🐕 Watchdog started — IK mode={ik_mode} | "
            f"dims={len(dimensions) if dimensions else 0} | queries={len(keyword_list)}",
            {"ik_mode": ik_mode, "dimension_count": len(dimensions) if dimensions else 0,
             "keyword_count": len(keyword_list), "primary_query": primary_query[:120]})

    # ── 1. Local DB search — Qdrant semantic (primary) + keyword fallback ──────
    if dimensions:
        all_dim_tasks = _build_dimension_query_tasks(dimensions)
        qdrant_tasks = _build_qdrant_dimension_tasks(dimensions)
        per_local = max(1, max_local // max(len(all_dim_tasks), 1))
        local_rows: List[Dict[str, Any]] = []

        async def _run_local_dimension_queries(dim_tasks: List[Dict[str, Any]]) -> List[Any]:
            return await asyncio.gather(*[
                asyncio.to_thread(
                    _search_local,
                    t["query"],
                    per_local,
                    run_id,
                    case_state,
                    t["dimension_id"],
                    t["dimension_name"],
                    t["q_type"],
                )
                for t in dim_tasks
            ], return_exceptions=True)

        # Phase 2: inject controversy_query as an extra Qdrant task (dual-vector)
        # Results that match the controversy vector get a composite score boost.
        _controversy_q = ""
        if controversy_map and isinstance(controversy_map, dict):
            _controversy_q = str(
                controversy_map.get("controversy_query") or
                controversy_map.get("central_controversy") or ""
            ).strip()
        if _controversy_q:
            qdrant_tasks = qdrant_tasks + [{
                "query":          _controversy_q,
                "q_type":         "controversy",
                "dimension_id":   None,
                "dimension_name": "controversy",
            }]
            logger.info("[WATCHDOG] Added controversy Qdrant task: %s", _controversy_q[:80])

        # Run all dimension semantic tasks in one batch (so all dimensions are evaluated together).
        if qdrant_tasks:
            try:
                local_rows.extend(
                    _search_local_semantic(
                        tasks=qdrant_tasks,
                        max_total=max_local,
                        case_state=case_state,
                        run_id=run_id,
                        user_id=user_id,
                    )
                )
            except Exception as exc:
                logger.warning("[WATCHDOG] Semantic local dimension batch failed: %s", exc)

        # Fallback keyword retrieval for all dimension queries in parallel.
        if len(local_rows) < max_local and all_dim_tasks:
            local_results = _run_async(_run_local_dimension_queries(all_dim_tasks))
            for task, result in zip(all_dim_tasks, local_results):
                if isinstance(result, Exception):
                    logger.warning(
                        "[WATCHDOG] Local keyword task failed for dim=%s query=%r: %s",
                        task.get("dimension_id", "?"), task.get("query", "")[:60], result,
                    )
                    continue
                local_rows.extend(result or [])

        local = _dedupe_local_rows(local_rows)
        if len(local) < max_local and primary_query:
            topup = _search_local(primary_query, limit=max_local, run_id=run_id, case_state=case_state)
            local = _dedupe_local_rows(local + (topup or []))
        local = local[:max_local]
    else:
        # Legacy / no-dimension mode — semantic first, then keyword fallback
        local = _search_local_semantic(
            tasks=[{"query": primary_query, "q_type": "keyword",
                    "dimension_id": None, "dimension_name": ""}],
            max_total=max_local,
            case_state=case_state,
            run_id=run_id,
            user_id=user_id,
        )
        if len(local) < max_local:
            topup = _search_local(primary_query, limit=max_local, run_id=run_id, case_state=case_state)
            local = _dedupe_local_rows((local or []) + (topup or []))[:max_local]

    # ── 2. Indian Kanoon — dimension-aware batched search ────────────────────
    seen_tids: Dict[str, Dict[str, Any]] = {}
    dropped_low_hierarchy = 0

    if not skip_ik and dimensions:
        tasks = _build_dimension_query_tasks(dimensions)
        per_query_limit = max(2, max_ik // max(len(tasks), 1))

        logger.info("[WATCHDOG] Dimension IK search: %d queries across %d dimension(s)",
                    len(tasks), len(dimensions))
        _db_log(run_id, "watchdog", "watchdog", "INFO",
                f"📚 IK dimension search — {len(tasks)} queries across {len(dimensions)} dimensions",
                {"total_queries": len(tasks), "dimension_count": len(dimensions),
                 "per_query_limit": per_query_limit})

        async def _run_ik_dimension_queries(dim_tasks: List[Dict[str, Any]]) -> List[Any]:
            return await asyncio.gather(*[
                asyncio.to_thread(
                    _search_indian_kanoon,
                    t["query"],
                    per_query_limit,
                    run_id,
                    user_id,
                    t["dimension_id"],
                    t["dimension_name"],
                    t["q_type"],
                )
                for t in dim_tasks
            ], return_exceptions=True)

        try:
            # Execute all dimension queries together so all dimensions resolve in parallel.
            dim_results = _run_async(_run_ik_dimension_queries(tasks))
        except Exception as exc:
            logger.warning("[WATCHDOG] IK dimension batch failed: %s", exc)
            _db_log(run_id, "watchdog", "watchdog", "WARNING", f"📚 IK dimension batch failed: {exc}")
            dim_results = []

        for task, results in zip(tasks, dim_results):
            dim_id = task.get("dimension_id", "?")
            if isinstance(results, Exception):
                logger.warning("[WATCHDOG] IK task failed for dim=%s query=%r: %s",
                               dim_id, task.get("query", "")[:60], results)
                _db_log(run_id, "watchdog", "watchdog", "WARNING",
                        f"📚 IK query failed [{task.get('q_type')}|dim={dim_id}]: {results}")
                continue

            for candidate in results:
                q_type = str(task.get("q_type") or "").strip().lower()
                candidate["_query_type"] = q_type
                candidate["is_provision_match"] = (q_type == "provision")
                candidate["_dimension_id"] = dim_id
                candidate["_dimension_name"] = task.get("dimension_name")
                tid = (candidate.get("external_id") or "").strip()
                if not tid:
                    continue
                if _is_pending_result(candidate):
                    continue
                if _is_low_hierarchy(candidate.get("docsource", "")) and q_type != "provision":
                    dropped_low_hierarchy += 1
                    continue
                if tid not in seen_tids:
                    candidate["_jurisdiction_priority"] = _jurisdiction_priority(candidate, case_state)
                    seen_tids[tid] = candidate

    if not skip_ik and not dimensions:
        if False:
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

                            # ── Status filter: Approved only (spec §6) ────────
                            if _is_pending_result(candidate):
                                logger.debug(
                                    "[WATCHDOG] Dropped Pending result: %s (%s)",
                                    candidate.get("title", "?")[:60],
                                    candidate.get("docsource", ""),
                                )
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
            # Use ik_google_queries (short IK-friendly phrases) not keyword_list
            # (which may contain the long semantic controversy_query)
            _ik_list = ik_google_queries if ik_google_queries else keyword_list
            per_ik = max(1, max_ik // len(_ik_list)) if len(_ik_list) > 1 else max_ik

            def _run_ik_keyword(args: Tuple[int, str]) -> Tuple[int, List[Dict[str, Any]]]:
                qi, q = args
                q = (q or "").strip()
                if not q:
                    return qi, []
                return qi, _search_indian_kanoon(q, limit=per_ik, run_id=run_id, user_id=user_id)

            active = [(qi, q) for qi, q in enumerate(_ik_list, 1) if (q or "").strip()]
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

    # ── 3. Google search ──────────────────────────────────────────────────────
    # Run Google for all dimension queries (SC/HC/Provision) when available.
    google_queries: List[str] = []
    if dimensions:
        google_queries = _unique_nonempty(keyword_list)
    if not google_queries:
        # Use ik_google_queries (short phrases) — primary_query may be the long controversy_query
        google_queries = _unique_nonempty(ik_google_queries) if ik_google_queries else ([primary_query] if primary_query else [])
    # Cap Google via env so default remains safe but dimension-aware.
    try:
        max_google_queries = int(os.environ.get("CITATION_MAX_GOOGLE_QUERIES", "18"))
    except Exception:
        max_google_queries = 18
    google_queries = google_queries[:max(1, max_google_queries)]

    seen_google: Dict[str, Dict[str, Any]] = {}
    per_google = max(1, max_google // max(len(google_queries), 1))

    def _run_google_one(q: str) -> List[Dict[str, Any]]:
        return _search_google(q, num_results=per_google, run_id=run_id, user_id=user_id)

    if dimensions:
        async def _run_google_dimension_queries(dim_queries: List[str]) -> List[Any]:
            return await asyncio.gather(*[
                asyncio.to_thread(_run_google_one, q) for q in dim_queries
            ], return_exceptions=True)

        try:
            dim_results = _run_async(_run_google_dimension_queries(google_queries))
        except Exception as exc:
            logger.warning("[WATCHDOG] Google dimension batch failed: %s", exc)
            dim_results = []
        for query_text, result in zip(google_queries, dim_results):
            if isinstance(result, Exception):
                logger.warning("[WATCHDOG] Google query failed query=%r: %s", query_text[:60], result)
                continue
            for g in result:
                link = (g.get("link") or "").strip()
                if link and link not in seen_google:
                    seen_google[link] = g
    else:
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
        "local":         _unique_nonempty(keyword_list if dimensions else [primary_query]),
        "indian_kanoon": _unique_nonempty(keyword_list) if ik_enabled and not skip_ik else [],
        "google":        _unique_nonempty(google_queries) if google_enabled else [],
    }

    _db_log(run_id, "watchdog", "watchdog", "INFO",
            f"✅ Watchdog done — 🏛 {len(local)} local | 📚 {len(candidates_ik)} IK | "
            f"🌐 {len(candidates_google)} Google | 🚫 {dropped_low_hierarchy} dropped",
            {"local_count": len(local), "ik_count": len(candidates_ik),
             "google_count": len(candidates_google),
             "dropped_low_hierarchy": dropped_low_hierarchy})

    needing_clerk: List[str] = []
    _seen_nc = set()
    for r in local:
        if not r.get("_needs_clerk_analysis"):
            continue
        cid = str(r.get("canonical_id") or r.get("id") or "").strip()
        if cid and cid not in _seen_nc:
            _seen_nc.add(cid)
            needing_clerk.append(cid)
    if needing_clerk:
        logger.info(
            "[WATCHDOG] %d Qdrant local hit(s) missing citation_data.analysis_report — queued for Clerk enrich",
            len(needing_clerk),
        )

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
