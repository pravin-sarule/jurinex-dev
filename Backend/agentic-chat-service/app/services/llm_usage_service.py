from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from app.services.db import payment_conn

logger = logging.getLogger(__name__)


async def log_llm_usage(
    *,
    user_id: int,
    model_name: str,
    input_tokens: int,
    output_tokens: int,
    total_tokens: int | None = None,
    endpoint: str | None = None,
    file_id: str | None = None,
    session_id: str | None = None,
) -> None:
    total = total_tokens if total_tokens is not None else (input_tokens + output_tokens)
    try:
        with payment_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO public.llm_usage_logs
                      (user_id, model_name, input_tokens, output_tokens, total_tokens, endpoint, file_id, session_id, used_at)
                    VALUES (%s, %s, %s, %s, %s, %s, %s::uuid, %s::uuid, NOW())
                    ON CONFLICT (user_id, model_name, used_date)
                    DO UPDATE SET
                      input_tokens  = llm_usage_logs.input_tokens  + EXCLUDED.input_tokens,
                      output_tokens = llm_usage_logs.output_tokens + EXCLUDED.output_tokens,
                      total_tokens  = llm_usage_logs.total_tokens  + EXCLUDED.total_tokens,
                      used_at       = NOW()
                    """,
                    (
                        user_id,
                        model_name,
                        input_tokens,
                        output_tokens,
                        total,
                        endpoint,
                        file_id,
                        session_id,
                    ),
                )
            conn.commit()
        _maybe_deduct_topup_after_usage(user_id, total)
    except Exception as exc:
        logger.error("Failed to log LLM usage: %s", exc)


def _maybe_deduct_topup_after_usage(user_id: int, tokens_added: int) -> None:
    """Deduct top-up balance for the portion of this request that exceeded the monthly allowance."""
    added = max(0, int(tokens_added or 0))
    if added <= 0:
        return
    try:
        with payment_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT
                      CASE WHEN (us.end_date IS NULL OR us.end_date >= CURRENT_DATE)
                           THEN COALESCE(mp.monthly_tokens, sp.token_limit, 0)
                           ELSE 0
                      END                                             AS monthly_limit,
                      COALESCE(us.topup_token_balance, 0)            AS topup_balance,
                      us.topup_expires_at,
                      COALESCE(us.last_reset_date, us.start_date)    AS billing_period_start
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
                sub = dict(cur.fetchone() or {})
                if not sub:
                    return

                monthly_limit = int(sub.get("monthly_limit") or 0)
                topup_balance = int(sub.get("topup_balance") or 0)
                billing_period_start = sub.get("billing_period_start")

                topup_expires = sub.get("topup_expires_at")
                if topup_expires:
                    if topup_expires.tzinfo is None:
                        topup_expires = topup_expires.replace(tzinfo=timezone.utc)
                    if topup_expires < datetime.now(timezone.utc):
                        return
                if topup_balance <= 0 or monthly_limit <= 0:
                    return

                cur.execute(
                    """
                    SELECT COALESCE(SUM(total_tokens), 0)::bigint AS tokens_period
                    FROM public.llm_usage_logs
                    WHERE user_id = %s
                      AND (%s::timestamptz IS NULL OR used_at >= %s::timestamptz)
                    """,
                    (user_id, billing_period_start, billing_period_start),
                )
                usage = dict(cur.fetchone() or {})
                tokens_period = int(usage.get("tokens_period") or 0)
                tokens_period_before = max(0, tokens_period - added)

                overage_after  = max(0, tokens_period - monthly_limit)
                overage_before = max(0, tokens_period_before - monthly_limit)
                deduct = overage_after - overage_before
                deduct = min(deduct, added, topup_balance)
                if deduct <= 0:
                    return

                cur.execute(
                    """
                    UPDATE user_subscriptions SET
                      topup_token_balance = GREATEST(0, topup_token_balance - %s),
                      updated_at = CURRENT_TIMESTAMP
                    WHERE user_id = %s
                      AND topup_token_balance > 0
                      AND (topup_expires_at IS NULL OR topup_expires_at > CURRENT_TIMESTAMP)
                    """,
                    (deduct, user_id),
                )
            conn.commit()
    except Exception as exc:
        logger.warning("Topup deduction failed: %s", exc)
