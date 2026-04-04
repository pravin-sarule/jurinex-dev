-- Per-user rows in summarization_chat_config: user_id NULL = global defaults for all users.
-- Latest row per scope is chosen by updated_at (see agentic-document-service llm_chat_config loader).

ALTER TABLE public.summarization_chat_config
  ADD COLUMN IF NOT EXISTS user_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_summarization_chat_config_user_updated
  ON public.summarization_chat_config (user_id, updated_at DESC NULLS LAST);

COMMENT ON COLUMN public.summarization_chat_config.user_id IS
  'NULL or 0 = global template; positive integer = overrides for that user (merged over global).';
