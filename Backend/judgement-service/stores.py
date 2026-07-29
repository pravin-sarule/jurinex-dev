"""
Data-store connections and helpers: Redis (cache/sessions), Qdrant
(segment embeddings), Neo4j (citation graph), Postgres (vault).

Every store is optional and lazily connected. When a store is missing or
down the service degrades gracefully: Redis falls back to an in-process
TTL cache, Qdrant caching is skipped, Neo4j-based good-law stays "lite",
and vault writes are no-ops. Nothing here may raise at import or boot.
"""

from __future__ import annotations

import json
import logging
import threading
import time
import uuid
from typing import Any

from config import get_settings

logger = logging.getLogger(__name__)


# ─── In-process TTL cache (Redis fallback) ───────────────────────────────────

class _MemoryTTLCache:
    def __init__(self) -> None:
        self._data: dict[str, tuple[float, str]] = {}
        self._lock = threading.Lock()

    def get(self, key: str) -> str | None:
        with self._lock:
            item = self._data.get(key)
            if item is None:
                return None
            expires, value = item
            if expires < time.time():
                del self._data[key]
                return None
            return value

    def set(self, key: str, value: str, ttl: int) -> None:
        with self._lock:
            if len(self._data) > 5000:  # crude bound; oldest-expiry sweep
                now = time.time()
                self._data = {k: v for k, v in self._data.items() if v[0] > now}
            self._data[key] = (time.time() + ttl, value)


class Cache:
    """Redis-backed string cache with transparent in-memory fallback."""

    def __init__(self) -> None:
        self._memory = _MemoryTTLCache()
        self._redis = None
        self._redis_failed = False

    def _client(self):
        if self._redis is not None or self._redis_failed:
            return self._redis
        url = get_settings().redis_url
        if not url:
            self._redis_failed = True
            return None
        try:
            import redis  # type: ignore
            self._redis = redis.Redis.from_url(url, decode_responses=True, socket_timeout=3)
            self._redis.ping()
            logger.info("[stores] Redis connected")
        except Exception as exc:
            logger.warning("[stores] Redis unavailable (%s) — using in-memory cache", exc)
            self._redis = None
            self._redis_failed = True
        return self._redis

    def get(self, key: str) -> str | None:
        client = self._client()
        if client is not None:
            try:
                return client.get(key)
            except Exception as exc:
                logger.warning("[stores] Redis get failed (%s)", exc)
        return self._memory.get(key)

    def set(self, key: str, value: str, ttl: int = 86400) -> None:
        client = self._client()
        if client is not None:
            try:
                client.setex(key, ttl, value)
                return
            except Exception as exc:
                logger.warning("[stores] Redis set failed (%s)", exc)
        self._memory.set(key, value, ttl)

    def get_json(self, key: str) -> Any | None:
        raw = self.get(key)
        if raw is None:
            return None
        try:
            return json.loads(raw)
        except ValueError:
            return None

    def set_json(self, key: str, value: Any, ttl: int = 86400) -> None:
        self.set(key, json.dumps(value, default=str), ttl)

    @property
    def backend(self) -> str:
        return "redis" if self._client() is not None else "memory"


cache = Cache()


# ─── Session store (for /refine) ─────────────────────────────────────────────

class SessionStore:
    """Holds the full result set + candidate pool + reports for a search
    session. Fast path is the cache; every save is also written through to
    Postgres (citationTest) in the background, and cache misses fall back
    to Postgres — sessions survive restarts and cache TTLs."""

    def __init__(self) -> None:
        self._cache = cache
        from concurrent.futures import ThreadPoolExecutor
        self._writer = ThreadPoolExecutor(max_workers=2, thread_name_prefix="session-db")

    @staticmethod
    def new_session_id() -> str:
        return uuid.uuid4().hex

    def save(self, session_id: str, payload: dict[str, Any]) -> None:
        ttl = get_settings().session_ttl_seconds
        self._cache.set_json(f"jsession:{session_id}", payload, ttl)
        # Durable write-through — background thread so the response path
        # never waits on the remote database.
        self._writer.submit(_session_db_upsert, session_id, payload)

    def load(self, session_id: str) -> dict[str, Any] | None:
        payload = self._cache.get_json(f"jsession:{session_id}")
        if payload is not None:
            return payload
        payload = postgres.session_select(session_id)
        if payload is not None:
            self._cache.set_json(f"jsession:{session_id}", payload,
                                 get_settings().session_ttl_seconds)
        return payload


