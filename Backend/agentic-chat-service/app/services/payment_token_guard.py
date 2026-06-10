"""
Central token guard — calls payment-service before LLM tasks.
"""
from __future__ import annotations

import base64
import json
import logging
import os
from typing import Any, Optional

import httpx

logger = logging.getLogger(__name__)

PAYMENT_SERVICE_URL = (os.environ.get("PAYMENT_SERVICE_URL") or "http://localhost:5003").rstrip("/")
SERVICE_NAME = os.environ.get("SERVICE_NAME", "agentic-chat-service")
FAIL_OPEN = os.environ.get("TOKEN_CHECK_FAIL_OPEN", "false").lower() == "true"


# Exact POST paths that trigger LLM consumption and must be quota-checked.
# Upload, utility, and session-management routes are intentionally excluded.
_LLM_CONSUMING_POST_PATHS: frozenset[str] = frozenset({
    "/api/chat/ask",
    "/api/chat/ask/stream",
    "/api/chat/ask/general/stream",
    "/api/chat/cache/ask",
    "/api/chat/cache/ask/stream",
    "/api/chat/cache/create",
})


def is_llm_consuming_request(method: str, path: str) -> bool:
    if method.upper() != "POST":
        return False
    return path.rstrip("/") in _LLM_CONSUMING_POST_PATHS


def extract_user_id_from_request(request) -> Optional[str]:
    x_user_id = request.headers.get("x-user-id")
    if x_user_id:
        return str(x_user_id).strip()
    authorization = request.headers.get("authorization") or ""
    if not authorization.lower().startswith("bearer "):
        return None
    token = authorization.split(" ", 1)[1].strip()
    try:
        parts = token.split(".")
        if len(parts) != 3:
            return None
        payload = parts[1]
        payload += "=" * ((4 - len(payload) % 4) % 4)
        decoded = json.loads(base64.urlsafe_b64decode(payload.encode("utf-8")).decode("utf-8"))
        user_id = decoded.get("id") or decoded.get("userId") or decoded.get("user_id") or decoded.get("sub")
        return str(user_id) if user_id is not None else None
    except Exception:
        return None


def _fallback_allow() -> dict[str, Any]:
    if FAIL_OPEN:
        return {"ok": True, "source": "fail_open"}
    return {
        "ok": False,
        "code": "TOKEN_CHECK_UNAVAILABLE",
        "message": "Unable to verify token availability. Please try again shortly.",
        "details": {},
    }


def check_token_availability(
    user_id: str | int,
    *,
    estimated_tokens: int = 0,
    endpoint: str | None = None,
    service: str | None = None,
    check_firm_cap: bool = True,
) -> dict[str, Any]:
    uid = int(user_id)
    if uid <= 0:
        return {"ok": False, "code": "INVALID_USER", "message": "Valid user id is required."}

    url = f"{PAYMENT_SERVICE_URL}/api/user-resources/internal/token-check"
    try:
        resp = httpx.post(
            url,
            json={
                "userId": uid,
                "estimatedTokens": max(0, int(estimated_tokens or 0)),
                "service": service or SERVICE_NAME,
                "endpoint": endpoint,
                "checkFirmCap": check_firm_cap,
            },
            headers={"x-internal-service": service or SERVICE_NAME},
            timeout=8.0,
        )

        if resp.status_code == 404 or resp.status_code >= 500:
            logger.warning(
                "[PaymentTokenGuard] %s status=%s — using fallback",
                url,
                resp.status_code,
            )
            return _fallback_allow()

        try:
            payload = resp.json() if resp.content else {}
        except json.JSONDecodeError:
            return _fallback_allow()

        data = payload.get("data") or payload
        if resp.status_code == 429 or data.get("allowed") is False:
            return {
                "ok": False,
                "code": data.get("code") or "TOKEN_LIMIT_EXHAUSTED",
                "message": data.get("message") or "Token limit reached.",
                "details": data,
            }
        if data.get("allowed") or resp.status_code == 200:
            return {"ok": True, "source": data.get("source"), "details": data}
        return _fallback_allow()
    except (httpx.ConnectError, httpx.TimeoutException) as exc:
        logger.warning("[PaymentTokenGuard] payment-service unreachable: %s", exc)
        return _fallback_allow()
    except Exception as exc:
        logger.warning("[PaymentTokenGuard] check failed: %s", exc)
        return _fallback_allow()


def quota_block_status(result: dict[str, Any]) -> int:
    return 503 if result.get("code") == "TOKEN_CHECK_UNAVAILABLE" else 429


def quota_block_body(result: dict[str, Any]) -> dict[str, Any]:
    return {
        "success": False,
        "code": result.get("code"),
        "message": result.get("message"),
        "details": result.get("details") or {},
    }
