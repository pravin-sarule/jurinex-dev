-- Create documents table for draft service (word_documents)
-- Matches the required schema with proper user_id enforcement
CREATE TABLE IF NOT EXISTS documents (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    title VARCHAR(255),
    content TEXT,
    
    -- Microsoft Word Integration Fields
    word_file_id VARCHAR(255),
    word_web_url TEXT,
    last_synced_at TIMESTAMP,
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Note: If foreign key constraint is needed, uncomment below
-- FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
-- However, if users table is in different database (auth-service), handle at application level

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_documents_user_id ON documents(user_id);
CREATE INDEX IF NOT EXISTS idx_documents_updated_at ON documents(updated_at DESC);

-- Add Microsoft token columns to users table if they don't exist
-- Note: This assumes the users table already exists from auth service
-- If these columns don't exist in your users table, run these ALTER TABLE statements:
-- ALTER TABLE users ADD COLUMN IF NOT EXISTS ms_access_token TEXT;
-- ALTER TABLE users ADD COLUMN IF NOT EXISTS ms_refresh_token TEXT;
-- ALTER TABLE users ADD COLUMN IF NOT EXISTS ms_token_expiry TIMESTAMP;
