from __future__ import annotations

import io
import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from pypdf import PdfReader

from app.core.config import get_settings
from app.core.upload_constants import SUPPORTED_AUDIO_MIME_TYPES
from app.services.db import get_db_connection, get_payment_db_connection, is_db_available, is_payment_db_available

logger = logging.getLogger("agentic_document_service.llm_policy")


def _num(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _as_int(value: Any) -> int:
    return int(_num(value))


def _policy_error(code: str, message: str, details: dict[str, Any] | None = None) -> dict[str, Any]:
    return {"ok": False, "code": code, "message": message, "details": details or {}}


def _db_guard() -> bool:
    return is_db_available()


def _payment_db_guard() -> bool:
    return is_payment_db_available()


_IST = timezone(timedelta(hours=5, minutes=30))


def _dt_to_iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _dt_to_ist(dt: datetime | None) -> str | None:
    """Format datetime as 'DD MMM YYYY, HH:MM AM/PM IST'."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    ist = dt.astimezone(_IST)
    # %-d is Unix-only; use .day for cross-platform day-without-leading-zero
    return f"{ist.day} {ist.strftime('%b %Y, %I:%M %p')} IST"


def get_user_usage_stats(user_id: str) -> dict:
    """
    Single query returning counts (minute/hour/day), total tokens in 24h,
    and the oldest entry timestamp in each window for accurate reset times.
    llm_usage_logs lives in Payment_DB.
    """
    if not _payment_db_guard():
        return {
            "tokens_24h": 0, "perMinute": 0, "perHour": 0, "perDay": 0,
            "oldest_1min": None, "oldest_1hr": None, "oldest_24h": None,
        }
    with get_payment_db_connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT
                COALESCE(SUM(total_tokens) FILTER (WHERE used_at > now() - interval '24 hours'), 0)::bigint AS tokens_24h,
                COUNT(*) FILTER (WHERE used_at > now() - interval '1 minute')::int  AS per_minute,
                COUNT(*) FILTER (WHERE used_at > now() - interval '1 hour')::int    AS per_hour,
                COUNT(*) FILTER (WHERE used_at > now() - interval '24 hours')::int  AS per_day,
                MIN(used_at) FILTER (WHERE used_at > now() - interval '1 minute')   AS oldest_1min,
                MIN(used_at) FILTER (WHERE used_at > now() - interval '1 hour')     AS oldest_1hr,
                MIN(used_at) FILTER (WHERE used_at > now() - interval '24 hours')   AS oldest_24h
            FROM public.llm_usage_logs
            WHERE user_id::text = %s
            """,
            [str(user_id)],
        )
        row = cur.fetchone() or {}
    return {
        "tokens_24h": int(row.get("tokens_24h") or 0),
        "perMinute": int(row.get("per_minute") or 0),
        "perHour": int(row.get("per_hour") or 0),
        "perDay": int(row.get("per_day") or 0),
        "oldest_1min": row.get("oldest_1min"),
        "oldest_1hr": row.get("oldest_1hr"),
        "oldest_24h": row.get("oldest_24h"),
    }


def _reset_dt(oldest_dt: datetime | None, window_seconds: int) -> datetime:
    """oldest entry timestamp + window = when that entry ages out = real reset time."""
    if oldest_dt is None:
        return datetime.now(timezone.utc) + timedelta(seconds=window_seconds)
    if oldest_dt.tzinfo is None:
        oldest_dt = oldest_dt.replace(tzinfo=timezone.utc)
    return oldest_dt + timedelta(seconds=window_seconds)


def _reset_fields(oldest_dt: datetime | None, window_seconds: int) -> dict:
    dt = _reset_dt(oldest_dt, window_seconds)
    return {"next_reset_utc": _dt_to_iso(dt), "next_reset_ist": _dt_to_ist(dt)}


