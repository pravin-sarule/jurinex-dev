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


class LLMChatPolicyMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: Callable[[Request], Response]) -> Response:
        user_id = _resolve_user_id_from_request(request)
        # Per-user merge from summarization_chat_config; cache TTL via SUMMARIZATION_CHAT_CONFIG_CACHE_SECONDS (0 = always DB).
        config = get_llm_chat_config(user_id=user_id, force_refresh=False)
        request.state.llm_chat_config = config
        request.state.user_id = user_id

        # Let CORS preflight requests pass through untouched so CORSMiddleware can
        # return the correct Access-Control-* headers.
        if request.method.upper() == "OPTIONS":
            return await call_next(request)

        path = request.url.path
        if path.startswith("/api/files/") and (
            path.endswith("/intelligent-chat") or path.endswith("/intelligent-chat/stream")
        ):
            user_id = request.state.user_id
            if not user_id:
                return JSONResponse(status_code=401, content={"success": False, "message": "Authentication required"})
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
