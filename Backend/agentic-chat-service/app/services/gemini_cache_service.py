from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import tempfile
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, AsyncIterator

from app.core.config import get_settings
from app.services.db import doc_conn
from app.services.gemini_pricing import (
    DEFAULT_CACHE_MODEL,
    compute_setup_cost,
    compute_storage_cost,
    compute_usage_cost,
    get_pricing,
)
from app.services.gcs_service import download_object_buffer, mime_from_path, parse_gcs_uri
from app.services.llm_service import (
    _aggregate_candidate_text,
    _append_stream_piece,
    _build_generation_config,
    _extract_stream_payload,
    _stream_tail_delta,
    build_model_list,
)

logger = logging.getLogger(__name__)

MAX_HISTORY_TURNS = 10
DEFAULT_TTL_SECONDS = 600


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _ttl_seconds(ttl_seconds: int | None = None) -> int:
    return max(60, int(ttl_seconds or get_settings().context_cache_ttl_seconds or DEFAULT_TTL_SECONDS))


def _ttl_string(ttl_seconds: int | None = None) -> str:
    return f"{_ttl_seconds(ttl_seconds)}s"


def _system_hash(system_instruction: str) -> str:
    return hashlib.sha256((system_instruction or "").encode("utf-8")).hexdigest()[:16]


def _file_fingerprint(file_ids: list[str]) -> list[str]:
    return sorted({str(x).strip() for x in file_ids if str(x).strip()})


def _as_iso(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)


def _cache_tokens_from_session(session: dict[str, Any]) -> int:
    return int(session.get("cache_total_tokens") or session.get("document_tokens") or 0)


def _finish_reason(chunk: Any) -> str | None:
    candidates = getattr(chunk, "candidates", None) or []
    if not candidates:
        return None
    reason = getattr(candidates[0], "finish_reason", None)
    return str(reason) if reason is not None else None


def _response_text(response: Any) -> str:
    text = getattr(response, "text", None)
    if isinstance(text, str) and text:
        return text

    pieces: list[str] = []
    for candidate in getattr(response, "candidates", []) or []:
        content = getattr(candidate, "content", None)
        for part in getattr(content, "parts", []) or []:
            part_text = getattr(part, "text", None)
            if isinstance(part_text, str) and part_text:
                pieces.append(part_text)
    return "".join(pieces)


def _get_client():
    from google import genai
    from app.services.gcs_service import get_service_account_credentials

    settings = get_settings()
    if settings.gemini_api_key:
        return genai.Client(api_key=settings.gemini_api_key)
    kwargs: dict[str, Any] = {
        "vertexai": True,
        "project": settings.gcloud_project_id,
        "location": settings.gcp_location,
    }
    creds = get_service_account_credentials()
    if creds is not None:
        kwargs["credentials"] = creds
    return genai.Client(**kwargs)


_COLUMN_CACHE: dict[str, set[str]] = {}


