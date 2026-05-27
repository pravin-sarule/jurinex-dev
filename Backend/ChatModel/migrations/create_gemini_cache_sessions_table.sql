-- Migration: Create gemini_cache_sessions table
-- Description: Stores metadata, token usage, and cost calculations for Gemini explicit context caching.

CREATE TABLE IF NOT EXISTS gemini_cache_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL UNIQUE,
    cache_name VARCHAR(255) NOT NULL,
    model_name VARCHAR(100) NOT NULL DEFAULT 'gemini-1.5-pro-002',
    document_tokens INTEGER NOT NULL DEFAULT 0,
    display_name VARCHAR(255),
    status VARCHAR(50) NOT NULL DEFAULT 'active', -- 'active', 'deleted'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_accessed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP WITH TIME ZONE,
    deleted_at TIMESTAMP WITH TIME ZONE,
    delete_reason VARCHAR(100), -- 'manual', 'inactivity_timeout'
    questions_asked INTEGER DEFAULT 0,
    total_input_tokens_used INTEGER DEFAULT 0,
    total_output_tokens_used INTEGER DEFAULT 0,
    creation_cost NUMERIC(15, 6) DEFAULT 0.00,
    storage_cost NUMERIC(15, 6) DEFAULT 0.00,
    accumulated_input_cost NUMERIC(15, 6) DEFAULT 0.00,
    accumulated_output_cost NUMERIC(15, 6) DEFAULT 0.00,
    total_cost NUMERIC(15, 6) DEFAULT 0.00
);

-- Index for fast lookup by session_id
CREATE INDEX IF NOT EXISTS idx_gemini_cache_sessions_session_id ON gemini_cache_sessions(session_id);
