"""
PostgreSQL + Elasticsearch DB client for citation-service.
Uses canonical_id across systems and stores report snapshots in PostgreSQL.
"""

from __future__ import annotations

import logging
import re
from datetime import date, datetime
from typing import Any, Dict, List, Optional

from psycopg2.extras import Json, RealDictCursor

from db.connections import get_es_client, get_pg_conn, get_neo4j_driver

logger = logging.getLogger(__name__)


def _fmt_date(value: Any) -> Any:
    if isinstance(value, (datetime, date)):
        return value.strftime("%d %b %Y")
    return value


def _normalize_db_status(status: Any) -> Any:
    """Normalize audit status for DB columns with short VARCHAR limits."""
    if status is None:
        return None
    s = str(status).strip()
    if not s:
        return None
    mapping = {
        'VERIFIED_WITH_WARNINGS': 'VERIFIED_WARN',
        'NEEDS_REVIEW': 'NEEDS_REVIEW',
        'QUARANTINED': 'QUARANTINED',
        'VERIFIED': 'VERIFIED',
    }
    if s in mapping:
        return mapping[s]
    return s[:20]


def _normalize_citation_key(raw: str) -> str:
    """
    Normalize a citation string so blacklist lookups are stable:
    - lowercase
    - expand common abbreviations (AIR -> all india reporter)
    - strip punctuation and collapse whitespace
    """
    s = (raw or "").lower()
    s = s.replace("air", "all india reporter")
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return " ".join(s.split())


def citation_blacklisted(raw: str) -> bool:
    """
    Check if a citation (any textual form) is present in the confirmed-fake blacklist.
    This should be called at Step 0 before running any verification layers.
    """
    key = _normalize_citation_key(raw)
    if not key:
        return False
    conn = get_pg_conn()
    if not conn:
        return False
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM citation_blacklist WHERE normalized_key = %s", (key,))
            return cur.fetchone() is not None
    finally:
        conn.close()


