"""
Gemini and Claude model ids as defined in Document_DB.public.llm_models.

Used so summarization_chat_config.llm_model matches the same canonical names as the dashboard.
"""
from __future__ import annotations

import logging
import threading
import time
from typing import Any

from app.services.db import get_db_connection, is_db_available

logger = logging.getLogger("agentic_document_service.llm_models_catalog")

_CACHE_TTL_SECONDS = 60.0
_lock = threading.Lock()
_lower_to_canonical: dict[str, str] | None = None
_cache_expires_at = 0.0

# If is_active exists, prefer active rows only; otherwise fall back to a simpler query.
_QUERIES = (
    """
    SELECT TRIM(name::text) AS name
    FROM public.llm_models
    WHERE name IS NOT NULL AND TRIM(name::text) <> ''
      AND COALESCE(is_active, true) = true
      AND (
        LOWER(TRIM(name::text)) LIKE 'gemini%'
        OR LOWER(TRIM(name::text)) LIKE 'claude%'
      )
    ORDER BY id NULLS LAST
    """,
    """
    SELECT TRIM(name::text) AS name
    FROM public.llm_models
    WHERE name IS NOT NULL AND TRIM(name::text) <> ''
      AND (
        LOWER(TRIM(name::text)) LIKE 'gemini%'
        OR LOWER(TRIM(name::text)) LIKE 'claude%'
      )
    ORDER BY id NULLS LAST
    """,
)


def _fetch_names_from_db() -> list[str]:
    if not is_db_available():
        return []
    last_err: Exception | None = None
    for sql in _QUERIES:
        try:
            with get_db_connection() as conn, conn.cursor() as cur:
                cur.execute(sql)
                rows = cur.fetchall()
            out: list[str] = []
            for row in rows:
                n = str((row or {}).get("name") or "").strip()
                if n:
                    out.append(n)
            return out
        except Exception as exc:  # noqa: BLE001
            last_err = exc
            continue
    if last_err:
        logger.warning("[LLMModelsCatalog] could not read llm_models: %s", last_err)
    return []


def get_gemini_claude_models_map(*, force_refresh: bool = False) -> dict[str, str]:
    """
    Map lowercased model name -> canonical name as stored in llm_models (dashboard).
    """
    global _lower_to_canonical, _cache_expires_at
    now = time.time()
    if not force_refresh and _lower_to_canonical is not None and now < _cache_expires_at:
        return _lower_to_canonical

    with _lock:
        now = time.time()
        if not force_refresh and _lower_to_canonical is not None and now < _cache_expires_at:
            return _lower_to_canonical

        lower_map: dict[str, str] = {}
        for n in _fetch_names_from_db():
            lower_map[n.lower()] = n

        _lower_to_canonical = lower_map
        _cache_expires_at = now + _CACHE_TTL_SECONDS
        if lower_map:
            logger.info("[LLMModelsCatalog] loaded %d Gemini/Claude model name(s) from llm_models", len(lower_map))
        else:
            logger.debug("[LLMModelsCatalog] no Gemini/Claude rows in llm_models (empty or unavailable)")
        return _lower_to_canonical


def _api_model_tail(raw: str) -> str:
    """Last path segment (e.g. anthropic/claude-sonnet-4 -> claude-sonnet-4)."""
    s = str(raw or "").strip()
    if not s:
        return ""
    if "/" in s:
        return s.split("/")[-1].strip()
    return s


def resolve_chat_llm_model(raw: Any, fallback: str) -> str:
    """
    Align config model strings with llm_models when present; otherwise keep sensible behavior.

    - Exact (case-insensitive) match to a row in llm_models -> use that row's spelling.
    - Also matches on the last path segment (e.g. vendor/anthropic/claude-4-6 -> claude-4-6 in catalog).
    - Catalog empty (DB down / no rows) -> trust the raw string from config/env.
    - Catalog loaded but name not listed: still allow typical Gemini/Claude API ids; else fallback.
    """
    candidate = str(raw or "").strip()
    fb = str(fallback or "").strip()
    if not candidate:
        return fb

    catalog = get_gemini_claude_models_map()
    key_full = candidate.lower()
    tail = _api_model_tail(candidate).lower()
    if key_full in catalog:
        return catalog[key_full]
    if tail and tail in catalog:
        return catalog[tail]
    if not catalog:
        return candidate
    if tail.startswith("gemini") or tail.startswith("claude"):
        return candidate
    return fb if fb else candidate


def invalidate_llm_models_catalog_cache() -> None:
    global _lower_to_canonical, _cache_expires_at
    with _lock:
        _lower_to_canonical = None
        _cache_expires_at = 0.0
