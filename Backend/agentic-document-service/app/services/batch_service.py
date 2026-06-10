"""
Batch Service

Orchestrates Gemini Batch API operations:
- Auto-creates batch_upload_files, batch_jobs, batch_job_results tables
- Builds JSONL request files for large-scale batches (up to 200,000 requests)
- Submits jobs to the Gemini Batch API via google-genai SDK
- Polls Gemini for live status and syncs to the local DB
- Downloads and parses JSONL results, persisting them for repeat access
"""
from __future__ import annotations

import json
import logging
import os
import tempfile
import threading
from typing import Optional

logger = logging.getLogger("agentic_document_service.batch_service")

# Track jobs currently being downloaded+cached in background so we don't double-start
_CACHING_JOBS: set[str] = set()
_CACHING_LOCK = threading.Lock()


def _cache_results_in_background(job_id: str, output_file_name: str, queries_json_str: str) -> None:
    """Download Gemini output JSONL and cache all results in DB. Runs in a daemon thread."""
    with _CACHING_LOCK:
        if job_id in _CACHING_JOBS:
            return
        _CACHING_JOBS.add(job_id)

    try:
        from app.services.db import get_db_connection

        # Skip if already cached
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT COUNT(*) AS cnt FROM batch_job_results WHERE batch_job_id = %s",
                    [job_id],
                )
                row = cur.fetchone()
                if (row["cnt"] if row else 0) > 0:
                    logger.debug("[BatchService] Job %s already cached — skipping background cache", job_id)
                    return

        queries_map: dict = {}
        try:
            queries_map = json.loads(queries_json_str or "{}")
        except Exception:
            pass

        client = _gemini_client()
        logger.info("[BatchService] Background caching job %s — downloading output file", job_id)
        raw = client.files.download(file=output_file_name)
        text = raw.decode("utf-8") if isinstance(raw, (bytes, bytearray)) else str(raw)

        rows = []
        total_input = 0
        total_output = 0
        for line in text.strip().splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
                key = obj.get("key", "")
                response = obj.get("response", {})
                candidates = response.get("candidates", [])
                usage = response.get("usageMetadata", {})
                in_tok = int(usage.get("promptTokenCount", 0) or 0)
                out_tok = int(usage.get("candidatesTokenCount", 0) or 0)
                total_input += in_tok
                total_output += out_tok
                if candidates:
                    parts = candidates[0].get("content", {}).get("parts", [])
                    answer = " ".join(p.get("text", "") for p in parts if "text" in p)
                    st = "completed"
                else:
                    answer = obj.get("error", {}).get("message", "No response generated")
                    st = "failed"
                rows.append((job_id, key, queries_map.get(key, ""), answer, st, in_tok, out_tok))
            except Exception:
                continue

        total_all = total_input + total_output
        if rows:
            with get_db_connection() as conn:
                with conn.cursor() as cur:
                    cur.executemany(
                        """INSERT INTO batch_job_results
                           (id, batch_job_id, request_key, query_text,
                            response_text, status, input_tokens, output_tokens)
                           VALUES (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s)
                           ON CONFLICT DO NOTHING""",
                        rows,
                    )
                    cur.execute(
                        """UPDATE batch_jobs
                           SET total_input_tokens=%s, total_output_tokens=%s,
                               total_tokens=%s, updated_at=NOW()
                           WHERE id=%s""",
                        [total_input, total_output, total_all, job_id],
                    )
                conn.commit()
        logger.info("[BatchService] Background cache complete for job %s — %d results", job_id, len(rows))
    except Exception as exc:
        logger.error("[BatchService] Background caching failed for job %s: %s", job_id, exc, exc_info=True)
    finally:
        with _CACHING_LOCK:
            _CACHING_JOBS.discard(job_id)

# ── Table bootstrap ────────────────────────────────────────────────────────────

