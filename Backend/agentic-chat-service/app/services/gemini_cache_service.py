from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import re
import tempfile
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, AsyncIterator

from app.core.config import get_settings
from app.services.chat_helpers import is_valid_uuid
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
    CHAT_CONTINUATION_PROMPT,
    _CONTINUATION_TRIM_WINDOW,
    _RepetitionGuard,
    _STALL_LIMIT,
    _aggregate_candidate_text,
    _append_stream_piece,
    _build_generation_config,
    _extract_stream_payload,
    _is_max_tokens_finish,
    _looks_like_restart,
    _normalize_usage,
    _stream_round,
    supports_frequency_penalty,
    _stream_tail_delta,
    _trim_overlap,
    build_model_list,
    build_recovery_prompt,
    continuation_attempts,
    continuation_time_budget,
)

logger = logging.getLogger(__name__)

MAX_HISTORY_TURNS = 10
DEFAULT_TTL_SECONDS = 300  # 5 minutes — cache auto-deletes after 5 min without a prompt
# When Gemini hits max_output_tokens mid-answer (e.g. incomplete SUMMARY table),
# ask the same ADK session to continue. Attempts come from CHAT_CONTINUATION_ATTEMPTS
# (default 3) so every chat path uses the same continuation policy.


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _ttl_seconds(ttl_seconds: int | None = None) -> int:
    return max(60, int(ttl_seconds or get_settings().context_cache_ttl_seconds or DEFAULT_TTL_SECONDS))


def _ttl_string(ttl_seconds: int | None = None) -> str:
    return f"{_ttl_seconds(ttl_seconds)}s"


def _slide_cache_expiry(
    svc: Any,
    *,
    user_id: str,
    adk_session_id: str,
    cache_name: str,
    ttl_seconds: int,
) -> float | None:
    """Sliding inactivity window: reset the cache lifetime to now + TTL.

    Called after every answered prompt so the cache only dies after TTL seconds
    WITHOUT a prompt, not TTL seconds after creation. Two things must move:

    1. The real Gemini cached-content TTL (caches.update) — Google deletes the
       cache at this time.
    2. CacheMetadata.expire_time on the stored in-memory ADK session event —
       ADK's own validity check uses this, so without the rewrite ADK would
       discard and rebuild the cache at the original expiry. CacheMetadata is
       frozen, so it is replaced via model_copy.

    Returns the new expire_time (unix seconds), or None if the cache is
    already gone (next prompt will rebuild it automatically).
    """
    import time as _time
    from google.genai import types as gt
    from agents.adk_app import APP_NAME

    try:
        _get_client().caches.update(
            name=cache_name,
            config=gt.UpdateCachedContentConfig(ttl=f"{int(ttl_seconds)}s"),
        )
    except Exception as exc:
        logger.info("Cache TTL slide skipped (cache gone?) %s: %s", cache_name, exc)
        return None

    new_expire = _time.time() + int(ttl_seconds)
    try:
        stored = (
            getattr(svc, "sessions", {})
            .get(APP_NAME, {})
            .get(user_id, {})
            .get(adk_session_id)
        )
        if stored is not None:
            for event in reversed(stored.events or []):
                md = getattr(event, "cache_metadata", None)
                if md is not None and md.cache_name == cache_name:
                    event.cache_metadata = md.model_copy(update={"expire_time": new_expire})
                    break
    except Exception:
        logger.exception("Failed to update in-memory ADK cache metadata %s", cache_name)
    return new_expire


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


