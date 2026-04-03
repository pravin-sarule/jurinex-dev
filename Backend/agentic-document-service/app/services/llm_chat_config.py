from __future__ import annotations

import logging
import threading
import time
from typing import Any

from app.core.config import get_settings
from app.services.db import get_db_connection, is_db_available

logger = logging.getLogger("agentic_document_service.llm_chat_config")
CONFIG_TABLE_NAME = "public.summarization_chat_config"
ALLOWED_GEMINI_MODELS = {
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
    "gemini-2.5-pro",
}

_CACHE_TTL_SECONDS = 60.0
_cache_lock = threading.Lock()
_cached_config: dict[str, Any] | None = None
_cache_expires_at = 0.0


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


def _parse_model_alias_map(raw: Any) -> dict[str, Any]:
    if isinstance(raw, dict):
        return dict(raw)
    return {}


def _clamp_int(value: Any, minimum: int, maximum: int, fallback: int) -> int:
    parsed = _finite_int(value, fallback)
    return max(minimum, min(maximum, parsed))


def _clamp_float(value: Any, minimum: float, maximum: float, fallback: float) -> float:
    parsed = _finite_number(value, fallback)
    return max(minimum, min(maximum, parsed))


def _normalize_model(value: Any, fallback: str) -> str:
    candidate = str(value or "").strip()
    return candidate if candidate in ALLOWED_GEMINI_MODELS else fallback


