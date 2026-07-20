from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any

from app.services.db import doc_conn, payment_conn

logger = logging.getLogger(__name__)

# Values below 1 are treated as unconfigured/defaults.
_CHAT_MIN_OUTPUT_TOKENS = 1
_CHAT_DEFAULT_OUTPUT_TOKENS = 20000

_config_cache: dict[str, tuple[dict[str, Any], float]] = {}
_CACHE_TTL = 1.0  # Reduced to 1s to ensure DB changes are picked up immediately while debugging


def invalidate_llm_config_cache(user_id: str | None = None) -> None:
    """Drop cached admin LLM settings so the next chat request re-reads Document_DB.

    Call after an admin updates `llm_chat_config` (or pass nothing to clear all).
    """
    if user_id is None:
        _config_cache.clear()
        return
    _config_cache.pop(str(user_id), None)
    _config_cache.pop("global", None)


def _finite_number(value: Any, fallback: float = 0.0) -> float:
    try:
        n = float(value)
        return n if n == n else fallback
    except (TypeError, ValueError):
        return fallback


def _parse_alias_map(raw: Any) -> dict[str, str]:
    if isinstance(raw, dict):
        return {str(k): str(v) for k, v in raw.items()}
    if isinstance(raw, str) and raw.strip():
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, dict):
                return {str(k): str(v) for k, v in parsed.items()}
        except json.JSONDecodeError:
            pass
    return {}


def _map_row(row: dict[str, Any] | None) -> dict[str, Any] | None:
    if not row:
        return None
    alias = _parse_alias_map(row.get("model_alias_map"))
    # Document_DB `llm_chat_config.max_output_tokens` is the generation budget.
    # When `max_output_tokens_cap` is absent, that same value is also the hard ceiling
    # for client overrides (30k configured → max 30k output; 5k → max 5k).
    max_out = max(_CHAT_MIN_OUTPUT_TOKENS, int(_finite_number(row.get("max_output_tokens"), _CHAT_DEFAULT_OUTPUT_TOKENS)))
    if row.get("max_output_tokens_cap") is None:
        max_cap = max_out
    else:
        max_cap = max(max_out, int(_finite_number(row.get("max_output_tokens_cap"), max_out)))
    return {
        "max_output_tokens": max_out,
        "total_tokens_per_day": int(_finite_number(row.get("total_tokens_per_day"), 100000)),
        "llm_model": str(row.get("llm_model") or "gemini-2.5-flash-lite"),
        "llm_provider": str(row.get("llm_provider") or "google").strip().lower(),
        "model_temperature": _finite_number(row.get("model_temperature"), 1.0),
        "messages_per_hour": int(_finite_number(row.get("messages_per_hour"), 100)),
        "quota_chats_per_minute": int(_finite_number(row.get("quota_chats_per_minute"), 4)),
        "chats_per_day": int(_finite_number(row.get("chats_per_day"), 100)),
        "max_document_pages": int(_finite_number(row.get("max_document_pages"), 500)),
        "max_document_size_mb": int(_finite_number(row.get("max_document_size_mb"), 50)),
        "max_file_upload_per_day": int(_finite_number(row.get("max_file_upload_per_day"), 20)),
        "max_upload_files": int(_finite_number(row.get("max_upload_files"), 8)),
        "streaming_delay": int(_finite_number(row.get("streaming_delay"), 0)),
        "vertex_model_id": (row.get("vertex_model_id") or "").strip() or None,
        "model_alias_map": alias,
        "min_output_tokens": int(_finite_number(row.get("min_output_tokens"), 1)),
        "max_output_tokens_cap": max_cap,
        "temperature_min": _finite_number(row.get("temperature_min"), 0),
        "temperature_max": _finite_number(row.get("temperature_max"), 2),
        "multer_upload_ceiling_mb": int(_finite_number(row.get("multer_upload_ceiling_mb"), 100)),
    }


def resolve_vertex_model_id(cfg: dict[str, Any]) -> str | None:
    if cfg.get("vertex_model_id"):
        return str(cfg["vertex_model_id"]).strip()
    raw = (cfg.get("llm_model") or "").strip()
    if not raw:
        return None
    amap = cfg.get("model_alias_map") or {}
    key = raw.lower()
    if amap.get(key):
        return str(amap[key]).strip()
    if amap.get(raw):
        return str(amap[raw]).strip()
    return raw


def get_streaming_delay_ms(cfg: dict[str, Any]) -> int:
    raw = int(_finite_number(cfg.get("streaming_delay"), 0))
    return min(max(0, raw), 5000)


