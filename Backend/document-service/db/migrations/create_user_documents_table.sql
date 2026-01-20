-- Migration: Create user_documents table for storing Google Docs references
-- This table stores user-selected Google Docs for the editor integration

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS user_documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    google_file_id VARCHAR(255) NOT NULL,
    document_name VARCHAR(500) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for faster lookup by user_id
CREATE INDEX IF NOT EXISTS idx_user_documents_user_id ON user_documents(user_id);

-- Index for faster lookup by google_file_id
CREATE INDEX IF NOT EXISTS idx_user_documents_google_file_id ON user_documents(google_file_id);

-- Composite unique constraint to prevent duplicate entries
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_documents_user_file_unique 
ON user_documents(user_id, google_file_id);