def _session_db_upsert(session_id: str, payload: dict[str, Any]) -> None:
    try:
        postgres.session_upsert(session_id, payload)
    except Exception as exc:  # background thread — never propagate
        logger.warning("[stores] background session write failed (%s)", exc)


sessions = SessionStore()


# ─── Qdrant (segment embeddings — the flywheel) ──────────────────────────────

class QdrantStore:
    def __init__(self) -> None:
        self._client = None
        self._failed = False
        self._collection_ready = False

    def _get(self):
        if self._client is not None or self._failed:
            return self._client
        settings = get_settings()
        if not settings.qdrant_url:
            self._failed = True
            return None
        try:
            from qdrant_client import QdrantClient
            self._client = QdrantClient(
                url=settings.qdrant_url,
                api_key=settings.qdrant_api_key,
                timeout=10,
            )
            self._ensure_collection()
            logger.info("[stores] Qdrant connected (%s)", settings.judgement_qdrant_collection)
        except Exception as exc:
            logger.warning("[stores] Qdrant unavailable (%s) — embedding cache disabled", exc)
            self._client = None
            self._failed = True
        return self._client

    def _ensure_collection(self) -> None:
        if self._collection_ready or self._client is None:
            return
        from qdrant_client import models as qm
        settings = get_settings()
        name = settings.judgement_qdrant_collection
        if not self._client.collection_exists(name):
            self._client.create_collection(
                collection_name=name,
                vectors_config=qm.VectorParams(size=settings.embedding_dim, distance=qm.Distance.COSINE),
            )
        self._collection_ready = True

    @staticmethod
    def point_id(doc_id: str) -> str:
        return str(uuid.uuid5(uuid.NAMESPACE_URL, f"ik-segment:{doc_id}"))

    def get_vector(self, doc_id: str) -> list[float] | None:
        client = self._get()
        if client is None:
            return None
        try:
            points = client.retrieve(
                collection_name=get_settings().judgement_qdrant_collection,
                ids=[self.point_id(doc_id)],
                with_vectors=True,
            )
            if points and points[0].vector:
                return list(points[0].vector)
        except Exception as exc:
            logger.warning("[stores] Qdrant retrieve failed (%s)", exc)
        return None

    def put_vector(self, doc_id: str, vector: list[float], payload: dict[str, Any]) -> None:
        client = self._get()
        if client is None:
            return
        try:
            from qdrant_client import models as qm
            client.upsert(
                collection_name=get_settings().judgement_qdrant_collection,
                points=[qm.PointStruct(id=self.point_id(doc_id), vector=vector,
                                       payload={"doc_id": doc_id, **payload})],
            )
        except Exception as exc:
            logger.warning("[stores] Qdrant upsert failed (%s)", exc)

    @property
    def available(self) -> bool:
        return self._get() is not None


qdrant = QdrantStore()


# ─── Neo4j (typed citation graph — full good-law, later phase) ───────────────

class Neo4jStore:
    def __init__(self) -> None:
        self._driver = None
        self._failed = False

    def _get(self):
        if self._driver is not None or self._failed:
            return self._driver
        settings = get_settings()
        if settings.judgement_disable_neo4j or not settings.neo4j_uri:
            self._failed = True
            return None
        try:
            from neo4j import GraphDatabase
            self._driver = GraphDatabase.driver(
                settings.neo4j_uri,
                auth=(settings.neo4j_username, settings.neo4j_password),
            )
            self._driver.verify_connectivity()
            logger.info("[stores] Neo4j connected")
        except Exception as exc:
            logger.warning("[stores] Neo4j unavailable (%s) — good-law stays lite", exc)
            self._driver = None
            self._failed = True
        return self._driver

    def negative_treatment(self, doc_id: str) -> dict[str, Any] | None:
        """Typed treatment lookup: returns {"overruled": bool, "negative_count": int}
        when the graph knows this judgment, else None (→ lite proxy applies)."""
        driver = self._get()
        if driver is None:
            return None
        try:
            with driver.session() as session:
                record = session.run(
                    """
                    MATCH (c:Case {doc_id: $doc_id})
                    OPTIONAL MATCH (c)<-[r:CITES]-(:Case)
                    WITH c,
                         sum(CASE WHEN r.treatment IN ['overruled','superseded'] THEN 1 ELSE 0 END) AS overruled_n,
                         sum(CASE WHEN r.treatment IN ['distinguished','doubted','overruled','superseded'] THEN 1 ELSE 0 END) AS negative_n
                    RETURN overruled_n, negative_n
                    """,
                    doc_id=doc_id,
                ).single()
                if record is None:
                    return None
                return {
                    "overruled": (record["overruled_n"] or 0) > 0,
                    "negative_count": record["negative_n"] or 0,
                }
        except Exception as exc:
            logger.warning("[stores] Neo4j treatment lookup failed (%s)", exc)
            return None

    @property
    def available(self) -> bool:
        return self._get() is not None