_TABLES_SQL = """
CREATE TABLE IF NOT EXISTS batch_sessions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     TEXT NOT NULL,
    name        TEXT NOT NULL,
    description TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_batch_sessions_user ON batch_sessions(user_id);

CREATE TABLE IF NOT EXISTS batch_upload_files (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           TEXT NOT NULL,
    original_filename TEXT NOT NULL,
    gcs_path          TEXT,
    gemini_file_name  TEXT,
    gemini_file_uri   TEXT,
    gemini_mime_type  TEXT DEFAULT 'application/pdf',
    status            TEXT DEFAULT 'pending',
    is_scanned        BOOLEAN DEFAULT FALSE,
    page_count        INTEGER DEFAULT 0,
    file_size_bytes   BIGINT DEFAULT 0,
    error_message     TEXT,
    created_at        TIMESTAMPTZ DEFAULT NOW(),
    updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS batch_jobs (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                 TEXT NOT NULL,
    display_name            TEXT,
    gemini_job_name         TEXT,
    status                  TEXT DEFAULT 'CREATING',
    model                   TEXT DEFAULT 'gemini-2.0-flash',
    request_count           INTEGER DEFAULT 0,
    batch_file_id           UUID,
    input_jsonl_gemini_file TEXT,
    output_file_name        TEXT,
    error_message           TEXT,
    queries_json            TEXT,
    total_input_tokens      BIGINT DEFAULT 0,
    total_output_tokens     BIGINT DEFAULT 0,
    total_tokens            BIGINT DEFAULT 0,
    created_at              TIMESTAMPTZ DEFAULT NOW(),
    updated_at              TIMESTAMPTZ DEFAULT NOW(),
    completed_at            TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS batch_job_results (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_job_id  UUID NOT NULL,
    request_key   TEXT NOT NULL,
    query_text    TEXT,
    response_text TEXT,
    status        TEXT DEFAULT 'completed',
    input_tokens  INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Migrations: safe to re-run on every startup (ADD COLUMN IF NOT EXISTS)
ALTER TABLE batch_jobs        ADD COLUMN IF NOT EXISTS session_id          UUID    REFERENCES batch_sessions(id) ON DELETE SET NULL;
ALTER TABLE batch_jobs        ADD COLUMN IF NOT EXISTS total_input_tokens  BIGINT  DEFAULT 0;
ALTER TABLE batch_jobs        ADD COLUMN IF NOT EXISTS total_output_tokens BIGINT  DEFAULT 0;
ALTER TABLE batch_jobs        ADD COLUMN IF NOT EXISTS total_tokens        BIGINT  DEFAULT 0;
ALTER TABLE batch_jobs        ADD COLUMN IF NOT EXISTS system_instruction  TEXT;
ALTER TABLE batch_job_results ADD COLUMN IF NOT EXISTS input_tokens        INTEGER DEFAULT 0;
ALTER TABLE batch_job_results ADD COLUMN IF NOT EXISTS output_tokens       INTEGER DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_batch_jobs_user     ON batch_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_batch_files_user    ON batch_upload_files(user_id);
CREATE INDEX IF NOT EXISTS idx_batch_results_job   ON batch_job_results(batch_job_id);
"""

_tables_ready = False


def _ensure_tables() -> None:
    global _tables_ready
    if _tables_ready:
        return
    from app.services.db import get_db_connection
    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(_TABLES_SQL)
            conn.commit()
        _tables_ready = True
    except Exception as exc:
        logger.warning("[BatchService] Table bootstrap failed: %s", exc)


# ── Gemini client helper ───────────────────────────────────────────────────────

def _gemini_client():
    from google import genai  # type: ignore
    from app.core.config import get_settings
    return genai.Client(api_key=get_settings().gemini_api_key)


# ── JSONL helpers ──────────────────────────────────────────────────────────────

