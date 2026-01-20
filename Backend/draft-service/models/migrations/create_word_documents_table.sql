-- ============================================
-- Create word_documents table
-- ============================================
-- This table stores documents created in Jurinex and their Microsoft Word integration data
-- 
-- Schema matches the exact requirements:
-- - user_id INTEGER NOT NULL (always required)
-- - title, content (document data)
-- - word_file_id, word_web_url (Word integration)
-- - last_synced_at (sync tracking)
-- - created_at, updated_at (timestamps)
-- ============================================

CREATE TABLE IF NOT EXISTS word_documents (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    title VARCHAR(255),
    content TEXT,

    word_file_id VARCHAR(255),
    word_web_url TEXT,
    last_synced_at TIMESTAMP,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_word_documents_user_id ON word_documents(user_id);
CREATE INDEX IF NOT EXISTS idx_word_documents_updated_at ON word_documents(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_word_documents_word_file_id ON word_documents(word_file_id) WHERE word_file_id IS NOT NULL;

-- ============================================
-- Verification Query
-- ============================================
-- Run this to verify the table was created correctly:
-- SELECT column_name, data_type, is_nullable 
-- FROM information_schema.columns 
-- WHERE table_name = 'word_documents' 
-- ORDER BY ordinal_position;

-- ============================================
-- Sample Test Query
-- ============================================
-- INSERT INTO word_documents (user_id, title, content) 
-- VALUES (3, 'Test Document', '<p>Test content</p>') 
-- RETURNING *;

-- SELECT * FROM word_documents WHERE user_id = 3;
