"""
Shared FastAPI dependencies (e.g. JWT auth). Use this module to avoid circular imports with app.
"""

from __future__ import annotations

from typing import Optional

from fastapi import Header, HTTPException


def require_user_id(authorization: Optional[str] = Header(None, alias="Authorization")) -> int:
    """
    Decode JWT from Authorization: Bearer <token> and return user id.
    All agent flows (ingest, retrieve, orchestrate, drafts) are user-specific; user_id from JWT only.
    """
    from services.jwt_auth import get_user_id_from_authorization
    user_id = get_user_id_from_authorization(authorization)
    if user_id is None:
        raise HTTPException(
            status_code=401,
            detail="Authorization required. Send Authorization: Bearer <JWT> (same token as authservice).",
        )
    return user_id


def optional_user_id(authorization: Optional[str] = Header(None, alias="Authorization")) -> Optional[int]:
    """
    Decode JWT and return user id if present; otherwise None.
    Use for endpoints that work with or without auth (e.g. template sections from Analyzer).
    """
    from services.jwt_auth import get_user_id_from_authorization
    return get_user_id_from_authorization(authorization)