def get_user_upload_count_today(user_id: str) -> int:
    if not _db_guard():
        return 0
    with get_db_connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT COUNT(*)::int AS c
            FROM user_files
            WHERE user_id::text = %s
              AND (is_folder IS NULL OR is_folder = false)
              AND created_at > now() - interval '24 hours'
            """,
            [str(user_id)],
        )
        row = cur.fetchone() or {}
    return int(row.get("c") or 0)


def assert_chat_allowed(user_id: str, config: dict[str, Any]) -> dict[str, Any]:
    per_user_token_cap = max(0, _as_int(config.get("total_tokens_per_day")))
    per_min = max(0, _as_int(config.get("quota_chats_per_minute")))
    per_hour = max(0, _as_int(config.get("messages_per_hour")))
    per_day = max(0, _as_int(config.get("chats_per_day")))

    try:
        stats = get_user_usage_stats(user_id)
    except Exception as exc:
        logger.warning("[LLMPolicy] Usage query failed: %s", exc)
        return _policy_error(
            "POLICY_CHECK_UNAVAILABLE",
            "Usage limits could not be verified. Please try again shortly.",
            {"reason": str(exc)},
        )

    if per_user_token_cap > 0 and stats["tokens_24h"] >= per_user_token_cap:
        rf = _reset_fields(stats["oldest_24h"], 86400)
        return _policy_error(
            "RATE_LIMIT_TOTAL_TOKENS_PER_DAY",
            f"Your token limit for the last 24 hours has been reached. Resets at {rf['next_reset_ist']}.",
            {
                "used_tokens_last_24h": stats["tokens_24h"],
                "limit": per_user_token_cap,
                "reset_basis": "rolling_24h_per_user_tokens",
                **rf,
            },
        )
    if per_min > 0 and stats["perMinute"] >= per_min:
        rf = _reset_fields(stats["oldest_1min"], 60)
        return _policy_error(
            "RATE_LIMIT_PER_MINUTE",
            f"Too many requests. Please wait until {rf['next_reset_ist']}.",
            {
                "used_last_minute": stats["perMinute"],
                "limit_per_minute": per_min,
                **rf,
            },
        )
    if per_hour > 0 and stats["perHour"] >= per_hour:
        rf = _reset_fields(stats["oldest_1hr"], 3600)
        return _policy_error(
            "RATE_LIMIT_MESSAGES_PER_HOUR",
            f"Your hourly message quota has been reached. Resets at {rf['next_reset_ist']}.",
            {
                "used_last_hour": stats["perHour"],
                "limit_per_hour": per_hour,
                **rf,
            },
        )
    if per_day > 0 and stats["perDay"] >= per_day:
        rf = _reset_fields(stats["oldest_24h"], 86400)
        return _policy_error(
            "RATE_LIMIT_CHATS_PER_DAY",
            f"Your daily chat quota has been reached. Resets at {rf['next_reset_ist']}.",
            {
                "used_last_24h": stats["perDay"],
                "limit_per_24h": per_day,
                "reset_basis": "rolling_24h_per_user",
                **rf,
            },
        )
    return {"ok": True}


def assert_upload_allowed(
    user_id: str,
    config: dict[str, Any],
    *,
    files_count: int = 1,
    size_bytes: int = 0,
    buffer: bytes | None = None,
    mimetype: str | None = None,
    originalname: str | None = None,
) -> dict[str, Any]:
    plan_name: str | None = config.get("_plan_name") or None

    def _upload_error(code: str, message: str, details: dict[str, Any]) -> dict[str, Any]:
        if plan_name:
            details = {**details, "plan_name": plan_name}
        return _policy_error(code, message, details)

    max_upload_files = max(0, _as_int(config.get("max_upload_files")))
    if max_upload_files > 0 and files_count > max_upload_files:
        return _upload_error(
            "MAX_UPLOAD_FILES_EXCEEDED",
            f"Only {max_upload_files} file(s) can be uploaded in one request.",
            {"requested_files": files_count, "max_upload_files": max_upload_files},
        )

    size_limits_mb = [
        max(0, _as_int(config.get("max_document_size_mb"))),
        max(0, _as_int(config.get("max_file_size_mb"))),
        max(0, _as_int(config.get("multer_upload_ceiling_mb"))),
    ]
    positive_limits = [limit for limit in size_limits_mb if limit > 0]
    if positive_limits:
        effective_limit_mb = min(positive_limits)
        if size_bytes > effective_limit_mb * 1024 * 1024:
            return _upload_error(
                "FILE_TOO_LARGE",
                f"File exceeds the maximum allowed size of {effective_limit_mb} MB.",
                {"size_bytes": size_bytes, "max_mb": effective_limit_mb},
            )

    max_uploads_per_day = max(0, _as_int(config.get("max_file_upload_per_day")))
    if max_uploads_per_day > 0:
        used_today = get_user_upload_count_today(user_id)
        if used_today + max(files_count, 1) > max_uploads_per_day:
            return _upload_error(
                "DAILY_UPLOAD_LIMIT",
                "Maximum file uploads in the last 24 hours reached.",
                {
                    "used_last_24h": used_today,
                    "limit_per_24h": max_uploads_per_day,
                    "reset_basis": "rolling_24h_per_user",
                },
            )

    max_pages = max(0, _as_int(config.get("max_document_pages")))
    name = (originalname or "").lower()
    mime = (mimetype or "").lower()
    is_pdf = mime == "application/pdf" or name.endswith(".pdf")
    if max_pages > 0 and is_pdf and buffer:
        try:
            reader = PdfReader(io.BytesIO(buffer))
            pages = len(reader.pages)
        except Exception as exc:
            return _upload_error("PDF_INVALID", "Could not read this PDF.", {"error": str(exc)})
        if pages > max_pages:
            return _upload_error(
                "DOCUMENT_TOO_MANY_PAGES",
                f"Document has {pages} pages; maximum allowed is {max_pages}.",
                {"pages": pages, "max_pages": max_pages},
            )

    # Optional stricter cap for audio (e.g. long court recordings)
    try:
        settings = get_settings()
        audio_cap_mb = max(0, _as_int(getattr(settings, "max_audio_file_size_mb", 0)))
    except Exception:
        audio_cap_mb = 0
    mime_l = (mimetype or "").lower().split(";")[0].strip()
    if audio_cap_mb > 0 and mime_l.startswith("audio/") and size_bytes > audio_cap_mb * 1024 * 1024:
        return _upload_error(
            "AUDIO_FILE_TOO_LARGE",
            f"Audio exceeds the maximum allowed size of {audio_cap_mb} MB.",
            {"size_bytes": size_bytes, "max_mb": audio_cap_mb},
        )

    return {"ok": True}


def supported_audio_mime_types() -> frozenset[str]:
    """MIME types treated as legal audio uploads (see Speech-to-Text adapter)."""
    return SUPPORTED_AUDIO_MIME_TYPES
