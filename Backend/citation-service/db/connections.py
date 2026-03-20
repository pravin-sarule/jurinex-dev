"""
Database connection helpers for citation-service.
Uses environment variables from .env.
"""

from __future__ import annotations

import logging
import os
import threading
from typing import Optional

logger = logging.getLogger(__name__)


def _get_env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


def _get_env_bool(name: str, default: bool) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return str(value).strip().lower() in ("1", "true", "yes", "on")


def _get_env(*keys: str) -> Optional[str]:
    for key in keys:
        val = os.environ.get(key)
        if val is not None and str(val).strip() != "":
            return str(val).strip()
    return None


def get_pg_dsn() -> Optional[str]:
    dsn = _get_env("CITATION_DB_URL", "DATABASE_URL")
    if dsn:
        return dsn
    host = _get_env("DB_HOST")
    port = _get_env("DB_PORT",) or "5432"
    user = _get_env("DB_USER")
    password = _get_env("DB_PASSWORD")
    name = _get_env("DB_NAME")
    if not (host and user and password and name):
        return None
    return f"postgresql://{user}:{password}@{host}:{port}/{name}"


_pg_pool = None
_es_client = None
_es_init_attempted = False
_qdrant_client = None
_qdrant_init_attempted = False
_neo4j_driver = None
_neo4j_init_attempted = False
_clients_lock = threading.Lock()
PG_POOL_MINCONN = max(1, _get_env_int("PG_POOL_MINCONN", 1))
PG_POOL_MAXCONN = max(PG_POOL_MINCONN, _get_env_int("PG_POOL_MAXCONN", 30))
DRAFT_POOL_MINCONN = max(1, _get_env_int("DRAFT_POOL_MINCONN", 1))
DRAFT_POOL_MAXCONN = max(DRAFT_POOL_MINCONN, _get_env_int("DRAFT_POOL_MAXCONN", 3))
DOC_POOL_MINCONN = max(1, _get_env_int("DOC_POOL_MINCONN", 1))
DOC_POOL_MAXCONN = max(DOC_POOL_MINCONN, _get_env_int("DOC_POOL_MAXCONN", 3))
ES_REQUEST_TIMEOUT = max(1, _get_env_int("ELASTIC_REQUEST_TIMEOUT", 3))
ES_MAX_RETRIES = max(0, _get_env_int("ELASTIC_MAX_RETRIES", 0))
ES_VERIFY_CERTS = _get_env_bool("ELASTIC_VERIFY_CERTS", True)
NEO4J_MAX_POOL_SIZE = max(1, _get_env_int("NEO4J_MAX_CONNECTION_POOL_SIZE", 20))

class PooledConnWrapper:
    """Wraps a psycopg2 connection to intercept .close() and return it to the pool instead of destroying it."""
    def __init__(self, pool, conn):
        self._pool = pool
        self._conn = conn

    def __getattr__(self, name):
        return getattr(self._conn, name)

    def close(self):
        if self._conn:
            try:
                self._pool.putconn(self._conn)
            except Exception:
                pass
            self._conn = None

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()

def get_pg_conn():
    global _pg_pool
    dsn = get_pg_dsn()
    if not dsn:
        logger.warning("[PG] Missing database config. Set CITATION_DB_URL or DATABASE_URL.")
        return None
    if _pg_pool is None:
        with _clients_lock:
            if _pg_pool is None:
                try:
                    from psycopg2.pool import ThreadedConnectionPool
                    _pg_pool = ThreadedConnectionPool(
                        minconn=PG_POOL_MINCONN,
                        maxconn=PG_POOL_MAXCONN,
                        dsn=dsn,
                    )
                    logger.info("[PG] Connection pool ready (min=%s max=%s)", PG_POOL_MINCONN, PG_POOL_MAXCONN)
                except Exception as exc:
                    logger.warning("[PG] Pool init failed: %s", exc)
                    return None
    try:
        conn = _pg_pool.getconn()
        return PooledConnWrapper(_pg_pool, conn)
    except Exception as exc:
        logger.warning("[PG] getconn failed: %s", exc)
        return None


def get_es_client():
    global _es_client, _es_init_attempted
    url = _get_env("ELASTICSEARCH_URL", "ELASTIC_URL", "ES_URL")
    if not url:
        logger.warning("[ES] Missing ELASTICSEARCH_URL/ELASTIC_URL/ES_URL; Elasticsearch disabled.")
        return None
    if _es_client is not None:
        return _es_client
    if _es_init_attempted:
        return None
    try:
        with _clients_lock:
            if _es_client is not None:
                return _es_client
            if _es_init_attempted:
                return None
            _es_init_attempted = True
            from elasticsearch import Elasticsearch
            api_key = _get_env("ELASTICSEARCH_API_KEY")
            username = _get_env("ELASTICSEARCH_USERNAME", "ELASTIC_USER", "ES_USERNAME")
            password = _get_env("ELASTICSEARCH_PASSWORD", "ELASTIC_PASSWORD", "ES_PASSWORD")
            kwargs = {
                "request_timeout": ES_REQUEST_TIMEOUT,
                "max_retries": ES_MAX_RETRIES,
                "retry_on_timeout": False,
                "verify_certs": ES_VERIFY_CERTS,
            }
            if api_key:
                kwargs["api_key"] = api_key
                client = Elasticsearch(url, **kwargs)
            elif username and password:
                client = Elasticsearch(url, basic_auth=(username, password), **kwargs)
            else:
                client = Elasticsearch(url, **kwargs)
            if not client.ping():
                logger.warning("[ES] Elasticsearch unreachable at %s — ES indexing disabled for this process.", url)
                return None
            _es_client = client
            logger.info("[ES] Client ready for %s", url)
            return _es_client
    except Exception as exc:
        logger.warning("[ES] Client init failed or unreachable: %s", exc)
        return None


