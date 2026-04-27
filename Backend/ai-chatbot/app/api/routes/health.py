import importlib.metadata
from pathlib import Path

from fastapi import APIRouter

from app.core.config import get_settings
from app.services import chatbot
from app.services.db import is_db_available

router = APIRouter(tags=["health"])


@router.get("/health")
def health_check():
    settings = get_settings()
    try:
        google_genai_version = importlib.metadata.version("google-genai")
    except importlib.metadata.PackageNotFoundError:
        google_genai_version = None

    return {
        "status": "ok",
        "db": is_db_available(),
        "service": "ai-chatbot",
        "port": settings.port,
        "chatbot_module": str(Path(chatbot.__file__).resolve()),
        "google_genai_version": google_genai_version,
        "min_live_google_genai_version": "1.60.0",
    }
