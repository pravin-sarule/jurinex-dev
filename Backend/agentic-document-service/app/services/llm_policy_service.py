from __future__ import annotations

import io
import logging
from typing import Any

from pypdf import PdfReader

from app.services.db import get_db_connection, is_db_available

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


def get_global_daily_token_sum() -> int:
    if not _db_guard():
        return 0
    with get_db_connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT COALESCE(SUM(total_tokens), 0)::bigint AS s
            FROM public.llm_usage_logs
            WHERE used_at > now() - interval '24 hours'
            """
        )
        row = cur.fetchone() or {}
    return int(row.get("s") or 0)


def get_user_recent_counts(user_id: str) -> dict[str, int]:
    if not _db_guard():
        return {"perMinute": 0, "perHour": 0, "perDay": 0}
    with get_db_connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT COUNT(*)::int AS c
            FROM public.llm_usage_logs
            WHERE user_id::text = %s
              AND used_at > now() - interval '1 minute'
            """,
            [str(user_id)],
        )
        per_minute = int((cur.fetchone() or {}).get("c") or 0)
        cur.execute(
            """
            SELECT COUNT(*)::int AS c
            FROM public.llm_usage_logs
            WHERE user_id::text = %s
              AND used_at > now() - interval '1 hour'
            """,
            [str(user_id)],
        )
        per_hour = int((cur.fetchone() or {}).get("c") or 0)
        cur.execute(
            """
            SELECT COUNT(*)::int AS c
            FROM public.llm_usage_logs
            WHERE user_id::text = %s
              AND used_at > now() - interval '24 hours'
            """,
            [str(user_id)],
        )
        per_day = int((cur.fetchone() or {}).get("c") or 0)
    return {"perMinute": per_minute, "perHour": per_hour, "perDay": per_day}


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
    global_cap = max(0, _as_int(config.get("total_tokens_per_day")))
    per_min = max(0, _as_int(config.get("quota_chats_per_minute")))
    per_hour = max(0, _as_int(config.get("messages_per_hour")))
    per_day = max(0, _as_int(config.get("chats_per_day")))

    try:
        global_tokens = get_global_daily_token_sum()
        counts = get_user_recent_counts(user_id)
    except Exception as exc:
        logger.warning("[LLMPolicy] Usage query failed: %s", exc)
        return _policy_error(
            "POLICY_CHECK_UNAVAILABLE",
            "Usage limits could not be verified. Please try again shortly.",
            {"reason": str(exc)},
        )

    if global_cap > 0 and global_tokens >= global_cap:
        return _policy_error(
            "DAILY_GLOBAL_TOKEN_POOL_EXHAUSTED",
            "The environment token limit for the last 24 hours has been reached. Try again later.",
            {"used_tokens_last_24h": global_tokens, "limit": global_cap, "reset_basis": "rolling_24h_global_tokens"},
        )
    if per_min > 0 and counts["perMinute"] >= per_min:
        return _policy_error(
            "RATE_LIMIT_PER_MINUTE",
            "Too many chat requests. Please wait a minute and try again.",
            {"used_last_minute": counts["perMinute"], "limit_per_minute": per_min},
        )
    if per_hour > 0 and counts["perHour"] >= per_hour:
        return _policy_error(
            "RATE_LIMIT_MESSAGES_PER_HOUR",
            "Your hourly message quota has been reached. Try again later.",
            {"used_last_hour": counts["perHour"], "limit_per_hour": per_hour},
        )
    if per_day > 0 and counts["perDay"] >= per_day:
        return _policy_error(
            "RATE_LIMIT_CHATS_PER_DAY",
            "Your chat quota for the last 24 hours has been reached (all sessions combined). Try again later.",
            {
                "used_last_24h": counts["perDay"],
                "limit_per_24h": per_day,
                "reset_basis": "rolling_24h_per_user",
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
    max_upload_files = max(0, _as_int(config.get("max_upload_files")))
    if max_upload_files > 0 and files_count > max_upload_files:
        return _policy_error(
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
            return _policy_error(
                "FILE_TOO_LARGE",
                f"File exceeds the maximum allowed size of {effective_limit_mb} MB.",
                {"size_bytes": size_bytes, "max_mb": effective_limit_mb},
            )

    max_uploads_per_day = max(0, _as_int(config.get("max_file_upload_per_day")))
    if max_uploads_per_day > 0:
        used_today = get_user_upload_count_today(user_id)
        if used_today + max(files_count, 1) > max_uploads_per_day:
            return _policy_error(
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
            return _policy_error("PDF_INVALID", "Could not read this PDF.", {"error": str(exc)})
        if pages > max_pages:
            return _policy_error(
                "DOCUMENT_TOO_MANY_PAGES",
                f"Document has {pages} pages; maximum allowed is {max_pages}.",
                {"pages": pages, "max_pages": max_pages},
            )

    return {"ok": True}
