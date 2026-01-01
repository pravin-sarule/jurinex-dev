-- Migration: Create prompt_cache and user_metadata tables for LLM response caching
-- This enables user-specific caching with automatic invalidation on document upload

-- Table A: prompt_cache
-- Stores cached LLM responses keyed by user_id, context (folder/file), and prompt hash
CREATE TABLE IF NOT EXISTS prompt_cache (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id INTEGER NOT NULL,
    prompt_hash VARCHAR(64) NOT NULL, -- SHA-256 hash (64 hex characters)
    cached_output TEXT NOT NULL, -- The actual AI-generated response
    prompt_text TEXT, -- Optional: store original prompt for debugging (can be NULL for privacy)
    method_used VARCHAR(50), -- e.g., 'rag', 'gemini_eyeball', 'web_search'
    chat_type VARCHAR(20) NOT NULL, -- 'folder' or 'file' - distinguishes between folder chats and file chats
    context_id VARCHAR(255) NOT NULL, -- folder_name (for folder chats) or file_id (for file chats)
    session_id UUID, -- Optional: session context if applicable
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP WITH TIME ZONE, -- Optional: TTL for automatic cleanup
    
    -- Composite unique constraint: one cache entry per user per context per prompt hash
    -- This ensures a prompt in "Case A" doesn't return a result from "Case B"
    CONSTRAINT unique_user_context_prompt UNIQUE (user_id, context_id, prompt_hash),
    
    -- Foreign key to users table
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Index for fast lookups by user, context, and hash
CREATE INDEX IF NOT EXISTS idx_prompt_cache_user_context_hash ON prompt_cache(user_id, context_id, prompt_hash);

-- Index for fast lookups by user and hash (backward compatibility)
CREATE INDEX IF NOT EXISTS idx_prompt_cache_user_hash ON prompt_cache(user_id, prompt_hash);

-- Index for cleanup: find expired entries
CREATE INDEX IF NOT EXISTS idx_prompt_cache_expires ON prompt_cache(expires_at) WHERE expires_at IS NOT NULL;

-- Index for cleanup: find old entries by created_at
CREATE INDEX IF NOT EXISTS idx_prompt_cache_created ON prompt_cache(created_at);

-- Table B: user_metadata
-- Tracks the last document upload timestamp for each user (for cache invalidation)
CREATE TABLE IF NOT EXISTS user_metadata (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id INTEGER NOT NULL UNIQUE, -- One metadata record per user
    last_doc_upload TIMESTAMP WITH TIME ZONE, -- Updated when user uploads a new document
    last_cache_invalidation TIMESTAMP WITH TIME ZONE, -- Track when cache was last invalidated
    total_cache_hits INTEGER DEFAULT 0, -- Optional: track cache performance
    total_cache_misses INTEGER DEFAULT 0, -- Optional: track cache performance
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Foreign key to users table
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Index for fast lookup by user_id
CREATE INDEX IF NOT EXISTS idx_user_metadata_user_id ON user_metadata(user_id);

-- Function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger to auto-update updated_at for prompt_cache
CREATE TRIGGER update_prompt_cache_updated_at 
    BEFORE UPDATE ON prompt_cache
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Trigger to auto-update updated_at for user_metadata
CREATE TRIGGER update_user_metadata_updated_at 
    BEFORE UPDATE ON user_metadata
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Optional: Function to clean up expired cache entries (can be called by a cron job)
CREATE OR REPLACE FUNCTION cleanup_expired_cache()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM prompt_cache 
    WHERE expires_at IS NOT NULL 
      AND expires_at < CURRENT_TIMESTAMP;
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Optional: Function to clean up old cache entries (older than 30 days, can be called by a cron job)
CREATE OR REPLACE FUNCTION cleanup_old_cache(days_old INTEGER DEFAULT 30)
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM prompt_cache 
    WHERE created_at < CURRENT_TIMESTAMP - (days_old || ' days')::INTERVAL;
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Comments for documentation
COMMENT ON TABLE prompt_cache IS 'Stores cached LLM responses keyed by user_id, context (folder/file), and prompt hash. Cache is invalidated when user uploads new documents.';
COMMENT ON TABLE user_metadata IS 'Tracks user-specific metadata including last document upload timestamp for cache invalidation.';
COMMENT ON COLUMN prompt_cache.prompt_hash IS 'SHA-256 hash of the normalized prompt text (lowercased, trimmed).';
COMMENT ON COLUMN prompt_cache.chat_type IS 'Type of chat: ''folder'' for folder chats, ''file'' for single file chats. Ensures prompts in "Case A" don''t return results from "Case B".';
COMMENT ON COLUMN prompt_cache.context_id IS 'Context identifier: folder_name (for folder chats) or file_id (for file chats). Used to distinguish between different contexts.';
COMMENT ON COLUMN prompt_cache.expires_at IS 'Optional TTL. If set, cache entry will be considered expired after this timestamp.';
COMMENT ON COLUMN user_metadata.last_doc_upload IS 'Timestamp of the most recent document upload. Used to invalidate stale cache entries.';