def _build_request_line(
    key: str,
    query: str,
    gemini_file_uri: Optional[str],
    mime_type: Optional[str],
    system_instruction: Optional[str],
) -> dict:
    parts = []
    if gemini_file_uri:
        parts.append({"file_data": {"mime_type": mime_type or "application/pdf", "file_uri": gemini_file_uri}})
    parts.append({"text": query})

    req: dict = {
        "key": key,
        "request": {
            "contents": [{"role": "user", "parts": parts}],
        },
    }
    if system_instruction:
        req["request"]["system_instruction"] = {"parts": [{"text": system_instruction}]}
    return req


def _upload_jsonl_to_gemini(jsonl_text: str, display_name: str) -> str:
    """Upload JSONL string to Gemini Files API. Returns file name (files/xxx)."""
    client = _gemini_client()
    with tempfile.NamedTemporaryFile(suffix=".jsonl", delete=False, mode="w", encoding="utf-8") as f:
        f.write(jsonl_text)
        tmp_path = f.name
    try:
        resp = client.files.upload(
            file=tmp_path,
            config={"mime_type": "application/jsonl", "display_name": display_name},
        )
        logger.info("[BatchService] JSONL uploaded to Gemini: %s", resp.name)
        return resp.name
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


# ── Public API ─────────────────────────────────────────────────────────────────

def create_batch_upload_record(
    file_id: str,
    user_id: str,
    filename: str,
    gcs_path: str,
    file_size_bytes: int,
) -> None:
    """Insert a new batch_upload_files row (status=pending)."""
    _ensure_tables()
    from app.services.db import get_db_connection
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """INSERT INTO batch_upload_files
                   (id, user_id, original_filename, gcs_path, file_size_bytes, status)
                   VALUES (%s, %s, %s, %s, %s, 'pending')""",
                [file_id, user_id, filename, gcs_path, file_size_bytes],
            )
        conn.commit()


def get_batch_file(file_id: str, user_id: str) -> Optional[dict]:
    _ensure_tables()
    from app.services.db import get_db_connection
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM batch_upload_files WHERE id = %s AND user_id = %s",
                [file_id, user_id],
            )
            row = cur.fetchone()
    return dict(row) if row else None


