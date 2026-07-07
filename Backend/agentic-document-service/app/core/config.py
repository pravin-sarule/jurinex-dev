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
            "https://auth.jurinex.ai",
            "https://www.jurinex.ai",
            "https://ailearn.co.in",
            "https://www.ailearn.co.in",
        ]
    )
    enable_adk_runtime: bool = True
    enable_legacy_proxy: bool = False

    database_url: str = Field(default="", validation_alias=AliasChoices("DATABASE_URL"))
    payment_db_url: str = Field(default="", validation_alias=AliasChoices("PAYMENT_DB_URL"))
    # Optional DB override for reading public.agent_prompts.
    # Use this when agent prompts live in Draft_DB while runtime tables stay in Document_DB.
    agent_prompts_database_url: str = Field(
        default="",
        validation_alias=AliasChoices("AGENT_PROMPTS_DATABASE_URL", "DRAFT_DATABASE_URL"),
    )
    google_cloud_project: str = Field(
        default="",
        validation_alias=AliasChoices("GOOGLE_CLOUD_PROJECT", "GCLOUD_PROJECT_ID"),
    )
    google_cloud_location: str = Field(
        default="us-central1",
        validation_alias=AliasChoices("GOOGLE_CLOUD_LOCATION", "DOCUMENT_AI_LOCATION"),
    )
    document_ai_processor_id: str = Field(
        default="",
        validation_alias=AliasChoices("DOCUMENT_AI_PROCESSOR_ID"),
    )
    document_ai_ocr_processor_version_id: str = Field(
        default="",
        validation_alias=AliasChoices("DOCUMENT_AI_OCR_PROCESSOR_VERSION_ID"),
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
    # Dedicated key for Gemma models (gemma-*). Falls back to GEMINI_API_KEY when blank.
    gemma_api_key: str = Field(default="", validation_alias=AliasChoices("GEMMA_API_KEY"))
    # Dedicated model for draft-from-template mode. A stronger model (e.g. gemini-3.1-pro-preview)
    # reads the uploaded template PDF directly and reproduces all pages with clean formatting — gemma
    # cannot (PDF Parts 500 and it truncates long templates). Uses GEMINI_API_KEY. Blank -> reuse the
    # admin-selected chat model (template injected as text).
    draft_model_name: str = Field(
        default="gemini-3.1-pro-preview",
        validation_alias=AliasChoices("DRAFT_MODEL_NAME"),
    )
    # Output-token ceiling for drafts (full-length templates need room; clamped to the model's real max).
    draft_max_output_tokens: int = Field(
        default=65536,
        validation_alias=AliasChoices("DRAFT_MAX_OUTPUT_TOKENS"),
    )
    anthropic_api_key: str = Field(default="", validation_alias=AliasChoices("ANTHROPIC_API_KEY"))
    deepseek_api_key: str = Field(
        default="",
        validation_alias=AliasChoices("DEEPSEEK_API_KEY", "Deepseek_API_KEY"),
    )
    cloud_speech_to_text_api_key: str = Field(
        default="",
        validation_alias=AliasChoices("CLOUD_SPEECH_TO_TEXT_API_KEY"),
    )
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
    # Optional HTTP fallback for agent prompts when DB lookup is unavailable.
    agent_draft_service_url: str = Field(
        default="http://localhost:8000",
        validation_alias=AliasChoices("AGENT_DRAFT_SERVICE_URL", "DRAFTING_SERVICE_URL"),
    )
    retrieval_top_k: int = 8
    chunk_size: int = 750
    chunk_overlap: int = 160
    chunk_min_tokens: int = 500
    chunk_max_tokens: int = 1000
    max_parallel_document_workers: int = 4
    # Document AI page limit per request (online processing max is 15 pages)
    document_ai_page_limit: int = Field(
        default=15,
        validation_alias=AliasChoices("DOCUMENT_AI_PAGE_LIMIT"),
    )
    # Threads used to send parallel page-batch OCR requests to Document AI
    ocr_parallel_workers: int = Field(
        default=4,
        validation_alias=AliasChoices("OCR_PARALLEL_WORKERS"),
    )
    # Persistent background worker threads in the document processing queue
    processing_queue_workers: int = Field(
        default=4,
        validation_alias=AliasChoices("PROCESSING_QUEUE_WORKERS"),
    )
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

    # ── Default rate / upload limits (fallback when summarization_chat_config has no row) ──
    # These are used when the DB config table is empty AND no per-plan override exists.
    default_tokens_per_day: int = Field(default=300000, validation_alias=AliasChoices("DEFAULT_TOKENS_PER_DAY"))
    default_messages_per_hour: int = Field(default=60, validation_alias=AliasChoices("DEFAULT_MESSAGES_PER_HOUR"))
    default_chats_per_minute: int = Field(default=20, validation_alias=AliasChoices("DEFAULT_CHATS_PER_MINUTE"))
    default_chats_per_day: int = Field(default=80, validation_alias=AliasChoices("DEFAULT_CHATS_PER_DAY"))
    default_max_upload_files: int = Field(default=10, validation_alias=AliasChoices("DEFAULT_MAX_UPLOAD_FILES"))
    default_max_document_size_mb: int = Field(default=40, validation_alias=AliasChoices("DEFAULT_MAX_DOCUMENT_SIZE_MB"))
    default_max_document_pages: int = Field(default=400, validation_alias=AliasChoices("DEFAULT_MAX_DOCUMENT_PAGES"))
    default_max_file_upload_per_day: int = Field(default=15, validation_alias=AliasChoices("DEFAULT_MAX_FILE_UPLOAD_PER_DAY"))
    default_max_context_documents: int = Field(default=8, validation_alias=AliasChoices("DEFAULT_MAX_CONTEXT_DOCUMENTS"))
    default_max_conversation_history: int = Field(default=25, validation_alias=AliasChoices("DEFAULT_MAX_CONVERSATION_HISTORY"))
    default_max_output_tokens: int = Field(
        default=65536,
        validation_alias=AliasChoices("DEFAULT_MAX_OUTPUT_TOKENS"),
    )

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
    # 0 = use the same max as documents (max_document_size_mb / multer_upload_ceiling_mb from chat config)
    max_audio_file_size_mb: int = Field(
        default=0,
        validation_alias=AliasChoices("MAX_AUDIO_FILE_SIZE_MB"),
    )
    # BatchRecognize / long audio: allow up to ~8h; sync calls finish sooner.
    speech_to_text_timeout_seconds: int = Field(
        default=28800,
        validation_alias=AliasChoices("SPEECH_TO_TEXT_TIMEOUT", "SPEECH_TO_TEXT_TIMEOUT_SECONDS"),
    )
    speech_to_text_language_code: str = Field(
        default="en-IN",
        validation_alias=AliasChoices("SPEECH_TO_TEXT_LANGUAGE", "SPEECH_TO_TEXT_LANGUAGE_CODE"),
    )
    speech_to_text_alternative_language_code: str = Field(
        default="hi-IN",
        validation_alias=AliasChoices("SPEECH_TO_TEXT_ALTERNATIVE_LANGUAGE", "SPEECH_TO_TEXT_ALT_LANGUAGE"),
    )
    # Speech-to-Text v2: Chirp + batch_recognize for gs:// (long audio); v1 fallback if disabled.
    speech_use_v2: bool = Field(
        default=True,
        validation_alias=AliasChoices("SPEECH_USE_V2"),
    )
    speech_v2_model: str = Field(
        default="chirp_2",
        validation_alias=AliasChoices("SPEECH_V2_MODEL"),
    )
    # Chirp 2/3 are regional — use us-central1 unless your model docs specify another region.
    speech_recognizer_location: str = Field(
        default="us-central1",
        validation_alias=AliasChoices("SPEECH_RECOGNIZER_LOCATION", "SPEECH_V2_LOCATION"),
    )
    # Named recognizer ID created in GCP Console / gcloud.
    # Set to the ID of your pre-created recognizer (e.g. "chirp-transcriber").
    # Full path: projects/{project}/locations/{location}/recognizers/{id}
    # Leave empty ("") to use the implicit wildcard recognizer "_" (auto-provisioned).
    speech_v2_recognizer_id: str = Field(
        default="chirp-transcriber",
        validation_alias=AliasChoices("SPEECH_V2_RECOGNIZER_ID"),
    )
    # Max concurrent STT submissions to avoid hitting GCP rate limits.
    stt_max_concurrent: int = Field(
        default=3,
        validation_alias=AliasChoices("STT_MAX_CONCURRENT"),
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