neo4j_store = Neo4jStore()


# ─── Postgres (vault write path — flywheel persistence) ──────────────────────

_VAULT_DDL = """
CREATE TABLE IF NOT EXISTS judgement_vault (
    doc_id       TEXT PRIMARY KEY,
    title        TEXT,
    court        TEXT,
    year         INTEGER,
    headline     TEXT,
    num_citedby  INTEGER DEFAULT 0,
    first_seen   TIMESTAMPTZ DEFAULT now(),
    last_seen    TIMESTAMPTZ DEFAULT now(),
    seen_count   INTEGER DEFAULT 1
);
"""

_SESSIONS_DDL = """
CREATE TABLE IF NOT EXISTS judgement_sessions (
    session_id   TEXT PRIMARY KEY,
    payload      JSONB NOT NULL,
    created_at   TIMESTAMPTZ DEFAULT now(),
    updated_at   TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE judgement_sessions ADD COLUMN IF NOT EXISTS user_id TEXT;
CREATE INDEX IF NOT EXISTS idx_judgement_sessions_user
    ON judgement_sessions (user_id, updated_at DESC);
"""


class PostgresStore:
    def __init__(self) -> None:
        self._pool = None
        self._failed = False

    def _get(self):
        if self._pool is not None or self._failed:
            return self._pool
        url = get_settings().db_url
        if not url:
            self._failed = True
            return None
        try:
            from psycopg2 import pool as pgpool
            self._pool = pgpool.ThreadedConnectionPool(1, 5, dsn=url)
            conn = self._pool.getconn()
            try:
                with conn.cursor() as cur:
                    cur.execute(_VAULT_DDL)
                    cur.execute(_SESSIONS_DDL)
                conn.commit()
            finally:
                self._pool.putconn(conn)
            logger.info("[stores] Postgres connected — vault + sessions ready")
        except Exception as exc:
            logger.warning("[stores] Postgres unavailable (%s) — vault writes disabled", exc)
            self._pool = None
            self._failed = True
        return self._pool

    def session_upsert(self, session_id: str, payload: dict[str, Any]) -> bool:
        """Durable copy of a search session (results, reports, statuses) —
        everything survives cache TTLs and service restarts."""
        pool = self._get()
        if pool is None:
            return False
        conn = None
        try:
            from psycopg2.extras import Json
            conn = pool.getconn()
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO judgement_sessions (session_id, payload, user_id)
                    VALUES (%s, %s, %s)
                    ON CONFLICT (session_id) DO UPDATE SET
                        payload = EXCLUDED.payload,
                        user_id = COALESCE(EXCLUDED.user_id, judgement_sessions.user_id),
                        updated_at = now()
                    """,
                    (session_id, Json(payload), payload.get("userId")),
                )
            conn.commit()
            return True
        except Exception as exc:
            logger.warning("[stores] session upsert failed (%s)", exc)
            if conn is not None:
                try:
                    conn.rollback()
                except Exception:
                    pass
            return False
        finally:
            if conn is not None:
                pool.putconn(conn)

    def session_list(self, user_id: str | None = None, limit: int = 20) -> list[dict[str, Any]]:
        """Research history: lightweight summaries of stored sessions,
        newest first, optionally scoped to one user."""
        pool = self._get()
        if pool is None:
            return []
        conn = None
        try:
            conn = pool.getconn()
            with conn.cursor() as cur:
                # NULL-owned rows are included: sessions predating user
                # tagging (and curl/dev runs) would otherwise vanish from
                # everyone's history.
                cur.execute(
                    """
                    SELECT session_id,
                           COALESCE(payload->>'caseTitle', '')                          AS case_title,
                           COALESCE(payload->>'caseId', '')                             AS case_id,
                           COALESCE(payload->'caseContext'->>'raw_case_summary', '')    AS summary,
                           COALESCE(jsonb_array_length(payload->'issues'), 0)           AS issue_count,
                           COALESCE((SELECT SUM(jsonb_array_length(i->'results'))
                                     FROM jsonb_array_elements(payload->'issues') i), 0) AS citation_count,
                           created_at, updated_at
                    FROM judgement_sessions
                    WHERE (%s::text IS NULL OR user_id = %s::text OR user_id IS NULL)
                    ORDER BY updated_at DESC
                    LIMIT %s
                    """,
                    (user_id, user_id, limit),
                )
                rows = cur.fetchall()
            return [
                {
                    "sessionId": r[0],
                    "caseTitle": r[1],
                    "caseId": r[2],
                    "summary": (r[3] or "")[:220],
                    "issueCount": int(r[4] or 0),
                    "citationCount": int(r[5] or 0),
                    "createdAt": str(r[6]),
                    "updatedAt": str(r[7]),
                }
                for r in rows
            ]
        except Exception as exc:
            logger.warning("[stores] session list failed (%s)", exc)
            return []
        finally:
            if conn is not None:
                pool.putconn(conn)

    def session_select(self, session_id: str) -> dict[str, Any] | None:
        pool = self._get()
        if pool is None:
            return None
        conn = None
        try:
            conn = pool.getconn()
            with conn.cursor() as cur:
                cur.execute("SELECT payload FROM judgement_sessions WHERE session_id = %s",
                            (session_id,))
                row = cur.fetchone()
            return row[0] if row else None
        except Exception as exc:
            logger.warning("[stores] session select failed (%s)", exc)
            return None
        finally:
            if conn is not None:
                pool.putconn(conn)

    def vault_upsert(self, rows: list[dict[str, Any]]) -> int:
        """Persist GREEN survivors. Called async after the response is sent —
        must never raise into the request path."""
        pool = self._get()
        if pool is None or not rows:
            return 0
        conn = None
        try:
            conn = pool.getconn()
            with conn.cursor() as cur:
                for row in rows:
                    cur.execute(
                        """
                        INSERT INTO judgement_vault (doc_id, title, court, year, headline, num_citedby)
                        VALUES (%(doc_id)s, %(title)s, %(court)s, %(year)s, %(headline)s, %(num_citedby)s)
                        ON CONFLICT (doc_id) DO UPDATE SET
                            last_seen = now(),
                            seen_count = judgement_vault.seen_count + 1,
                            num_citedby = EXCLUDED.num_citedby
                        """,
                        row,
                    )
            conn.commit()
            return len(rows)
        except Exception as exc:
            logger.warning("[stores] vault upsert failed (%s)", exc)
            if conn is not None:
                try:
                    conn.rollback()
                except Exception:
                    pass
            return 0
        finally:
            if conn is not None:
                pool.putconn(conn)

    @property
    def available(self) -> bool:
        return self._get() is not None


postgres = PostgresStore()


# ─── Document_DB (read-only: per-page chunks for issue source refs) ──────────

class DocDBStore:
    """Read-only access to the agentic-document-service's Postgres, used
    solely to turn a file into page-numbered chunks (file_chunks.content +
    page_start) so issues can cite 'file, page N'. Optional — when absent,
    issues fall back to whole-file refs from the HTTP files API."""

    def __init__(self) -> None:
        self._pool = None
        self._failed = False

    def _get(self):
        if self._pool is not None or self._failed:
            return self._pool
        url = get_settings().doc_db_url
        if not url:
            self._failed = True
            return None
        try:
            from psycopg2 import pool as pgpool
            self._pool = pgpool.ThreadedConnectionPool(1, 3, dsn=url)
            logger.info("[stores] Document_DB connected (page-chunk refs enabled)")
        except Exception as exc:
            logger.warning("[stores] Document_DB unavailable (%s) — page refs disabled", exc)
            self._pool = None
            self._failed = True
        return self._pool

    def chunks_for_file(self, file_id: str) -> list[tuple[str, int]] | None:
        """[(content, page_start)] ordered by chunk_index, or None."""
        pool = self._get()
        if pool is None or not file_id:
            return None
        conn = None
        try:
            conn = pool.getconn()
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT content, COALESCE(page_start, 0)
                    FROM file_chunks
                    WHERE file_id::text = %s
                    ORDER BY chunk_index
                    """,
                    (str(file_id),),
                )
                rows = cur.fetchall()
            return [(r[0] or "", int(r[1] or 0)) for r in rows] or None
        except Exception as exc:
            logger.warning("[stores] file_chunks lookup failed (%s)", exc)
            return None
        finally:
            if conn is not None:
                pool.putconn(conn)

    @property
    def available(self) -> bool:
        return self._get() is not None


doc_db = DocDBStore()


def store_health() -> dict[str, Any]:
    return {
        "cache": cache.backend,
        "qdrant": qdrant.available,
        "neo4j": neo4j_store.available,
        "postgres": postgres.available,
        "docDb": doc_db.available,
    }