def list_batch_files(user_id: str) -> list[dict]:
    _ensure_tables()
    from app.services.db import get_db_connection
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT id, user_id, original_filename, status, is_scanned, page_count,
                          file_size_bytes, error_message, created_at, updated_at
                   FROM batch_upload_files WHERE user_id = %s ORDER BY created_at DESC""",
                [user_id],
            )
            rows = cur.fetchall()
    return [dict(r) for r in rows]


def create_batch_job(
    job_id: str,
    user_id: str,
    display_name: str,
    queries: list[str],
    model: str,
    system_instruction: Optional[str],
    batch_file_id: Optional[str],
    session_id: Optional[str] = None,
) -> dict:
    """
    Build the JSONL, upload it to Gemini Files API, create the Gemini batch job,
    and persist the job record in the DB.
    """
    _ensure_tables()
    from app.services.db import get_db_connection

    # Resolve document file context (if any)
    gemini_file_uri: Optional[str] = None
    gemini_mime_type: Optional[str] = None
    if batch_file_id:
        file_row = get_batch_file(batch_file_id, user_id)
        if file_row and file_row.get("status") == "ready":
            gemini_file_uri = file_row.get("gemini_file_uri")
            gemini_mime_type = file_row.get("gemini_mime_type", "application/pdf")

    # Build JSONL
    lines = [
        _build_request_line(f"q-{i}", q, gemini_file_uri, gemini_mime_type, system_instruction)
        for i, q in enumerate(queries)
    ]
    jsonl_text = "\n".join(json.dumps(ln) for ln in lines)

    # Map key → original query for result display
    queries_map = {f"q-{i}": q for i, q in enumerate(queries)}

    logger.info("[BatchService] Building batch job: %d requests, file_id=%s", len(lines), batch_file_id)

    # Upload JSONL
    jsonl_file_name = _upload_jsonl_to_gemini(jsonl_text, f"batch-input-{job_id[:8]}.jsonl")

    # Create Gemini batch job — pass the JSONL file name directly as src
    client = _gemini_client()
    batch_job = client.batches.create(
        model=model,
        src=jsonl_file_name,
        config={"display_name": display_name},
    )
    gemini_job_name = batch_job.name
    logger.info("[BatchService] Gemini batch job created: %s", gemini_job_name)

    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """INSERT INTO batch_jobs
                   (id, user_id, display_name, gemini_job_name, status, model,
                    request_count, batch_file_id, input_jsonl_gemini_file,
                    queries_json, system_instruction, session_id)
                   VALUES (%s, %s, %s, %s, 'JOB_STATE_PENDING', %s, %s, %s, %s, %s, %s, %s)""",
                [
                    job_id, user_id, display_name, gemini_job_name, model,
                    len(queries), batch_file_id, jsonl_file_name,
                    json.dumps(queries_map), system_instruction, session_id or None,
                ],
            )
        conn.commit()

    return {
        "job_id": job_id,
        "display_name": display_name,
        "status": "JOB_STATE_PENDING",
        "gemini_job_name": gemini_job_name,
        "request_count": len(queries),
    }


def _sync_job_status(job_row: dict) -> dict:
    """Poll Gemini for the live job status and update the DB row."""
    from app.services.db import get_db_connection

    gemini_job_name = job_row.get("gemini_job_name")
    current_status = job_row.get("status", "")
    terminal = {"JOB_STATE_SUCCEEDED", "JOB_STATE_FAILED", "JOB_STATE_CANCELLED", "JOB_STATE_EXPIRED"}
    if not gemini_job_name or current_status in terminal:
        return job_row

    try:
        client = _gemini_client()
        batch_job = client.batches.get(name=gemini_job_name)
        new_status = batch_job.state.name if hasattr(batch_job.state, "name") else str(batch_job.state)

        updates: dict = {"status": new_status}
        if new_status == "JOB_STATE_SUCCEEDED":
            dest = getattr(batch_job, "dest", None)
            if dest:
                out_file = getattr(dest, "file_name", None)
                if out_file:
                    updates["output_file_name"] = out_file

        set_clause = ", ".join(f"{k} = %s" for k in updates)
        vals = list(updates.values()) + [str(job_row["id"])]

        is_terminal = new_status in terminal
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                extra = ", completed_at = NOW()" if is_terminal else ""
                cur.execute(
                    f"UPDATE batch_jobs SET {set_clause}, updated_at = NOW(){extra} WHERE id = %s",
                    vals,
                )
            conn.commit()

        updated_row = {**job_row, **updates}

        # Pre-cache results as soon as job succeeds so the first user fetch is instant
        if new_status == "JOB_STATE_SUCCEEDED":
            out_file = updates.get("output_file_name") or job_row.get("output_file_name")
            job_id_str = str(job_row["id"])
            with _CACHING_LOCK:
                already = job_id_str in _CACHING_JOBS
            if out_file and not already:
                t = threading.Thread(
                    target=_cache_results_in_background,
                    args=(job_id_str, out_file, job_row.get("queries_json", "{}")),
                    daemon=True,
                )
                t.start()

        return updated_row

    except Exception as exc:
        logger.warning("[BatchService] Status sync failed for %s: %s", job_row.get("id"), exc)
        return job_row


def get_batch_job(job_id: str, user_id: str) -> Optional[dict]:
    _ensure_tables()
    from app.services.db import get_db_connection
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM batch_jobs WHERE id = %s AND user_id = %s", [job_id, user_id]
            )
            row = cur.fetchone()
    if not row:
        return None
    return _sync_job_status(dict(row))


def list_batch_jobs(user_id: str, limit: int = 50, offset: int = 0) -> list[dict]:
    _ensure_tables()
    from app.services.db import get_db_connection
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM batch_jobs WHERE user_id = %s ORDER BY created_at DESC LIMIT %s OFFSET %s",
                [user_id, limit, offset],
            )
            rows = cur.fetchall()

    active = {"CREATING", "JOB_STATE_PENDING", "JOB_STATE_RUNNING"}
    result = []
    for row in rows:
        d = dict(row)
        if d.get("status") in active and d.get("gemini_job_name"):
            d = _sync_job_status(d)
        result.append(d)
    return result


def _slice_field_text(val: str, text_limit: int, text_offset: int) -> tuple[str, bool]:
    """Return a window of text and whether more content exists after the window."""
    if text_limit <= 0 and text_offset <= 0:
        return val, False
    start = max(0, text_offset)
    if text_limit <= 0:
        return val[start:], False
    end = start + text_limit
    return val[start:end], end < len(val)


def _truncate_result_text(
    row: dict,
    text_limit: int,
    query_offset: int = 0,
    response_offset: int = 0,
    fields: str = "both",
) -> dict:
    """Return a copy with optional per-field offset/limit windows."""
    out = dict(row)
    if fields in ("both", "query"):
        qval = out.get("query_text") or ""
        out["query_text"], out["query_truncated"] = _slice_field_text(qval, text_limit, query_offset)
    elif fields == "response":
        out["query_text"] = None
        out["query_truncated"] = False

    if fields in ("both", "response"):
        rval = out.get("response_text") or ""
        out["response_text"], out["response_truncated"] = _slice_field_text(rval, text_limit, response_offset)
    elif fields == "query":
        out["response_text"] = None
        out["response_truncated"] = False
    return out


def _with_text_lengths(row: dict, include_text: bool) -> dict:
    """Attach char lengths; optionally strip heavy text fields for fast list responses."""
    out = dict(row)
    if "query_length" not in out:
        out["query_length"] = len(out.get("query_text") or "")
    if "response_length" not in out:
        out["response_length"] = len(out.get("response_text") or "")
    if not include_text:
        out["query_text"] = None
        out["response_text"] = None
        out["query_truncated"] = False
        out["response_truncated"] = False
    return out


def get_batch_job_results(
    job_id: str,
    user_id: str,
    limit: int = 100,
    offset: int = 0,
    text_limit: int = 0,
    request_key: Optional[str] = None,
    include_text: bool = True,
    query_offset: int = 0,
    response_offset: int = 0,
    fields: str = "both",
) -> Optional[dict]:
    """Fetch results for a completed batch job, caching them in batch_job_results."""
    _ensure_tables()
    from app.services.db import get_db_connection

    job = get_batch_job(job_id, user_id)
    if not job:
        return None

    base = {
        "job_id":             job_id,
        "display_name":       job.get("display_name"),
        "status":             job.get("status"),
        "model":              job.get("model", "—"),
        "request_count":      job.get("request_count", 0),
        "total_count":        0,
        "total_input_tokens": int(job.get("total_input_tokens") or 0),
        "total_output_tokens":int(job.get("total_output_tokens") or 0),
        "total_tokens":       int(job.get("total_tokens") or 0),
        "results": [],
    }

    if job.get("status") != "JOB_STATE_SUCCEEDED":
        return base

    # Check cache
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT COUNT(*) AS cnt FROM batch_job_results WHERE batch_job_id = %s", [job_id]
            )
            row = cur.fetchone()
            cached_count = row["cnt"] if row else 0

    if cached_count > 0:
        # Results are in DB — return requested page immediately
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                if request_key:
                    cur.execute(
                        """SELECT request_key, query_text, response_text, status,
                                  input_tokens, output_tokens
                           FROM batch_job_results
                           WHERE batch_job_id = %s AND request_key = %s
                           LIMIT 1""",
                        [job_id, request_key],
                    )
                else:
                    cur.execute(
                        """SELECT request_key, query_text, response_text, status,
                                  input_tokens, output_tokens
                           FROM batch_job_results
                           WHERE batch_job_id = %s
                           ORDER BY request_key
                           LIMIT %s OFFSET %s""",
                        [job_id, limit, offset],
                    )
                rows = cur.fetchall()
                cur.execute(
                    "SELECT total_input_tokens, total_output_tokens, total_tokens FROM batch_jobs WHERE id = %s",
                    [job_id],
                )
                tok = cur.fetchone()
        sliced_results = []
        for r in rows:
            full = dict(r)
            item = _truncate_result_text(
                full,
                text_limit,
                query_offset=query_offset,
                response_offset=response_offset,
                fields=fields,
            )
            item["query_length"] = len(full.get("query_text") or "")
            item["response_length"] = len(full.get("response_text") or "")
            sliced_results.append(_with_text_lengths(item, include_text))
        base["results"] = sliced_results
        base["total_count"] = cached_count
        if tok:
            base["total_input_tokens"]  = int(tok.get("total_input_tokens") or 0)
            base["total_output_tokens"] = int(tok.get("total_output_tokens") or 0)
            base["total_tokens"]        = int(tok.get("total_tokens") or 0)
        return base

    # ── Not cached yet — kick off background caching and return immediately ────
    out_file = job.get("output_file_name")
    with _CACHING_LOCK:
        already_caching = job_id in _CACHING_JOBS

    if out_file and not already_caching:
        t = threading.Thread(
            target=_cache_results_in_background,
            args=(job_id, out_file, job.get("queries_json", "{}")),
            daemon=True,
        )
        t.start()

    base["caching"] = True
    return base


# ── Session management ─────────────────────────────────────────────────────────

def create_session(user_id: str, name: str, description: Optional[str] = None) -> dict:
    _ensure_tables()
    from app.services.db import get_db_connection
    import uuid as _uuid
    session_id = str(_uuid.uuid4())
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """INSERT INTO batch_sessions (id, user_id, name, description)
                   VALUES (%s, %s, %s, %s) RETURNING *""",
                [session_id, user_id, name.strip(), description],
            )
            row = cur.fetchone()
        conn.commit()
    return dict(row)


def list_sessions(user_id: str) -> list[dict]:
    _ensure_tables()
    from app.services.db import get_db_connection
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT s.*,
                          COUNT(j.id)                                          AS job_count,
                          SUM(CASE WHEN j.status='JOB_STATE_SUCCEEDED' THEN 1 ELSE 0 END) AS completed_count,
                          SUM(COALESCE(j.total_tokens, 0))                     AS total_tokens
                   FROM batch_sessions s
                   LEFT JOIN batch_jobs j ON j.session_id = s.id
                   WHERE s.user_id = %s
                   GROUP BY s.id
                   ORDER BY s.created_at DESC""",
                [user_id],
            )
            rows = cur.fetchall()
    return [dict(r) for r in rows]


