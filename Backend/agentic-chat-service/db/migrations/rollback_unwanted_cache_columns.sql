ALTER TABLE gemini_cache_sessions
  DROP COLUMN IF EXISTS cache_token_count,
  DROP COLUMN IF EXISTS cache_creation_time,
  DROP COLUMN IF EXISTS cache_expiration_time,
  DROP COLUMN IF EXISTS grand_total_cost,
  DROP COLUMN IF EXISTS total_query_cost,
  DROP COLUMN IF EXISTS total_prompt_tokens_used,
  DROP COLUMN IF EXISTS total_new_prompt_tokens_used,
  DROP COLUMN IF EXISTS total_tokens_used;