def init_db() -> None:
    """
    Ensure service-local tables exist: citation_reports, citation_pipeline_runs,
    agent_logs, hitl_queue, report_citations.
    Core legal schema tables (judgments, citation_aliases, judges, etc.) are assumed to exist.
    """
    conn = get_pg_conn()
    if not conn:
        return
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS citation_reports (
                    id UUID PRIMARY KEY,
                    user_id VARCHAR,
                    query TEXT,
                    report_format JSONB,
                    status VARCHAR,
                    case_id VARCHAR,
                    citation_count INTEGER DEFAULT 0,
                    run_id UUID,
                    hitl_pending_count INTEGER DEFAULT 0,
                    hitl_approved_count INTEGER DEFAULT 0,
                    citations_approved_count INTEGER DEFAULT 0,
                    citations_quarantined_count INTEGER DEFAULT 0,
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW()
                )
                """
            )
            # Add new columns if table already existed (ignore errors)
            try:
                cur.execute("ALTER TABLE citation_reports ADD COLUMN IF NOT EXISTS run_id UUID")
                cur.execute("ALTER TABLE citation_reports ADD COLUMN IF NOT EXISTS hitl_pending_count INTEGER DEFAULT 0")
                cur.execute("ALTER TABLE citation_reports ADD COLUMN IF NOT EXISTS hitl_approved_count INTEGER DEFAULT 0")
                cur.execute("ALTER TABLE citation_reports ADD COLUMN IF NOT EXISTS citations_approved_count INTEGER DEFAULT 0")
                cur.execute("ALTER TABLE citation_reports ADD COLUMN IF NOT EXISTS citations_quarantined_count INTEGER DEFAULT 0")
                cur.execute("ALTER TABLE citation_reports ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()")
                cur.execute("ALTER TABLE citation_reports ADD COLUMN IF NOT EXISTS shared_with JSONB DEFAULT '[]'::jsonb")
            except Exception:
                pass

            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS citation_pipeline_runs (
                    id UUID PRIMARY KEY,
                    user_id VARCHAR NOT NULL,
                    case_id VARCHAR,
                    query TEXT NOT NULL,
                    status VARCHAR NOT NULL DEFAULT 'running',
                    report_id UUID,
                    citations_fetched_count INTEGER DEFAULT 0,
                    citations_approved_count INTEGER DEFAULT 0,
                    citations_quarantined_count INTEGER DEFAULT 0,
                    citations_sent_to_hitl_count INTEGER DEFAULT 0,
                    started_at TIMESTAMP NOT NULL DEFAULT NOW(),
                    completed_at TIMESTAMP,
                    error_message TEXT,
                    created_at TIMESTAMP DEFAULT NOW()
                )
                """
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS agent_logs (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    run_id UUID,
                    report_id UUID,
                    agent_name VARCHAR(64) NOT NULL,
                    stage VARCHAR(64),
                    log_level VARCHAR(16) NOT NULL,
                    message TEXT NOT NULL,
                    metadata JSONB,
                    created_at TIMESTAMP NOT NULL DEFAULT NOW()
                )
                """
            )
            cur.execute("CREATE INDEX IF NOT EXISTS idx_agent_logs_run ON agent_logs(run_id)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_agent_logs_created ON agent_logs(created_at DESC)")

            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS hitl_queue (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    report_id UUID,
                    run_id UUID,
                    canonical_id VARCHAR(128) NOT NULL,
                    citation_string VARCHAR(512),
                    query_context TEXT,
                    web_source_url TEXT,
                    priority_score NUMERIC(4,3) DEFAULT 0.0,
                    case_id VARCHAR,
                    user_id VARCHAR NOT NULL,
                    citation_snapshot JSONB NOT NULL,
                    status VARCHAR(32) NOT NULL DEFAULT 'pending',
                    reason_queued VARCHAR(256),
                    reviewed_at TIMESTAMP,
                    reviewed_by VARCHAR(128),
                    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW()
                )
                """
            )
            # Migrations: add new columns if table existed with older schema
            for _sql in [
                "ALTER TABLE hitl_queue ALTER COLUMN report_id DROP NOT NULL",
                "ALTER TABLE hitl_queue ADD COLUMN IF NOT EXISTS citation_string VARCHAR(512)",
                "ALTER TABLE hitl_queue ADD COLUMN IF NOT EXISTS query_context TEXT",
                "ALTER TABLE hitl_queue ADD COLUMN IF NOT EXISTS web_source_url TEXT",
                "ALTER TABLE hitl_queue ADD COLUMN IF NOT EXISTS priority_score NUMERIC(4,3) DEFAULT 0.0",
                "CREATE INDEX IF NOT EXISTS idx_hitl_report ON hitl_queue(report_id)",
                "CREATE INDEX IF NOT EXISTS idx_hitl_status ON hitl_queue(status)",
                "CREATE INDEX IF NOT EXISTS idx_hitl_priority ON hitl_queue(priority_score DESC)",
            ]:
                try:
                    cur.execute(_sql)
                except Exception:
                    pass

            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS report_citations (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    report_id UUID NOT NULL,
                    canonical_id VARCHAR(128) NOT NULL,
                    status VARCHAR(32) NOT NULL,
                    citation_snapshot JSONB,
                    hitl_queue_id UUID,
                    created_at TIMESTAMP NOT NULL DEFAULT NOW()
                )
                """
            )
            cur.execute("CREATE INDEX IF NOT EXISTS idx_report_citations_report ON report_citations(report_id)")

            # Blacklist of confirmed fake / hallucinated citations (normalized_key)
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS citation_blacklist (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    normalized_key TEXT UNIQUE NOT NULL,
                    reason TEXT,
                    created_at TIMESTAMP NOT NULL DEFAULT NOW()
                )
                """
            )
            cur.execute("CREATE INDEX IF NOT EXISTS idx_citation_blacklist_key ON citation_blacklist(normalized_key)")

            # Daily usage analytics for admin dashboard
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS usage_analytics_daily (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    user_id VARCHAR NOT NULL,
                    usage_date DATE NOT NULL,
                    queries_count INTEGER NOT NULL DEFAULT 0,
                    citations_generated INTEGER NOT NULL DEFAULT 0,
                    time_saved_minutes INTEGER NOT NULL DEFAULT 0,
                    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
                    UNIQUE (user_id, usage_date)
                )
                """
            )
            cur.execute("CREATE INDEX IF NOT EXISTS idx_usage_analytics_date ON usage_analytics_daily(usage_date)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_usage_analytics_user ON usage_analytics_daily(user_id)")

            # Migration: store rich citation fields in PG for ES-free fallback
            try:
                cur.execute("ALTER TABLE judgments ADD COLUMN IF NOT EXISTS citation_data JSONB")
            except Exception:
                pass

            # ── Indian Kanoon enrichment columns on judgments ──────────────
            for _col_sql in [
                "ALTER TABLE judgments ADD COLUMN IF NOT EXISTS ik_orig_doc_url TEXT",
                "ALTER TABLE judgments ADD COLUMN IF NOT EXISTS ik_fragments JSONB",
                "ALTER TABLE judgments ADD COLUMN IF NOT EXISTS ik_cite_list JSONB",
                "ALTER TABLE judgments ADD COLUMN IF NOT EXISTS ik_cited_by_list JSONB",
                "ALTER TABLE judgments ADD COLUMN IF NOT EXISTS ik_doc_meta JSONB",
            ]:
                try:
                    cur.execute(_col_sql)
                except Exception:
                    pass

            # ── ik_document_assets: stores all IK API responses per document ──
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS ik_document_assets (
                    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    doc_id                VARCHAR(64) NOT NULL,
                    canonical_id          VARCHAR(128),
                    meta                  JSONB,
                    fragments             JSONB,
                    cite_list             JSONB,
                    cited_by_list         JSONB,
                    orig_doc_url          TEXT,
                    orig_doc_gcs_path     TEXT,
                    orig_doc_content_type VARCHAR(64),
                    raw_api_response      JSONB,
                    title                 TEXT,
                    docsource             TEXT,
                    doc_char_count        INTEGER,
                    cache_hit_count       INTEGER DEFAULT 0,
                    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    UNIQUE (doc_id)
                )
                """
            )
            # Migrations for existing tables
            for _col in [
                "ALTER TABLE ik_document_assets ADD COLUMN IF NOT EXISTS raw_api_response JSONB",
                "ALTER TABLE ik_document_assets ADD COLUMN IF NOT EXISTS title TEXT",
                "ALTER TABLE ik_document_assets ADD COLUMN IF NOT EXISTS docsource TEXT",
                "ALTER TABLE ik_document_assets ADD COLUMN IF NOT EXISTS doc_char_count INTEGER",
                "ALTER TABLE ik_document_assets ADD COLUMN IF NOT EXISTS cache_hit_count INTEGER DEFAULT 0",
            ]:
                try:
                    cur.execute(_col)
                except Exception:
                    pass
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_ik_assets_doc_id ON ik_document_assets(doc_id)"
            )
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_ik_assets_canonical ON ik_document_assets(canonical_id)"
            )

        conn.commit()
    finally:
        conn.close()