def get_multer_upload_ceiling_mb(cfg: dict[str, Any]) -> int:
    ceiling = int(_finite_number(cfg.get("multer_upload_ceiling_mb"), 100))
    max_doc = int(_finite_number(cfg.get("max_document_size_mb"), 1))
    return max(1, ceiling, max_doc)


def get_next_utc_midnight_iso() -> str:
    now = datetime.now(timezone.utc)
    nxt = now.replace(hour=0, minute=0, second=0, microsecond=0)
    if nxt <= now:
        from datetime import timedelta

        nxt = nxt + timedelta(days=1)
    return nxt.isoformat().replace("+00:00", "Z")


async def get_llm_config(user_id: str | None = None) -> dict[str, Any]:
    import asyncio
    import time

    cache_key = str(user_id or "global")
    now = time.time()
    hit = _config_cache.get(cache_key)
    if hit and now - hit[1] < _CACHE_TTL:
        return hit[0]

    import psycopg

    def _fetch():
        for attempt in range(3):
            try:
                with doc_conn() as conn:
                    with conn.cursor() as cur:
                        cur.execute(
                            "SELECT * FROM llm_chat_config ORDER BY updated_at DESC NULLS LAST, id DESC LIMIT 1"
                        )
                        return cur.fetchone()
            except psycopg.OperationalError as exc:
                if attempt == 2:
                    raise
                logger.warning("DB connection failed (attempt %d/3), retrying: %s", attempt + 1, exc)
        return None

    row = await asyncio.get_event_loop().run_in_executor(None, _fetch)
    cfg = _map_row(dict(row) if row else None) or _map_row({})

    uid = None
    try:
        uid = int(user_id) if user_id else None
    except (TypeError, ValueError):
        uid = None

    if uid and uid > 0:
        def _fetch_plan():
            try:
                with payment_conn() as conn:
                    with conn.cursor() as cur:
                        cur.execute(
                            """
                            SELECT
                                COALESCE(mp.id, sp.id) AS id,
                                COALESCE(mp.name, sp.name) AS name
                            FROM user_subscriptions us
                            LEFT JOIN monthly_plans mp ON mp.id = us.monthly_plan_id AND mp.is_active = true
                            LEFT JOIN subscription_plans sp ON sp.id = us.plan_id
                            WHERE us.user_id = %s
                              AND LOWER(COALESCE(us.status, 'active')) = 'active'
                              AND (us.end_date IS NULL OR us.end_date >= CURRENT_DATE)
                              AND (mp.id IS NOT NULL OR sp.id IS NOT NULL)
                            ORDER BY us.activated_at DESC NULLS LAST
                            LIMIT 1
                            """,
                            (uid,),
                        )
                        return cur.fetchone()
            except Exception as exc:
                logger.warning("Plan lookup failed: %s", exc)
                return None

        plan = await asyncio.get_event_loop().run_in_executor(None, _fetch_plan)
        if plan:
            plan = dict(plan)
            cfg["_plan_id"] = plan.get("id")
            cfg["_plan_name"] = plan.get("name")

    _config_cache[cache_key] = (cfg, now)
    return cfg


def merge_request_overrides(cfg: dict[str, Any], body: dict[str, Any]) -> dict[str, Any]:
    out = dict(cfg)
    # After _map_row, max_output_tokens_cap equals configured max when the DB
    # column is missing — so a 30k row cannot be overridden above 30k.
    ceiling = max(
        1,
        int(out.get("max_output_tokens_cap") or out.get("max_output_tokens") or _CHAT_DEFAULT_OUTPUT_TOKENS),
    )
    min_out = 1
    tmin = float(out.get("temperature_min") or 0)
    tmax = float(out.get("temperature_max") or 2)

    mot = body.get("max_output_tokens") or body.get("maxOutputTokens")
    if mot is not None:
        try:
            n = int(float(mot))
            out["max_output_tokens"] = max(min_out, min(ceiling, n))
        except (TypeError, ValueError):
            pass

    temp = body.get("model_temperature") if body.get("model_temperature") is not None else body.get("temperature")
    if temp is not None:
        try:
            t = float(temp)
            out["model_temperature"] = max(tmin, min(tmax, t))
        except (TypeError, ValueError):
            pass

    # Client llm_name is intentionally IGNORED — the admin-configured Chat Model
    # (Document_DB llm_chat_config.llm_model) is authoritative for generation.
    # Frontends that send hardcoded names (e.g. "gemini-pro-2.5" from secret
    # prompts) must not silently switch the model away from the admin config.
    return out