def _db_adk_cache_name(file_id: str) -> str | None:
    """Latest still-valid explicit cache name for this file.

    A generation round that aborts early (degenerate repetition) can end before
    ADK emits its cache-metadata event, leaving ``adk_cache_name`` unset even
    though the Gemini cache exists. The DB record from cache priming still has
    the name — recovering it lets the changed-sampling direct recovery run
    instead of the fixed-sampling ADK runner (which re-loops deterministically).
    """
    try:
        with doc_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT adk_cache_name
                    FROM gemini_cache_sessions
                    WHERE file_id=%s::uuid AND status='active' AND expires_at > NOW()
                      AND adk_cache_name IS NOT NULL AND adk_cache_name <> ''
                    ORDER BY created_at DESC LIMIT 1
                    """,
                    (file_id,),
                )
                row = cur.fetchone()
        if not row:
            return None
        if isinstance(row, dict):
            return row.get("adk_cache_name") or None
        return row[0] or None
    except Exception:
        return None


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
    is_priming: bool = False,
) -> AsyncIterator[dict[str, Any]]:
    """Stream document Q&A using ADK App + ContextCacheConfig (explicit Gemini caching).

    ADK manages the entire cache lifecycle — creation, TTL extension, refresh
    after N uses — so we never manually call validate_cache_exists or mark_deleted.
    The first query in a session primes the cache with the document; subsequent
    queries re-use the cached context automatically.
    """
    from google.genai import types as gt
    from google.adk.runners import RunConfig
    from google.adk.agents.run_config import StreamingMode
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

    # Apply Document_DB llm_chat_config.max_output_tokens to ADK generation.
    # Passing the model keeps chat thinking at the model family's minimum.
    gen_cfg = _build_generation_config(llm_config or {}, model)
    logger.info(
        "ADK document chat model=%s max_output_tokens=%s temperature=%.2f file=%s",
        model,
        gen_cfg["max_output_tokens"],
        gen_cfg["temperature"],
        file_id,
    )

    runner, svc, runner_key = get_or_build_document_runner(
        file_id=file_id,
        model_name=model,
        system_instruction=system_instruction,
        max_output_tokens=gen_cfg["max_output_tokens"],
        temperature=gen_cfg["temperature"],
        thinking_config=gen_cfg.get("thinking_config"),
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
        def _check_primed():
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
                    return cur.fetchone()

        try:
            row = await _run_blocking(_check_primed)
            if row:
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
        if not doc_parts:
            # Caller skipped the document bytes because has_active_cache() was
            # True, but the cache expired in between. Asking without the
            # document would produce an ungrounded answer — return empty so the
            # orchestrator's GCS fallback (which fetches the bytes) takes over.
            logger.warning(
                "Cache expired between check and generation file=%s — yielding to GCS fallback",
                file_id,
            )
            return
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
    _t_start = time.monotonic()
    guard = _RepetitionGuard()
    stalls = 0  # consecutive non-empty pieces fully eaten by the dedupe
    degen_abort = False  # a round was cut for repetition → try a recovery round

    # Round-trip metrics
    prompt = cached = output = total = 0
    curr_round_output = 0

    # ── 1. First round ──────────────────────────────────────────────────────
    try:
        async for event in runner.run_async(
            user_id=user_id,
            session_id=adk_session_id,
            new_message=new_message,
            run_config=RunConfig(streaming_mode=StreamingMode.SSE),
        ):
            # Accept events from the document agent OR events with no author (framework events).
            author = getattr(event, "author", None) or ""
            if author and "document_cache_agent" not in author:
                continue

            if event.cache_metadata and event.cache_metadata.cache_name:
                adk_cache_name = event.cache_metadata.cache_name
                adk_expire_time = event.cache_metadata.expire_time
                # If ADK gave us a cache name, this session is definitely primed
                mark_session_primed(runner_key, session_key)

            if event.usage_metadata:
                um = event.usage_metadata
                # Usage metadata in streaming events is CUMULATIVE for the current round.
                # Take latest (max) value seen in this round.
                prompt = max(prompt, int(getattr(um, "prompt_token_count", 0) or 0))
                cached = max(cached, int(getattr(um, "cached_content_token_count", 0) or 0))
                curr_round_output = max(curr_round_output, int(getattr(um, "candidates_token_count", 0) or 0))
                total = prompt + output + curr_round_output

            if event.content:
                for part in getattr(event.content, "parts", []) or []:
                    text = getattr(part, "text", "") or ""
                    if not text:
                        continue
                    if getattr(part, "thought", False):
                        yield {"type": "thought", "text": text}
                    else:
                        full, delta = _append_stream_piece(full, text)
                        if delta:
                            yield {"type": "chunk", "text": delta}
                            guard.feed(delta)
                            stalls = 0
                        elif len(text) >= 8:
                            stalls += 1
                if guard.tripped or stalls >= _STALL_LIMIT:
                    logger.warning("Degenerate repetition in ADK initial stream file=%s", file_id)
                    finish_reason = None
                    degen_abort = True
                    break

            if event.turn_complete:
                if not full.strip() and hasattr(event, "output") and event.output:
                    out_text = str(event.output) if not isinstance(event.output, list) else "".join(str(o) for o in event.output)
                    if out_text.strip():
                        full, delta = _append_stream_piece(full, out_text)
                        if delta:
                            yield {"type": "chunk", "text": delta}

            if hasattr(event, "finish_reason") and event.finish_reason:
                finish_reason = str(event.finish_reason)
            else:
                cands = getattr(event, "candidates", None) or []
                if cands:
                    cfr = getattr(cands[0], "finish_reason", None)
                    if cfr:
                        finish_reason = str(cfr)

    except (Exception, BaseException) as exc:
        if isinstance(exc, GeneratorExit):
            pass
        else:
            logger.exception("ADK runner failed file=%s", file_id)
            yield {"type": "error", "message": str(exc), "code": "ADK_STREAM_FAILED"}
        return

    # Accumulate round output into session total
    output += curr_round_output
    curr_round_output = 0

    # ── 2. Fallback / Retry if empty ────────────────────────────────────────
    had_real_content = bool(full.strip())
    if not had_real_content:
        logger.warning("ADK runner returned empty response file=%s primed=%s", file_id, primed)
        is_normal_stop = finish_reason and any(x in finish_reason for x in ("STOP", "FINISH_REASON_UNSPECIFIED", "None", "1"))

        if not is_normal_stop:
            yield {"type": "error", "message": f"Gemini blocked the response ({finish_reason}).", "code": "EMPTY_RESPONSE"}
            return

        if not primed:
            mark_session_primed(runner_key, session_key)
            primed = True
            logger.info("ADK primed session without answering — auto-retrying file=%s", file_id)

            retry_message = gt.Content(role="user", parts=[gt.Part(text=question)])
            # Reset round metrics for retry (but output total persists)
            curr_round_output = 0
            finish_reason = None

            try:
                async for event in runner.run_async(
                    user_id=user_id,
                    session_id=adk_session_id,
                    new_message=retry_message,
                    run_config=RunConfig(streaming_mode=StreamingMode.SSE),
                ):
                    author = getattr(event, "author", None) or ""
                    if author and "document_cache_agent" not in author:
                        continue

                    if event.usage_metadata:
                        um = event.usage_metadata
                        prompt = max(prompt, int(getattr(um, "prompt_token_count", 0) or 0))
                        cached = max(cached, int(getattr(um, "cached_content_token_count", 0) or 0))
                        curr_round_output = max(curr_round_output, int(getattr(um, "candidates_token_count", 0) or 0))
                        total = prompt + output + curr_round_output

                    if event.content:
                        for part in getattr(event.content, "parts", []) or []:
                            text = getattr(part, "text", "") or ""
                            if not text:
                                continue
                            if getattr(part, "thought", False):
                                yield {"type": "thought", "text": text}
                            else:
                                full, delta = _append_stream_piece(full, text)
                                if delta:
                                    yield {"type": "chunk", "text": delta}

                    if event.turn_complete:
                        if not full.strip() and hasattr(event, "output") and event.output:
                            out_text = str(event.output) if not isinstance(event.output, list) else "".join(str(o) for o in event.output)
                            if out_text.strip():
                                full, delta = _append_stream_piece(full, out_text)
                                if delta:
                                    yield {"type": "chunk", "text": delta}

                    if hasattr(event, "finish_reason") and event.finish_reason:
                        finish_reason = str(event.finish_reason)

            except Exception as exc:
                logger.exception("ADK retry failed file=%s", file_id)
                yield {"type": "error", "message": str(exc), "code": "ADK_RETRY_FAILED"}
                return

            if not full.strip():
                logger.info("ADK retry also empty for file=%s — falling back to GCS path", file_id)
                return
            
            # Accumulate retry output
            output += curr_round_output
            curr_round_output = 0
        else:
            logger.info("ADK returned empty for primed session — falling back to GCS path")
            return

    if not primed:
        mark_session_primed(runner_key, session_key)

    # Admin max_output_tokens is already applied; when the model still hits the
    # budget mid-answer (e.g. unfinished SUMMARY table), continue up to N times.
    # We only auto-continue if the budget is reasonably large (> 1000 tokens);
    # small budgets imply the user explicitly wants a short/truncated response.
    cont_attempts = continuation_attempts()
    if gen_cfg.get("max_output_tokens", 0) < 1000:
        cont_attempts = 0

    consec_degen = 1 if degen_abort else 0
    for cont_i in range(cont_attempts):
        if not (_is_max_tokens_finish(finish_reason) or degen_abort) or not full.strip():
            break
        budget = continuation_time_budget()
        if budget and (time.monotonic() - _t_start) > budget:
            logger.info(
                "Continuation time budget (%.0fs) exhausted — delivering partial answer file=%s",
                budget,
                file_id,
            )
            break
        recovery = degen_abort
        degen_abort = False
        logger.info(
            "ADK continuation %s/%s (recovery=%s) file=%s answer_chars=%s",
            cont_i + 1,
            cont_attempts,
            recovery,
            file_id,
            len(full),
        )
        yield {
            "type": "status",
            "status": "continuing",
            "message": (
                f"Recovering answer after repetition ({cont_i + 1}/{cont_attempts})..."
                if recovery
                else f"Completing truncated answer ({cont_i + 1}/{cont_attempts})..."
            ),
        }
        finish_reason = None
        full_before = full
        cont_guard = _RepetitionGuard()
        cont_stalls = 0

        if recovery and not adk_cache_name:
            # The aborted round may have died before ADK emitted cache metadata;
            # the explicit cache usually still exists — recover its name so the
            # changed-sampling direct recovery below can actually run.
            adk_cache_name = await _run_blocking(lambda: _db_adk_cache_name(file_id))

        rec_doc_parts: list[Any] = []
        if recovery and not adk_cache_name:
            # First question in a session: the cache row is only persisted at
            # the END of this request, so there is no cache name to recover yet.
            # Ground the direct recovery by re-sending the document bytes inline
            # instead of falling back to the fixed-sampling ADK runner (which
            # deterministically recreates the same loop).
            for spec in file_specs:
                buf = spec.get("buffer") or b""
                mime = spec.get("mimetype") or "application/octet-stream"
                if buf:
                    rec_doc_parts.append(gt.Part.from_bytes(data=buf, mime_type=mime))

        if recovery and (adk_cache_name or rec_doc_parts):
            # Recover via a DIRECT generation against the explicit cache (or the
            # inline document) with changed sampling (higher temperature +
            # frequency penalty). The ADK runner's fixed low temperature would
            # deterministically recreate the exact same repetition loop.
            state: dict[str, Any] = {"streamed": "", "last_chunk": None}
            direct_ok = False
            try:
                rec_kwargs: dict[str, Any] = {
                    "temperature": max(0.7, float(gen_cfg["temperature"] or 0)),
                    "max_output_tokens": gen_cfg["max_output_tokens"],
                }
                # Gemini 2.5+ rejects penalty params outright (400 "Penalty is
                # not enabled for models/…"), which would fail the whole direct
                # recovery and force the weaker ADK fallback. The raised
                # temperature above is what actually escapes the loop.
                if supports_frequency_penalty(model):
                    rec_kwargs["frequency_penalty"] = 0.4
                if adk_cache_name:
                    # The system instruction lives inside the explicit cache;
                    # the API rejects passing both.
                    rec_kwargs["cached_content"] = adk_cache_name
                else:
                    rec_kwargs["system_instruction"] = system_instruction
                rec_cfg = gt.GenerateContentConfig(**rec_kwargs)
                # Collapse degenerate punctuation floods (e.g. a table separator
                # of 1000 dashes) before echoing the answer back as a model turn
                # — quoting the flood verbatim invites the model to resume it.
                model_turn = re.sub(
                    r"([\s|\-:=+_~*#.])\1{9,}", lambda m: m.group(1) * 3, full.rstrip()
                )
                rec_contents = [
                    gt.Content(role="user", parts=[*rec_doc_parts, gt.Part(text=question)]),
                    gt.Content(role="model", parts=[gt.Part(text=model_turn)]),
                    gt.Content(role="user", parts=[gt.Part(text=build_recovery_prompt(full))]),
                ]
                _direct = _get_client()
                sync_iter = await _run_blocking(
                    lambda: _direct.models.generate_content_stream(
                        model=model, contents=rec_contents, config=rec_cfg
                    )
                )
                async for ev in _stream_round(iter(sync_iter), state, prior_text=full):
                    yield ev
                direct_ok = True
            except Exception as exc:
                logger.warning(
                    "Direct cache recovery failed (%s) — falling back to ADK session recovery", exc
                )
            if direct_ok:
                added = state["streamed"]
                full += added
                if state["last_chunk"] is not None:
                    u = _normalize_usage(state["last_chunk"], len(added))
                    # Output is additive; Input/Cached are latest/max.
                    prompt = max(prompt, u["inputTokens"])
                    output += u["outputTokens"]
                    total = prompt + output
                    finish_reason = u["finishReason"]
                if state.get("degenerate") or state.get("restarted") or not added.strip():
                    consec_degen += 1
                    if consec_degen >= 3:
                        logger.warning(
                            "Recovery also degenerated — delivering partial answer file=%s", file_id
                        )
                        break
                    degen_abort = True
                    continue
                consec_degen = 0
                continue

        cont_message = gt.Content(
            role="user",
            parts=[gt.Part(text=build_recovery_prompt(full) if recovery else CHAT_CONTINUATION_PROMPT)],
        )
        # Reset per-round state
        round_raw = ""
        head_emitted = False
        trim_offset = 0
        round_degenerate = False
        round_restarted = False
        round_error = False

        try:
            async for event in runner.run_async(
                user_id=user_id,
                session_id=adk_session_id,
                new_message=cont_message,
                run_config=RunConfig(streaming_mode=StreamingMode.SSE),
            ):
                author = getattr(event, "author", None) or ""
                if author and "document_cache_agent" not in author:
                    continue

                if event.cache_metadata and event.cache_metadata.cache_name:
                    adk_cache_name = event.cache_metadata.cache_name
                    adk_expire_time = event.cache_metadata.expire_time

                if event.usage_metadata:
                    um = event.usage_metadata
                    # Round-trip maximums within the current stream
                    prompt = max(prompt, int(getattr(um, "prompt_token_count", 0) or 0))
                    cached = max(cached, int(getattr(um, "cached_content_token_count", 0) or 0))
                    curr_round_output = max(curr_round_output, int(getattr(um, "candidates_token_count", 0) or 0))
                    total = prompt + output + curr_round_output

                if event.content:
                    for part in getattr(event.content, "parts", []) or []:
                        text = getattr(part, "text", "") or ""
                        if not text:
                            continue
                        if getattr(part, "thought", False):
                            yield {"type": "thought", "text": text}
                        else:
                            # Use round_raw for snapshot deduplication within this round
                            round_raw, delta = _append_stream_piece(round_raw, text)
                            if not delta:
                                # Stalls are ONLY significant after we've seen some output
                                # or if they are long fragments.
                                if len(text) >= 15:
                                    cont_stalls += 1
                                continue
                            
                            cont_stalls = 0
                            
                            # Handle overlap with previous rounds
                            if not head_emitted:
                                # Repetition guard on the raw stream to catch loops early
                                if cont_guard.feed(delta):
                                    round_degenerate = True
                                    break
                                
                                # Buffer the head until we have enough to detect overlap
                                if len(round_raw) < _CONTINUATION_TRIM_WINDOW:
                                    continue 
                                
                                head = _trim_overlap(full, round_raw)
                                if _looks_like_restart(full, head):
                                    round_restarted = True
                                    break
                                
                                trim_offset = len(round_raw) - len(head)
                                head_emitted = True
                                if head:
                                    yield {"type": "chunk", "text": head}
                                    cont_guard.feed(head)
                                continue

                            # Standard stream delivery
                            yield {"type": "chunk", "text": delta}
                            if cont_guard.feed(delta):
                                round_degenerate = True
                                break

                    if round_degenerate or round_restarted or cont_stalls >= _STALL_LIMIT:
                        if round_degenerate or cont_stalls >= _STALL_LIMIT:
                            logger.warning(
                                "Degenerate repetition in ADK continuation (tripped=%s stalls=%s) — aborting file=%s",
                                round_degenerate,
                                cont_stalls,
                                file_id,
                            )
                        else:
                            logger.warning("Continuation restarted from the beginning — discarding round.")
                        finish_reason = None
                        break

                if event.turn_complete:
                    if hasattr(event, "output") and event.output and not round_raw.strip():
                        out_text = (
                            str(event.output)
                            if not isinstance(event.output, list)
                            else "".join(str(o) for o in event.output)
                        )
                        if out_text.strip():
                            round_raw, delta = _append_stream_piece(round_raw, out_text)
                            if delta:
                                if not head_emitted:
                                    head = _trim_overlap(full, round_raw)
                                    if not _looks_like_restart(full, head):
                                        yield {"type": "chunk", "text": head}
                                        head_emitted = True
                                        trim_offset = len(round_raw) - len(head)
                                else:
                                    yield {"type": "chunk", "text": delta}

                if hasattr(event, "finish_reason") and event.finish_reason:
                    finish_reason = str(event.finish_reason)
        except (Exception, BaseException) as exc:
            round_error = True
            if isinstance(exc, GeneratorExit):
                # Client disconnected; stop everything immediately.
                return
            logger.exception("ADK continuation error file=%s", file_id)
            yield {"type": "status", "status": "continuing", "message": f"Continuation error ({exc})"}
            break

        # Post-round finalization: flush remaining buffered head if round was too short
        if not head_emitted and not round_restarted and not round_degenerate and not round_error:
            head = _trim_overlap(full, round_raw)
            if _looks_like_restart(full, head):
                round_restarted = True
            else:
                if head:
                    yield {"type": "chunk", "text": head}
                head_emitted = True
                trim_offset = len(round_raw) - len(head)

        # ── CRITICAL: Only append to the answer if the round was VALID ──
        if round_restarted or round_degenerate or round_error:
            if round_degenerate or (cont_stalls >= _STALL_LIMIT):
                # Recovery loop state
                consec_degen += 1
                if consec_degen >= 3:
                    logger.warning("Repetition persisted across ADK rounds — delivering partial answer file=%s", file_id)
                    break
                degen_abort = True
            elif round_restarted:
                logger.warning("ADK continuation restarted — stopping further rounds file=%s", file_id)
                break
            else:
                # Other error
                break
            continue

        # Round was successful!
        added = round_raw[trim_offset:]
        if not added.strip():
            logger.info("ADK continuation added nothing new — delivering existing answer file=%s", file_id)
            break
            
        full += added
        consec_degen = 0
        degen_abort = False

        # Accumulate round output into session total
        output += curr_round_output
        curr_round_output = 0
    # Every answered prompt resets the cache lifetime to a fresh TTL, so the
    # cache is deleted only after 5 minutes WITHOUT a prompt. If the user was
    # idle past expiry, the slide is skipped and the next prompt rebuilds the
    # cache automatically.
    if adk_cache_name:
        _ttl = _ttl_seconds()
        slid = await _run_blocking(
            lambda: _slide_cache_expiry(
                svc,
                user_id=user_id,
                adk_session_id=adk_session_id,
                cache_name=adk_cache_name,
                ttl_seconds=_ttl,
            )
        )
        if slid:
            adk_expire_time = slid
            logger.info(
                "Cache window reset: %s expires %ds from now (prompt received)",
                adk_cache_name,
                _ttl,
            )

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
        chat_session_id=session_key,
    )

    costs = compute_usage_cost(
        model=model,
        prompt_tokens=prompt,
        cached_tokens=cached,
        output_tokens=output,
        document_tokens=cached,
    )

    # Only log a query entry when a real user question produced a real answer.
    # The cache-priming call ("Acknowledge the document context." from
    # /cache/create, is_priming=True) always answers with SOME text, but its
    # token cost is already captured in setup_cost — logging it as a query
    # would show output tokens and a query cost before the user asked anything.
    is_priming_only = is_priming or (not primed and not had_real_content)
    if db_session_id and not is_priming_only:
        await persist_query_usage(
            session_id=db_session_id,
            prompt=prompt,
            cached=cached,
            output=output,
            total=total,
            costs=costs,
        )

    # ── Final Usage Report ──────────────────────────────────────────────────
    total = prompt + output
    status = await get_status_for_file(file_id, session_id=db_session_id)
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
        "finishReason": finish_reason,
        "outputTruncated": _is_max_tokens_finish(finish_reason),
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
    chat_session_id: str | None = None,
) -> str | None:
    """Create or refresh the gemini_cache_sessions DB record from ADK event metadata.

    Returns the session_id to use for persist_query_usage, or None on failure.
    """
    _ensure_schema()
    sys_hash = _system_hash(system_instruction)
    files = _file_fingerprint([file_id])
    model = model_name or DEFAULT_CACHE_MODEL

    # `chat_session_id` doubles as the ADK runner session key, which may be a
    # synthetic marker rather than a real session — cache priming passes
    # "prime-<file_id>". gemini_cache_sessions.session_id is a uuid column, so
    # only use the value as a DB id when it actually is one; otherwise fall back
    # to the per-file lookup and mint a fresh uuid for any new row.
    db_chat_session_id = chat_session_id if is_valid_uuid(chat_session_id) else None

    # Look for existing active session for this specific chat
    session_id = None
    with doc_conn() as conn:
        with conn.cursor() as cur:
            if db_chat_session_id:
                cur.execute(
                    """
                    SELECT session_id FROM gemini_cache_sessions
                    WHERE session_id=%s::uuid AND status='active' AND expires_at > NOW()
                    """,
                    (db_chat_session_id,)
                )
                row = cur.fetchone()
                if row:
                    session_id = row["session_id"]

            if not session_id:
                # Fallback: find any recent active session for this file
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
    new_session_id = db_chat_session_id or str(uuid.uuid4())
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


async def has_active_cache(file_id: str) -> bool:
    """True when a valid Gemini named cache exists for this file.
    
    Mirrors the primed-recovery check in ``ask_with_context_cache``: when this
    returns True, the ADK path answers question-only against the named cache and
    never needs the document bytes — so callers can skip downloading them.
    """
    def _check() -> bool:
        with doc_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT 1
                    FROM gemini_cache_sessions
                    WHERE file_id=%s::uuid AND status='active' AND expires_at > NOW()
                      AND adk_cache_name IS NOT NULL AND adk_cache_name <> ''
                    LIMIT 1
                    """,
                    (file_id,),
                )
                return cur.fetchone() is not None

    try:
        return await _run_blocking(_check)
    except Exception:
        return False


async def get_status_for_session(session_id: str) -> dict[str, Any] | None:
    """Detailed lifecycle + query history for one specific cache session."""
    _ensure_schema()
    with doc_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM gemini_cache_sessions WHERE session_id=%s::uuid", (session_id,))
            row = cur.fetchone()
            if not row:
                return None
            session = dict(row)
            cur.execute(
                """
                SELECT * FROM query_logs 
                WHERE session_id = %s::uuid 
                ORDER BY created_at ASC
                """,
                (session_id,),
            )
            logs = [dict(x) for x in cur.fetchall()]
    return _status_payload(session, logs)


async def get_status_for_file(file_id: str, session_id: str | None = None) -> dict[str, Any]:
    """Latest session lifecycle + query history aggregated across all cache sessions for this file."""
    if session_id:
        s = await get_status_for_session(session_id)
        if s:
            return s

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
            # Use the specific session's ID for logs to avoid file-level crosstalk
            sid = session["session_id"]
            cur.execute(
                """
                SELECT * FROM query_logs 
                WHERE session_id = %s::uuid 
                ORDER BY created_at ASC
                """,
                (sid,),
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
