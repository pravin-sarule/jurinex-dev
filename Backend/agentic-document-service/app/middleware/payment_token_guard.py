"""HTTP middleware — verify token availability via payment-service before LLM routes."""
from __future__ import annotations

from typing import Callable

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

from app.services.payment_token_guard import (
    check_token_availability,
    extract_user_id_from_request,
    is_llm_consuming_request,
    quota_block_body,
    quota_block_status,
)


class PaymentTokenGuardMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: Callable[[Request], Response]) -> Response:
        if request.method.upper() == "OPTIONS":
            return await call_next(request)

        path = request.url.path
        if not is_llm_consuming_request(request.method, path):
            return await call_next(request)

        user_id = extract_user_id_from_request(request) or getattr(request.state, "user_id", None)
        if not user_id:
            return JSONResponse(
                status_code=401,
                content={"success": False, "message": "Authentication required"},
            )

        result = check_token_availability(
            user_id,
            endpoint=path,
            service="agentic-document-service",
        )
        if not result.get("ok"):
            return JSONResponse(
                status_code=quota_block_status(result),
                content=quota_block_body(result),
            )

        return await call_next(request)
