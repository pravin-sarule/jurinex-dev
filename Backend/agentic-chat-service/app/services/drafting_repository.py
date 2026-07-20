"""Persistence for drafting sessions (PostgreSQL, psycopg3 pool).

One row in ``drafting_sessions`` tracks a full drafting workflow:
template upload → async analysis → supporting docs → section-by-section
generation. The schema is auto-created on first use (same pattern as
``gemini_cache_service``).
"""
from __future__ import annotations

import json
import logging
import threading
import uuid
from typing import Any, Optional

from app.services.db import doc_conn

logger = logging.getLogger(__name__)

_schema_lock = threading.Lock()
_schema_ready = False

_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS drafting_sessions (
    id uuid PRIMARY KEY,
    user_id text NOT NULL,
    status text NOT NULL DEFAULT 'created',
    model text,
    template_file jsonb,
    template_structure jsonb,
    supporting_docs jsonb NOT NULL DEFAULT '[]'::jsonb,
    cache_name text,
    draft_sections jsonb NOT NULL DEFAULT '[]'::jsonb,
    facts_digest text,
    error text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_drafting_sessions_user
    ON drafting_sessions (user_id, created_at DESC);
-- Migration for tables created before the facts-digest feature.
ALTER TABLE drafting_sessions ADD COLUMN IF NOT EXISTS facts_digest text;
-- Session fact memory: user-confirmed facts persisted across regenerations.
ALTER TABLE drafting_sessions ADD COLUMN IF NOT EXISTS facts_addendum text;
-- Stage-2 strategy traceability (monolithic vs section-wise, per-section stats).
ALTER TABLE drafting_sessions ADD COLUMN IF NOT EXISTS draft_metadata jsonb;
-- 4-stage grounded pipeline: cited field extraction (Stage 2) + review packet
-- (ingestion report, missing/conflict/unverified fields, discrepancy report).
ALTER TABLE drafting_sessions ADD COLUMN IF NOT EXISTS grounded_facts jsonb;
ALTER TABLE drafting_sessions ADD COLUMN IF NOT EXISTS review_packet jsonb;
"""

# status lifecycle:
# created → template_uploaded → analyzing → ready → generating → completed
#                                   ↘ analysis_failed          ↘ generation_failed


def _ensure_schema() -> None:
    global _schema_ready
    if _schema_ready:
        return
    with _schema_lock:
        if _schema_ready:
            return
        with doc_conn() as conn:
            conn.execute(_SCHEMA_SQL)
            conn.commit()
        _schema_ready = True


def _jsonb(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, default=str)


def create_session(user_id: str, model: Optional[str] = None) -> str:
    _ensure_schema()
    session_id = str(uuid.uuid4())
    with doc_conn() as conn:
        conn.execute(
            "INSERT INTO drafting_sessions (id, user_id, status, model) VALUES (%s, %s, 'created', %s)",
            (session_id, user_id, model),
        )
        conn.commit()
    return session_id


def get_session(session_id: str, user_id: str) -> Optional[dict[str, Any]]:
    _ensure_schema()
    with doc_conn() as conn:
        row = conn.execute(
            "SELECT * FROM drafting_sessions WHERE id = %s AND user_id = %s",
            (session_id, user_id),
        ).fetchone()
    return dict(row) if row else None


def update_session(session_id: str, **fields: Any) -> None:
    """Update whitelisted columns; jsonb columns are serialized automatically."""
    _ensure_schema()
    allowed = {
        "status", "model", "template_file", "template_structure",
        "supporting_docs", "cache_name", "draft_sections", "facts_digest",
        "facts_addendum", "draft_metadata", "grounded_facts", "review_packet",
        "error",
    }
    jsonb_cols = {"template_file", "template_structure", "supporting_docs",
                  "draft_sections", "draft_metadata", "grounded_facts", "review_packet"}
    sets, params = [], []
    for key, value in fields.items():
        if key not in allowed:
            raise ValueError(f"Column not updatable: {key}")
        if key in jsonb_cols and value is not None:
            sets.append(f"{key} = %s::jsonb")
            params.append(_jsonb(value))
        else:
            sets.append(f"{key} = %s")
            params.append(value)
    if not sets:
        return
    sets.append("updated_at = now()")
    with doc_conn() as conn:
        conn.execute(
            f"UPDATE drafting_sessions SET {', '.join(sets)} WHERE id = %s",
            (*params, session_id),
        )
        conn.commit()


def append_supporting_doc(session_id: str, doc_meta: dict[str, Any]) -> None:
    _ensure_schema()
    with doc_conn() as conn:
        conn.execute(
            "UPDATE drafting_sessions SET supporting_docs = supporting_docs || %s::jsonb, "
            "updated_at = now() WHERE id = %s",
            (_jsonb([doc_meta]), session_id),
        )
        conn.commit()


def save_draft_section(session_id: str, section: dict[str, Any]) -> None:
    """Upsert one generated section into the draft_sections array (by section_id)."""
    _ensure_schema()
    with doc_conn() as conn:
        row = conn.execute(
            "SELECT draft_sections FROM drafting_sessions WHERE id = %s",
            (session_id,),
        ).fetchone()
        if row is None:
            conn.rollback()
            return
        sections: list[dict[str, Any]] = row["draft_sections"] or []
        sections = [s for s in sections if s.get("section_id") != section.get("section_id")]
        sections.append(section)
        sections.sort(key=lambda s: s.get("index", 0))
        conn.execute(
            "UPDATE drafting_sessions SET draft_sections = %s::jsonb, updated_at = now() WHERE id = %s",
            (_jsonb(sections), session_id),
        )
        conn.commit()


def delete_session(session_id: str, user_id: str) -> bool:
    _ensure_schema()
    with doc_conn() as conn:
        cur = conn.execute(
            "DELETE FROM drafting_sessions WHERE id = %s AND user_id = %s",
            (session_id, user_id),
        )
        conn.commit()
        return cur.rowcount > 0


def list_sessions_by_status(status: str, limit: int = 50) -> list[dict[str, Any]]:
    """Sessions in a given status — used to resume analysis after server reload."""
    _ensure_schema()
    with doc_conn() as conn:
        rows = conn.execute(
            "SELECT id, user_id, model, updated_at FROM drafting_sessions "
            "WHERE status = %s ORDER BY updated_at DESC LIMIT %s",
            (status, limit),
        ).fetchall()
    return [dict(r) for r in rows]
