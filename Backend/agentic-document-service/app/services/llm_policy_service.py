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


def _get_plan_limits(user_id: str) -> dict[str, Any]:
    """
    Returns monthly_limit, topup_balance, last_reset_date for the active subscription.
    Plan limits are zeroed when the plan has expired; topup balance is always returned.
    Prefers monthly_plans (new flow). Falls back gracefully if payment DB is unavailable.
    """
    if not is_payment_db_available():
        return {"monthly_limit": 0, "topup_balance": 0, "last_reset_date": None}
    try:
        with get_payment_db_connection() as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                  CASE WHEN (us.end_date IS NULL OR us.end_date >= CURRENT_DATE)
                       THEN COALESCE(mp.monthly_tokens, sp.token_limit, 0)
                       ELSE 0
                  END                                             AS monthly_limit,
                  COALESCE(us.topup_token_balance, 0)            AS topup_balance,
                  us.topup_expires_at,
                  COALESCE(us.last_reset_date, us.start_date)    AS last_reset_date
                FROM user_subscriptions us
                LEFT JOIN monthly_plans mp ON mp.id = us.monthly_plan_id
                LEFT JOIN subscription_plans sp ON sp.id = us.plan_id
                WHERE us.user_id::text = %s
                  AND LOWER(COALESCE(us.status, 'active')) IN ('active', 'topup_only')
                ORDER BY us.updated_at DESC NULLS LAST
                LIMIT 1
                """,
                [str(user_id)],
            )
            row = cur.fetchone() or {}
    except Exception as exc:
        logger.warning("[LLMPolicy] plan limits query failed: %s", exc)
        return {"monthly_limit": 0, "topup_balance": 0, "last_reset_date": None}

    monthly_limit = int(row.get("monthly_limit") or 0)
    topup_balance = int(row.get("topup_balance") or 0)
    last_reset_date = row.get("last_reset_date")

    topup_expires = row.get("topup_expires_at")
    if topup_expires:
        if topup_expires.tzinfo is None:
            topup_expires = topup_expires.replace(tzinfo=timezone.utc)
        if topup_expires < datetime.now(timezone.utc):
            topup_balance = 0

    return {
        "monthly_limit":   monthly_limit,
        "topup_balance":   topup_balance,
        "last_reset_date": last_reset_date,
    }


def _get_tokens_used_today(user_id: str) -> int:
    """Sum of tokens for today (UTC calendar day) from llm_usage_logs."""
    if not is_payment_db_available():
        return 0
    try:
        with get_payment_db_connection() as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT COALESCE(SUM(total_tokens), 0)::bigint AS tokens_today
                FROM public.llm_usage_logs
                WHERE user_id::text = %s
                  AND used_at >= CURRENT_DATE AT TIME ZONE 'UTC'
                """,
                [str(user_id)],
            )
            row = cur.fetchone() or {}
        return int(row.get("tokens_today") or 0)
    except Exception as exc:
        logger.warning("[LLMPolicy] tokens_today query failed: %s", exc)
        return 0


