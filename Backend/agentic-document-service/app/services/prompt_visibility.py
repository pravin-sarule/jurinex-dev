"""
Shared rules for showing secret prompts and preset prompts to a user.

A prompt is visible only when BOTH plan and role are configured on the prompt row
and BOTH match the authenticated user's active plan and role.
"""
from __future__ import annotations

from typing import Any, Iterable


def normalize_role_slug(raw_role: str | None) -> str | None:
    if not raw_role:
        return None
    normalized = str(raw_role).strip().lower().replace(" ", "_").replace("-", "_")
    if not normalized or normalized in {"user", "users"}:
        return None
    return normalized


def user_context_ready(user_plan_id: int | None, user_role: str | None) -> bool:
    return user_plan_id is not None and bool(user_role)


def preset_matches_user(
    allowed_roles: Iterable[str] | None,
    allowed_plan_ids: Iterable[int] | None,
    user_role: str | None,
    user_plan_id: int | None,
) -> bool:
    """Preset must define at least one role AND one plan; user must match both."""
    if not user_context_ready(user_plan_id, user_role):
        return False

    roles = [normalize_role_slug(r) for r in (allowed_roles or []) if r]
    plan_ids = [int(p) for p in (allowed_plan_ids or []) if p is not None]

    if not roles or not plan_ids:
        return False

    normalized_user_role = normalize_role_slug(user_role)
    if not normalized_user_role:
        return False

    return normalized_user_role in roles and int(user_plan_id) in plan_ids


def secret_sql_filters() -> tuple[str, str]:
    """
    Returns (plan_clause, role_clause) for secret_manager queries.
    Caller supplies params: [user_plan_id, user_role_id].
    NULL role_id means no role restriction — visible to any user with matching plan.
    """
    plan_clause = "s.plan_id IS NOT NULL AND s.plan_id = %s"
    role_clause = "(s.role_id IS NULL OR s.role_id::text = %s)"
    return plan_clause, role_clause