def judgement_update_validation(
    canonical_id: str,
    librarian_status: str = None,
    librarian_warnings: str = None,
    librarian_issues: str = None,
    area: str = None,
    audit_status: str = None,
    audit_confidence: int = None,
):
    """
    Persist validation results.
    Maps to judgments.verification_status and judgments.confidence_score.
    Also mirrors rich status fields into Elasticsearch for UI/reporting.
    """
    canonical_id = (canonical_id or "").strip()
    if not canonical_id:
        return

    status = audit_status or librarian_status
    score = audit_confidence
    db_status = _normalize_db_status(status)
    # confidence_score column is often NUMERIC(4,3): 0–9.999; auditor sends 0–100
    if score is not None:
        try:
            v = float(score)
            if v > 1:
                v = round(v / 100.0, 3)
            score = min(9.999, max(0.0, v))
        except (TypeError, ValueError):
            score = None

    conn = get_pg_conn()
    if conn:
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE judgments
                       SET verification_status = COALESCE(%s, verification_status),
                           confidence_score    = COALESCE(%s, confidence_score),
                           last_verified_at    = CASE
                                                   WHEN %s IS NULL AND %s IS NULL THEN last_verified_at
                                                   ELSE NOW()
                                                 END
                     WHERE canonical_id = %s
                    """,
                    (db_status, score, db_status, score, canonical_id),
                )
            conn.commit()
        finally:
            conn.close()

    es = get_es_client()
    if es:
        try:
            payload = {
                "doc": {
                    "librarian_status": librarian_status,
                    "librarian_warnings": librarian_warnings,
                    "librarian_issues": librarian_issues,
                    "area": area,
                    "audit_status": audit_status,
                    "audit_confidence": audit_confidence,
                }
            }
            es.update(index="judgments", id=canonical_id, body=payload, doc_as_upsert=True)
        except Exception as exc:
            logger.warning("[ES] status update failed for %s: %s", canonical_id, exc)


def judgement_get(canonical_id: str) -> Optional[Dict[str, Any]]:
    canonical_id = (canonical_id or "").strip()
    if not canonical_id:
        return None

    row = None
    conn = get_pg_conn()
    if conn:
        try:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(
                    """
                    SELECT judgment_uuid, canonical_id, case_name, court_code, court_tier,
                           judgment_date, year, bench_size, outcome, source_type,
                           verification_status, confidence_score, citation_frequency,
                           qdrant_vector_id, neo4j_node_id, es_doc_id,
                           ingested_at, last_verified_at, citation_data,
                           ik_orig_doc_url, ik_fragments, ik_cite_list, ik_cited_by_list, ik_doc_meta
                      FROM judgments
                     WHERE canonical_id = %s
                    """,
                    (canonical_id,),
                )
                row = cur.fetchone()
        finally:
            conn.close()

    es_doc = None
    es = get_es_client()
    if es:
        try:
            res = es.get(index="judgments", id=canonical_id)
            es_doc = res.get("_source") or {}
        except Exception:
            es_doc = None

    if not row and not es_doc:
        return None

    row = row or {}
    es_doc = es_doc or {}

    # Fall back to PG citation_data JSONB when ES is unavailable
    pg_citation = row.get("citation_data") or {}
    if isinstance(pg_citation, str):
        import json as _json
        try:
            pg_citation = _json.loads(pg_citation)
        except Exception:
            pg_citation = {}

    def _es_or_pg(key: str, pg_key: str = None):
        """Return ES value if available, else fall back to PG citation_data."""
        v = es_doc.get(key)
        if v is not None and v != "" and v != []:
            return v
        return pg_citation.get(pg_key or key)

    source_url = _es_or_pg("source_url") or _es_or_pg("official_source_url")
    # Import source link: URL from which this judgment was fetched (Indian Kanoon, Google result, etc.)
    import_source_link = source_url or _es_or_pg("official_source_url") or ""

    # Subsequent treatment: prefer ES cached value; if missing, compute from Neo4j citation graph.
    subsequent_treatment = es_doc.get("subsequent_treatment") or {}
    if not subsequent_treatment:
        driver = get_neo4j_driver()
        if driver:
            try:
                with driver.session() as session:
                    cypher = """
                        MATCH (c:CitedCase {caseId: $cid})<-[r]-(other:CitedCase)
                        WHERE type(r) IN ['FOLLOWS','DISTINGUISHES','OVERRULES']
                        RETURN type(r) AS rel_type, coalesce(other.caseName, other.caseId) AS name
                        LIMIT 100
                    """
                    result = session.run(cypher, cid=canonical_id)
                    followed: List[str] = []
                    distinguished: List[str] = []
                    overruled: List[str] = []
                    for rec in result:
                        rel = (rec.get("rel_type") or "").upper()
                        name = (rec.get("name") or "").strip()
                        if not name:
                            continue
                        if rel == "FOLLOWS":
                            followed.append(name)
                        elif rel == "DISTINGUISHES":
                            distinguished.append(name)
                        elif rel == "OVERRULES":
                            overruled.append(name)
                    if followed or distinguished or overruled:
                        subsequent_treatment = {
                            "followed": followed,
                            "distinguished": distinguished,
                            "overruled": overruled,
                        }
                        # Cache back into ES for future fast reads
                        if es:
                            try:
                                es.update(
                                    index="judgments",
                                    id=canonical_id,
                                    body={"doc": {"subsequent_treatment": subsequent_treatment}},
                                    doc_as_upsert=True,
                                )
                            except Exception as exc:
                                logger.warning("[ES] subsequent_treatment cache failed for %s: %s", canonical_id, exc)
            except Exception as exc:
                logger.warning("[NEO4J] subsequent_treatment fetch failed for %s: %s", canonical_id, exc)
    return {
        "id": canonical_id,
        "canonical_id": canonical_id,
        "title": _es_or_pg("case_name") or row.get("case_name"),
        "primary_citation": _es_or_pg("primary_citation"),
        "alternate_citations": _es_or_pg("alternate_citations") or [],
        "court": _es_or_pg("court_name") or _es_or_pg("court_code") or row.get("court_code"),
        "bench_type": _es_or_pg("bench_type"),
        "date_judgment": _fmt_date(row.get("judgment_date")),
        "statutes": _es_or_pg("statutes") or [],
        "ratio": _es_or_pg("holding_text") or _es_or_pg("summary_text") or "",
        "excerpt_para": _es_or_pg("excerpt_para"),
        "excerpt_text": _es_or_pg("excerpt_text"),
        "source_url": source_url,
        "official_source_url": _es_or_pg("official_source_url") or source_url,
        "import_source_link": import_source_link,
        "subsequent_treatment": subsequent_treatment or {},
        "source": row.get("source_type") or _es_or_pg("source_type") or "local",
        "raw_content": _es_or_pg("full_text") or "",
        "full_text": _es_or_pg("full_text") or "",
        "paragraphs": _es_or_pg("paragraphs") or [],
        "audit_status": es_doc.get("audit_status") or row.get("verification_status"),
        "audit_confidence": es_doc.get("audit_confidence") or row.get("confidence_score"),
        "librarian_status": es_doc.get("librarian_status") or row.get("verification_status"),
        "librarian_warnings": es_doc.get("librarian_warnings"),
        "librarian_issues": es_doc.get("librarian_issues"),
        "area": es_doc.get("area"),
        "refreshed_at": _fmt_date(row.get("last_verified_at") or row.get("ingested_at")),
        # Indian Kanoon enrichment columns (from judgments table)
        "ik_orig_doc_url":    row.get("ik_orig_doc_url") or "",
        "ik_fragments":       row.get("ik_fragments") or {},
        "ik_cite_list":       row.get("ik_cite_list") or [],
        "ik_cited_by_list":   row.get("ik_cited_by_list") or [],
        "ik_doc_meta":        row.get("ik_doc_meta") or {},
    }

    # ── IK fallback: if judgments IK columns are empty, pull from ik_document_assets ──
    _needs_ik_fallback = (
        not result.get("ik_orig_doc_url")
        and not result.get("ik_cite_list")
        and not result.get("ik_cited_by_list")
        and not result.get("ik_doc_meta")
    )
    if _needs_ik_fallback:
        _ik_conn = get_pg_conn()
        if _ik_conn:
            try:
                with _ik_conn.cursor(cursor_factory=RealDictCursor) as _cur:
                    _cur.execute(
                        """SELECT orig_doc_url, fragments, cite_list, cited_by_list, meta, raw_api_response
                             FROM ik_document_assets
                            WHERE canonical_id = %s
                            ORDER BY updated_at DESC NULLS LAST LIMIT 1""",
                        (canonical_id,),
                    )
                    _ik_row = _cur.fetchone()
                    if _ik_row:
                        result["ik_orig_doc_url"] = _ik_row.get("orig_doc_url") or ""
                        result["ik_fragments"] = _ik_row.get("fragments") or {}
                        result["ik_doc_meta"] = _ik_row.get("meta") or {}
                        # cite_list/cited_by_list may be NULL due to old field-name bug;
                        # fall back to raw_api_response.doc_data.cites / .citedby
                        _cite = _ik_row.get("cite_list") or []
                        _citedby = _ik_row.get("cited_by_list") or []
                        if not _cite or not _citedby:
                            _raw = _ik_row.get("raw_api_response") or {}
                            _doc_data = _raw.get("doc_data") or {}
                            _cite = _cite or _doc_data.get("cites") or _doc_data.get("citeList") or []
                            _citedby = _citedby or _doc_data.get("citedby") or _doc_data.get("citedbyList") or []
                        result["ik_cite_list"] = _cite
                        result["ik_cited_by_list"] = _citedby
            except Exception as _exc:
                logger.warning("[DB] IK fallback from ik_document_assets failed for %s: %s", canonical_id, _exc)
            finally:
                _ik_conn.close()

    return result


def judgement_search_local(query: str, limit: int = 10) -> List[Dict[str, Any]]:
    query = (query or "").strip()
    if not query:
        return []

    es = get_es_client()
    if es:
        try:
            resp = es.search(
                index="judgments",
                size=limit,
                query={
                    "multi_match": {
                        "query": query,
                        "fields": [
                            "case_name^3",
                            "summary_text^2",
                            "holding_text^2",
                            "facts_text",
                            "full_text",
                        ],
                    }
                },
            )
            hits = resp.get("hits", {}).get("hits", [])
            rows = []
            for h in hits:
                src = h.get("_source") or {}
                canonical_id = src.get("canonical_id") or h.get("_id")
                rows.append({
                    "id": canonical_id,
                    "canonical_id": canonical_id,
                    "title": src.get("case_name"),
                    "primary_citation": src.get("primary_citation"),
                    "court": src.get("court_code"),
                    "ratio": src.get("holding_text") or src.get("summary_text"),
                    "source": src.get("source_type") or "local",
                })
            return rows
        except Exception as exc:
            logger.warning("[ES] search failed: %s", exc)

    conn = get_pg_conn()
    if not conn:
        return []
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT canonical_id, case_name, court_code, judgment_date, year, source_type
                  FROM judgments
                 WHERE case_name ILIKE %s
                 ORDER BY ingested_at DESC NULLS LAST
                 LIMIT %s
                """,
                (f"%{query}%", limit),
            )
            rows = cur.fetchall()
            out = []
            for r in rows:
                out.append({
                    "id": r.get("canonical_id"),
                    "canonical_id": r.get("canonical_id"),
                    "title": r.get("case_name"),
                    "primary_citation": None,
                    "court": r.get("court_code"),
                    "ratio": "",
                    "source": r.get("source_type") or "local",
                })
            return out
    finally:
        conn.close()