def map_row_to_config(row: dict[str, Any] | None) -> dict[str, Any]:
    settings = get_settings()
    if not row:
        default_model = _normalize_model(settings.adk_model, "gemini-2.5-pro")
        return {
            "config_id": None,
            "config_created_at": None,
            "config_updated_at": None,
            "max_output_tokens": 25000,
            "total_tokens_per_day": 300000,
            "llm_model": default_model,
            "llm_provider": "google",
            "model_temperature": 0.7,
            "messages_per_hour": 60,
            "quota_chats_per_minute": 20,
            "chats_per_day": 80,
            "max_document_pages": 400,
            "max_document_size_mb": 40,
            "max_file_upload_per_day": 15,
            "max_upload_files": 10,
            "streaming_delay": 0,
            "updated_by": None,
            "vertex_model_id": None,
            "model_alias_map": {},
            "min_output_tokens": 1,
            "max_output_tokens_cap": 65536,
            "temperature_min": 0.0,
            "temperature_max": 1.0,
            "multer_upload_ceiling_mb": 100,
            "summarization_model": default_model,
            "max_summarization_output_tokens": 15000,
            "max_context_documents": 8,
            "embedding_provider": "google",
            "embedding_model": settings.embedding_model or "text-embedding-004",
            "embedding_dimension": 768,
            "retrieval_top_k": int(settings.retrieval_top_k or 8),
            "use_hybrid_search": True,
            "use_rrf": True,
            "semantic_weight": 0.7,
            "keyword_weight": 0.3,
            "text_search_language": "english",
            "max_conversation_history": 25,
            "max_file_size_mb": 100,
    }

    default_model = _normalize_model(settings.adk_model, "gemini-2.5-pro")
    config = {
        "config_id": row.get("id"),
        "config_created_at": row.get("created_at"),
        "config_updated_at": row.get("updated_at"),
        "max_output_tokens": _clamp_int(row.get("max_output_tokens"), 1000, 100000, 25000),
        "total_tokens_per_day": _clamp_int(row.get("total_tokens_per_day"), 1000, 1000000, 300000),
        "llm_model": _normalize_model(row.get("llm_model"), default_model),
        "llm_provider": str(row.get("llm_provider") or "google").strip().lower(),
        "model_temperature": _clamp_float(row.get("model_temperature"), 0.0, 1.0, 0.7),
        "messages_per_hour": _clamp_int(row.get("messages_per_hour"), 1, 100, 60),
        "quota_chats_per_minute": _clamp_int(row.get("quota_chats_per_minute"), 1, 100, 20),
        "chats_per_day": _clamp_int(row.get("chats_per_day"), 0, 100, 80),
        "max_document_pages": _clamp_int(row.get("max_document_pages"), 1, 1000, 400),
        "max_document_size_mb": _clamp_int(row.get("max_document_size_mb"), 1, 50, 40),
        "max_file_upload_per_day": _clamp_int(row.get("max_file_upload_per_day"), 0, 100, 15),
        "max_upload_files": _clamp_int(row.get("max_upload_files"), 1, 20, 10),
        "streaming_delay": _finite_int(row.get("streaming_delay"), 0),
        "updated_by": row.get("updated_by"),
        "vertex_model_id": str(row.get("vertex_model_id") or "").strip() or None,
        "model_alias_map": _parse_model_alias_map(row.get("model_alias_map")),
        "min_output_tokens": _finite_int(row.get("min_output_tokens"), 1),
        "max_output_tokens_cap": _finite_int(row.get("max_output_tokens_cap"), 65536),
        "temperature_min": _finite_number(row.get("temperature_min"), 0.0),
        "temperature_max": 1.0,
        "multer_upload_ceiling_mb": _clamp_int(row.get("max_file_size_mb"), 1, 200, 100),
        "summarization_model": _normalize_model(row.get("summarization_model"), default_model),
        "max_summarization_output_tokens": _clamp_int(
            row.get("max_summarization_output_tokens"), 1000, 30000, 15000
        ),
        "max_context_documents": _finite_int(row.get("max_context_documents"), 8),
        "embedding_provider": str(row.get("embedding_provider") or "google").strip().lower(),
        "embedding_model": str(row.get("embedding_model") or settings.embedding_model or "text-embedding-004").strip(),
        "embedding_dimension": _finite_int(row.get("embedding_dimension"), 768),
        "retrieval_top_k": _finite_int(row.get("retrieval_top_k"), int(settings.retrieval_top_k or 8)),
        "use_hybrid_search": _parse_bool(row.get("use_hybrid_search"), True),
        "use_rrf": _parse_bool(row.get("use_rrf"), True),
        "semantic_weight": _finite_number(row.get("semantic_weight"), 0.7),
        "keyword_weight": _finite_number(row.get("keyword_weight"), 0.3),
        "text_search_language": str(row.get("text_search_language") or "english").strip() or "english",
        "max_conversation_history": _finite_int(row.get("max_conversation_history"), 25),
        "max_file_size_mb": _clamp_int(
            row.get("max_file_size_mb"),
            1,
            200,
            100,
        ),
    }
    return config


def resolve_model_name(config: dict[str, Any] | None, *, for_summary: bool = False) -> str:
    if not config:
        return ""
    raw = (config.get("summarization_model") if for_summary else config.get("llm_model")) or ""
    raw = str(raw).strip()
    if not raw:
        return ""
    if config.get("vertex_model_id") and not for_summary:
        return str(config["vertex_model_id"]).strip()
    alias_map = config.get("model_alias_map") or {}
    lowered = raw.lower()
    alias = alias_map.get(lowered) or alias_map.get(raw)
    return str(alias).strip() if alias else raw


def get_streaming_delay_ms(config: dict[str, Any] | None) -> int:
    return max(0, min(5000, _finite_int((config or {}).get("streaming_delay"), 0)))


def merge_folder_chat_request_llm_overrides(base: dict[str, Any], request: Any) -> dict[str, Any]:
    """Apply optional per-request max_output_tokens / model_temperature (clamped to dashboard limits)."""
    out = dict(base)
    if request is None:
        return out
    mot = getattr(request, "max_output_tokens", None)
    if mot is not None:
        try:
            n = int(mot)
            cap = max(1, _finite_int(out.get("max_output_tokens_cap"), 65536))
            min_t = max(1, _finite_int(out.get("min_output_tokens"), 1))
            clamped = max(min_t, min(cap, n))
            out["max_output_tokens"] = clamped
            sum_hi = max(1000, min(30000, cap))
            out["max_summarization_output_tokens"] = max(1000, min(sum_hi, n))
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
        _finite_int(config.get("multer_upload_ceiling_mb"), 0),
    ]
    positives = [value for value in candidates if value > 0]
    return min(positives) if positives else 100


