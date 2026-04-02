from __future__ import annotations

from typing import Iterable

import httpx
from fastapi import APIRouter, Request, Response
from fastapi.responses import JSONResponse

from app.core.config import get_settings


router = APIRouter(tags=["legacy-proxy"])
settings = get_settings()

HOP_BY_HOP_HEADERS = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
    "host",
    "content-length",
}


def _filter_headers(headers: Iterable[tuple[str, str]]) -> dict[str, str]:
    return {
        key: value
        for key, value in headers
        if key.lower() not in HOP_BY_HOP_HEADERS
    }


async def _proxy_to_legacy(request: Request, target_path: str) -> Response:
    base_url = settings.legacy_document_service_url.rstrip("/")
    query = request.url.query
    url = f"{base_url}{target_path}"
    if query:
        url = f"{url}?{query}"

    body = await request.body()
    headers = _filter_headers(request.headers.items())

    try:
        async with httpx.AsyncClient(timeout=settings.proxy_timeout_seconds, follow_redirects=True) as client:
            upstream_response = await client.request(
                method=request.method,
                url=url,
                content=body,
                headers=headers,
            )
    except httpx.RequestError as exc:
        return JSONResponse(
            status_code=503,
            content={
                "success": False,
                "error": "legacy_document_service_unavailable",
                "message": (
                    "The legacy document-service is not reachable. "
                    "Start the Node document-service or set LEGACY_DOCUMENT_SERVICE_URL correctly."
                ),
                "target_url": url,
                "details": str(exc),
            },
        )

    response_headers = _filter_headers(upstream_response.headers.items())
    return Response(
        content=upstream_response.content,
        status_code=upstream_response.status_code,
        headers=response_headers,
        media_type=upstream_response.headers.get("content-type"),
    )


@router.api_route("/api/files", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
@router.api_route("/api/files/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
async def proxy_files(request: Request, path: str = "") -> Response:
    suffix = f"/{path}" if path else ""
    return await _proxy_to_legacy(request, f"/api/files{suffix}")


@router.api_route("/api/content", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
@router.api_route("/api/content/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
async def proxy_content(request: Request, path: str = "") -> Response:
    suffix = f"/{path}" if path else ""
    return await _proxy_to_legacy(request, f"/api/content{suffix}")


@router.api_route("/api/mindmap", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
@router.api_route("/api/mindmap/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
async def proxy_mindmap(request: Request, path: str = "") -> Response:
    suffix = f"/{path}" if path else ""
    return await _proxy_to_legacy(request, f"/api/mindmap{suffix}")


@router.api_route("/api/llm-models", methods=["GET"])
async def proxy_llm_models(request: Request) -> Response:
    return await _proxy_to_legacy(request, "/api/llm-models")