def _get_tokens_used_this_month(user_id: str, last_reset_date: Any) -> int:
    """Sum of tokens since last_reset_date (start of current billing period)."""
    if not is_payment_db_available() or last_reset_date is None:
        return 0
    try:
        with get_payment_db_connection() as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT COALESCE(SUM(total_tokens), 0)::bigint AS tokens_month
                FROM public.llm_usage_logs
                WHERE user_id::text = %s
                  AND used_at >= %s::timestamptz
                """,
                [str(user_id), last_reset_date],
            )
            row = cur.fetchone() or {}
        return int(row.get("tokens_month") or 0)
    except Exception as exc:
        logger.warning("[LLMPolicy] tokens_this_month query failed: %s", exc)
        return 0


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
        # Allow users with active top-up balance to continue past the rolling cap
        try:
            topup_check = _get_plan_limits(user_id)
            if topup_check.get("topup_balance", 0) > 0:
                return {"ok": True, "source": "topup", "topup_balance": topup_check["topup_balance"]}
        except Exception:
            pass  # fall through to block
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

    # ── Plan token limits (monthly_plans) ────────────────────────────────────
    try:
        limits = _get_plan_limits(user_id)
        monthly_limit   = limits["monthly_limit"]
        topup_balance   = limits["topup_balance"]
        last_reset_date = limits["last_reset_date"]

        if monthly_limit > 0:
            tokens_this_period = _get_tokens_used_this_month(user_id, last_reset_date)

            if tokens_this_period >= monthly_limit:
                if topup_balance > 0:
                    return {"ok": True, "source": "topup", "topup_balance": topup_balance}
                next_midnight = datetime.now(timezone.utc).replace(
                    hour=0, minute=0, second=0, microsecond=0
                ) + timedelta(days=1)
                return _policy_error(
                    "MONTHLY_TOKEN_LIMIT_EXHAUSTED",
                    "You have used all your monthly tokens. Purchase a top-up to continue, upgrade your plan, or wait for your next billing date.",
                    {
                        "tokens_used_this_period": tokens_this_period,
                        "monthly_token_limit":     monthly_limit,
                        "topup_available":         True,
                        "next_reset_utc":          next_midnight.strftime("%Y-%m-%dT%H:%M:%SZ"),
                    },
                )
    except Exception as exc:
        logger.warning("[LLMPolicy] plan limit check failed: %s", exc)

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
    # Upload restrictions (file size, page count, daily count) are disabled.
    # Only token-based limits are enforced (see assert_storage_allowed / chat policy checks).
    return {"ok": True}

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


def assert_storage_allowed(user_id: str, size_bytes: int = 0) -> dict[str, Any]:
    """
    Check whether uploading `size_bytes` more data would exceed the user's
    plan storage_limit_gb.  Returns {"ok": True} when the upload is allowed,
    or a policy-error dict when the limit is exceeded.

    Storage calculation:
      - Document DB  : SUM(user_files.size) for the user (all non-folder files)
      - Payment DB   : storage_limit_gb from the active monthly_plan / subscription_plan

    A limit of 0 means unlimited (no enforcement).
    """
    if not is_payment_db_available() or not is_db_available():
        return {"ok": True}

    from app.services.db import is_draft_db_available, get_draft_db_connection

    # ── 1a. Document DB: user_files (uploads from all services) ─────────────
    storage_used_bytes: int = 0
    try:
        with get_db_connection() as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT COALESCE(SUM(size), 0)::bigint AS total_bytes
                FROM user_files
                WHERE user_id = %s
                  AND (is_folder IS NULL OR is_folder = FALSE)
                """,
                (str(user_id),),
            )
            row = cur.fetchone() or {}
        storage_used_bytes = int(row.get("total_bytes", 0) or 0)
    except Exception as exc:
        logger.warning("[StoragePolicy] doc-db query failed for user %s: %s", user_id, exc)
        return {"ok": True}

    # ── 1b. Draft DB: generated_documents (agent-draft-service output) ──────
    if is_draft_db_available():
        try:
            with get_draft_db_connection() as conn, conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT COALESCE(SUM(gd.file_size), 0)::bigint AS draft_bytes
                    FROM generated_documents gd
                    JOIN user_drafts ud ON ud.draft_id = gd.draft_id
                    WHERE ud.user_id = %s
                      AND gd.file_size IS NOT NULL
                    """,
                    (str(user_id),),
                )
                row = cur.fetchone() or {}
            storage_used_bytes += int(row.get("draft_bytes", 0) or 0)
        except Exception as exc:
            logger.warning("[StoragePolicy] draft-db query failed for user %s: %s", user_id, exc)

    # ── 2. Storage limit (Payment DB) ───────────────────────────────────────
    storage_limit_gb: float = 0.0
    try:
        with get_payment_db_connection() as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT COALESCE(
                    mp.storage_limit_gb,
                    sp.storage_limit_gb,
                    0
                )::numeric AS storage_limit_gb
                FROM user_subscriptions us
                LEFT JOIN monthly_plans      mp ON mp.id = us.monthly_plan_id AND mp.is_active = TRUE
                LEFT JOIN subscription_plans sp ON sp.id = us.plan_id
                WHERE us.user_id::text = %s
                  AND LOWER(COALESCE(us.status, 'active')) = 'active'
                  AND (us.end_date IS NULL OR us.end_date >= CURRENT_DATE)
                  AND (mp.id IS NOT NULL OR sp.id IS NOT NULL)
                ORDER BY us.updated_at DESC NULLS LAST
                LIMIT 1
                """,
                (str(user_id),),
            )
            row = cur.fetchone() or {}
        storage_limit_gb = float(row.get("storage_limit_gb", 0) or 0)
    except Exception as exc:
        logger.warning("[StoragePolicy] payment-db query failed for user %s: %s", user_id, exc)
        return {"ok": True}

    # No limit configured → allow
    if storage_limit_gb <= 0:
        return {"ok": True}

    storage_limit_bytes = storage_limit_gb * (1024 ** 3)
    used_after_upload   = storage_used_bytes + size_bytes

    if used_after_upload > storage_limit_bytes:
        used_gb  = storage_used_bytes / (1024 ** 3)
        extra_gb = size_bytes / (1024 ** 3)
        return _policy_error(
            "STORAGE_LIMIT_EXCEEDED",
            (
                f"You have used {used_gb:.2f} GB of your {storage_limit_gb:.2f} GB storage limit. "
                f"This upload ({extra_gb:.3f} GB) would exceed your plan's storage quota. "
                "Delete existing files or upgrade your plan to continue."
            ),
            {
                "storage_used_bytes":   storage_used_bytes,
                "storage_used_gb":      round(used_gb, 4),
                "storage_limit_gb":     storage_limit_gb,
                "upload_size_bytes":    size_bytes,
                "upload_size_gb":       round(extra_gb, 4),
                "overage_bytes":        max(0, int(used_after_upload - storage_limit_bytes)),
            },
        )

    return {"ok": True}


def supported_audio_mime_types() -> frozenset[str]:
    """MIME types treated as legal audio uploads (see Speech-to-Text adapter)."""
    return SUPPORTED_AUDIO_MIME_TYPES
