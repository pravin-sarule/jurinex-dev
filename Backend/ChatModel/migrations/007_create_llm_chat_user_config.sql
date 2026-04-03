-- Per-user overrides for ChatModel LLM policy/config.
-- Null override values fall back to latest row from llm_chat_config.

CREATE TABLE IF NOT EXISTS llm_chat_user_config (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL UNIQUE,

    max_output_tokens INTEGER,
    total_tokens_per_day INTEGER,
    llm_model VARCHAR(100),
    llm_provider VARCHAR(50),
    model_temperature NUMERIC(4,2),
    messages_per_hour INTEGER,
    quota_chats_per_minute INTEGER,
    chats_per_day INTEGER,

    max_document_pages INTEGER,
    max_document_size_mb INTEGER,
    max_file_upload_per_day INTEGER,
    max_upload_files INTEGER,
    streaming_delay INTEGER,

    vertex_model_id VARCHAR(120),
    model_alias_map JSONB,
    min_output_tokens INTEGER,
    max_output_tokens_cap INTEGER,
    temperature_min NUMERIC(4,2),
    temperature_max NUMERIC(4,2),
    multer_upload_ceiling_mb INTEGER,

    updated_by INTEGER,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_llm_chat_user_config_user_id
  ON llm_chat_user_config(user_id);
