-- Migration 010: Store question and answer text in query_logs for conversation history
ALTER TABLE query_logs
  ADD COLUMN IF NOT EXISTS question TEXT,
  ADD COLUMN IF NOT EXISTS answer   TEXT;
