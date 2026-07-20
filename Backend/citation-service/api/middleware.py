from __future__ import annotations

import logging
import time
import uuid
from datetime import datetime, timezone

from fastapi import Request

logger = logging.getLogger("citation.api")


async def structured_request_logging(request: Request, call_next):
    started = time.monotonic()
    request_id = request.headers.get("x-run-id") or request.headers.get("x-request-id") or str(uuid.uuid4())
    details = {
        "run_id": request_id,
        "endpoint": request.url.path,
        "method": request.method,
        "user_id": request.headers.get("x-user-id", ""),
        "workspace_id": request.headers.get("x-workspace-id", ""),
        "request_time": datetime.now(timezone.utc).isoformat(),
    }
    logger.info("API_REQUEST", extra={"details": details})
    try:
        response = await call_next(request)
    except Exception as exc:
        logger.exception("API_ERROR", extra={"details": {**details, "error_type": type(exc).__name__, "message": str(exc)}})
        raise
    details["run_id"] = getattr(request.state, "run_id", request_id)
    details.update({
        "response_time": datetime.now(timezone.utc).isoformat(),
        "duration_seconds": round(time.monotonic() - started, 4),
        "status_code": response.status_code,
    })
    response.headers["X-Request-ID"] = request_id
    logger.info("API_RESPONSE", extra={"details": details})
    return response
