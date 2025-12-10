-- Migration: Add session_id to mindmaps table
-- This allows mindmaps to be linked to specific chat sessions
-- Similar to how past chats are fetched by session

-- Add session_id column (nullable to support existing mindmaps)
ALTER TABLE mindmaps 
ADD COLUMN IF NOT EXISTS session_id UUID NULL;

-- Add index for efficient session-based queries
CREATE INDEX IF NOT EXISTS idx_mindmaps_session ON mindmaps(session_id);

-- Add composite index for session + file queries
CREATE INDEX IF NOT EXISTS idx_mindmaps_file_session ON mindmaps(file_id, session_id);

-- Add comment
COMMENT ON COLUMN mindmaps.session_id IS 'Links mindmap to a specific chat session (similar to chat sessions)';

