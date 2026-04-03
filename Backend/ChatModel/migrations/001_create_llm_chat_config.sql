-- Migration: Create llm_chat_config table
-- Run this once against the ChatModel database (DATABASE_URL in .env)

CREATE TABLE IF NOT EXISTS llm_chat_config (
    id SERIAL PRIMARY KEY,
    max_output_tokens   INTEGER     NOT NULL DEFAULT 20000,
    total_tokens_per_day INTEGER    NOT NULL DEFAULT 100000,
    llm_model           VARCHAR(100) NOT NULL DEFAULT 'gemini-2.5-flash-lite',
    llm_provider        VARCHAR(50)  NOT NULL DEFAULT 'google',
    model_temperature   NUMERIC(4,2) NOT NULL DEFAULT 1.00,
    messages_per_hour   INTEGER     NOT NULL DEFAULT 100,
    quota_chats_per_minute INTEGER  NOT NULL DEFAULT 4,
    chats_per_day       INTEGER     NOT NULL DEFAULT 100,
    max_document_pages  INTEGER     NOT NULL DEFAULT 500,
    max_document_size_mb INTEGER    NOT NULL DEFAULT 50,
    max_file_upload_per_day INTEGER NOT NULL DEFAULT 20,
    max_upload_files    INTEGER     NOT NULL DEFAULT 8,
    streaming_delay     INTEGER     NOT NULL DEFAULT 100,
    updated_by          INTEGER,
    created_at          TIMESTAMP   NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMP   NOT NULL DEFAULT NOW()
);

-- Seed the default config row (from user specification).
-- If a row already exists, UPDATE it to ensure correct values.
INSERT INTO llm_chat_config (
    max_output_tokens, total_tokens_per_day, llm_model, llm_provider,
    model_temperature, messages_per_hour, quota_chats_per_minute,
    chats_per_day, max_document_pages, max_document_size_mb,
    max_file_upload_per_day, max_upload_files, streaming_delay, updated_by,
    created_at, updated_at
) VALUES (
    20000, 250000, 'gemini-2.5-flash-lite', 'google',
    0.70, 50, 10,
    60, 300, 40,
    15, 8, 100, 1,
    NOW(), NOW()
)
ON CONFLICT (id) DO UPDATE SET
    max_output_tokens     = EXCLUDED.max_output_tokens,
    total_tokens_per_day  = EXCLUDED.total_tokens_per_day,
    llm_model             = EXCLUDED.llm_model,
    llm_provider          = EXCLUDED.llm_provider,
    model_temperature     = EXCLUDED.model_temperature,
    messages_per_hour     = EXCLUDED.messages_per_hour,
    quota_chats_per_minute = EXCLUDED.quota_chats_per_minute,
    chats_per_day         = EXCLUDED.chats_per_day,
    max_document_pages    = EXCLUDED.max_document_pages,
    max_document_size_mb  = EXCLUDED.max_document_size_mb,
    max_file_upload_per_day = EXCLUDED.max_file_upload_per_day,
    max_upload_files      = EXCLUDED.max_upload_files,
    streaming_delay       = EXCLUDED.streaming_delay,
    updated_by            = EXCLUDED.updated_by,
    updated_at            = NOW();

-- Also correct any existing rows with the wrong model name or tiny token limit
UPDATE llm_chat_config
SET
    llm_model         = 'gemini-2.5-flash-lite',
    llm_provider      = 'google',
    max_output_tokens = 20000,
    total_tokens_per_day = 250000,
    model_temperature = 0.70,
    messages_per_hour = 50,
    quota_chats_per_minute = 10,
    chats_per_day = 60,
    max_document_pages = 300,
    max_document_size_mb = 40,
    max_file_upload_per_day = 15,
    max_upload_files = 8,
    streaming_delay = 100,
    updated_by = 1,
    updated_at        = NOW()
WHERE llm_model IN ('gemini-flash-lite-latest', 'gemini-flash-lite', 'gemini-pro-latest', 'gemini-2.0-flash-lite', 'gemini-2.0-flash-lite-001')
   OR max_output_tokens < 512;
