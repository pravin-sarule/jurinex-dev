from __future__ import annotations

import logging
import logging.config
import time

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.core.config import get_settings
from app.api.routes import health, chat, audio, admin, demo

# Force our log format onto the root logger regardless of what uvicorn pre-configured
logging.config.dictConfig({
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "default": {
            "format": "%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
        }
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "default",
        }
    },
    "root": {
        "level": "DEBUG",
        "handlers": ["console"],
    },
    "loggers": {
        "ai_chatbot": {"level": "DEBUG", "propagate": True},
        "ai_chatbot.audio_route": {"level": "INFO", "propagate": True},
        "websockets.client": {"level": "WARNING"},
        "websockets.server": {"level": "WARNING"},
        "uvicorn.error": {"level": "DEBUG"},
        "uvicorn.access": {"level": "INFO"},
    },
})
logger = logging.getLogger("ai_chatbot")

app = FastAPI(
    title="Nexintel AI Support Chatbot",
    description=(
        "Text and audio support agent powered by Gemini. "
        "Answers are grounded in admin-uploaded documents via vector search."
    ),
    version="1.0.0",
)

settings = get_settings()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def _log_http_requests(request: Request, call_next):
    started = time.perf_counter()
    logger.info("HTTP START method=%s path=%s client=%s", request.method, request.url.path, request.client)
    try:
        response = await call_next(request)
        elapsed_ms = (time.perf_counter() - started) * 1000
        logger.info(
            "HTTP END method=%s path=%s status=%s elapsed_ms=%.2f",
            request.method,
            request.url.path,
            response.status_code,
            elapsed_ms,
        )
        return response
    except Exception:
        elapsed_ms = (time.perf_counter() - started) * 1000
        logger.exception(
            "HTTP ERROR method=%s path=%s elapsed_ms=%.2f",
            request.method,
            request.url.path,
            elapsed_ms,
        )
        raise


@app.exception_handler(Exception)
async def _global_error_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("Unhandled error on %s", request.url.path)
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})


app.include_router(health.router)
app.include_router(chat.router)
app.include_router(audio.router)
app.include_router(admin.router)
app.include_router(demo.router)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host=settings.host,
        port=settings.port,
        reload=(settings.environment == "development"),
        log_level=settings.log_level.lower(),
    )
