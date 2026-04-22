"""
Resolve human-readable user labels from the auth service (same internal API as main.py bulk fetch).
Used when persisting citation_service_usage rows so reports and analytics show correct names.
"""

from __future__ import annotations

import logging
import os
from typing import Dict, Tuple

logger = logging.getLogger(__name__)

# Process-local cache: user_id str -> (display_name, username)
_cache: Dict[str, Tuple[str, str]] = {}


def _auth_base_url() -> str:
    return (os.environ.get("AUTH_SERVICE_URL") or "").strip().rstrip("/")


def _auth_base_candidates() -> list[str]:
    base = _auth_base_url()
    candidates = [base] if base else []
    if base and "/auth/api/auth" in base:
        candidates.append(base.replace("/auth/api/auth", "/api/auth"))
    # Preserve order while de-duping
    return list(dict.fromkeys([c for c in candidates if c]))


def _pick_display_name(user: dict) -> str:
    for key in ("full_name", "display_name", "name", "username", "email"):
        v = user.get(key)
        if v and str(v).strip():
            return str(v).strip()
    return ""


def resolve_user_display_and_username(user_id: str) -> Tuple[str, str]:
    """
    Returns (display_name, username) for storage alongside usage rows.
    Empty strings if anonymous, invalid id, auth URL missing, or lookup fails.
    """
    if not user_id or str(user_id).strip().lower() in ("anonymous", "0", "-", "none"):
        return "", ""
    key = str(user_id).strip()
    if key in _cache:
        return _cache[key]

    bases = _auth_base_candidates()
    if not bases:
        _cache[key] = ("", "")
        return "", ""

    try:
        uid_int = int(key)
    except (TypeError, ValueError):
        _cache[key] = ("", "")
        return "", ""

    headers = {}
    token = (os.environ.get("AUTH_SERVICE_INTERNAL_TOKEN") or os.environ.get("INTERNAL_SERVICE_TOKEN") or "").strip()
    if token:
        headers["Authorization"] = f"Bearer {token}"

    try:
        import httpx

        timeout = float(os.environ.get("AUTH_SERVICE_TIMEOUT_SECONDS", "3") or "3")
        with httpx.Client(timeout=timeout) as client:
            res = None
            for base in bases:
                url = f"{base}/internal/users/bulk?ids={uid_int}"
                res = client.get(url, headers=headers)
                if res.status_code == 200:
                    break
        if not res or res.status_code != 200:
            logger.debug("[auth_user_lookup] HTTP %s for user %s", getattr(res, "status_code", None), key)
            _cache[key] = ("", "")
            return "", ""
        users = res.json().get("users") or []
        if not users:
            _cache[key] = ("", "")
            return "", ""
        u = users[0]
        dn = _pick_display_name(u)
        un = (u.get("username") or u.get("email") or "").strip()
        if not dn:
            dn = un or key
        if not un:
            un = dn
        _cache[key] = (dn, un)
        return _cache[key]
    except Exception as exc:
        logger.debug("[auth_user_lookup] failed for %s: %s", key, exc)
        _cache[key] = ("", "")
        return "", ""
