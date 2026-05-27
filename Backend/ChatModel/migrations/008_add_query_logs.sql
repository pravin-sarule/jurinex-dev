-- Migration 008: Per-query tracking for Gemini context caching
-- Adds query_logs table and two columns to gemini_cache_sessions

-- Track pure new-prompt tokens and total cached-doc tokens served
ALTER TABLE gemini_cache_sessions
  ADD COLUMN IF NOT EXISTS new_input_tokens_used   INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_cached_tokens_used INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS setup_cost               NUMERIC(20,10) DEFAULT 0;

-- Per-query cost & token breakdown
CREATE TABLE IF NOT EXISTS query_logs (
  id            SERIAL PRIMARY KEY,
  session_id    UUID        NOT NULL
                REFERENCES gemini_cache_sessions(session_id) ON DELETE CASCADE,
  prompt_tokens INTEGER     NOT NULL DEFAULT 0,   -- new / non-cached input tokens
  cached_tokens INTEGER     NOT NULL DEFAULT 0,   -- tokens served from Gemini cache
  output_tokens INTEGER     NOT NULL DEFAULT 0,
  query_cost    NUMERIC(20,10) NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_query_logs_session_id  ON query_logs(session_id);
CREATE INDEX IF NOT EXISTS idx_query_logs_created_at  ON query_logs(created_at DESC);