# --- Citation reports (user-specific) ---

def report_insert(
    report_id: str,
    user_id: str,
    query: str,
    report_format: Dict[str, Any],
    status: str = "completed",
    case_id: Optional[str] = None,
    run_id: Optional[str] = None,
    hitl_pending_count: int = 0,
    hitl_approved_count: int = 0,
    citations_approved_count: int = 0,
    citations_quarantined_count: int = 0,
) -> str:
    conn = get_pg_conn()
    if not conn:
        raise RuntimeError("PostgreSQL unavailable for report_insert")
    cit_count = len(report_format.get("citations", [])) if isinstance(report_format, dict) else 0
    try:
        with conn.cursor() as cur:
            # Store main report row
            cur.execute(
                """
                INSERT INTO citation_reports (
                    id, user_id, query, report_format, status, case_id, citation_count,
                    run_id, hitl_pending_count, hitl_approved_count,
                    citations_approved_count, citations_quarantined_count
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    report_id, user_id, query, Json(report_format), status, case_id, cit_count,
                    run_id, hitl_pending_count, hitl_approved_count,
                    citations_approved_count, citations_quarantined_count,
                ),
            )

            # Increment daily usage analytics for this user
            from datetime import date

            today = date.today()
            # Simple heuristic: assume each verified citation saves ~5 minutes of manual research
            est_minutes_saved = int(max(0, cit_count) * 5)
            cur.execute(
                """
                INSERT INTO usage_analytics_daily (
                    user_id, usage_date, queries_count, citations_generated, time_saved_minutes
                )
                VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT (user_id, usage_date)
                DO UPDATE SET
                    queries_count = usage_analytics_daily.queries_count + EXCLUDED.queries_count,
                    citations_generated = usage_analytics_daily.citations_generated + EXCLUDED.citations_generated,
                    time_saved_minutes = usage_analytics_daily.time_saved_minutes + EXCLUDED.time_saved_minutes,
                    updated_at = NOW()
                """,
                (user_id or "anonymous", today, 1, cit_count, est_minutes_saved),
            )

        conn.commit()
        return report_id
    finally:
        conn.close()


def analytics_get_enterprise_dashboard(
    days_window: int = 30,
    months: int = 6,
    member_ids: Optional[List[str]] = None,
    user_info_map: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Aggregate enterprise analytics for admin dashboard.
    - Summary for the last `days_window` days
    - Volume trend for the last `months` months
    - Team activity for the last `days_window` days (all firm members, 0 for inactive)

    member_ids: restrict queries to these user IDs; if None, shows all
    user_info_map: {user_id_str -> {display_name, username, auth_type, role} or str} for the team activity table
    """
    conn = get_pg_conn()
    _empty = {
        "summary": {"total_queries": 0, "total_citations": 0, "total_time_saved_minutes": 0, "active_users": 0},
        "volume_trend": [],
        "team_activity": [],
    }
    if not conn:
        return _empty
    days_window = max(1, min(int(days_window or 30), 365))
    months = max(1, min(int(months or 6), 24))
    user_info_map = user_info_map or {}

    def _user_info(uid_str: str) -> Dict[str, Any]:
        raw = user_info_map.get(str(uid_str))
        if isinstance(raw, dict):
            return {
                "display_name": raw.get("display_name") or raw.get("username") or uid_str,
                "username": raw.get("username") or raw.get("display_name") or uid_str,
                "auth_type": raw.get("auth_type") or "—",
                "role": raw.get("role") or "—",
            }
        display = str(raw) if raw else uid_str
        return {"display_name": display, "username": display, "auth_type": "—", "role": "—"}

    # Build optional WHERE fragment to scope to firm members
    def _member_filter(alias: str = "") -> tuple:
        """Returns (extra_where_clause, params_list). alias e.g. 'u.' """
        col = f"{alias}user_id"
        if member_ids:
            placeholders = ",".join(["%s"] * len(member_ids))
            return f"AND {col} = ANY(ARRAY[{placeholders}]::text[])", list(member_ids)
        return "", []

    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            mf, mp = _member_filter()

            # Summary (last N days)
            cur.execute(
                f"""
                SELECT
                    COALESCE(SUM(queries_count), 0) AS total_queries,
                    COALESCE(SUM(citations_generated), 0) AS total_citations,
                    COALESCE(SUM(time_saved_minutes), 0) AS total_time_saved_minutes,
                    COUNT(DISTINCT user_id) AS active_users
                FROM usage_analytics_daily
                WHERE usage_date >= CURRENT_DATE - (%s::int - 1) * INTERVAL '1 day'
                {mf}
                """,
                [days_window] + mp,
            )
            summary = cur.fetchone() or _empty["summary"]

            # Volume trend (last N months)
            cur.execute(
                f"""
                SELECT
                    DATE_TRUNC('month', usage_date)::date AS month_start,
                    SUM(queries_count) AS queries,
                    SUM(citations_generated) AS citations
                FROM usage_analytics_daily
                WHERE usage_date >= (DATE_TRUNC('month', CURRENT_DATE) - (%s::int - 1) * INTERVAL '1 month')
                {mf}
                GROUP BY month_start
                ORDER BY month_start
                """,
                [months] + mp,
            )
            volume_rows = cur.fetchall() or []
            volume_trend: List[Dict[str, Any]] = []
            for r in volume_rows:
                month_start = r["month_start"]
                volume_trend.append({
                    "month_start": month_start.isoformat(),
                    "label": month_start.strftime("%b"),
                    "queries": int(r["queries"] or 0),
                    "citations": int(r["citations"] or 0),
                })

            # Team activity — aggregate activity rows
            cur.execute(
                f"""
                SELECT
                    user_id,
                    SUM(queries_count) AS queries,
                    SUM(citations_generated) AS citations,
                    SUM(time_saved_minutes) AS time_saved_minutes
                FROM usage_analytics_daily
                WHERE usage_date >= CURRENT_DATE - (%s::int - 1) * INTERVAL '1 day'
                {mf}
                GROUP BY user_id
                ORDER BY SUM(queries_count) DESC
                LIMIT 100
                """,
                [days_window] + mp,
            )
            activity_rows = {r["user_id"]: r for r in (cur.fetchall() or [])}

            # Build final team_activity: include ALL firm members, 0 for those with no activity
            team_activity: List[Dict[str, Any]] = []
            seen_ids = set()

            # First, fill from activity rows (has real data)
            for uid_str, r in activity_rows.items():
                seen_ids.add(str(uid_str))
                info = _user_info(str(uid_str))
                team_activity.append({
                    "user_id": str(uid_str),
                    "display_name": info["display_name"],
                    "username": info["username"],
                    "auth_type": info["auth_type"],
                    "role": info["role"],
                    "queries": int(r["queries"] or 0),
                    "citations": int(r["citations"] or 0),
                    "time_saved_minutes": int(r["time_saved_minutes"] or 0),
                })

            # Then, add members with zero activity (only if member_ids provided)
            for mid in (member_ids or []):
                if str(mid) not in seen_ids:
                    info = _user_info(str(mid))
                    team_activity.append({
                        "user_id": str(mid),
                        "display_name": info["display_name"],
                        "username": info["username"],
                        "auth_type": info["auth_type"],
                        "role": info["role"],
                        "queries": 0,
                        "citations": 0,
                        "time_saved_minutes": 0,
                    })

            # Sort: active users first, then alphabetically by display_name
            team_activity.sort(key=lambda x: (-x["queries"], (x["display_name"] or "").lower()))

        return {
            "summary": summary,
            "volume_trend": volume_trend,
            "team_activity": team_activity,
        }
    finally:
        conn.close()


def report_update(
    report_id: str,
    report_format: Optional[Dict[str, Any]] = None,
    status: Optional[str] = None,
    hitl_pending_count: Optional[int] = None,
    hitl_approved_count: Optional[int] = None,
) -> None:
    """Update report after HITL approvals or status change."""
    conn = get_pg_conn()
    if not conn:
        return
    try:
        with conn.cursor() as cur:
            updates, vals = [], []
            if report_format is not None:
                updates.append("report_format = %s"); vals.append(Json(report_format))
            if status is not None:
                updates.append("status = %s"); vals.append(status)
            if hitl_pending_count is not None:
                updates.append("hitl_pending_count = %s"); vals.append(hitl_pending_count)
            if hitl_approved_count is not None:
                updates.append("hitl_approved_count = %s"); vals.append(hitl_approved_count)
            if not updates:
                return
            updates.append("updated_at = NOW()")
            vals.append(report_id)
            cur.execute(
                f"UPDATE citation_reports SET {', '.join(updates)} WHERE id = %s",
                vals,
            )
        conn.commit()
    finally:
        conn.close()


def report_get(report_id: str) -> Optional[Dict[str, Any]]:
    conn = get_pg_conn()
    if not conn:
        return None
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT id, user_id, query, report_format, created_at, status, case_id, citation_count,
                       run_id, hitl_pending_count, hitl_approved_count, citations_approved_count,
                       citations_quarantined_count, updated_at, shared_with
                  FROM citation_reports
                 WHERE id = %s
                """,
                (report_id,),
            )
            row = cur.fetchone()
            return dict(row) if row else None
    finally:
        conn.close()


def report_delete(report_id: str, user_id: Optional[str] = None) -> bool:
    """
    Delete a citation report and its related rows (report_citations, hitl_queue).
    If user_id is provided, only deletes when the report belongs to that user.
    Returns True if deleted, False if not found or ownership check failed.
    """
    conn = get_pg_conn()
    if not conn:
        return False
    try:
        with conn.cursor() as cur:
            if user_id is not None:
                cur.execute("SELECT id FROM citation_reports WHERE id = %s AND user_id = %s", (report_id, user_id))
                if not cur.fetchone():
                    return False
            cur.execute("DELETE FROM report_citations WHERE report_id = %s", (report_id,))
            cur.execute("DELETE FROM hitl_queue WHERE report_id = %s", (report_id,))
            cur.execute("DELETE FROM citation_reports WHERE id = %s", (report_id,))
            deleted = cur.rowcount
        conn.commit()
        return deleted > 0
    finally:
        conn.close()


def report_share(report_id: str, shared_with: List[Dict[str, Any]]) -> bool:
    """
    Overwrite the shared_with list for a report.
    Each entry: {user_id, email, username, shared_at}.
    Returns True on success.
    """
    import json as _json
    conn = get_pg_conn()
    if not conn:
        return False
    try:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE citation_reports SET shared_with = %s WHERE id = %s",
                (_json.dumps(shared_with), report_id),
            )
            updated = cur.rowcount
        conn.commit()
        return updated > 0
    finally:
        conn.close()


def report_get_shares(report_id: str) -> List[Dict[str, Any]]:
    """Return the shared_with list for a report."""
    conn = get_pg_conn()
    if not conn:
        return []
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                "SELECT shared_with FROM citation_reports WHERE id = %s",
                (report_id,),
            )
            row = cur.fetchone()
            if not row:
                return []
            return row["shared_with"] or []
    finally:
        conn.close()


def report_list_by_user(user_id: str, limit: int = 50) -> List[Dict[str, Any]]:
    import json as _json
    conn = get_pg_conn()
    if not conn:
        return []
    # Build JSONB containment filter to also find reports shared with this user
    shared_filter = _json.dumps([{"user_id": str(user_id)}])
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT id, user_id, query, created_at, status, case_id, citation_count,
                       hitl_pending_count, shared_with
                  FROM citation_reports
                 WHERE user_id = %s
                    OR (shared_with IS NOT NULL AND shared_with @> %s::jsonb)
                 ORDER BY created_at DESC
                 LIMIT %s
                """,
                (user_id, shared_filter, limit),
            )
            return cur.fetchall()
    finally:
        conn.close()