def get_session(session_id: str, user_id: str) -> Optional[dict]:
    _ensure_tables()
    from app.services.db import get_db_connection
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM batch_sessions WHERE id = %s AND user_id = %s",
                [session_id, user_id],
            )
            row = cur.fetchone()
    return dict(row) if row else None


def list_session_jobs(session_id: str, user_id: str, limit: int = 200) -> list[dict]:
    """Return all jobs belonging to a session (with live status sync for active ones)."""
    _ensure_tables()
    from app.services.db import get_db_connection
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT * FROM batch_jobs
                   WHERE session_id = %s AND user_id = %s
                   ORDER BY created_at DESC LIMIT %s""",
                [session_id, user_id, limit],
            )
            rows = cur.fetchall()
    active = {"CREATING", "JOB_STATE_PENDING", "JOB_STATE_RUNNING"}
    result = []
    for row in rows:
        d = dict(row)
        if d.get("status") in active and d.get("gemini_job_name"):
            d = _sync_job_status(d)
        result.append(d)
    return result


def delete_session(session_id: str, user_id: str) -> bool:
    """Delete a session (jobs are kept; their session_id is set to NULL by FK ON DELETE SET NULL)."""
    _ensure_tables()
    from app.services.db import get_db_connection
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM batch_sessions WHERE id = %s AND user_id = %s RETURNING id",
                [session_id, user_id],
            )
            deleted = cur.fetchone()
        conn.commit()
    return deleted is not None


def rename_session(session_id: str, user_id: str, name: str) -> Optional[dict]:
    _ensure_tables()
    from app.services.db import get_db_connection
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """UPDATE batch_sessions SET name = %s, updated_at = NOW()
                   WHERE id = %s AND user_id = %s RETURNING *""",
                [name.strip(), session_id, user_id],
            )
            row = cur.fetchone()
        conn.commit()
    return dict(row) if row else None


def get_batch_job_config(job_id: str, user_id: str) -> Optional[dict]:
    """
    Return full reusable config for a batch job:
    queries list, model, system_instruction, and the linked file info.
    Used by the frontend "Reuse Job" flow.
    """
    _ensure_tables()
    from app.services.db import get_db_connection

    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM batch_jobs WHERE id = %s AND user_id = %s",
                [job_id, user_id],
            )
            job = cur.fetchone()
    if not job:
        return None
    job = dict(job)

    # Rebuild ordered queries list from queries_json map
    queries: list[str] = []
    try:
        qmap = json.loads(job.get("queries_json") or "{}")
        # Sort by numeric index embedded in key "q-N"
        def _key_order(k: str) -> int:
            try:
                return int(k.split("-", 1)[1])
            except Exception:
                return 0
        queries = [qmap[k] for k in sorted(qmap.keys(), key=_key_order)]
    except Exception:
        pass

    # Linked file info
    file_info: Optional[dict] = None
    if job.get("batch_file_id"):
        file_info = get_batch_file(str(job["batch_file_id"]), user_id)
        if file_info:
            file_info = {
                "file_id":           str(file_info["id"]),
                "original_filename": file_info.get("original_filename", ""),
                "status":            file_info.get("status", "unknown"),
                "is_scanned":        bool(file_info.get("is_scanned", False)),
                "page_count":        file_info.get("page_count") or 0,
                "file_size_bytes":   file_info.get("file_size_bytes") or 0,
            }

    return {
        "job_id":             job_id,
        "display_name":       job.get("display_name"),
        "model":              job.get("model", "gemini-2.0-flash"),
        "system_instruction": job.get("system_instruction"),
        "request_count":      job.get("request_count", 0),
        "queries":            queries,
        "batch_file_id":      str(job["batch_file_id"]) if job.get("batch_file_id") else None,
        "file_info":          file_info,
        "status":             job.get("status"),
        "created_at":         job.get("created_at"),
        "total_input_tokens": int(job.get("total_input_tokens") or 0),
        "total_output_tokens":int(job.get("total_output_tokens") or 0),
        "total_tokens":       int(job.get("total_tokens") or 0),
    }


def cancel_batch_job(job_id: str, user_id: str) -> bool:
    _ensure_tables()
    from app.services.db import get_db_connection

    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT gemini_job_name FROM batch_jobs WHERE id = %s AND user_id = %s",
                [job_id, user_id],
            )
            row = cur.fetchone()
    if not row:
        return False

    if row.get("gemini_job_name"):
        try:
            _gemini_client().batches.cancel(name=row["gemini_job_name"])
        except Exception as exc:
            logger.warning("[BatchService] Gemini cancel failed for %s: %s", job_id, exc)

    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE batch_jobs SET status = 'JOB_STATE_CANCELLED', updated_at = NOW() WHERE id = %s",
                [job_id],
            )
        conn.commit()
    return True
