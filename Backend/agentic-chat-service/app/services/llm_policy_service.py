from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from app.services.db import payment_conn
from app.services.llm_config_service import get_next_utc_midnight_iso


def _num(v: Any) -> float:
    try:
        n = float(v)
        return n if n == n else 0.0
    except (TypeError, ValueError):
        return 0.0


# ── Usage stats ───────────────────────────────────────────────────────────────

def _usage_stats(user_id: int) -> dict[str, Any]:
    """Returns per-minute/hour/day call counts and token sums for today and the rolling 24h."""
    with payment_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                  COALESCE(SUM(total_tokens) FILTER (WHERE used_at > now() - interval '24 hours'), 0)::bigint AS tokens_24h,
                  COALESCE(SUM(total_tokens) FILTER (WHERE used_at >= CURRENT_DATE AT TIME ZONE 'UTC'), 0)::bigint  AS tokens_today,
                  COUNT(*) FILTER (WHERE used_at > now() - interval '1 minute')::int  AS per_minute,
                  COUNT(*) FILTER (WHERE used_at > now() - interval '1 hour')::int    AS per_hour,
                  COUNT(*) FILTER (WHERE used_at > now() - interval '24 hours')::int  AS per_day
                FROM public.llm_usage_logs
                WHERE user_id = %s
                """,
                (user_id,),
            )
            row = cur.fetchone()
    r = dict(row) if row else {}
    return {
        "tokens24h":   int(r.get("tokens_24h")   or 0),
        "tokensToday": int(r.get("tokens_today")  or 0),
        "perMinute":   int(r.get("per_minute")    or 0),
        "perHour":     int(r.get("per_hour")      or 0),
        "perDay":      int(r.get("per_day")       or 0),
    }


def _get_tokens_used_this_month(user_id: int, last_reset_date: Any) -> int:
    """Sum of tokens used since the subscription's last_reset_date (billing period start)."""
    if last_reset_date is None:
        return 0
    try:
        with payment_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT COALESCE(SUM(total_tokens), 0)::bigint AS tokens_month
                    FROM public.llm_usage_logs
                    WHERE user_id = %s
                      AND used_at >= %s::timestamptz
                    """,
                    (user_id, last_reset_date),
                )
                row = cur.fetchone()
        return int((dict(row) if row else {}).get("tokens_month") or 0)
    except Exception:
        return 0


# ── Plan limit resolution ─────────────────────────────────────────────────────

def _get_plan_limits(user_id: int) -> dict[str, Any]:
    """
    Returns plan limits for the user's active subscription.
    Prefers monthly_plans (new flow). Falls back to subscription_plans.
    Returns:
        monthly_limit    – tokens allowed per billing period (0 = no cap)
        topup_balance    – remaining top-up tokens (non-expiring or not yet expired)
        last_reset_date  – start of current billing period (for monthly sum)
    """
    try:
        with payment_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT
                      COALESCE(mp.monthly_tokens, sp.token_limit, 0) AS monthly_limit,
                      COALESCE(us.topup_token_balance, 0)            AS topup_balance,
                      us.topup_expires_at,
                      us.last_reset_date
                    FROM user_subscriptions us
                    LEFT JOIN monthly_plans mp ON mp.id = us.monthly_plan_id
                    LEFT JOIN subscription_plans sp ON sp.id = us.plan_id
                    WHERE us.user_id = %s
                      AND LOWER(COALESCE(us.status, 'active')) IN ('active', 'topup_only')
                    ORDER BY us.updated_at DESC NULLS LAST
                    LIMIT 1
                    """,
                    (user_id,),
                )
                row = cur.fetchone()
    except Exception:
        return {"monthly_limit": 0, "topup_balance": 0, "last_reset_date": None}

    if not row:
        return {"monthly_limit": 0, "topup_balance": 0, "last_reset_date": None}

    r = dict(row)
    monthly_limit = int(r.get("monthly_limit") or 0)
    topup_balance = int(r.get("topup_balance") or 0)
    last_reset_date = r.get("last_reset_date")

    topup_expires = r.get("topup_expires_at")
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


# ── Policy assertion ──────────────────────────────────────────────────────────

def assert_chat_allowed(user_id: int, cfg: dict[str, Any]) -> dict[str, Any]:
    return {"ok": True}


# ── Upload policy helpers (unchanged) ─────────────────────────────────────────

def get_user_upload_count_today(user_id: str | int) -> int:
    from app.services.db import doc_conn
    uid = str(user_id)
    with doc_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT COUNT(*)::int AS c FROM user_files
                WHERE user_id = %s
                  AND (is_folder IS NULL OR is_folder = false)
                  AND created_at > now() - interval '24 hours'
                """,
                (uid,),
            )
            row = cur.fetchone()
    return int((dict(row) if row else {}).get("c") or 0)


async def assert_upload_allowed(
    user_id: str | int,
    cfg: dict[str, Any],
    *,
    size_bytes: int,
    buffer: bytes | None = None,
    mimetype: str = "",
    originalname: str = "",
) -> dict[str, Any]:
    max_mb = int(_num(cfg.get("max_document_size_mb")))
    if max_mb > 0 and size_bytes > max_mb * 1024 * 1024:
        return {
            "ok": False,
            "code": "FILE_TOO_LARGE",
            "message": f"File exceeds maximum size of {max_mb} MB.",
            "details": {"max_mb": max_mb, "size_bytes": size_bytes},
        }

    max_uploads = int(_num(cfg.get("max_file_upload_per_day")))
    if max_uploads > 0:
        count = get_user_upload_count_today(user_id)
        if count >= max_uploads:
            return {
                "ok": False,
                "code": "DAILY_UPLOAD_LIMIT",
                "message": f"Maximum file uploads in the last 24 hours ({max_uploads}) reached.",
                "details": {"limit_per_24h": max_uploads, "used_last_24h": count},
            }

    max_pages = int(_num(cfg.get("max_document_pages")))
    mime = (mimetype or "").lower()
    name = (originalname or "").lower()
    is_pdf = mime == "application/pdf" or name.endswith(".pdf")
    if max_pages > 0 and is_pdf and buffer:
        try:
            import io
            from pypdf import PdfReader
            reader = PdfReader(io.BytesIO(buffer))
            pages = len(reader.pages)
            if pages > max_pages:
                return {
                    "ok": False,
                    "code": "DOCUMENT_TOO_MANY_PAGES",
                    "message": f"Document has {pages} pages; maximum allowed is {max_pages}.",
                    "details": {"max_pages": max_pages, "pages": pages},
                }
        except Exception as exc:
            return {
                "ok": False,
                "code": "PDF_INVALID",
                "message": "Could not read this PDF (invalid or corrupted).",
                "details": {"error": str(exc)},
            }

    return {"ok": True}


def assert_stored_file_meets_limits(file_row: dict[str, Any], cfg: dict[str, Any]) -> dict[str, Any]:
    max_mb = int(_num(cfg.get("max_document_size_mb")))
    size_bytes = int(file_row.get("size") or 0)
    if max_mb > 0 and size_bytes > max_mb * 1024 * 1024:
        return {
            "ok": False,
            "code": "FILE_TOO_LARGE",
            "message": f"File exceeds maximum size of {max_mb} MB.",
            "details": {"max_document_size_mb": max_mb},
        }
    return {"ok": True}
