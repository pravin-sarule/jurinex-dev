from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from pydantic import AliasChoices, Field
from pydantic import field_validator
from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


BASE_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(BASE_DIR / ".env",),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    service_name: str = Field(
        default="agentic-document-service",
        validation_alias=AliasChoices("SERVICE_NAME"),
    )
    environment: str = "development"
    version: str = "1.0.0"
    host: str = "0.0.0.0"
    port: int = Field(
        default=8092,
        validation_alias=AliasChoices("PORT", "AGENTIC_DOCUMENT_SERVICE_PORT", "SERVICE_PORT"),
    )
    log_level: str = "INFO"
    cors_origins: list[str] = Field(
        validation_alias=AliasChoices("CORS_ORIGINS"),
        default_factory=lambda: [
            "http://localhost:3000",
            "http://localhost:5173",
            "http://localhost:5000",
            "http://127.0.0.1:3000",
            "http://127.0.0.1:5173",
            "http://127.0.0.1:5000",
            "https://jurinex.netlify.app",
            "https://jurinex-dev.netlify.app",
            "https://nexintel.netlify.app",
        ]
    )
    enable_adk_runtime: bool = True
    enable_legacy_proxy: bool = False

    database_url: str = Field(default="", validation_alias=AliasChoices("DATABASE_URL"))
    google_cloud_project: str = Field(
        default="",
        validation_alias=AliasChoices("GOOGLE_CLOUD_PROJECT", "GCLOUD_PROJECT_ID"),
    )
    google_cloud_location: str = Field(
        default="us-central1",
        validation_alias=AliasChoices("GOOGLE_CLOUD_LOCATION", "DOCUMENT_AI_LOCATION"),
    )
    google_application_credentials: str = Field(
        default="",
        validation_alias=AliasChoices("GOOGLE_APPLICATION_CREDENTIALS"),
    )
    gcs_bucket_name: str = Field(
        default="",
        validation_alias=AliasChoices("GCS_BUCKET_NAME", "GCS_BUCKET"),
    )
    gcs_input_bucket_name: str = Field(
        default="",
        validation_alias=AliasChoices("GCS_INPUT_BUCKET_NAME"),
    )
    gcs_output_bucket_name: str = Field(
        default="",
        validation_alias=AliasChoices("GCS_OUTPUT_BUCKET_NAME"),
    )
    gcs_key_base64: str = Field(
        default="",
        validation_alias=AliasChoices("GCS_KEY_BASE64"),
    )
    firestore_database: str = "(default)"
    datastore_namespace: str = "agentic-document-service"
    bigquery_dataset: str = "agentic_document_service"
    vector_store_backend: str = "memory"
    vector_search_index: str = ""
    adk_model: str = Field(
        default="gemini-2.5-pro",
        validation_alias=AliasChoices("ADK_MODEL"),
    )
    embedding_model: str = Field(
        default="gemini-embedding-001",
        validation_alias=AliasChoices("EMBEDDING_MODEL"),
    )
    gemini_api_key: str = Field(default="", validation_alias=AliasChoices("GEMINI_API_KEY"))
    jwt_secret: str = Field(default="", validation_alias=AliasChoices("JWT_SECRET"))
    redis_url: str = Field(default="", validation_alias=AliasChoices("REDIS_URL"))
    auth_service_url: str = Field(
        default="http://localhost:5001",
        validation_alias=AliasChoices("AUTH_SERVICE_URL"),
    )
    api_gateway_url: str = Field(
        default="http://localhost:5000",
        validation_alias=AliasChoices("API_GATEWAY_URL", "GATEWAY_URL"),
    )
    payment_service_url: str = Field(
        default="http://localhost:5003",
        validation_alias=AliasChoices("PAYMENT_SERVICE_URL"),
    )
    retrieval_top_k: int = 8
    chunk_size: int = 750
    chunk_overlap: int = 160
    chunk_min_tokens: int = 500
    chunk_max_tokens: int = 1000
    max_parallel_document_workers: int = 4
    auto_fill_confidence_threshold: float = 0.90

    # Embedding batching & rate-limit protection
    # Max texts per single Gemini embed_content call (Gemini supports up to 100)
    embedding_batch_size: int = Field(
        default=50,
        validation_alias=AliasChoices("EMBEDDING_BATCH_SIZE"),
    )
    # Max retry attempts on 429 / quota errors (exponential backoff between each)
    embedding_max_retries: int = Field(
        default=5,
        validation_alias=AliasChoices("EMBEDDING_MAX_RETRIES"),
    )
    # Token-bucket rate: max Gemini embed API calls per minute across all threads
    # gemini-embedding-001 free-tier = 1500 RPM; set lower if you hit limits
    embedding_rpm_limit: int = Field(
        default=1500,
        validation_alias=AliasChoices("EMBEDDING_RPM_LIMIT"),
    )
    legacy_document_service_url: str = Field(
        default="",
        validation_alias=AliasChoices("LEGACY_DOCUMENT_SERVICE_URL"),
    )
    proxy_timeout_seconds: float = 300.0
    # 0 = always read latest summarization_chat_config from DB (recommended when admins edit often).
    summarization_chat_config_cache_seconds: float = Field(
        default=0.0,
        validation_alias=AliasChoices("SUMMARIZATION_CHAT_CONFIG_CACHE_SECONDS"),
    )
    # Optional: require this header value for POST .../invalidate-cache (empty = endpoint disabled).
    summarization_config_admin_key: str = Field(
        default="",
        validation_alias=AliasChoices("SUMMARIZATION_CONFIG_ADMIN_KEY"),
    )

    @field_validator("cors_origins", mode="before")
    @classmethod
    def parse_cors_origins(cls, value: object) -> object:
        if isinstance(value, str):
            text = value.strip()
            if not text:
                return []
            if text.startswith("["):
                try:
                    parsed = json.loads(text)
                    if isinstance(parsed, list):
                        return [str(item).strip() for item in parsed if str(item).strip()]
                except json.JSONDecodeError:
                    pass
            return [origin.strip() for origin in text.split(",") if origin.strip()]
        return value

    @model_validator(mode="after")
    def apply_derived_defaults(self) -> "Settings":
        return self


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
