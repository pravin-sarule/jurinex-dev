-- Migration 009: Add file_id to gemini_cache_sessions for lazy/auto-create lookup
-- Enables keying cache sessions by document file rather than requiring explicit session IDs

ALTER TABLE gemini_cache_sessions
  ADD COLUMN IF NOT EXISTS file_id UUID;

CREATE INDEX IF NOT EXISTS idx_cache_sessions_file_id_active
  ON gemini_cache_sessions(file_id, status);
