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
