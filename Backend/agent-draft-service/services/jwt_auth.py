"""
JWT decode for agent-draft-service. Compatible with authservice (same secret, same payload).

Expects: Authorization: Bearer <token>
Payload from authservice: { id: numericId, user_uuid: str, email: str }.
We use id as user_id for user-specific and document-specific retrieval (user_files.user_id).
"""

from __future__ import annotations

import logging
import os
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)


def get_jwt_secret() -> str:
    secret = os.environ.get("JWT_SECRET")
    if not secret:
        raise ValueError("JWT_SECRET must be set for authenticated endpoints")
    return secret


def decode_token(token: str) -> Optional[Dict[str, Any]]:
    """
    Decode and verify JWT using JWT_SECRET (same as authservice).
    Returns payload dict or None if invalid/expired.
    """
    if not token or not token.strip():
        return None
    try:
        import jwt as pyjwt
    except ImportError:
        logger.warning("PyJWT not installed; JWT auth disabled")
        return None
    secret = os.environ.get("JWT_SECRET")
    if not secret:
        logger.warning("JWT_SECRET not set; JWT auth disabled")
        return None
    try:
        payload = pyjwt.decode(
            token.strip(),
            secret,
            algorithms=["HS256"],
            options={"verify_exp": True},
        )
        return payload
    except Exception as e:
        logger.debug("JWT decode failed: %s", e)
        return None


def get_user_id_from_token(token: str) -> Optional[int]:
    """
    Extract user id (numeric) from JWT payload. Same as authservice: decoded.id.
    Used to scope ingestion and retrieval to that user's documents only.
    """
    payload = decode_token(token)
    if not payload:
        return None
    uid = payload.get("id") or payload.get("userId")
    if uid is None:
        return None
    try:
        return int(uid)
    except (TypeError, ValueError):
        return None


def get_user_id_from_authorization(auth_header: Optional[str]) -> Optional[int]:
    """
    From Authorization: Bearer <token> header, decode JWT and return user id.
    Returns None if missing or invalid.
    """
    if not auth_header or not auth_header.strip().startswith("Bearer "):
        return None
    token = auth_header.strip().split(maxsplit=1)[1]
    return get_user_id_from_token(token)
