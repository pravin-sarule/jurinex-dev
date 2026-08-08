"""Caller identity — the verified JWT is the identity of record.

authservice signs HS256 tokens with the shared JWT_SECRET; the payload
carries the numeric user id as `id` (older tokens: `userId`). Rules:

- A valid Bearer token wins, always — its id claim is the caller.
- When verification is available (JWT_SECRET set + PyJWT installed), the
  spoofable X-User-Id header / body ids are NEVER trusted on their own:
  a caller without a valid token is anonymous.
- Without JWT_SECRET (local dev, offline tests), legacy X-User-Id header
  scoping applies unchanged.
"""

from __future__ import annotations

import logging

from fastapi import Request

from config import get_settings

logger = logging.getLogger("judgement.auth")

_warned_no_pyjwt = False


def _jwt_secret() -> str | None:
    return get_settings().jwt_secret


def _pyjwt():
    global _warned_no_pyjwt
    try:
        import jwt as pyjwt
        return pyjwt
    except ImportError:
        if not _warned_no_pyjwt:
            logger.warning("[auth] PyJWT not installed — token verification "
                           "unavailable, falling back to X-User-Id scoping")
            _warned_no_pyjwt = True
        return None


def jwt_verification_enabled() -> bool:
    return bool(_jwt_secret()) and _pyjwt() is not None


def _decode_bearer(auth_header: str | None) -> dict | None:
    if not auth_header:
        return None
    parts = auth_header.strip().split(maxsplit=1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None
    secret = _jwt_secret()
    pyjwt = _pyjwt()
    if not secret or pyjwt is None:
        return None
    try:
        return pyjwt.decode(parts[1], secret, algorithms=["HS256"],
                            options={"verify_exp": True})
    except Exception as exc:  # expired / malformed / foreign-signature tokens
        logger.debug("[auth] JWT rejected: %s", exc)
        return None


def resolve_user_id(request: Request, fallback: str | None = None) -> str | None:
    """The caller's user id (as a string) for ownership scoping."""
    payload = _decode_bearer(request.headers.get("authorization"))
    if payload:
        uid = payload.get("id") or payload.get("userId") or payload.get("user_id")
        if uid is not None:
            return str(uid)
    if jwt_verification_enabled():
        # Verification is on: unauthenticated ids are ignored outright.
        return None
    header = request.headers.get("x-user-id")
    if header:
        return str(header)
    return str(fallback) if fallback else None