def report_list_firm_shared(member_ids: List[str], limit: int = 100, case_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """
    FIRM_ADMIN only: returns all reports from firm members that have been shared with anyone.
    Scoped to reports owned by any of the given member_ids.
    If case_id provided, filter to reports for that case.
    """
    conn = get_pg_conn()
    if not conn:
        return []
    if not member_ids:
        return []
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            placeholders = ",".join(["%s"] * len(member_ids))
            case_filter = " AND case_id = %s" if case_id else ""
            params = list(member_ids) + ([case_id] if case_id else []) + [limit]
            cur.execute(
                f"""
                SELECT id, user_id, query, created_at, status, case_id, citation_count,
                       hitl_pending_count, shared_with
                  FROM citation_reports
                 WHERE user_id = ANY(ARRAY[{placeholders}]::text[])
                   AND shared_with IS NOT NULL
                   AND jsonb_array_length(shared_with) > 0
                   {case_filter}
                 ORDER BY created_at DESC
                 LIMIT %s
                """,
                params,
            )
            return cur.fetchall()
    finally:
        conn.close()


def report_list_shared_with_members(
    member_ids: List[str], limit: int = 100, case_id: Optional[str] = None
) -> List[Dict[str, Any]]:
    """
    Returns reports shared with any of the given member_ids (even if owner is outside the firm).
    Uses EXISTS + jsonb_array_elements for reliable string/int user_id matching.
    If case_id provided, filter to reports for that case.
    """
    conn = get_pg_conn()
    if not conn:
        return []
    if not member_ids:
        return []
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            # Use EXISTS with OR to match any member (avoids JSONB containment type mismatch)
            case_filter = " AND r.case_id = %s" if case_id else ""
            params = list(member_ids) + ([case_id] if case_id else []) + [limit]
            placeholders = ",".join(["%s"] * len(member_ids))
            cur.execute(
                f"""
                SELECT r.id, r.user_id, r.query, r.created_at, r.status, r.case_id, r.citation_count,
                       r.hitl_pending_count, r.shared_with
                  FROM citation_reports r
                 WHERE r.shared_with IS NOT NULL
                   AND jsonb_array_length(r.shared_with) > 0
                   AND EXISTS (
                     SELECT 1 FROM jsonb_array_elements(r.shared_with) elem
                     WHERE elem->>'user_id' = ANY(ARRAY[{placeholders}]::text[])
                   )
                   {case_filter}
                 ORDER BY r.created_at DESC
                 LIMIT %s
                """,
                params,
            )
            return cur.fetchall()
    finally:
        conn.close()


def report_list_by_case(case_id: str, user_id: Optional[str] = None, limit: int = 50) -> List[Dict[str, Any]]:
    """
    List citation reports for a case. When user_id is provided, returns:
    - Reports owned by that user for this case
    - Reports shared with that user for this case
    """
    import json as _json
    conn = get_pg_conn()
    if not conn:
        return []
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            if user_id:
                shared_filter = _json.dumps([{"user_id": str(user_id)}])
                cur.execute(
                    """
                    SELECT id, user_id, query, created_at, status, case_id, citation_count, hitl_pending_count, shared_with
                      FROM citation_reports
                     WHERE case_id = %s
                       AND (user_id = %s OR (shared_with IS NOT NULL AND shared_with @> %s::jsonb))
                     ORDER BY created_at DESC
                     LIMIT %s
                    """,
                    (case_id, user_id, shared_filter, limit),
                )
            else:
                cur.execute(
                    """
                    SELECT id, user_id, query, created_at, status, case_id, citation_count, hitl_pending_count
                      FROM citation_reports
                     WHERE case_id = %s
                     ORDER BY created_at DESC
                     LIMIT %s
                    """,
                    (case_id, limit),
                )
            return cur.fetchall()
    finally:
        conn.close()


# --- Pipeline runs ---

def pipeline_run_insert(
    run_id: str,
    user_id: str,
    query: str,
    case_id: Optional[str] = None,
) -> str:
    conn = get_pg_conn()
    if not conn:
        raise RuntimeError("PostgreSQL unavailable for pipeline_run_insert")
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO citation_pipeline_runs (id, user_id, case_id, query, status)
                VALUES (%s, %s, %s, %s, 'running')
                """,
                (run_id, user_id, case_id, query),
            )
        conn.commit()
        return run_id
    finally:
        conn.close()


def pipeline_run_update(
    run_id: str,
    status: str,
    report_id: Optional[str] = None,
    citations_fetched_count: Optional[int] = None,
    citations_approved_count: Optional[int] = None,
    citations_quarantined_count: Optional[int] = None,
    citations_sent_to_hitl_count: Optional[int] = None,
    error_message: Optional[str] = None,
) -> None:
    conn = get_pg_conn()
    if not conn:
        return
    try:
        with conn.cursor() as cur:
            updates = ["status = %s", "completed_at = NOW()"]
            vals = [status]
            if report_id is not None:
                updates.append("report_id = %s"); vals.append(report_id)
            if citations_fetched_count is not None:
                updates.append("citations_fetched_count = %s"); vals.append(citations_fetched_count)
            if citations_approved_count is not None:
                updates.append("citations_approved_count = %s"); vals.append(citations_approved_count)
            if citations_quarantined_count is not None:
                updates.append("citations_quarantined_count = %s"); vals.append(citations_quarantined_count)
            if citations_sent_to_hitl_count is not None:
                updates.append("citations_sent_to_hitl_count = %s"); vals.append(citations_sent_to_hitl_count)
            if error_message is not None:
                updates.append("error_message = %s"); vals.append(error_message)
            vals.append(run_id)
            cur.execute(f"UPDATE citation_pipeline_runs SET {', '.join(updates)} WHERE id = %s", vals)
        conn.commit()
    finally:
        conn.close()


# --- Agent logs ---

def agent_log_insert(
    run_id: Optional[str],
    report_id: Optional[str],
    agent_name: str,
    stage: str,
    log_level: str,
    message: str,
    metadata: Optional[Dict[str, Any]] = None,
) -> None:
    conn = get_pg_conn()
    if not conn:
        return
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO agent_logs (run_id, report_id, agent_name, stage, log_level, message, metadata)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                """,
                (run_id, report_id, agent_name, stage, log_level, message[:10000], Json(metadata) if metadata else None),
            )
        conn.commit()
    finally:
        conn.close()


