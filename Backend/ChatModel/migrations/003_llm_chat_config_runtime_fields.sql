-- Runtime fields for ChatModel (aliases, generation bounds, upload ceiling from DB).
-- Run against the ChatModel database after 001.

ALTER TABLE llm_chat_config
  ADD COLUMN IF NOT EXISTS vertex_model_id VARCHAR(120),
  ADD COLUMN IF NOT EXISTS model_alias_map JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS min_output_tokens INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS max_output_tokens_cap INTEGER NOT NULL DEFAULT 65536,
  ADD COLUMN IF NOT EXISTS temperature_min NUMERIC(4,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS temperature_max NUMERIC(4,2) NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS multer_upload_ceiling_mb INTEGER NOT NULL DEFAULT 100;

-- If alias map still empty, seed defaults (editable in DB / admin)
UPDATE llm_chat_config
SET
  model_alias_map = '{"gemini-flash-lite-latest":"gemini-2.5-flash-lite","gemini-flash-lite":"gemini-2.5-flash-lite","gemini-pro-latest":"gemini-2.5-flash","gemini-pro":"gemini-2.5-flash"}'::jsonb,
  updated_at = NOW()
WHERE id = (SELECT MAX(id) FROM llm_chat_config)
  AND (model_alias_map IS NULL OR model_alias_map = '{}'::jsonb);

INSERT INTO llm_chat_config (
  max_output_tokens, total_tokens_per_day, llm_model, llm_provider,
  model_temperature, messages_per_hour, quota_chats_per_minute,
  chats_per_day, max_document_pages, max_document_size_mb,
  max_file_upload_per_day,
  max_upload_files, streaming_delay, updated_by,
  vertex_model_id, model_alias_map,
  min_output_tokens, max_output_tokens_cap, temperature_min, temperature_max, multer_upload_ceiling_mb
)
SELECT
  20000, 250000, 'gemini-2.5-flash-lite', 'google',
  0.70, 50, 10,
  60, 300, 40,
  20,
  8, 100, 1,
  NULL,
  '{"gemini-flash-lite-latest":"gemini-2.5-flash-lite","gemini-flash-lite":"gemini-2.5-flash-lite","gemini-pro-latest":"gemini-2.5-flash","gemini-pro":"gemini-2.5-flash"}'::jsonb,
  1, 65536, 0, 2, 100
WHERE NOT EXISTS (SELECT 1 FROM llm_chat_config LIMIT 1);
