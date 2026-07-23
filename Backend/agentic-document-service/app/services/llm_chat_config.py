from __future__ import annotations

import logging
import threading
import time
from typing import Any

from app.core.config import get_settings
from app.services.db import get_db_connection, is_db_available
from app.services.llm_models_catalog import (
    get_gemini_claude_models_map,
    invalidate_llm_models_catalog_cache,
    resolve_chat_llm_model,
)

logger = logging.getLogger("agentic_document_service.llm_chat_config")
CONFIG_TABLE_NAME = "public.summarization_chat_config"

# Upper bounds guard against corrupt DB values only; real limits come from the row.
_MAX_OUTPUT_TOKENS_CEILING = 2_000_000
_TOTAL_TOKENS_PER_DAY_CEILING = 1_000_000_000_000  # 1e12
_RATE_LIMIT_CEILING = 1_000_000
_MAX_DOC_MB_CEILING = 10_000
_MAX_DOC_PAGES_CEILING = 50_000

_SKIP_ROW_MERGE_KEYS = frozenset({"id", "created_at", "updated_at", "user_id"})

_cache_lock = threading.Lock()
_config_cache: dict[str, tuple[dict[str, Any], float]] = {}

_schema_lock = threading.Lock()
_summarization_table_columns: frozenset[str] | None = None


def _finite_number(value: Any, fallback: float = 0.0) -> float:
    try:
        num = float(value)
    except (TypeError, ValueError):
        return fallback
    return num if num == num and num not in (float("inf"), float("-inf")) else fallback


def _finite_int(value: Any, fallback: int = 0) -> int:
    return int(_finite_number(value, fallback))


