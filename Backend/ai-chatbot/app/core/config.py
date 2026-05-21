from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings

# Always load Backend/ai-chatbot/.env regardless of process working directory.
_ENV_FILE = Path(__file__).resolve().parents[2] / ".env"


class Settings(BaseSettings):
    database_url: str = Field("", alias="DATABASE_URL")
    gemini_api_key: str = Field("", alias="GEMINI_API_KEY")
    port: int = Field(8095, alias="PORT")
    host: str = Field("0.0.0.0", alias="HOST")
    environment: str = Field("development", alias="ENVIRONMENT")
    log_level: str = Field("INFO", alias="LOG_LEVEL")

    # DB connection pool — per worker process
    # With 4 gunicorn workers × 10 max = 40 connections per instance
    db_pool_min_size: int = Field(2, alias="DB_POOL_MIN_SIZE")
    db_pool_max_size: int = Field(10, alias="DB_POOL_MAX_SIZE")

    # Comma-separated allowed CORS origins. Use "*" to allow all (dev only).
    cors_origins: str = Field("*", alias="CORS_ORIGINS")

    # Rate limit for POST /api/chat — slowapi format e.g. "20/minute"
    rate_limit_chat: str = Field("20/minute", alias="RATE_LIMIT_CHAT")

    # Google Calendar integration for demo bookings
    google_service_account_json: str = Field("", alias="GOOGLE_SERVICE_ACCOUNT_JSON")
    google_calendar_id: str = Field("primary", alias="GOOGLE_CALENDAR_ID")
    google_calendar_tz: str = Field("UTC", alias="GOOGLE_CALENDAR_TZ")
    # Domain-Wide Delegation: only needed for personal calendars, leave blank for group calendars
    google_calendar_subject: str = Field("", alias="GOOGLE_CALENDAR_SUBJECT")

    model_config = {
        "env_file": str(_ENV_FILE),
        "env_file_encoding": "utf-8",
        "populate_by_name": True,
    }


@lru_cache
def get_settings() -> Settings:
    return Settings()
