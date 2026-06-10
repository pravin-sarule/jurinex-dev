from __future__ import annotations

import base64
import json
from typing import Callable

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

from app.services.llm_chat_config import get_llm_chat_config
from app.services.llm_policy_service import assert_chat_allowed
from app.services.payment_token_guard import check_token_availability


def _resolve_user_id_from_request(request: Request) -> str | None:
    x_user_id = request.headers.get("x-user-id")
    if x_user_id:
        return x_user_id
    authorization = request.headers.get("authorization")
    if not authorization or not authorization.lower().startswith("bearer "):
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


# Paths that never need the LLM chat config — skip the DB load entirely for these.
_SKIP_LLM_CONFIG_PREFIXES = (
    "/api/batch/",
    "/api/branding/",
    "/health",
    "/docs",
    "/redoc",
    "/openapi",
)

_CHAT_PATH_SUFFIXES = ("/intelligent-chat", "/intelligent-chat/stream")


class LLMChatPolicyMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: Callable[[Request], Response]) -> Response:
        # Let CORS preflight requests pass through untouched so CORSMiddleware can
        # return the correct Access-Control-* headers.
        if request.method.upper() == "OPTIONS":
            return await call_next(request)

        user_id = _resolve_user_id_from_request(request)
        request.state.user_id = user_id
        request.state.llm_chat_config = None

        path = request.url.path

        # Only load the per-user LLM config for paths that actually enforce the chat policy.
        # Skipping it for batch, branding, health, and docs routes avoids unnecessary DB
        # round-trips and noisy summarization-config log lines on every request.
        is_chat_endpoint = path.startswith("/api/files/") and path.endswith(_CHAT_PATH_SUFFIXES)
        skip_config = any(path.startswith(prefix) for prefix in _SKIP_LLM_CONFIG_PREFIXES)

        if is_chat_endpoint and not skip_config:
            config = get_llm_chat_config(
                user_id=user_id,
                force_refresh=False,
                plan_limit_mode="summarization",
            )
            request.state.llm_chat_config = config

            if not user_id:
                return JSONResponse(status_code=401, content={"success": False, "message": "Authentication required"})
            token_check = check_token_availability(
                user_id,
                endpoint=path,
                service="agentic-document-service",
            )
            if not token_check.get("ok"):
                status_code = 503 if token_check.get("code") == "TOKEN_CHECK_UNAVAILABLE" else 429
                return JSONResponse(
                    status_code=status_code,
                    content={
                        "success": False,
                        "code": token_check.get("code"),
                        "message": token_check.get("message"),
                        "details": token_check.get("details") or {},
                    },
                )
            check = assert_chat_allowed(str(user_id), config)
            if not check.get("ok"):
                status_code = 503 if check.get("code") == "POLICY_CHECK_UNAVAILABLE" else 429
                return JSONResponse(
                    status_code=status_code,
                    content={
                        "success": False,
                        "code": check.get("code"),
                        "message": check.get("message"),
                        "details": check.get("details") or {},
                    },
                )

        return await call_next(request)
