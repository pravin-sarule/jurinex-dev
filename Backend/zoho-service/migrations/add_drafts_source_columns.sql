-- Migration: Add source tracking columns to drafts table
-- Purpose: Track where a draft originated (e.g., 'chat' from AI chat editing)
-- Run this migration manually when needed

-- Add source column (e.g., 'chat', 'upload', 'blank')
ALTER TABLE drafts ADD COLUMN IF NOT EXISTS source VARCHAR(20);

-- Add source_id column (e.g., chatMessageId for chat-originated drafts)
ALTER TABLE drafts ADD COLUMN IF NOT EXISTS source_id VARCHAR(100);

-- Optional: Add index for querying by source
CREATE INDEX IF NOT EXISTS idx_drafts_source ON drafts(source);
CREATE INDEX IF NOT EXISTS idx_drafts_source_id ON drafts(source_id);

-- NOTES:
-- 1. Run this migration only once
-- 2. Existing rows will have NULL for source and source_id
-- 3. Code must handle NULL values until migration is applied
