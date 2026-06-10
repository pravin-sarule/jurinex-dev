"""
storage_policy.py — Cumulative storage quota enforcement for agentic-chat-service.

Checks whether a user has exceeded their plan's storage_limit_gb before
any file is written to GCS or saved to the database.

Returns {"ok": True} when the upload is allowed, or
        {"ok": False, "code": "STORAGE_LIMIT_EXCEEDED", "message": "..."} when not.

Fails OPEN (allows upload) on any DB connection error so a transient
outage doesn't permanently block users.
"""

from __future__ import annotations

import logging
import os
from typing import Any, Dict

logger = logging.getLogger(__name__)


def _doc_conn():
    import psycopg2
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise ValueError("DATABASE_URL is not set")
    return psycopg2.connect(url)


def _payment_conn():
    import psycopg2
    url = os.environ.get("PAYMENT_DB_URL")
    if not url:
        raise ValueError("PAYMENT_DB_URL is not set")
    return psycopg2.connect(url)


def assert_storage_allowed(user_id: str | int, size_bytes: int = 0) -> Dict[str, Any]:
    """
    Returns {"ok": True} if adding size_bytes would stay within the user's
    plan storage limit, or {"ok": False, ...} if it would exceed it.
    """
    if not user_id:
        return {"ok": True}

    uid = str(user_id)

    # ── 1. Current storage used (Document_DB → user_files) ───────────────────
    storage_used_bytes = 0
    try:
        conn = _doc_conn()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """SELECT COALESCE(SUM(size), 0)::bigint
                       FROM user_files
                       WHERE user_id = %s
                         AND (is_folder IS NULL OR is_folder = FALSE)""",
                    (uid,),
                )
                row = cur.fetchone()
                storage_used_bytes = int(row[0]) if row else 0
        finally:
            conn.close()
    except Exception as exc:
        logger.warning("[storage_policy] doc-db query failed for user %s: %s", uid, exc)
        return {"ok": True}   # fail open

    # ── 2. Plan storage limit (Payment_DB → monthly_plans) ───────────────────
    storage_limit_gb = 0.0
    try:
        conn = _payment_conn()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """SELECT COALESCE(mp.storage_limit_gb, sp.storage_limit_gb, 0)::numeric
                       FROM user_subscriptions us
                       LEFT JOIN monthly_plans      mp ON mp.id = us.monthly_plan_id
                                                      AND mp.is_active = TRUE
                       LEFT JOIN subscription_plans sp ON sp.id = us.plan_id
                       WHERE us.user_id::text = %s
                         AND LOWER(COALESCE(us.status, 'active')) = 'active'
                         AND (us.end_date IS NULL OR us.end_date >= CURRENT_DATE)
                       LIMIT 1""",
                    (uid,),
                )
                row = cur.fetchone()
                if row and row[0]:
                    storage_limit_gb = float(row[0])
        finally:
            conn.close()
    except Exception as exc:
        logger.warning("[storage_policy] payment-db query failed for user %s: %s", uid, exc)
        return {"ok": True}   # fail open

    # 0 means unlimited
    if storage_limit_gb <= 0:
        return {"ok": True}

    storage_limit_bytes = storage_limit_gb * (1024 ** 3)
    used_after = storage_used_bytes + size_bytes

    if used_after > storage_limit_bytes:
        used_gb  = storage_used_bytes / (1024 ** 3)
        extra_gb = size_bytes / (1024 ** 3)
        overage  = max(0, used_after - storage_limit_bytes)
        return {
            "ok": False,
            "code": "STORAGE_LIMIT_EXCEEDED",
            "message": (
                f"Your storage is full. You have used {used_gb:.2f} GB of your "
                f"{storage_limit_gb:.2f} GB plan limit. "
                f"This upload ({extra_gb:.3f} GB) would exceed your quota. "
                "Please delete some files or upgrade your plan to continue."
            ),
            "details": {
                "storage_used_bytes":  storage_used_bytes,
                "storage_limit_gb":    storage_limit_gb,
                "upload_size_bytes":   size_bytes,
                "overage_bytes":       int(overage),
            },
        }

    return {"ok": True}