def get_qdrant_client():
    """Connect to Qdrant using QDRANT_URL and QDRANT_API_KEY (or Qdrant_API_KEY) from environment."""
    global _qdrant_client, _qdrant_init_attempted
    url = os.getenv("QDRANT_URL")
    api_key = os.getenv("QDRANT_API_KEY") or os.getenv("Qdrant_API_KEY")
    if not url:
        logger.warning("[QDRANT] Missing QDRANT_URL; Qdrant disabled.")
        return None
    if _qdrant_client is not None:
        return _qdrant_client
    if _qdrant_init_attempted:
        return None
    try:
        with _clients_lock:
            if _qdrant_client is not None:
                return _qdrant_client
            if _qdrant_init_attempted:
                return None
            _qdrant_init_attempted = True
            from qdrant_client import QdrantClient
            _qdrant_client = QdrantClient(url=url, api_key=api_key)
            logger.info("[QDRANT] Client ready for %s", url)
            return _qdrant_client
    except Exception as exc:
        logger.warning("[QDRANT] Client init failed: %s", exc)
        return None


def get_neo4j_driver():
    """Connect to Neo4j using NEO4J_URI and NEO4J_USERNAME/NEO4J_PASSWORD from environment.
    URI examples: neo4j://localhost, neo4j+s://xxx.databases.neo4j.io
    """
    global _neo4j_driver, _neo4j_init_attempted
    uri = os.getenv("NEO4J_URI")
    user = os.getenv("NEO4J_USERNAME") or os.getenv("NEO4J_USER")
    password = os.getenv("NEO4J_PASSWORD")
    if not uri:
        logger.warning("[NEO4J] Missing NEO4J_URI; Neo4j disabled.")
        return None
    if not (user and password):
        logger.warning("[NEO4J] Missing NEO4J_USERNAME/NEO4J_PASSWORD; Neo4j disabled.")
        return None
    if _neo4j_driver is not None:
        return _neo4j_driver
    if _neo4j_init_attempted:
        return None
    try:
        with _clients_lock:
            if _neo4j_driver is not None:
                return _neo4j_driver
            if _neo4j_init_attempted:
                return None
            _neo4j_init_attempted = True
            from neo4j import GraphDatabase
            _neo4j_driver = GraphDatabase.driver(
                uri,
                auth=(user, password),
                max_connection_pool_size=NEO4J_MAX_POOL_SIZE,
            )
            _neo4j_driver.verify_connectivity()
            logger.info("[NEO4J] Driver ready for %s", uri)
            return _neo4j_driver
    except Exception as exc:
        logger.warning("[NEO4J] Driver init failed: %s", exc)
        return None


def get_all_clients():
    return {
        "pg": get_pg_conn(),
        "es": get_es_client(),
        "qdrant": get_qdrant_client(),
        "neo4j": get_neo4j_driver(),
    }


# ── Pooled connections for prompt resolution (Draft_DB, Document_DB) ─────────

_draft_pool = None
_doc_pool = None


def get_draft_db_conn():
    """Get a pooled connection to Draft_DB (agent_prompts table)."""
    global _draft_pool
    dsn = _get_env("DRAFT_DB_URL")
    if not dsn:
        logger.warning("[DRAFT_DB] Missing DRAFT_DB_URL; dynamic prompts disabled.")
        return None
    if _draft_pool is None:
        try:
            from psycopg2.pool import ThreadedConnectionPool
            _draft_pool = ThreadedConnectionPool(
                minconn=DRAFT_POOL_MINCONN,
                maxconn=DRAFT_POOL_MAXCONN,
                dsn=dsn,
            )
        except Exception as exc:
            logger.warning("[DRAFT_DB] Pool init failed: %s", exc)
            return None
    try:
        return _draft_pool.getconn()
    except Exception as exc:
        logger.warning("[DRAFT_DB] getconn failed: %s", exc)
        return None


def release_draft_db_conn(conn):
    """Return a Draft_DB connection to the pool."""
    if _draft_pool and conn:
        try:
            _draft_pool.putconn(conn)
        except Exception:
            pass


def get_doc_db_conn():
    """Get a pooled connection to Document_DB (llm_models table)."""
    global _doc_pool
    dsn = _get_env("DOC_DB_URL")
    if not dsn:
        logger.warning("[DOC_DB] Missing DOC_DB_URL; model resolution disabled.")
        return None
    if _doc_pool is None:
        try:
            from psycopg2.pool import ThreadedConnectionPool
            _doc_pool = ThreadedConnectionPool(
                minconn=DOC_POOL_MINCONN,
                maxconn=DOC_POOL_MAXCONN,
                dsn=dsn,
            )
        except Exception as exc:
            logger.warning("[DOC_DB] Pool init failed: %s", exc)
            return None
    try:
        return _doc_pool.getconn()
    except Exception as exc:
        logger.warning("[DOC_DB] getconn failed: %s", exc)
        return None


def release_doc_db_conn(conn):
    """Return a Document_DB connection to the pool."""
    if _doc_pool and conn:
        try:
            _doc_pool.putconn(conn)
        except Exception:
            pass
