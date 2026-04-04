from __future__ import annotations

import logging
import sys

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes.cases import router as cases_router
from app.api.routes.content import router as content_router
from app.api.routes.files import router as files_router
from app.api.routes.health import router as health_router
from app.api.routes.summarization_config_admin import router as summarization_config_admin_router
from app.core.config import BASE_DIR, get_settings
from app.core.logging import configure_logging
from app.middleware.llm_chat_policy import LLMChatPolicyMiddleware


logger = logging.getLogger(__name__)
settings = get_settings()
configure_logging(settings.log_level)
logger.info(
    "Agentic Document Service config loaded: port=%s legacy_document_service_url=%s adk_model=%s",
    settings.port,
    settings.legacy_document_service_url,
    settings.adk_model,
)


def create_app() -> FastAPI:
    app = FastAPI(
        title="Agentic Document Service",
        description=(
            "Python FastAPI service for legal case intake, ingestion, grounded retrieval, "
            "and preset execution, backed by a Google ADK agent package."
        ),
        version=settings.version,
    )

    app.add_middleware(LLMChatPolicyMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?",
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(health_router)
    app.include_router(summarization_config_admin_router)
    app.include_router(cases_router)
    app.include_router(content_router)
    app.include_router(files_router)
    if settings.enable_legacy_proxy:
        from app.api.routes.legacy_proxy import router as legacy_proxy_router

        app.include_router(legacy_proxy_router)
        logger.warning(
            "Legacy proxy is enabled. Requests may still depend on the old document-service at %s",
            settings.legacy_document_service_url,
        )
    else:
        logger.info("Legacy proxy is disabled. FastAPI is running in standalone agentic mode.")

    if settings.enable_adk_runtime:
        _mount_adk_runtime(app)

    @app.get("/")
    def root() -> dict[str, str]:
        return {
            "service": settings.service_name,
            "docs": "/docs",
            "health": "/health",
            "adk": "/adk",
        }

    return app


def _mount_adk_runtime(app: FastAPI) -> None:
    if sys.version_info >= (3, 14):
        logger.warning(
            "Skipping Google ADK runtime mount on Python %s.%s because the current "
            "google-adk/grpc stack is not stable on this interpreter yet.",
            sys.version_info.major,
            sys.version_info.minor,
        )
        return

    try:
        from google.adk.cli.fast_api import get_fast_api_app
    except Exception as exc:
        logger.warning("Unable to import Google ADK runtime; skipping mount: %s", exc)
        return

    try:
        adk_app = get_fast_api_app(agents_dir=str(BASE_DIR / "agents"))
        app.mount("/adk", adk_app)
        logger.info("Mounted Google ADK runtime at /adk")
    except Exception as exc:  # pragma: no cover
        logger.warning("Unable to mount Google ADK runtime: %s", exc)


app = create_app()


if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.environment.lower() == "development",
    )
