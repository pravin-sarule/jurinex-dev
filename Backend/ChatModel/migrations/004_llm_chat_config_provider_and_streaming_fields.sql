-- Adds provider / upload / streaming metadata fields for llm_chat_config.
-- Run after 003 for existing databases.

ALTER TABLE llm_chat_config
  ADD COLUMN IF NOT EXISTS llm_provider VARCHAR(50) NOT NULL DEFAULT 'google',
  ADD COLUMN IF NOT EXISTS max_upload_files INTEGER NOT NULL DEFAULT 8,
  ADD COLUMN IF NOT EXISTS streaming_delay INTEGER NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS updated_by INTEGER;

UPDATE llm_chat_config
SET
  llm_provider = COALESCE(NULLIF(TRIM(llm_provider), ''), 'google'),
  max_upload_files = CASE WHEN max_upload_files IS NULL OR max_upload_files < 1 THEN 8 ELSE max_upload_files END,
  streaming_delay = CASE WHEN streaming_delay IS NULL OR streaming_delay < 0 THEN 100 ELSE streaming_delay END,
  updated_at = NOW()
WHERE TRUE;
