from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parents[2]
CHAT_MODEL_ENV = BASE_DIR.parent / "ChatModel" / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(BASE_DIR / ".env", CHAT_MODEL_ENV),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
        env_ignore_empty=True,
    )

    service_name: str = "agentic-chat-service"
    host: str = "0.0.0.0"
    port: int = Field(default=8096, validation_alias=AliasChoices("PORT", "AGENTIC_CHAT_SERVICE_PORT"))
    log_level: str = "INFO"
    cors_origins: list[str] = Field(
        default_factory=lambda: [
            "http://localhost:3000",
            "http://localhost:5173",
            "http://localhost:5000",
            "http://ailearn.co.in",
            "http://www.ailearn.co.in",
            "https://ailearn.co.in",
            "https://www.ailearn.co.in",
            "https://nexintelagent.netlify.app",
        ],
        validation_alias=AliasChoices("CORS_ORIGINS"),
    )

    jwt_secret: str = Field(default="", validation_alias=AliasChoices("JWT_SECRET"))
    database_url: str = Field(default="", validation_alias=AliasChoices("DATABASE_URL"))
    payment_db_url: str = Field(default="", validation_alias=AliasChoices("PAYMENT_DB_URL"))
    payment_service_url: str = Field(
        default="http://localhost:5003",
        validation_alias=AliasChoices("PAYMENT_SERVICE_URL"),
    )
    auth_service_url: str = Field(default="", validation_alias=AliasChoices("AUTH_SERVICE_URL"))

    gcs_bucket_name: str = Field(default="", validation_alias=AliasChoices("GCS_BUCKET_NAME"))
    gcs_output_bucket_name: str = Field(
        default="", validation_alias=AliasChoices("GCS_OUTPUT_BUCKET_NAME")
    )
    gcs_key_base64: str = Field(default="", validation_alias=AliasChoices("GCS_KEY_BASE64"))
    gcloud_project_id: str = Field(
        default="", validation_alias=AliasChoices("GCLOUD_PROJECT_ID", "GCP_PROJECT_ID")
    )
    gcp_location: str = Field(default="us-central1", validation_alias=AliasChoices("GCP_LOCATION"))
    gemini_api_key: str = Field(default="", validation_alias=AliasChoices("GEMINI_API_KEY"))
    adk_model: str = Field(default="gemini-2.5-pro", validation_alias=AliasChoices("ADK_MODEL"))

    # ── Free-tier DeepSeek routing ────────────────────────────────────────────
    # When free_tier_deepseek_enabled is on, users on the named free plan have
    # general (non-file) chat routed to a DeepSeek model, with Gemini fallback.
    # Off by default → no behavior change. Mirrors the payment-service flag.
    deepseek_api_key: str = Field(default="", validation_alias=AliasChoices("DEEPSEEK_API_KEY"))
    deepseek_model: str = Field(
        default="deepseek-v4-flash", validation_alias=AliasChoices("DEEPSEEK_MODEL")
    )
    free_tier_deepseek_enabled: bool = Field(
        default=False, validation_alias=AliasChoices("FREE_TIER_DEEPSEEK_ENABLED")
    )
    free_plan_name: str = Field(default="free", validation_alias=AliasChoices("FREE_PLAN_NAME"))
    # Gemini explicit-cache lifetime. 5 minutes of inactivity auto-deletes the
    # cache; the next prompt transparently rebuilds it from the ADK session.
    context_cache_ttl_seconds: int = Field(
        default=300, validation_alias=AliasChoices("CONTEXT_CACHE_TTL_SECONDS", "GEMINI_CACHE_TTL_SECONDS")
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()