def _table_columns(table: str) -> set[str]:
    cached = _COLUMN_CACHE.get(table)
    if cached is not None:
        return cached
    with doc_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT column_name FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = %s
                """,
                (table,),
            )
            cols = {str(r["column_name"]) for r in cur.fetchall()}
    _COLUMN_CACHE[table] = cols
    return cols


def _ensure_schema() -> None:
    """Create the previous cache tables only when absent; do not mutate existing schemas."""
    with doc_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS gemini_cache_sessions (
                  session_id UUID PRIMARY KEY,
                  cache_name TEXT NOT NULL UNIQUE,
                  model_name TEXT NOT NULL,
                  file_id UUID,
                  source_file_ids TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
                  display_name TEXT,
                  system_hash VARCHAR(16) NOT NULL DEFAULT '',
                  status TEXT NOT NULL DEFAULT 'active',
                  document_tokens INTEGER NOT NULL DEFAULT 0,
                  cache_total_tokens INTEGER,
                  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                  last_accessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                  deleted_at TIMESTAMPTZ,
                  delete_reason TEXT,
                  setup_cost DOUBLE PRECISION NOT NULL DEFAULT 0,
                  creation_cost DOUBLE PRECISION NOT NULL DEFAULT 0,
                  questions_asked INTEGER NOT NULL DEFAULT 0,
                  total_input_tokens_used BIGINT NOT NULL DEFAULT 0,
                  new_input_tokens_used BIGINT NOT NULL DEFAULT 0,
                  total_cached_tokens_used BIGINT NOT NULL DEFAULT 0,
                  total_output_tokens_used BIGINT NOT NULL DEFAULT 0,
                  accumulated_input_cost DOUBLE PRECISION NOT NULL DEFAULT 0,
                  accumulated_output_cost DOUBLE PRECISION NOT NULL DEFAULT 0
                )
                """
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS query_logs (
                  id BIGSERIAL PRIMARY KEY,
                  session_id UUID NOT NULL,
                  prompt_tokens INTEGER NOT NULL DEFAULT 0,
                  cached_tokens INTEGER NOT NULL DEFAULT 0,
                  output_tokens INTEGER NOT NULL DEFAULT 0,
                  query_cost DOUBLE PRECISION NOT NULL DEFAULT 0,
                  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
                """
            )
            cur.execute("CREATE INDEX IF NOT EXISTS idx_gemini_cache_sessions_file_active ON gemini_cache_sessions (file_id, status, expires_at)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_query_logs_session_created ON query_logs (session_id, created_at)")
        conn.commit()
    _COLUMN_CACHE.clear()


async def _run_blocking(fn):
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, fn)


def _parts_from_file_specs(file_specs: list[dict[str, Any]]) -> list[Any]:
    from google.genai import types as gt

    parts = []
    for spec in file_specs:
        data = spec.get("buffer")
        if data is None and spec.get("gcs_uri"):
            parsed = parse_gcs_uri(spec["gcs_uri"])
            if parsed:
                data = download_object_buffer(parsed[0], parsed[1])
        if data is None:
            continue
        mimetype = spec.get("mimetype") or mime_from_path(spec.get("filename") or "document")
        parts.append(gt.Part.from_bytes(data=data, mime_type=mimetype))
    return parts


async def count_tokens_for_file_specs(file_specs: list[dict[str, Any]], model_name: str | None = None) -> dict[str, Any]:
    from google.genai import types as gt

    model = (model_name or get_settings().adk_model or DEFAULT_CACHE_MODEL).strip()
    parts = _parts_from_file_specs(file_specs)
    if not parts:
        return {"totalTokens": 0, "promptTokenCount": 0, "modelName": model}

    def _count():
        client = _get_client()
        result = client.models.count_tokens(model=model, contents=[gt.Content(role="user", parts=parts)])
        total = int(getattr(result, "total_tokens", 0) or getattr(result, "total_token_count", 0) or 0)
        return {"totalTokens": total, "promptTokenCount": total, "modelName": model}

    return await _run_blocking(_count)


# Removed old manual caching methods (validate_cache_exists, create_cache_from_files, ensure_cache_session_for_files, get_active_session_id_for_files, extend_cache_ttl)


async def get_session_row(session_id: str) -> dict[str, Any] | None:
    _ensure_schema()
    with doc_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM gemini_cache_sessions WHERE session_id=%s", (session_id,))
            row = cur.fetchone()
    return dict(row) if row else None


async def ask_with_context_cache(
    *,
    file_id: str,
    question: str,
    user_id: str,
    file_specs: list[dict[str, Any]],
    system_instruction: str,
    model_name: str,
    llm_config: dict[str, Any] | None = None,
    chat_session_id: str | None = None,
) -> AsyncIterator[dict[str, Any]]:
    """Stream document Q&A using ADK App + ContextCacheConfig (explicit Gemini caching).

    ADK manages the entire cache lifecycle — creation, TTL extension, refresh
    after N uses — so we never manually call validate_cache_exists or mark_deleted.
    The first query in a session primes the cache with the document; subsequent
    queries re-use the cached context automatically.
    """
    from google.genai import types as gt
    from agents.adk_app import (
        get_or_build_document_runner,
        get_or_create_adk_session,
        is_session_primed,
        mark_session_primed,
        DEFAULT_TTL_SECONDS,
    )

    session_key = chat_session_id or str(uuid.uuid4())
    from app.services.gemini_pricing import normalize_model_name
    model = normalize_model_name(model_name or get_settings().adk_model or DEFAULT_CACHE_MODEL)

    runner, svc, runner_key = get_or_build_document_runner(
        file_id=file_id,
        model_name=model,
        system_instruction=system_instruction,
        ttl_seconds=int(get_settings().context_cache_ttl_seconds or DEFAULT_TTL_SECONDS),
        cache_intervals=10,
        min_tokens=2048,
    )

    adk_session_id = await get_or_create_adk_session(
        runner_key=runner_key,
        session_service=svc,
        user_id=user_id,
        chat_session_id=session_key,
    )

    # Build the message — include document bytes on first query (primes the cache),
    # question-only on subsequent queries (ADK reuses the cached context).
    primed = is_session_primed(runner_key, session_key)

    # Recover primed state from DB after server restart (in-memory state is lost).
    # Only skip re-sending document bytes if a real Gemini named cache exists and
    # is still valid — that way ADK can reference the persistent cache without needing
    # the document bytes in the current (new, empty) in-memory session.
    if not primed:
        try:
            with doc_conn() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        SELECT questions_asked, adk_cache_name
                        FROM gemini_cache_sessions
                        WHERE file_id=%s::uuid AND status='active' AND expires_at > NOW()
                          AND adk_cache_name IS NOT NULL AND adk_cache_name <> ''
                        ORDER BY created_at DESC LIMIT 1
                        """,
                        (file_id,),
                    )
                    row = cur.fetchone()
                    if row and int(row.get("questions_asked") or 0) > 0:
                        mark_session_primed(runner_key, session_key)
                        primed = True
        except Exception:
            pass  # Ignore DB errors; fall back to full document send
    if not primed:
        doc_parts: list[Any] = []
        for spec in file_specs:
            buf = spec.get("buffer") or b""
            mime = spec.get("mimetype") or "application/octet-stream"
            if buf:
                doc_parts.append(gt.Part.from_bytes(data=buf, mime_type=mime))
        parts = [*doc_parts, gt.Part(text=question)]
    else:
        parts = [gt.Part(text=question)]

    new_message = gt.Content(role="user", parts=parts)

    full = ""
    prompt = 0
    cached = 0
    output = 0
    total = 0
    adk_cache_name: str | None = None
    adk_expire_time: float | None = None
    finish_reason: str | None = None

    try:
        async for event in runner.run_async(
            user_id=user_id,
            session_id=adk_session_id,
            new_message=new_message,
        ):
            # Accept events from the document agent OR events with no author (framework events).
            # ADK may prefix the author with the app name (e.g. "document_cache_app/document_cache_agent")
            # so use a substring check rather than exact equality.
            author = getattr(event, "author", None) or ""
            if author and "document_cache_agent" not in author:
                continue

            # Extract cache metadata (available on events where ADK created/used a cache)
            if event.cache_metadata and event.cache_metadata.cache_name:
                adk_cache_name = event.cache_metadata.cache_name
                adk_expire_time = event.cache_metadata.expire_time

            # Extract usage from final event
            if event.usage_metadata:
                um = event.usage_metadata
                prompt = int(getattr(um, "prompt_token_count", 0) or 0)
                cached = int(getattr(um, "cached_content_token_count", 0) or 0)
                output = int(getattr(um, "candidates_token_count", 0) or 0)
                total = int(getattr(um, "total_token_count", 0) or (prompt + output))

            # Yield streaming text from content events (partial OR non-partial).
            # Some ADK/Gemini versions deliver text in non-partial events before turn_complete.
            if event.content:
                for part in getattr(event.content, "parts", []) or []:
                    text = getattr(part, "text", "") or ""
                    if not text:
                        continue
                    if getattr(part, "thought", False):
                        # Always forward thinking tokens so the frontend can show progress;
                        # do NOT add them to `full` (they are not part of the visible answer).
                        yield {"type": "thought", "text": text}
                    else:
                        # Append only the new delta to avoid duplicating text that ADK
                        # re-delivers in a final non-partial event.
                        if not full.endswith(text):
                            full += text
                            yield {"type": "chunk", "text": text}

            # Final turn — flush any text not yet streamed (covers non-streaming delivery)
            if event.turn_complete:
                # Fallback: if full is STILL empty but event.output has text, use it
                if not full.strip() and hasattr(event, "output") and event.output:
                    out_text = str(event.output) if not isinstance(event.output, list) else "".join(str(o) for o in event.output)
                    if out_text.strip():
                        full += out_text
                        yield {"type": "chunk", "text": out_text}

            if hasattr(event, "finish_reason") and event.finish_reason:
                finish_reason = str(event.finish_reason)

    except Exception as exc:
        logger.exception("ADK runner failed file=%s session=%s", file_id, session_key)
        yield {"type": "error", "message": str(exc), "code": "ADK_STREAM_FAILED"}
        return

    # Track whether the ADK produced real user-facing content before any fallback.
    had_real_content = bool(full.strip())

    if not had_real_content:
        logger.warning("ADK runner returned empty response file=%s model=%s primed=%s finish=%s", file_id, model, primed, finish_reason)
        is_normal_stop = finish_reason and any(x in finish_reason for x in ("STOP", "FINISH_REASON_UNSPECIFIED", "None", "1"))

        if not is_normal_stop:
            yield {
                "type": "error",
                "message": f"Gemini blocked the response ({finish_reason}). Try rephrasing.",
                "code": "EMPTY_RESPONSE",
            }
            return

        if not primed:
            # First document load — ADK acknowledged context but didn't answer the
            # question.  Mark as primed and immediately re-ask with the question only
            # so the user gets a real answer on their first click (no placeholder shown).
            mark_session_primed(runner_key, session_key)
            primed = True
            logger.info("ADK primed session without answering — auto-retrying question file=%s", file_id)

            retry_parts = [gt.Part(text=question)]
            retry_message = gt.Content(role="user", parts=retry_parts)
            prompt = cached = output = total = 0
            finish_reason = None

            try:
                async for event in runner.run_async(
                    user_id=user_id,
                    session_id=adk_session_id,
                    new_message=retry_message,
                ):
                    author = getattr(event, "author", None) or ""
                    if author and "document_cache_agent" not in author:
                        continue

                    if event.cache_metadata and event.cache_metadata.cache_name:
                        adk_cache_name = event.cache_metadata.cache_name
                        adk_expire_time = event.cache_metadata.expire_time

                    if event.usage_metadata:
                        um = event.usage_metadata
                        prompt = int(getattr(um, "prompt_token_count", 0) or 0)
                        cached = int(getattr(um, "cached_content_token_count", 0) or 0)
                        output = int(getattr(um, "candidates_token_count", 0) or 0)
                        total = int(getattr(um, "total_token_count", 0) or (prompt + output))

                    if event.content:
                        for part in getattr(event.content, "parts", []) or []:
                            text = getattr(part, "text", "") or ""
                            if not text:
                                continue
                            if getattr(part, "thought", False):
                                yield {"type": "thought", "text": text}
                            else:
                                if not full.endswith(text):
                                    full += text
                                    yield {"type": "chunk", "text": text}

                    if event.turn_complete:
                        if not full.strip() and hasattr(event, "output") and event.output:
                            out_text = str(event.output) if not isinstance(event.output, list) else "".join(str(o) for o in event.output)
                            if out_text.strip():
                                full += out_text
                                yield {"type": "chunk", "text": out_text}

                    if hasattr(event, "finish_reason") and event.finish_reason:
                        finish_reason = str(event.finish_reason)

            except Exception as exc:
                logger.exception("ADK retry failed file=%s session=%s", file_id, session_key)
                yield {"type": "error", "message": str(exc), "code": "ADK_RETRY_FAILED"}
                return

            had_real_content = bool(full.strip())
            if not had_real_content:
                # Retry also returned nothing — let GCS fallback handle it.
                logger.info("ADK retry also empty for file=%s — yielding nothing for GCS fallback", file_id)
                return
        else:
            # Primed session: the model should have answered. Return empty so the
            # orchestrator's GCS fallback path takes over and produces a real response.
            logger.info("ADK returned empty for primed session — falling back to GCS path")
            return

    # Session is now primed (document was sent and ADK has it in session history)
    if not primed:
        mark_session_primed(runner_key, session_key)

    # ── Persist usage + update / create DB cache session record ─────────────
    db_document_tokens = cached if cached > 0 else prompt
    db_session_id = await _upsert_adk_cache_session(
        file_id=file_id,
        user_id=user_id,
        model_name=model,
        adk_cache_name=adk_cache_name,
        adk_expire_time=adk_expire_time,
        system_instruction=system_instruction,
        document_tokens=db_document_tokens,
    )

    costs = compute_usage_cost(
        model=model,
        prompt_tokens=prompt,
        cached_tokens=cached,
        output_tokens=output,
        document_tokens=cached,
    )

    # Only log a query entry when the ADK produced a real answer.
    # For the initial cache-priming response ("Document context acknowledged."),
    # the token cost is already captured in setup_cost — logging it again as a
    # query would create a phantom entry and double-count the document tokens.
    is_priming_only = not primed and not had_real_content
    if db_session_id and not is_priming_only:
        await persist_query_usage(
            session_id=db_session_id,
            prompt=prompt,
            cached=cached,
            output=output,
            total=total,
            costs=costs,
        )

    status = await get_status_for_file(file_id)
    yield {
        "type": "usage",
        "inputTokens": prompt,
        "cachedTokens": cached,
        "newPromptTokens": max(0, prompt - cached),
        "outputTokens": output,
        "totalTokens": total,
        "queryCost": costs["queryCost"],
        "cachedCost": costs["cachedCost"],
        "promptCost": costs["promptCost"],
        "outputCost": costs["outputCost"],
        "modelName": model,
        "documentTokens": cached,
        "pricing": get_pricing(model, context_token_count=cached),
        "cacheMechanism": "gemini_explicit_adk",
        "sessionMetrics": status,
    }
    yield {"type": "done", "answer": full}


