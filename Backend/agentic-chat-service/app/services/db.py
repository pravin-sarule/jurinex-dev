from __future__ import annotations

import logging
from contextlib import contextmanager
from typing import Any, Generator

from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from app.core.config import get_settings

logger = logging.getLogger(__name__)

_doc_pool: ConnectionPool | None = None
_payment_pool: ConnectionPool | None = None


def _make_pool(url: str, name: str) -> ConnectionPool | None:
    if not url:
        logger.warning("%s database URL not set", name)
        return None
    return ConnectionPool(
        conninfo=url,
        min_size=1,
        max_size=8,
        kwargs={"row_factory": dict_row},
        check=ConnectionPool.check_connection,  # validate connection is alive before returning from pool
        reconnect_failed=lambda pool: logger.error("%s pool: all reconnect attempts failed", name),
    )


def get_doc_pool() -> ConnectionPool:
    global _doc_pool
    if _doc_pool is None:
        _doc_pool = _make_pool(get_settings().database_url, "Document")
        if _doc_pool is None:
            raise RuntimeError("DATABASE_URL is required")
    return _doc_pool


def get_payment_pool() -> ConnectionPool | None:
    global _payment_pool
    if _payment_pool is None:
        _payment_pool = _make_pool(get_settings().payment_db_url, "Payment")
    return _payment_pool


@contextmanager
def doc_conn() -> Generator[Any, None, None]:
    with get_doc_pool().connection() as conn:
        yield conn


@contextmanager
def payment_conn() -> Generator[Any, None, None]:
    pool = get_payment_pool()
    if pool is None:
        raise RuntimeError("PAYMENT_DB_URL is required for usage policy")
    with pool.connection() as conn:
        yield conn


def close_pools() -> None:
    global _doc_pool, _payment_pool
    for pool in (_doc_pool, _payment_pool):
        if pool is not None:
            pool.close()
    _doc_pool = None
    _payment_pool = None
