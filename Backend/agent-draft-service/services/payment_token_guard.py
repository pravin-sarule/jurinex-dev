"""
Central token guard — all Python backend services call payment-service before LLM work.
POST /api/user-resources/internal/token-check
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
SERVICE_NAME = os.environ.get("SERVICE_NAME", "agent-draft-service")
FAIL_OPEN = os.environ.get("TOKEN_CHECK_FAIL_OPEN", "false").lower() == "true"


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

    try:
        resp = httpx.post(
            f"{PAYMENT_SERVICE_URL}/api/user-resources/internal/token-check",
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
        payload = resp.json() if resp.content else {}
        data = payload.get("data") or {}
        allowed = bool(data.get("allowed"))
        if allowed:
            return {"ok": True, "source": data.get("source"), "details": data}
        return {
            "ok": False,
            "code": data.get("code") or "TOKEN_LIMIT_EXHAUSTED",
            "message": data.get("message") or "Token limit reached.",
            "details": data,
        }
    except Exception as exc:
        logger.warning("[PaymentTokenGuard] check failed: %s", exc)
        if FAIL_OPEN:
            return {"ok": True}
        return {
            "ok": False,
            "code": "TOKEN_CHECK_UNAVAILABLE",
            "message": "Unable to verify token availability. Please try again shortly.",
            "details": {"reason": str(exc)},
        }


def quota_block_status(result: dict[str, Any]) -> int:
    return 503 if result.get("code") == "TOKEN_CHECK_UNAVAILABLE" else 429


def quota_block_body(result: dict[str, Any]) -> dict[str, Any]:
    return {
        "success": False,
        "code": result.get("code"),
        "message": result.get("message"),
        "details": result.get("details") or {},
    }


def log_llm_usage(
    *,
    user_id: str | int,
    model_name: str,
    input_tokens: int = 0,
    output_tokens: int = 0,
    endpoint: str | None = None,
    request_id: str | None = None,
    file_id: str | None = None,
    session_id: str | None = None,
) -> None:
    uid = int(user_id)
    if uid <= 0 or not model_name:
        return
    it = max(0, int(input_tokens or 0))
    ot = max(0, int(output_tokens or 0))
    if it <= 0 and ot <= 0:
        return
    try:
        httpx.post(
            f"{PAYMENT_SERVICE_URL}/api/user-resources/llm-usage-log",
            json={
                "userId": uid,
                "modelName": str(model_name),
                "inputTokens": it,
                "outputTokens": ot,
                "endpoint": endpoint,
                "requestId": request_id,
                "fileId": file_id,
                "sessionId": session_id,
            },
            timeout=5.0,
        )
    except Exception as exc:
        logger.debug("[PaymentTokenGuard] usage log failed: %s", exc)
