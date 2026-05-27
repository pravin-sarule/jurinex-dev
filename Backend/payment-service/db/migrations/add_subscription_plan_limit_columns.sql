-- subscription_plans: per-plan overrides (NULL = use Document_DB admin defaults at runtime)

ALTER TABLE subscription_plans
  ADD COLUMN IF NOT EXISTS chat_token_limit INTEGER,
  ADD COLUMN IF NOT EXISTS chat_messages_per_hour INTEGER,
  ADD COLUMN IF NOT EXISTS chat_chats_per_day INTEGER,
  ADD COLUMN IF NOT EXISTS chat_quota_per_minute INTEGER,
  ADD COLUMN IF NOT EXISTS chat_max_document_pages INTEGER,
  ADD COLUMN IF NOT EXISTS chat_max_document_size_mb INTEGER,
  ADD COLUMN IF NOT EXISTS chat_max_file_upload_per_day INTEGER,
  ADD COLUMN IF NOT EXISTS chat_max_upload_files INTEGER,
  ADD COLUMN IF NOT EXISTS summarization_token_limit INTEGER,
  ADD COLUMN IF NOT EXISTS sum_messages_per_hour INTEGER,
  ADD COLUMN IF NOT EXISTS sum_chats_per_day INTEGER,
  ADD COLUMN IF NOT EXISTS sum_quota_per_minute INTEGER,
  ADD COLUMN IF NOT EXISTS sum_max_document_pages INTEGER,
  ADD COLUMN IF NOT EXISTS sum_max_document_size_mb INTEGER,
  ADD COLUMN IF NOT EXISTS sum_max_file_upload_per_day INTEGER,
  ADD COLUMN IF NOT EXISTS sum_max_upload_files INTEGER,
  ADD COLUMN IF NOT EXISTS sum_max_context_documents INTEGER,
  ADD COLUMN IF NOT EXISTS sum_max_conversation_history INTEGER;