def agent_logs_by_run(run_id: str, limit: int = 500) -> List[Dict[str, Any]]:
    conn = get_pg_conn()
    if not conn:
        return []
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT id, run_id, report_id, agent_name, stage, log_level, message, metadata, created_at
                  FROM agent_logs
                 WHERE run_id = %s
                 ORDER BY created_at ASC
                 LIMIT %s
                """,
                (run_id, limit),
            )
            return cur.fetchall()
    finally:
        conn.close()


# --- HITL queue ---

def hitl_queue_insert(
    report_id: Optional[str],
    run_id: Optional[str],
    canonical_id: str,
    user_id: str,
    citation_snapshot: Dict[str, Any],
    reason_queued: str = "unverified",
    case_id: Optional[str] = None,
    citation_string: Optional[str] = None,
    query_context: Optional[str] = None,
    web_source_url: Optional[str] = None,
    priority_score: float = 0.0,
) -> str:
    conn = get_pg_conn()
    if not conn:
        raise RuntimeError("PostgreSQL unavailable for hitl_queue_insert")
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO hitl_queue (
                    report_id, run_id, canonical_id, user_id,
                    citation_snapshot, reason_queued, case_id,
                    citation_string, query_context, web_source_url, priority_score
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
                """,
                (
                    report_id or None, run_id, canonical_id, user_id,
                    Json(citation_snapshot), reason_queued, case_id,
                    citation_string, query_context, web_source_url, round(float(priority_score or 0), 3),
                ),
            )
            row = cur.fetchone()
        conn.commit()
        return str(row[0])
    finally:
        conn.close()