def _parse_bool(value: Any, fallback: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return fallback
    text = str(value).strip().lower()
    if text in {"1", "true", "t", "yes", "y", "on"}:
        return True
    if text in {"0", "false", "f", "no", "n", "off"}:
        return False
    return fallback


def _clamp_float(value: Any, minimum: float, maximum: float, fallback: float) -> float:
    parsed = _finite_number(value, fallback)
    return max(minimum, min(maximum, parsed))


def _parse_user_id_int(user_id: str | int | None) -> int | None:
    if user_id is None:
        return None
    try:
        n = int(str(user_id).strip())
    except (TypeError, ValueError):
        return None
    return n if n > 0 else None


def _merge_config_rows(
    base: dict[str, Any] | None,
    *overlays: dict[str, Any] | None,
) -> dict[str, Any] | None:
    parts = [p for p in (base, *overlays) if p]
    if not parts:
        return None
    out = dict(parts[0])
    effective_id = parts[0].get("id")
    for ov in parts[1:]:
        if ov.get("id") is not None:
            effective_id = ov.get("id")
        for k, v in ov.items():
            if k in _SKIP_ROW_MERGE_KEYS:
                continue
            if v is None:
                continue
            out[k] = v
    out["id"] = effective_id
    return out


def _load_summarization_columns(conn: Any) -> frozenset[str]:
    global _summarization_table_columns
    with _schema_lock:
        if _summarization_table_columns is not None:
            return _summarization_table_columns
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'summarization_chat_config'
            """
        )
        cols = frozenset(str(r["column_name"]) for r in cur.fetchall())
    with _schema_lock:
        _summarization_table_columns = cols
    return cols


def _fetch_merged_summarization_row(uid_int: int | None) -> dict[str, Any] | None:
    with get_db_connection() as conn, conn.cursor() as cur:
        cols = _load_summarization_columns(conn)
        if not cols:
            logger.warning("[SummarizationConfig] table %s has no columns (missing table?)", CONFIG_TABLE_NAME)
            return None

        has_user_id = "user_id" in cols
        base: dict[str, Any] | None = None

        if has_user_id:
            cur.execute(
                """
                SELECT *
                FROM public.summarization_chat_config
                WHERE user_id IS NULL OR user_id = 0
                ORDER BY updated_at DESC NULLS LAST, id DESC
                LIMIT 1
                """
            )
            base = cur.fetchone()
            if base is None:
                cur.execute(
                    """
                    SELECT *
                    FROM public.summarization_chat_config
                    ORDER BY updated_at DESC NULLS LAST, id DESC
                    LIMIT 1
                    """
                )
                base = cur.fetchone()
        else:
            cur.execute(
                """
                SELECT *
                FROM public.summarization_chat_config
                ORDER BY updated_at DESC NULLS LAST, id DESC
                LIMIT 1
                """
            )
            base = cur.fetchone()

        user_row: dict[str, Any] | None = None
        if uid_int is not None and has_user_id:
            cur.execute(
                """
                SELECT *
                FROM public.summarization_chat_config
                WHERE user_id = %s
                ORDER BY updated_at DESC NULLS LAST, id DESC
                LIMIT 1
                """,
                (uid_int,),
            )
            user_row = cur.fetchone()

        return _merge_config_rows(base, user_row)


def _core_from_row(row: dict[str, Any] | None, *, settings: Any) -> dict[str, Any]:
    """
    Map only `summarization_chat_config` columns (plus id timestamps). No llm_chat_config / other tables.
    """
    default_model = resolve_chat_llm_model(settings.adk_model, "gemini-2.5-pro")
    # Env-backed defaults — set in .env, override only when DB row is missing/null
    d_tokens       = max(0, int(settings.default_tokens_per_day))
    d_msg_hr       = max(0, int(settings.default_messages_per_hour))
    d_chats_min    = max(0, int(settings.default_chats_per_minute))
    d_chats_day    = max(0, int(settings.default_chats_per_day))
    d_upload_files = max(0, int(settings.default_max_upload_files))
    d_doc_mb       = max(0, int(settings.default_max_document_size_mb))
    d_doc_pages    = max(0, int(settings.default_max_document_pages))
    d_uploads_day  = max(0, int(settings.default_max_file_upload_per_day))
    d_ctx_docs     = max(0, int(settings.default_max_context_documents))
    d_conv_hist    = max(0, int(settings.default_max_conversation_history))
    d_max_out      = max(1, min(_MAX_OUTPUT_TOKENS_CEILING, int(settings.default_max_output_tokens)))

    if not row:
        max_out = d_max_out
        max_file_mb = 100
        return {
            "config_id": None,
            "config_created_at": None,
            "config_updated_at": None,
            "llm_model": default_model,
            "llm_provider": "google",
            "model_temperature": 0.7,
            "max_output_tokens": max_out,
            "streaming_delay": 0,
            "max_upload_files": d_upload_files,
            "max_file_size_mb": max_file_mb,
            "max_document_size_mb": d_doc_mb,
            "max_document_pages": d_doc_pages,
            "max_context_documents": d_ctx_docs,
            "embedding_provider": "google",
            "embedding_model": settings.embedding_model or "gemini-embedding-001",
            "embedding_dimension": 768,
            "retrieval_top_k": int(settings.retrieval_top_k or 8),
            "use_hybrid_search": True,
            "use_rrf": True,
            "semantic_weight": 0.7,
            "keyword_weight": 0.3,
            "text_search_language": "english",
            "total_tokens_per_day": d_tokens,
            "messages_per_hour": d_msg_hr,
            "quota_chats_per_minute": d_chats_min,
            "chats_per_day": d_chats_day,
            "max_file_upload_per_day": d_uploads_day,
            "max_conversation_history": d_conv_hist,
            "updated_by": None,
        }

    llm_from_row = resolve_chat_llm_model(row.get("llm_model"), default_model)
    max_out = max(
        1,
        min(_MAX_OUTPUT_TOKENS_CEILING, _finite_int(row.get("max_output_tokens"), d_max_out)),
    )
    max_file_mb = max(0, min(_MAX_DOC_MB_CEILING, _finite_int(row.get("max_file_size_mb"), 100)))

    return {
        "config_id": row.get("id"),
        "config_created_at": row.get("created_at"),
        "config_updated_at": row.get("updated_at"),
        "llm_model": llm_from_row,
        "llm_provider": str(row.get("llm_provider") or "google").strip().lower(),
        "model_temperature": _clamp_float(row.get("model_temperature"), 0.0, 1.0, 0.7),
        "max_output_tokens": max_out,
        "streaming_delay": _finite_int(row.get("streaming_delay"), 0),
        "max_upload_files": max(0, min(1000, _finite_int(row.get("max_upload_files"), d_upload_files))),
        "max_file_size_mb": max_file_mb,
        "max_document_size_mb": max(0, min(_MAX_DOC_MB_CEILING, _finite_int(row.get("max_document_size_mb"), d_doc_mb))),
        "max_document_pages": max(0, min(_MAX_DOC_PAGES_CEILING, _finite_int(row.get("max_document_pages"), d_doc_pages))),
        "max_context_documents": max(0, min(10_000, _finite_int(row.get("max_context_documents"), d_ctx_docs))),
        "embedding_provider": str(row.get("embedding_provider") or "google").strip().lower(),
        "embedding_model": str(row.get("embedding_model") or settings.embedding_model or "gemini-embedding-001").strip(),
        "embedding_dimension": max(0, min(16_384, _finite_int(row.get("embedding_dimension"), 768))),
        "retrieval_top_k": max(0, min(10_000, _finite_int(row.get("retrieval_top_k"), int(settings.retrieval_top_k or 8)))),
        "use_hybrid_search": _parse_bool(row.get("use_hybrid_search"), True),
        "use_rrf": _parse_bool(row.get("use_rrf"), True),
        "semantic_weight": _finite_number(row.get("semantic_weight"), 0.7),
        "keyword_weight": _finite_number(row.get("keyword_weight"), 0.3),
        "text_search_language": str(row.get("text_search_language") or "english").strip() or "english",
        "total_tokens_per_day": max(
            0,
            min(_TOTAL_TOKENS_PER_DAY_CEILING, _finite_int(row.get("total_tokens_per_day"), d_tokens)),
        ),
        "messages_per_hour": max(0, min(_RATE_LIMIT_CEILING, _finite_int(row.get("messages_per_hour"), d_msg_hr))),
        "quota_chats_per_minute": max(0, min(_RATE_LIMIT_CEILING, _finite_int(row.get("quota_chats_per_minute"), d_chats_min))),
        "chats_per_day": max(0, min(_RATE_LIMIT_CEILING, _finite_int(row.get("chats_per_day"), d_chats_day))),
        "max_file_upload_per_day": max(0, min(_RATE_LIMIT_CEILING, _finite_int(row.get("max_file_upload_per_day"), d_uploads_day))),
        "max_conversation_history": max(0, min(10_000, _finite_int(row.get("max_conversation_history"), d_conv_hist))),
        "updated_by": row.get("updated_by"),
    }


def map_row_to_config(row: dict[str, Any] | None) -> dict[str, Any]:
    """
    Normalized runtime config from `summarization_chat_config` rows only.
    Extra keys (`summarization_model`, caps) are derived from the same row for internal callers.
    """
    settings = get_settings()
    core = _core_from_row(row, settings=settings)
    max_out = int(core["max_output_tokens"])
    llm = str(core["llm_model"])
    # Table has a single chat model column; summarization uses the same model and token budget.
    core["summarization_model"] = llm
    core["max_summarization_output_tokens"] = max_out
    core["min_output_tokens"] = 1
    core["max_output_tokens_cap"] = _MAX_OUTPUT_TOKENS_CEILING
    core["temperature_min"] = 0.0
    core["temperature_max"] = 1.0
    core["multer_upload_ceiling_mb"] = max(0, int(core["max_file_size_mb"]))
    core["vertex_model_id"] = None
    core["model_alias_map"] = {}
    return core


def resolve_model_name(config: dict[str, Any] | None, *, for_summary: bool = False) -> str:
    if not config:
        return ""
    # summarization_chat_config exposes one model id; summarization uses the same value.
    return str(config.get("llm_model") or "").strip()


def get_streaming_delay_ms(config: dict[str, Any] | None) -> int:
    return max(0, min(5000, _finite_int((config or {}).get("streaming_delay"), 0)))


def merge_folder_chat_request_llm_overrides(base: dict[str, Any], request: Any) -> dict[str, Any]:
    """Apply optional per-request generation overrides."""
    out = dict(base)
    if request is None:
        return out
    requested_model = str(getattr(request, "llm_name", None) or "").strip()
    if requested_model and requested_model.lower() not in {"gemini", "claude", "deepseek", "default"}:
        out["llm_model"] = requested_model
        out["summarization_model"] = requested_model
    mot = getattr(request, "max_output_tokens", None)
    if mot is not None:
        try:
            n = int(mot)
            cap = max(1, _finite_int(out.get("max_output_tokens_cap"), 65536))
            min_t = max(1, _finite_int(out.get("min_output_tokens"), 1))
            clamped = max(min_t, min(cap, n))
            out["max_output_tokens"] = clamped
            out["max_summarization_output_tokens"] = clamped
        except (TypeError, ValueError):
            pass
    mt = getattr(request, "model_temperature", None)
    if mt is not None:
        try:
            t = float(mt)
            tmin = _finite_number(out.get("temperature_min"), 0.0)
            tmax = _finite_number(out.get("temperature_max"), 1.0)
            if tmin > tmax:
                tmin, tmax = tmax, tmin
            out["model_temperature"] = max(tmin, min(tmax, t))
        except (TypeError, ValueError):
            pass
    return out


def get_request_upload_ceiling_mb(config: dict[str, Any] | None) -> int:
    if not config:
        return 100
    candidates = [
        _finite_int(config.get("max_file_size_mb"), 0),
        _finite_int(config.get("max_document_size_mb"), 0),
    ]
    positives = [value for value in candidates if value > 0]
    return min(positives) if positives else 100


def _get_user_active_plan(uid_int: int, authorization: str | None = None) -> dict[str, Any] | None:
    from app.services.payment_plan_service import get_user_active_plan

    try:
        return get_user_active_plan(uid_int, authorization=authorization)
    except Exception as exc:
        logger.warning("[SummarizationConfig] Failed to fetch active plan for user %s: %s", uid_int, exc)
    return None


def _merge_plan_limits(
    cfg: dict[str, Any],
    plan: dict[str, Any],
    *,
    plan_limit_mode: str = "chat",
) -> dict[str, Any]:
    """
    Overlay subscription_plans onto admin defaults.
    NULL plan column = keep admin default. Non-null > 0 = override.
    chat_* columns apply to intelligent chat; sum_* to summarization flows.
    """
    out = dict(cfg)
    mode = (plan_limit_mode or "chat").strip().lower()

    def plan_int(col: str, fallback: int) -> int:
        v = plan.get(col)
        if v is None:
            return fallback
        n = _finite_int(v, 0)
        return n if n > 0 else fallback

    def plan_col_set(col: str) -> bool:
        v = plan.get(col)
        return v is not None and _finite_int(v, 0) > 0

    legacy_doc_limit = _finite_int(plan.get("document_limit"), 0)

    if mode == "summarization":
        out["total_tokens_per_day"] = plan_int(
            "summarization_token_limit", out["total_tokens_per_day"]
        )
        out["messages_per_hour"] = plan_int("sum_messages_per_hour", out["messages_per_hour"])
        out["chats_per_day"] = plan_int("sum_chats_per_day", out["chats_per_day"])
        out["quota_chats_per_minute"] = plan_int(
            "sum_quota_per_minute", out["quota_chats_per_minute"]
        )
        out["max_document_pages"] = plan_int("sum_max_document_pages", out["max_document_pages"])
        out["max_document_size_mb"] = plan_int(
            "sum_max_document_size_mb", out["max_document_size_mb"]
        )
        out["max_file_upload_per_day"] = plan_int(
            "sum_max_file_upload_per_day", out["max_file_upload_per_day"]
        )
        out["max_upload_files"] = plan_int("sum_max_upload_files", out["max_upload_files"])
        out["max_context_documents"] = plan_int(
            "sum_max_context_documents", out["max_context_documents"]
        )
        out["max_conversation_history"] = plan_int(
            "sum_max_conversation_history", out["max_conversation_history"]
        )
        if legacy_doc_limit > 0:
            if not plan_col_set("sum_max_upload_files"):
                out["max_upload_files"] = legacy_doc_limit
            if not plan_col_set("sum_max_file_upload_per_day"):
                out["max_file_upload_per_day"] = legacy_doc_limit
    else:
        out["total_tokens_per_day"] = plan_int("chat_token_limit", out["total_tokens_per_day"])
        out["messages_per_hour"] = plan_int("chat_messages_per_hour", out["messages_per_hour"])
        out["chats_per_day"] = plan_int("chat_chats_per_day", out["chats_per_day"])
        out["quota_chats_per_minute"] = plan_int(
            "chat_quota_per_minute", out["quota_chats_per_minute"]
        )
        out["max_document_pages"] = plan_int(
            "chat_max_document_pages", out["max_document_pages"]
        )
        out["max_document_size_mb"] = plan_int(
            "chat_max_document_size_mb", out["max_document_size_mb"]
        )
        out["max_file_upload_per_day"] = plan_int(
            "chat_max_file_upload_per_day", out["max_file_upload_per_day"]
        )
        out["max_upload_files"] = plan_int("chat_max_upload_files", out["max_upload_files"])
        if legacy_doc_limit > 0:
            if not plan_col_set("chat_max_upload_files"):
                out["max_upload_files"] = legacy_doc_limit
            if not plan_col_set("chat_max_file_upload_per_day"):
                out["max_file_upload_per_day"] = legacy_doc_limit

    out["_plan_id"] = plan.get("id")
    out["_plan_name"] = plan.get("name")
    out["_plan_limit_mode"] = mode

    # Free-tier → DeepSeek: force the text LLM model for users on the named free
    # plan (reuses the existing DeepSeek adapter; _detect_provider routes on the
    # model name). Off by default; the generate dispatch keeps a Gemini fallback.
    try:
        from app.core.config import get_settings

        s = get_settings()
        # Free = a ₹0-price plan (robust to renaming; matches payment-service).
        _price = plan.get("price")
        _is_free = _price is not None and float(_price) == 0.0
        if (
            s.free_tier_deepseek_enabled
            and s.deepseek_api_key
            and s.deepseek_model
            and _is_free
        ):
            out["llm_model"] = s.deepseek_model
            out["summarization_model"] = s.deepseek_model
            out["llm_provider"] = "deepseek"
    except Exception as exc:
        logger.debug("[SummarizationConfig] free-tier override skipped: %s", exc)

    return out


def get_llm_chat_config(
    *,
    user_id: str | int | None = None,
    force_refresh: bool = False,
    plan_limit_mode: str = "chat",
) -> dict[str, Any]:
    """
    Effective limits/models from `public.summarization_chat_config` only.

    Resolution order (non-null overlays on top of global):
      1) Latest global row: user_id IS NULL OR user_id = 0 (if column exists), else latest row
      2) Latest row for this user in the same table (user_id = :user), when present

    Cache: settings.summarization_chat_config_cache_seconds (default 0 = read DB every time).
    """
    settings = get_settings()
    ttl = max(0.0, float(settings.summarization_chat_config_cache_seconds))
    uid_int = _parse_user_id_int(user_id)
    cache_key = f"u:{uid_int}" if uid_int is not None else "_global"
    now = time.time()

    if ttl > 0 and not force_refresh:
        with _cache_lock:
            hit = _config_cache.get(cache_key)
            if hit and now < hit[1]:
                logger.debug(
                    "[SummarizationConfig] cache hit key=%s config_id=%s expires_in=%.2fs",
                    cache_key,
                    hit[0].get("config_id"),
                    max(0.0, hit[1] - now),
                )
                return hit[0]

    if not is_db_available():
        cfg = map_row_to_config(None)
        cfg["summarization_config_scope"] = "fallback_no_db"
        cfg["summarization_config_user_id"] = uid_int
        if ttl > 0:
            with _cache_lock:
                _config_cache[cache_key] = (cfg, now + ttl)
        return cfg

    try:
        get_gemini_claude_models_map(force_refresh=force_refresh)
        merged_row = _fetch_merged_summarization_row(uid_int)
        cfg = map_row_to_config(merged_row)
        cfg["summarization_config_scope"] = (
            "user_merged" if uid_int is not None else "global"
        )
        cfg["summarization_config_user_id"] = uid_int

        if uid_int is not None:
            plan = _get_user_active_plan(uid_int)
            if plan:
                cfg = _merge_plan_limits(cfg, plan, plan_limit_mode=plan_limit_mode)
                cfg["summarization_config_scope"] = f"plan_merged_{plan_limit_mode}"
                logger.info(
                    "[SummarizationConfig] plan applied (%s) for user %s: \"%s\" (id=%s)",
                    plan_limit_mode,
                    uid_int,
                    plan.get("name"),
                    plan.get("id"),
                )
            else:
                logger.debug("[SummarizationConfig] No active plan for user %s — using global defaults", uid_int)

        row = merged_row or {}
        logger.info(
            "[SummarizationConfig] table=%s scope=%s user_id=%s config_id=%s updated_at=%s "
            "raw_llm_model=%s llm_model=%s retrieval_top_k=%s max_context_documents=%s",
            CONFIG_TABLE_NAME,
            cfg.get("summarization_config_scope"),
            uid_int,
            row.get("id"),
            row.get("updated_at"),
            row.get("llm_model"),
            cfg.get("llm_model"),
            cfg.get("retrieval_top_k"),
            cfg.get("max_context_documents"),
        )
        if ttl > 0:
            with _cache_lock:
                _config_cache[cache_key] = (cfg, now + ttl)
        return cfg
    except Exception as exc:
        logger.warning("[SummarizationConfig] DB read failed, using fallback defaults: %s", exc)
        cfg = map_row_to_config(None)
        cfg["summarization_config_scope"] = "fallback_error"
        cfg["summarization_config_user_id"] = uid_int
        if ttl > 0:
            with _cache_lock:
                _config_cache[cache_key] = (cfg, now + ttl)
        return cfg


def get_summarization_chat_config(
    *,
    user_id: str | int | None = None,
    force_refresh: bool = False,
) -> dict[str, Any]:
    """Summarization flows: apply sum_* columns from subscription_plans."""
    return get_llm_chat_config(
        user_id=user_id,
        force_refresh=force_refresh,
        plan_limit_mode="summarization",
    )


def invalidate_summarization_chat_config_cache() -> None:
    global _summarization_table_columns
    with _cache_lock:
        _config_cache.clear()
    with _schema_lock:
        _summarization_table_columns = None
    invalidate_llm_models_catalog_cache()


def invalidate_llm_chat_config_cache() -> None:
    invalidate_summarization_chat_config_cache()