async def _upsert_adk_cache_session(
    *,
    file_id: str,
    user_id: str,
    model_name: str,
    adk_cache_name: str | None,
    adk_expire_time: float | None,
    system_instruction: str,
    document_tokens: int,
) -> str | None:
    """Create or refresh the gemini_cache_sessions DB record from ADK event metadata.

    Returns the session_id to use for persist_query_usage, or None on failure.
    """
    _ensure_schema()
    sys_hash = _system_hash(system_instruction)
    files = _file_fingerprint([file_id])
    model = model_name or DEFAULT_CACHE_MODEL

    # Look for existing active session for this file
    session_id = None
    with doc_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT session_id FROM gemini_cache_sessions 
                WHERE file_id=%s::uuid AND status='active' AND expires_at > NOW()
                ORDER BY created_at DESC LIMIT 1
                """,
                (file_id,)
            )
            row = cur.fetchone()
            if row:
                session_id = row["session_id"]

    if session_id:
        # Update cache name / expiry if ADK gave us fresher info
        if adk_cache_name or adk_expire_time:
            with doc_conn() as conn:
                with conn.cursor() as cur:
                    updates: list[str] = ["last_accessed_at = NOW()"]
                    params: list[Any] = []
                    cols = _table_columns("gemini_cache_sessions")
                    if adk_cache_name and "cache_name" in cols:
                        updates.append("cache_name = %s")
                        params.append(adk_cache_name)
                    if adk_expire_time and "expires_at" in cols:
                        from datetime import timezone as tz
                        expires = datetime.fromtimestamp(adk_expire_time, tz=timezone.utc)
                        updates.append("expires_at = %s")
                        params.append(expires)
                        updates.append("status = 'active'")
                    params.append(session_id)
                    cur.execute(
                        f"UPDATE gemini_cache_sessions SET {', '.join(updates)} WHERE session_id = %s",
                        tuple(params),
                    )
                conn.commit()
        return session_id

    # No active session — create one using ADK-provided metadata
    new_session_id = str(uuid.uuid4())
    created_at = _now()
    expires_at: datetime | None = None
    if adk_expire_time:
        expires_at = datetime.fromtimestamp(adk_expire_time, tz=timezone.utc)
    else:
        ttl = int(get_settings().context_cache_ttl_seconds or DEFAULT_TTL_SECONDS)
        expires_at = created_at + timedelta(seconds=ttl)

    setup_cost = compute_setup_cost(model=model, document_tokens=document_tokens)
    cols = _table_columns("gemini_cache_sessions")
    values: dict[str, Any] = {
        "session_id": new_session_id,
        "cache_name": adk_cache_name or f"adk-managed-{new_session_id}",
        "model_name": model,
        "file_id": file_id,
        "source_file_ids": files,
        "system_hash": sys_hash,
        "status": "active",
        "document_tokens": document_tokens,
        "cache_total_tokens": document_tokens,
        "created_at": created_at,
        "expires_at": expires_at,
        "last_accessed_at": created_at,
        "setup_cost": setup_cost,
        "creation_cost": setup_cost,
        "total_cost": setup_cost,
    }
    insert_cols = [c for c in values if c in cols]
    placeholders = ", ".join(["%s"] * len(insert_cols))
    try:
        with doc_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"INSERT INTO gemini_cache_sessions ({', '.join(insert_cols)}) VALUES ({placeholders})",
                    tuple(values[c] for c in insert_cols),
                )
            conn.commit()
        logger.info("Created ADK cache session=%s file=%s cache=%s", new_session_id, file_id, adk_cache_name)
        return new_session_id
    except Exception:
        logger.exception("Failed to upsert ADK cache session file=%s", file_id)
        return None


async def persist_query_usage(
    session_id: str,
    prompt: int,
    cached: int,
    output: int,
    total: int,
    costs: dict[str, float],
    *,
    question: str | None = None,
) -> None:
    new_prompt = max(0, prompt - cached)
    log_cols = _table_columns("query_logs")
    log_values = {
        "session_id": session_id,
        "prompt_token_count": prompt,
        "cached_content_token_count": cached,
        "candidates_token_count": output,
        "total_token_count": total,
        "prompt_tokens": new_prompt,
        "cached_tokens": cached,
        "new_prompt_tokens": new_prompt,
        "output_tokens": output,
        "cached_token_cost": costs["cachedCost"],
        "new_prompt_cost": costs["promptCost"],
        "output_cost": costs["outputCost"],
        "query_cost": costs["queryCost"],
    }
    if question and "question" in log_cols:
        log_values["question"] = question[:4000]
    if output > 0 and "answer" in log_cols:
        log_values["answer"] = ""
    insert_cols = [c for c in log_values if c in log_cols]
    placeholders = ", ".join(["%s"] * len(insert_cols))
    session_cols = _table_columns("gemini_cache_sessions")
    updates: list[str] = []
    params: list[Any] = []

    def add_inc(col: str, value: Any) -> None:
        if col in session_cols:
            updates.append(f"{col} = COALESCE({col}, 0) + %s")
            params.append(value)

    add_inc("questions_asked", 1)
    add_inc("total_input_tokens_used", prompt)
    add_inc("total_cached_tokens_used", cached)
    add_inc("new_input_tokens_used", new_prompt)
    add_inc("total_output_tokens_used", output)
    add_inc("accumulated_input_cost", costs["cachedCost"] + costs["promptCost"])
    add_inc("accumulated_output_cost", costs["outputCost"])
    add_inc("total_cost", costs["queryCost"])
    if "last_accessed_at" in session_cols:
        updates.append("last_accessed_at = NOW()")
    with doc_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"INSERT INTO query_logs ({', '.join(insert_cols)}) VALUES ({placeholders})",
                tuple(log_values[c] for c in insert_cols),
            )
            if updates:
                cur.execute(
                    f"UPDATE gemini_cache_sessions SET {', '.join(updates)} WHERE session_id=%s",
                    tuple([*params, session_id]),
                )
        conn.commit()


async def persist_query_usage_from_metrics(
    session_id: str,
    usage: dict[str, Any],
    *,
    model_name: str | None = None,
    question: str | None = None,
    answer: str | None = None,
) -> None:
    """Record query tokens for non-cache (GCS fallback) or streamed usage payloads."""
    row = await get_session_row(session_id)
    if not row:
        logger.warning("persist_query_usage_from_metrics: no session row for %s", session_id)
        return
    token_usage = usage.get("tokenUsage") if isinstance(usage.get("tokenUsage"), dict) else usage
    prompt = int(token_usage.get("inputTokens") or token_usage.get("prompt_tokens") or 0)
    cached = int(token_usage.get("cachedTokens") or token_usage.get("cached_tokens") or 0)
    output = int(token_usage.get("outputTokens") or token_usage.get("output_tokens") or 0)
    total = int(token_usage.get("totalTokens") or token_usage.get("total_tokens") or (prompt + output))
    if output <= 0 and answer:
        output = max(1, len(answer) // 4)
    if prompt <= 0 and question:
        prompt = max(cached, len(question) // 4)
    if total <= 0:
        total = prompt + output
    model = token_usage.get("modelName") or usage.get("modelName") or row.get("model_name") or model_name
    costs = compute_usage_cost(
        model=model,
        prompt_tokens=prompt,
        cached_tokens=cached,
        output_tokens=output,
        document_tokens=_cache_tokens_from_session(row),
    )
    try:
        await persist_query_usage(
            session_id=session_id,
            prompt=prompt,
            cached=cached,
            output=output,
            total=total,
            costs=costs,
            question=question,
        )
        logger.info(
            "Recorded query usage session=%s prompt=%s cached=%s output=%s cost=%.6f",
            session_id,
            prompt,
            cached,
            output,
            costs["queryCost"],
        )
    except Exception:
        logger.exception("Failed to persist query usage for session=%s", session_id)


def _status_payload(session: dict[str, Any], logs: list[dict[str, Any]]) -> dict[str, Any]:
    now = _now()
    cache_tokens = _cache_tokens_from_session(session)
    created = session.get("created_at") or now
    expires = session.get("expires_at")
    status = session.get("status")
    if status == "active" and expires and expires <= now:
        status = "expired"
    deleted_at = session.get("deleted_at")
    if status != "active" and deleted_at:
        active_until = deleted_at if isinstance(deleted_at, datetime) else now
    elif status == "active":
        active_until = now
    else:
        active_until = min(expires or now, now)
    active_hours = max(0.0, (active_until - created).total_seconds() / 3600.0) if isinstance(created, datetime) else 0.0
    storage_cost = compute_storage_cost(session.get("model_name"), cache_tokens, active_hours)
    query_cost = sum(float(x.get("query_cost") or 0) for x in logs)
    setup_cost = float(session.get("setup_cost") or session.get("creation_cost") or 0)
    cached_sum = sum(int(r.get("cached_content_token_count") or r.get("cached_tokens") or 0) for r in logs)
    prompt_sum = sum(int(r.get("prompt_token_count") or r.get("prompt_tokens") or 0) for r in logs)
    output_sum = sum(int(r.get("candidates_token_count") or r.get("output_tokens") or 0) for r in logs)
    new_sum = max(0, prompt_sum - cached_sum)
    total_new_prompt = int(session.get("new_input_tokens_used") or new_sum)
    total_output = int(session.get("total_output_tokens_used") or output_sum)
    total_cached_used = int(session.get("total_cached_tokens_used") or cached_sum)
    total_queries = max(int(session.get("questions_asked") or 0), len(logs))
    display_total = cache_tokens + total_new_prompt + total_output

    last_row = logs[-1] if logs else None
    last_query = None
    if last_row:
        last_query = {
            "promptTokens": int(
                last_row.get("new_prompt_tokens")
                or max(0, int(last_row.get("prompt_token_count") or last_row.get("prompt_tokens") or 0)
                       - int(last_row.get("cached_content_token_count") or last_row.get("cached_tokens") or 0))
            ),
            "cachedTokens": int(last_row.get("cached_content_token_count") or last_row.get("cached_tokens") or 0),
            "outputTokens": int(last_row.get("candidates_token_count") or last_row.get("output_tokens") or 0),
            "queryCost": float(last_row.get("query_cost") or 0),
            "createdAt": _as_iso(last_row.get("created_at")),
        }

    lifetime_seconds = max(
        0,
        int(((session.get("expires_at") or now) - (session.get("created_at") or now)).total_seconds()),
    )

    return {
        "sessionId": str(session.get("session_id")),
        "fileId": str(session.get("file_id")) if session.get("file_id") else None,
        "status": status,
        "cacheName": session.get("cache_name"),
        "modelName": session.get("model_name"),
        "displayName": session.get("display_name"),
        "cacheMechanism": "gemini_explicit",
        "documentTokens": cache_tokens,
        "cacheTotalTokens": cache_tokens,
        "cacheTokenCount": cache_tokens,
        "cachedTokens": total_cached_used,
        "newInputTokens": total_new_prompt,
        "totalNewPromptTokens": total_new_prompt,
        "outputTokens": total_output,
        "totalOutputTokens": total_output,
        "totalTokens": display_total,
        "displayTotal": display_total,
        "setupCost": setup_cost,
        "storageCost": storage_cost,
        "queryCost": query_cost,
        "totalQueryCost": query_cost,
        "grandTotal": setup_cost + storage_cost + query_cost,
        "totalQueries": total_queries,
        "createdAt": _as_iso(session.get("created_at")),
        "expiresAt": _as_iso(session.get("expires_at")),
        "deletedAt": _as_iso(session.get("deleted_at")),
        "deleteReason": session.get("delete_reason"),
        "lastAccessedAt": _as_iso(session.get("last_accessed_at")),
        "remainingSeconds": max(0, int(((expires or now) - now).total_seconds())) if status == "active" else 0,
        "cacheLifetimeSeconds": lifetime_seconds,
        "lastQuery": last_query,
        "queryHistory": [
            {
                "index": i + 1,
                "promptTokens": int(
                    r.get("new_prompt_tokens")
                    or max(0, int(r.get("prompt_token_count") or r.get("prompt_tokens") or 0)
                           - int(r.get("cached_content_token_count") or r.get("cached_tokens") or 0))
                ),
                "cachedTokens": int(r.get("cached_content_token_count") or r.get("cached_tokens") or 0),
                "outputTokens": int(r.get("candidates_token_count") or r.get("output_tokens") or 0),
                "totalTokens": int(r.get("total_token_count") or 0),
                "queryCost": float(r.get("query_cost") or 0),
                "createdAt": _as_iso(r.get("created_at")),
            }
            for i, r in enumerate(logs)
        ],
        "pricing": get_pricing(session.get("model_name"), context_token_count=cache_tokens),
    }


async def get_status(session_id: str, user_id: str | None = None) -> dict[str, Any]:
    row = await get_session_row(session_id)
    if not row:
        return {"sessionId": session_id, "status": "NOT_FOUND"}
    with doc_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM query_logs WHERE session_id=%s ORDER BY created_at ASC", (session_id,))
            logs = [dict(x) for x in cur.fetchall()]
    payload = _status_payload(row, logs)
    cols = _table_columns("gemini_cache_sessions")
    updates: list[str] = []
    params: list[Any] = []
    for col, key in (
        ("storage_cost", "storageCost"),
        ("total_cost", "grandTotal"),
    ):
        if col in cols:
            updates.append(f"{col}=%s")
            params.append(payload[key])
    if "accumulated_input_cost" in cols and "accumulated_output_cost" in cols:
        # total_cost remains the full live total; accumulated_* remain query-only totals.
        pass
    if updates:
        with doc_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"UPDATE gemini_cache_sessions SET {', '.join(updates)} WHERE session_id=%s",
                    tuple([*params, session_id]),
                )
            conn.commit()
    return payload


async def get_status_for_file(file_id: str) -> dict[str, Any]:
    """Latest session lifecycle + query history aggregated across all cache sessions for this file."""
    _ensure_schema()
    with doc_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT * FROM gemini_cache_sessions
                WHERE file_id=%s::uuid
                ORDER BY CASE WHEN status='active' THEN 0 ELSE 1 END, created_at DESC
                LIMIT 1
                """,
                (file_id,),
            )
            row = cur.fetchone()
            if not row:
                return {"fileId": file_id, "status": "NO_SESSION", "queryHistory": [], "totalQueries": 0}
            session = dict(row)
            cur.execute(
                """
                SELECT ql.* FROM query_logs ql
                INNER JOIN gemini_cache_sessions gcs ON ql.session_id = gcs.session_id
                WHERE gcs.file_id = %s::uuid
                ORDER BY ql.created_at ASC
                """,
                (file_id,),
            )
            all_logs = [dict(x) for x in cur.fetchall()]
            cur.execute(
                """
                SELECT COALESCE(SUM(setup_cost), 0) AS total_setup_cost
                FROM gemini_cache_sessions
                WHERE file_id = %s::uuid
                """,
                (file_id,),
            )
            setup_row = cur.fetchone()

    total_setup = float((setup_row or {}).get("total_setup_cost") or 0)
    latest_setup = float(session.get("setup_cost") or session.get("creation_cost") or 0)
    session_adjusted = {
        **session,
        "setup_cost": latest_setup,
        "creation_cost": latest_setup,
        "lifetimeSetupCost": total_setup,
    }
    payload = _status_payload(session_adjusted, all_logs)
    payload["grandTotal"] = latest_setup + float(payload.get("storageCost") or 0) + float(payload.get("totalQueryCost") or 0)
    return {**payload, "fileId": file_id}


async def delete_cache(session_id: str, user_id: str | None = None, reason: str = "manual") -> dict[str, Any]:
    row = await get_session_row(session_id)
    if not row:
        return {"success": True, "sessionId": session_id, "deleted": False}

    def _delete():
        try:
            _get_client().caches.delete(name=row["cache_name"])
        except Exception:
            pass

    await _run_blocking(_delete)

    def _mark_deleted():
        with doc_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE gemini_cache_sessions
                       SET status = 'deleted',
                           deleted_at = NOW(),
                           delete_reason = %s
                     WHERE session_id = %s::uuid
                    """,
                    (reason, session_id),
                )
            conn.commit()

    await _run_blocking(_mark_deleted)
    return {"success": True, "sessionId": session_id, "deleted": True}