def get_llm_chat_config(*, force_refresh: bool = False) -> dict[str, Any]:
    global _cached_config, _cache_expires_at
    now = time.time()
    if not force_refresh and _cached_config is not None and now < _cache_expires_at:
        logger.debug(
            "[LLMConfig] source=cache config_id=%s updated_at=%s expires_in=%.2fs",
            _cached_config.get("config_id"),
            _cached_config.get("config_updated_at"),
            max(0.0, _cache_expires_at - now),
        )
        return _cached_config

    with _cache_lock:
        now = time.time()
        if not force_refresh and _cached_config is not None and now < _cache_expires_at:
            logger.debug(
                "[LLMConfig] source=cache config_id=%s updated_at=%s expires_in=%.2fs",
                _cached_config.get("config_id"),
                _cached_config.get("config_updated_at"),
                max(0.0, _cache_expires_at - now),
            )
            return _cached_config

        if not is_db_available():
            _cached_config = map_row_to_config(None)
            _cache_expires_at = now + _CACHE_TTL_SECONDS
            return _cached_config

        try:
            with get_db_connection() as conn, conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT *
                    FROM public.summarization_chat_config
                    ORDER BY id DESC
                    LIMIT 1
                    """
                )
                row = cur.fetchone()
            _cached_config = map_row_to_config(row)
            _cache_expires_at = now + _CACHE_TTL_SECONDS
            logger.info(
                "[LLMConfig] source=db table=%s config_id=%s updated_at=%s raw_llm_model=%s raw_summarization_model=%s "
                "raw_max_output_tokens=%s raw_max_summarization_output_tokens=%s raw_embedding_model=%s raw_retrieval_top_k=%s "
                "llm_model=%s summarization_model=%s retrieval_top_k=%s max_context_documents=%s "
                "max_upload_files=%s max_file_size_mb=%s max_document_size_mb=%s max_document_pages=%s total_tokens_per_day=%s "
                "messages_per_hour=%s quota_chats_per_minute=%s chats_per_day=%s max_file_upload_per_day=%s max_conversation_history=%s",
                CONFIG_TABLE_NAME,
                row.get("id") if row else None,
                row.get("updated_at") if row else None,
                row.get("llm_model") if row else None,
                row.get("summarization_model") if row else None,
                row.get("max_output_tokens") if row else None,
                row.get("max_summarization_output_tokens") if row else None,
                row.get("embedding_model") if row else None,
                row.get("retrieval_top_k") if row else None,
                _cached_config.get("llm_model"),
                _cached_config.get("summarization_model"),
                _cached_config.get("retrieval_top_k"),
                _cached_config.get("max_context_documents"),
                _cached_config.get("max_upload_files"),
                _cached_config.get("max_file_size_mb"),
                _cached_config.get("max_document_size_mb"),
                _cached_config.get("max_document_pages"),
                _cached_config.get("total_tokens_per_day"),
                _cached_config.get("messages_per_hour"),
                _cached_config.get("quota_chats_per_minute"),
                _cached_config.get("chats_per_day"),
                _cached_config.get("max_file_upload_per_day"),
                _cached_config.get("max_conversation_history"),
            )
            return _cached_config
        except Exception as exc:
            logger.warning("[LLMConfig] DB read failed, using fallback defaults: %s", exc)
            _cached_config = map_row_to_config(None)
            _cache_expires_at = now + _CACHE_TTL_SECONDS
            return _cached_config


def invalidate_llm_chat_config_cache() -> None:
    global _cached_config, _cache_expires_at
    with _cache_lock:
        _cached_config = None
        _cache_expires_at = 0.0
