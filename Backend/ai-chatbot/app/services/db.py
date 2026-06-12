from __future__ import annotations

import logging
from contextlib import contextmanager
from typing import Any, Iterator

from app.core.config import get_settings

logger = logging.getLogger("ai_chatbot.db")

try:
    import psycopg
    from psycopg.rows import dict_row
except Exception:  # pragma: no cover
    psycopg = None  # type: ignore[assignment]
    dict_row = None  # type: ignore[assignment]

try:
    from psycopg_pool import ConnectionPool
except Exception:  # pragma: no cover
    ConnectionPool = None  # type: ignore[assignment]

# Module-level pool — one per worker process, shared across all requests.
# Initialized by init_pool() in the FastAPI lifespan handler.
_pool: Any = None


def is_db_available() -> bool:
    settings = get_settings()
    return bool(psycopg and settings.database_url)


def init_pool() -> None:
    """Create the connection pool. Called once at app startup (lifespan)."""
    global _pool
    if not is_db_available():
        logger.warning("DB not configured — connection pool not created")
        return
    if ConnectionPool is None:
        logger.error(
            "psycopg-pool not installed — install psycopg-pool>=3.2.0. "
            "Falling back to per-request connections (not recommended for production)."
        )
        return

    settings = get_settings()
    _pool = ConnectionPool(
        conninfo=settings.database_url,
        min_size=settings.db_pool_min_size,
        max_size=settings.db_pool_max_size,
        kwargs={"row_factory": dict_row},
        open=True,
        reconnect_timeout=30,
        reconnect_failed=_on_reconnect_failed,
    )
    logger.info(
        "DB connection pool initialized min=%d max=%d",
        settings.db_pool_min_size,
        settings.db_pool_max_size,
    )


def _on_reconnect_failed(pool: Any) -> None:
    logger.error("DB reconnect failed — pool is unhealthy, check DATABASE_URL and Postgres status")


def close_pool() -> None:
    """Close the connection pool. Called once at app shutdown (lifespan)."""
    global _pool
    if _pool is not None:
        _pool.close()
        _pool = None
        logger.info("DB connection pool closed")


@contextmanager
def get_auth_db_connection() -> Iterator[Any]:
    """Direct connection to Auth_DB (used for saving leads to demo_bookings)."""
    settings = get_settings()
    if not psycopg or not settings.auth_db_url:
        raise RuntimeError("AUTH_DB_URL not configured.")
    conn = psycopg.connect(settings.auth_db_url, row_factory=dict_row)
    try:
        yield conn
    finally:
        conn.close()


@contextmanager
def get_db_connection() -> Iterator[Any]:
    """
    Yields a psycopg connection.

    When the pool is running (normal production path): borrows a connection
    from the pool and returns it automatically when the context exits.

    Fallback (pool not yet initialized or psycopg-pool missing): opens a
    direct connection and closes it on exit. This keeps all callers working
    during local dev without psycopg-pool installed.
    """
    settings = get_settings()
    if not psycopg or not settings.database_url:
        raise RuntimeError("Database not configured for ai-chatbot service.")

    if _pool is not None:
        with _pool.connection() as conn:
            yield conn
        return

    # Fallback: direct connection (dev / pool not yet initialized)
    logger.debug("Pool not available — opening direct DB connection")
    conn = psycopg.connect(settings.database_url, row_factory=dict_row)
    try:
        yield conn
    finally:
        conn.close()
