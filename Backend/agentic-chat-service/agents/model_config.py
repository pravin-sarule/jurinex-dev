"""Shared ADK / cache model selection."""
from __future__ import annotations

from app.core.config import get_settings
from app.services.gemini_pricing import DEFAULT_CACHE_MODEL


def get_adk_model() -> str:
    return (get_settings().adk_model or DEFAULT_CACHE_MODEL).strip()
