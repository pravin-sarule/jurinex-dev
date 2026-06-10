from __future__ import annotations

from contextlib import contextmanager
from typing import Any, Iterator

from app.core.config import get_settings

try:
    import psycopg
    from psycopg.rows import dict_row
except Exception:  # pragma: no cover
    psycopg = None
    dict_row = None


def is_db_available() -> bool:
    settings = get_settings()
    return bool(psycopg and settings.database_url)


@contextmanager
def get_db_connection() -> Iterator[Any]:
    settings = get_settings()
    if not psycopg or not settings.database_url:
        raise RuntimeError("Database access is not configured for the agentic document service.")
    conn = psycopg.connect(settings.database_url, row_factory=dict_row)
    try:
        yield conn
    finally:
        conn.close()


def is_payment_db_available() -> bool:
    settings = get_settings()
    return bool(psycopg and settings.payment_db_url)


@contextmanager
def get_payment_db_connection() -> Iterator[Any]:
    settings = get_settings()
    if not psycopg or not settings.payment_db_url:
        raise RuntimeError("Payment database access is not configured.")
    conn = psycopg.connect(settings.payment_db_url, row_factory=dict_row)
    try:
        yield conn
    finally:
        conn.close()


def is_draft_db_available() -> bool:
    """Draft_DB holds generated_documents, user_drafts, template_assets (agent-draft-service)."""
    settings = get_settings()
    return bool(psycopg and settings.agent_prompts_database_url)


@contextmanager
def get_draft_db_connection() -> Iterator[Any]:
    settings = get_settings()
    if not psycopg or not settings.agent_prompts_database_url:
        raise RuntimeError("Draft database access is not configured (set DRAFT_DATABASE_URL).")
    conn = psycopg.connect(settings.agent_prompts_database_url, row_factory=dict_row)
    try:
        yield conn
    finally:
        conn.close()
