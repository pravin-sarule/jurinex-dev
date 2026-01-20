-- ============================================
-- Documents Table SQL Query
-- ============================================
-- This table stores documents created in Jurinex and their Microsoft Word integration data
-- 
-- Workflow:
-- 1. User creates document in Jurinex → INSERT into documents
-- 2. User exports to Word → UPDATE word_file_id, word_web_url, last_synced_at
-- 3. User syncs from Word → UPDATE content, word_web_url, last_synced_at
-- 4. User re-opens Word → Use word_web_url to open in Word Online
--
-- ============================================

-- Create documents table
CREATE TABLE IF NOT EXISTS documents (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    content TEXT,
    user_id INTEGER NOT NULL,
    
    -- Microsoft Word Integration Fields
    word_file_id VARCHAR(255),           -- OneDrive file ID (e.g., "01ABC123...")
    word_web_url TEXT,                    -- Word Online editor URL
    last_synced_at TIMESTAMP,             -- Last sync timestamp
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_documents_user_id ON documents(user_id);
CREATE INDEX IF NOT EXISTS idx_documents_updated_at ON documents(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_documents_word_file_id ON documents(word_file_id) WHERE word_file_id IS NOT NULL;

-- ============================================
-- Sample Queries
-- ============================================

-- 1. Get all documents for a user
-- SELECT * FROM documents WHERE user_id = 3 ORDER BY updated_at DESC;

-- 2. Get document with Word integration info
-- SELECT 
--     id, title, content, 
--     word_file_id, word_web_url, last_synced_at,
--     created_at, updated_at
-- FROM documents 
-- WHERE id = 1 AND user_id = 3;

-- 3. Find documents linked to Word
-- SELECT * FROM documents 
-- WHERE user_id = 3 AND word_file_id IS NOT NULL
-- ORDER BY last_synced_at DESC;

-- 4. Update document after Word export
-- UPDATE documents 
-- SET 
--     word_file_id = '01ABC123...',
--     word_web_url = 'https://onedrive.live.com/edit.aspx?id=...',
--     last_synced_at = CURRENT_TIMESTAMP,
--     updated_at = CURRENT_TIMESTAMP
-- WHERE id = 1 AND user_id = 3;

-- 5. Sync content from Word
-- UPDATE documents 
-- SET 
--     content = '<p>Updated content from Word...</p>',
--     word_web_url = 'https://onedrive.live.com/edit.aspx?id=...',
--     last_synced_at = CURRENT_TIMESTAMP,
--     updated_at = CURRENT_TIMESTAMP
-- WHERE id = 1 AND user_id = 3;

-- 6. Get documents that need syncing (older than 1 hour)
-- SELECT * FROM documents 
-- WHERE user_id = 3 
--   AND word_file_id IS NOT NULL 
--   AND (last_synced_at IS NULL OR last_synced_at < NOW() - INTERVAL '1 hour')
-- ORDER BY last_synced_at ASC NULLS FIRST;

-- 7. Count documents per user
-- SELECT user_id, COUNT(*) as document_count,
--        COUNT(word_file_id) as word_linked_count
-- FROM documents 
-- GROUP BY user_id;

-- 8. Delete document (cascade will handle related data if any)
-- DELETE FROM documents WHERE id = 1 AND user_id = 3;

-- ============================================
-- Notes
-- ============================================
-- 
-- word_file_id: Microsoft Graph API file ID from OneDrive
--   Example: "01ABC123DEF456GHI789JKL012MNO345PQR678"
--
-- word_web_url: Direct URL to open document in Word Online
--   Personal OneDrive: https://onedrive.live.com/edit.aspx?id={fileId}
--   Business OneDrive: https://{tenant}.sharepoint.com/_layouts/15/WopiFrame.aspx?sourcedoc={fileId}&action=default
--
-- last_synced_at: Tracks when content was last synced FROM Word
--   NULL = Never synced (only exported)
--   Has value = Last sync timestamp
--
-- Foreign Key: user_id references users table (from auth-service)
--   Note: If users table is in different database, remove FK constraint
--   and handle referential integrity at application level
--
-- ============================================
