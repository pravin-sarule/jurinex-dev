"""Resolve a user's active subscription plan from Payment_DB or the payment microservice."""
from __future__ import annotations

import logging
from typing import Any

import httpx

from app.core.config import get_settings

logger = logging.getLogger("agentic_document_service.payment_plan")

_ACTIVE_SUBSCRIPTION_SQL = """
    SELECT
        COALESCE(mp.id, sp.id) AS id,
        COALESCE(mp.name, sp.name) AS name,
        COALESCE(mp.monthly_tokens, sp.token_limit, 0) AS token_limit
    FROM user_subscriptions us
    LEFT JOIN monthly_plans mp ON mp.id = us.monthly_plan_id AND mp.is_active = true
    LEFT JOIN subscription_plans sp ON sp.id = us.plan_id
    WHERE us.user_id = %s
      AND LOWER(COALESCE(us.status, 'active')) = 'active'
      AND (us.end_date IS NULL OR us.end_date >= CURRENT_DATE)
      AND (mp.id IS NOT NULL OR sp.id IS NOT NULL)
    ORDER BY us.activated_at DESC NULLS LAST, us.start_date DESC NULLS LAST, us.updated_at DESC
    LIMIT 1
"""


def _normalize_plan_row(row: dict[str, Any]) -> dict[str, Any]:
    out = dict(row)
    plan_id = out.get("id") or out.get("plan_id")
    if plan_id is not None:
        out["id"] = int(plan_id)
        out["plan_id"] = int(plan_id)
    return out


def _fetch_plan_from_payment_db(uid_int: int) -> dict[str, Any] | None:
    try:
        from app.services.db import get_payment_db_connection, is_payment_db_available

        if not is_payment_db_available():
            return None
        with get_payment_db_connection() as conn, conn.cursor() as cur:
            cur.execute(_ACTIVE_SUBSCRIPTION_SQL, (uid_int,))
            row = cur.fetchone()
            if row:
                return _normalize_plan_row(dict(row))
    except Exception as exc:
        logger.warning("[PaymentPlan] DB lookup failed for user %s: %s", uid_int, exc)
    return None


def _fetch_plan_from_payment_api(uid_int: int, authorization: str | None = None) -> dict[str, Any] | None:
    settings = get_settings()
    base = str(getattr(settings, "payment_service_url", "") or "").rstrip("/")
    if not base:
        return None
    url = f"{base}/api/user-resources/user-plan/{uid_int}"
    headers: dict[str, str] = {}
    if authorization:
        headers["Authorization"] = authorization
    try:
        with httpx.Client(timeout=5.0) as client:
            resp = client.get(url, headers=headers)
        if resp.status_code == 404:
            return None
        if resp.status_code != 200:
            logger.warning(
                "[PaymentPlan] payment API %s returned %s for user %s",
                url,
                resp.status_code,
                uid_int,
            )
            return None
        body = resp.json()
        data = body.get("data") if isinstance(body, dict) else None
        if not isinstance(data, dict):
            return None
        plan_id = data.get("plan_id") or data.get("id")
        if plan_id is None:
            return None
        return _normalize_plan_row(
            {
                "id": int(plan_id),
                "plan_id": int(plan_id),
                "name": data.get("plan_name") or data.get("name"),
                "plan_name": data.get("plan_name") or data.get("name"),
                **data,
            }
        )
    except Exception as exc:
        logger.warning("[PaymentPlan] payment API lookup failed for user %s: %s", uid_int, exc)
    return None


def _fetch_plan_from_app_users_table(uid_int: int) -> dict[str, Any] | None:
    """Fallback: users.active_plan_id stored by payment-service via authservice sync."""
    try:
        from app.services.db import (
            get_db_connection,
            get_payment_db_connection,
            is_db_available,
            is_payment_db_available,
        )

        if not is_db_available():
            return None
        with get_db_connection() as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT active_plan_id, active_plan_name
                FROM users
                WHERE id = %s
                  AND active_plan_id IS NOT NULL
                LIMIT 1
                """,
                (uid_int,),
            )
            row = cur.fetchone()
            if not row or row.get("active_plan_id") is None:
                return None
            plan_id = int(row["active_plan_id"])
            plan_name = row.get("active_plan_name")
            if is_payment_db_available():
                with get_payment_db_connection() as pconn, pconn.cursor() as pcur:
                    pcur.execute(
                        "SELECT * FROM subscription_plans WHERE id = %s LIMIT 1",
                        (plan_id,),
                    )
                    plan_row = pcur.fetchone()
                    if plan_row:
                        return _normalize_plan_row(dict(plan_row))
            return _normalize_plan_row(
                {
                    "id": plan_id,
                    "plan_id": plan_id,
                    "name": plan_name,
                    "plan_name": plan_name,
                }
            )
    except Exception as exc:
        logger.debug("[PaymentPlan] users.active_plan_id lookup skipped for %s: %s", uid_int, exc)
    return None


def get_user_active_plan(
    uid_int: int,
    *,
    authorization: str | None = None,
) -> dict[str, Any] | None:
    """Return subscription_plans row for the user's active subscription, or None."""
    if uid_int <= 0:
        return None
    plan = _fetch_plan_from_payment_db(uid_int)
    if plan:
        return plan
    plan = _fetch_plan_from_payment_api(uid_int, authorization)
    if plan:
        return plan
    return _fetch_plan_from_app_users_table(uid_int)
