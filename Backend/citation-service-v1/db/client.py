"""PostgreSQL client for citation-service-v1 report storage.

Uses the same citation_db as citation-service so reports are shared across
both versions and visible in the existing frontend.
"""
from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import asyncpg

_DB_URL = os.getenv("CITATION_DB_URL", "")
_pool: Optional[asyncpg.Pool] = None

# Service tag stored in metadata so frontend can distinguish v1 reports
_SVC_TAG = "citation-v1"


# ---------------------------------------------------------------------------
# Pool
# ---------------------------------------------------------------------------

async def get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        minconn = int(os.getenv("PG_POOL_MINCONN", "1"))
        maxconn = int(os.getenv("PG_POOL_MAXCONN", "10"))
        _pool = await asyncpg.create_pool(
            dsn=_DB_URL,
            min_size=minconn,
            max_size=maxconn,
            command_timeout=60,
        )
    return _pool


async def close_pool() -> None:
    global _pool
    if _pool:
        await _pool.close()
        _pool = None


# ---------------------------------------------------------------------------
# DDL — creates tables if they don't exist (compatible with citation-service schema)
# ---------------------------------------------------------------------------

_DDL = """
CREATE TABLE IF NOT EXISTS citation_reports_v1 (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL,
    case_id         TEXT,
    query           TEXT NOT NULL,
    report_format   JSONB NOT NULL,
    run_id          TEXT,
    service_version TEXT DEFAULT 'v1',
    shared_with     TEXT[] DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_citation_reports_v1_user ON citation_reports_v1(user_id);
CREATE INDEX IF NOT EXISTS idx_citation_reports_v1_case ON citation_reports_v1(case_id);
"""


async def ensure_tables() -> None:
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute(_DDL)


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------

async def save_report(
    user_id: str,
    query: str,
    report_format: Dict[str, Any],
    run_id: str = "",
    case_id: Optional[str] = None,
) -> str:
    """Persist a completed report and return its ID."""
    report_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO citation_reports_v1
                (id, user_id, case_id, query, report_format, run_id, service_version, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $8)
            """,
            report_id,
            user_id,
            case_id,
            query,
            json.dumps(report_format),
            run_id,
            _SVC_TAG,
            now,
        )
    return report_id


async def get_report(report_id: str) -> Optional[Dict[str, Any]]:
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM citation_reports_v1 WHERE id = $1", report_id
        )
    if not row:
        return None
    return _row_to_dict(row)


async def list_reports(
    user_id: str,
    case_id: Optional[str] = None,
    limit: int = 50,
) -> List[Dict[str, Any]]:
    pool = await get_pool()
    async with pool.acquire() as conn:
        if case_id:
            rows = await conn.fetch(
                """
                SELECT * FROM citation_reports_v1
                WHERE (user_id = $1 OR $1 = ANY(shared_with))
                  AND case_id = $2
                ORDER BY created_at DESC LIMIT $3
                """,
                user_id, case_id, limit,
            )
        else:
            rows = await conn.fetch(
                """
                SELECT * FROM citation_reports_v1
                WHERE user_id = $1 OR $1 = ANY(shared_with)
                ORDER BY created_at DESC LIMIT $2
                """,
                user_id, limit,
            )
    return [_row_to_dict(r) for r in rows]


async def delete_report(report_id: str, user_id: Optional[str] = None) -> bool:
    pool = await get_pool()
    async with pool.acquire() as conn:
        if user_id:
            result = await conn.execute(
                "DELETE FROM citation_reports_v1 WHERE id = $1 AND user_id = $2",
                report_id, user_id,
            )
        else:
            result = await conn.execute(
                "DELETE FROM citation_reports_v1 WHERE id = $1", report_id
            )
    return result.endswith("1")


async def update_report_shared_with(report_id: str, shared_with: List[str]) -> None:
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            "UPDATE citation_reports_v1 SET shared_with = $2, updated_at = NOW() WHERE id = $1",
            report_id, shared_with,
        )


async def get_report_shares(report_id: str) -> List[str]:
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT shared_with FROM citation_reports_v1 WHERE id = $1", report_id
        )
    if not row:
        return []
    return list(row["shared_with"] or [])


async def get_team_reports(
    user_id: str,
    case_id: Optional[str] = None,
    member_ids: Optional[List[str]] = None,
) -> List[Dict[str, Any]]:
    pool = await get_pool()
    ids = list({user_id, *(member_ids or [])})
    async with pool.acquire() as conn:
        if case_id:
            rows = await conn.fetch(
                """
                SELECT * FROM citation_reports_v1
                WHERE (user_id = ANY($1) OR user_id = ANY($1)) AND case_id = $2
                ORDER BY created_at DESC LIMIT 100
                """,
                ids, case_id,
            )
        else:
            rows = await conn.fetch(
                """
                SELECT * FROM citation_reports_v1
                WHERE user_id = ANY($1)
                ORDER BY created_at DESC LIMIT 100
                """,
                ids,
            )
    return [_row_to_dict(r) for r in rows]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _row_to_dict(row: asyncpg.Record) -> Dict[str, Any]:
    d = dict(row)
    rf = d.get("report_format")
    if isinstance(rf, str):
        d["report_format"] = json.loads(rf)
    # Normalise timestamp fields
    for key in ("created_at", "updated_at"):
        if isinstance(d.get(key), datetime):
            d[key] = d[key].isoformat().replace("+00:00", "Z")
    return d