def hitl_queue_list_by_report(report_id: str, status: Optional[str] = None) -> List[Dict[str, Any]]:
    conn = get_pg_conn()
    if not conn:
        return []
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            if status:
                cur.execute(
                    "SELECT * FROM hitl_queue WHERE report_id = %s AND status = %s ORDER BY created_at",
                    (report_id, status),
                )
            else:
                cur.execute("SELECT * FROM hitl_queue WHERE report_id = %s ORDER BY created_at", (report_id,))
            return cur.fetchall()
    finally:
        conn.close()


def hitl_queue_pending_count(report_id: str) -> int:
    conn = get_pg_conn()
    if not conn:
        return 0
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM hitl_queue WHERE report_id = %s AND status = 'pending'", (report_id,))
            return cur.fetchone()[0] or 0
    finally:
        conn.close()


def hitl_queue_update_status(
    hitl_id: str,
    status: str,
    reviewed_by: Optional[str] = None,
) -> None:
    conn = get_pg_conn()
    if not conn:
        return
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE hitl_queue SET status = %s, reviewed_at = NOW(), reviewed_by = %s, updated_at = NOW()
                WHERE id = %s
                """,
                (status, reviewed_by, hitl_id),
            )
        conn.commit()
    finally:
        conn.close()


def hitl_queue_get_report_id(hitl_id: str) -> Optional[str]:
    conn = get_pg_conn()
    if not conn:
        return None
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT report_id FROM hitl_queue WHERE id = %s", (hitl_id,))
            row = cur.fetchone()
            return str(row[0]) if row else None
    finally:
        conn.close()


# --- Report citations (per-citation tracking) ---

def report_citation_insert(
    report_id: str,
    canonical_id: str,
    status: str,
    citation_snapshot: Optional[Dict[str, Any]] = None,
    hitl_queue_id: Optional[str] = None,
) -> None:
    conn = get_pg_conn()
    if not conn:
        return
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO report_citations (report_id, canonical_id, status, citation_snapshot, hitl_queue_id)
                VALUES (%s, %s, %s, %s, %s)
                """,
                (report_id, canonical_id, status, Json(citation_snapshot) if citation_snapshot else None, hitl_queue_id),
            )
        conn.commit()
    finally:
        conn.close()


