from __future__ import annotations

import logging
from typing import Any

import httpx

from app.core.config import get_settings

logger = logging.getLogger(__name__)


async def get_full_profile(user_id: str, authorization: str | None) -> dict[str, Any] | None:
    """
    Mirrors Node.js UserProfileService.getFullProfile():
      GET /api/auth/professional-profile  (auth header carries the JWT — no user_id in path)
    Response shape: { type, message, data: { fullname, email, phone, primary_role, ... } }
    Returns: { basic: { username, email, phone }, professional: { ...all_fields } }
    """
    base = (get_settings().auth_service_url or "").rstrip("/")
    if not base or not authorization:
        return None
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(
                f"{base}/api/auth/professional-profile",
                headers={"Authorization": authorization, "Content-Type": "application/json"},
            )
        if resp.status_code != 200:
            logger.warning("Profile fetch failed: HTTP %s for user %s", resp.status_code, user_id)
            return None

        payload = resp.json()
        data = payload.get("data") or {}

        if not data:
            logger.warning("professional-profile returned empty data for user %s", user_id)
            return {"basic": None, "professional": None}

        basic = {
            "username": data.get("fullname") or None,
            "email":    data.get("email")    or None,
            "phone":    data.get("phone")    or None,
        }
        professional = dict(data)

        logger.info(
            "[UserProfileService] Profile loaded for user %s — name=%s role=%s org=%s",
            user_id,
            basic.get("username") or "N/A",
            professional.get("primary_role") or "N/A",
            professional.get("organization_name") or "N/A",
        )
        return {"basic": basic, "professional": professional}

    except Exception as exc:
        logger.warning("Profile fetch failed for user %s: %s", user_id, exc)
        return None