# ─── Indian Kanoon document assets ────────────────────────────────────────────

def ik_asset_upsert(
    doc_id: str,
    canonical_id: Optional[str] = None,
    meta: Optional[Dict] = None,
    fragments: Optional[Dict] = None,
    cite_list: Optional[List] = None,
    cited_by_list: Optional[List] = None,
    orig_doc_url: Optional[str] = None,
    orig_doc_gcs_path: Optional[str] = None,
    orig_doc_content_type: Optional[str] = None,
    raw_api_response: Optional[Dict] = None,
    title: Optional[str] = None,
    docsource: Optional[str] = None,
    doc_char_count: Optional[int] = None,
) -> None:
    """
    Insert or update the IK asset record for a given doc_id.
    Stores ALL IK API responses (doc, fragment, meta, origdoc) in raw_api_response JSONB
    for cache reuse on subsequent queries.
    Also mirrors orig_doc_url, ik_fragments, ik_cite_list, ik_cited_by_list,
    and ik_doc_meta into the judgments row (by canonical_id) for report builder access.
    """
    doc_id = (doc_id or "").strip()
    if not doc_id:
        return
    conn = get_pg_conn()
    if not conn:
        return
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO ik_document_assets
                    (doc_id, canonical_id, meta, fragments, cite_list, cited_by_list,
                     orig_doc_url, orig_doc_gcs_path, orig_doc_content_type,
                     raw_api_response, title, docsource, doc_char_count, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
                ON CONFLICT (doc_id) DO UPDATE SET
                    canonical_id          = COALESCE(EXCLUDED.canonical_id, ik_document_assets.canonical_id),
                    meta                  = COALESCE(EXCLUDED.meta, ik_document_assets.meta),
                    fragments             = COALESCE(EXCLUDED.fragments, ik_document_assets.fragments),
                    cite_list             = COALESCE(EXCLUDED.cite_list, ik_document_assets.cite_list),
                    cited_by_list         = COALESCE(EXCLUDED.cited_by_list, ik_document_assets.cited_by_list),
                    orig_doc_url          = COALESCE(EXCLUDED.orig_doc_url, ik_document_assets.orig_doc_url),
                    orig_doc_gcs_path     = COALESCE(EXCLUDED.orig_doc_gcs_path, ik_document_assets.orig_doc_gcs_path),
                    orig_doc_content_type = COALESCE(EXCLUDED.orig_doc_content_type, ik_document_assets.orig_doc_content_type),
                    raw_api_response      = COALESCE(EXCLUDED.raw_api_response, ik_document_assets.raw_api_response),
                    title                 = COALESCE(EXCLUDED.title, ik_document_assets.title),
                    docsource             = COALESCE(EXCLUDED.docsource, ik_document_assets.docsource),
                    doc_char_count        = COALESCE(EXCLUDED.doc_char_count, ik_document_assets.doc_char_count),
                    updated_at            = NOW()
                """,
                (
                    doc_id,
                    canonical_id,
                    Json(meta) if meta else None,
                    Json(fragments) if fragments else None,
                    Json(cite_list) if cite_list else None,
                    Json(cited_by_list) if cited_by_list else None,
                    orig_doc_url or None,
                    orig_doc_gcs_path or None,
                    orig_doc_content_type or None,
                    Json(raw_api_response) if raw_api_response else None,
                    title or None,
                    docsource or None,
                    doc_char_count or None,
                ),
            )
            # Mirror to judgments table if canonical_id provided
            if canonical_id:
                cur.execute(
                    """
                    UPDATE judgments SET
                        ik_orig_doc_url    = COALESCE(%s, ik_orig_doc_url),
                        ik_fragments       = COALESCE(%s, ik_fragments),
                        ik_cite_list       = COALESCE(%s, ik_cite_list),
                        ik_cited_by_list   = COALESCE(%s, ik_cited_by_list),
                        ik_doc_meta        = COALESCE(%s, ik_doc_meta)
                    WHERE canonical_id = %s
                    """,
                    (
                        orig_doc_url or None,
                        Json(fragments) if fragments else None,
                        Json(cite_list) if cite_list else None,
                        Json(cited_by_list) if cited_by_list else None,
                        Json(meta) if meta else None,
                        canonical_id,
                    ),
                )
        conn.commit()
    except Exception as exc:
        logger.warning("[DB] ik_asset_upsert failed for doc_id=%s: %s", doc_id, exc)
        try:
            conn.rollback()
        except Exception:
            pass
    finally:
        conn.close()


def ik_asset_get(doc_id: str, increment_hit: bool = False) -> Optional[Dict]:
    """Retrieve stored IK asset for a doc_id. Optionally increments cache_hit_count."""
    doc_id = (doc_id or "").strip()
    if not doc_id:
        return None
    conn = get_pg_conn()
    if not conn:
        return None
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                "SELECT * FROM ik_document_assets WHERE doc_id = %s LIMIT 1",
                (doc_id,),
            )
            row = cur.fetchone()
            if row and increment_hit:
                try:
                    cur.execute(
                        "UPDATE ik_document_assets SET cache_hit_count = COALESCE(cache_hit_count,0) + 1 WHERE doc_id = %s",
                        (doc_id,),
                    )
                    conn.commit()
                except Exception:
                    pass
            return dict(row) if row else None
    finally:
        conn.close()


def ik_asset_list_recent(limit: int = 50) -> List[Dict]:
    """List recently stored IK assets for admin/debug view."""
    conn = get_pg_conn()
    if not conn:
        return []
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """SELECT doc_id, canonical_id, title, docsource, doc_char_count,
                          orig_doc_url, cache_hit_count, created_at, updated_at
                     FROM ik_document_assets
                    ORDER BY updated_at DESC NULLS LAST
                    LIMIT %s""",
                (limit,),
            )
            return [dict(r) for r in cur.fetchall()]
    finally:
        conn.close()
