-- Migration: Update prompt_cache table to add chat_type and context_id
-- This migration adds support for context-specific caching (folder vs file chats)

-- Step 1: Add new columns
ALTER TABLE prompt_cache 
ADD COLUMN IF NOT EXISTS chat_type VARCHAR(20), -- 'folder' or 'file'
ADD COLUMN IF NOT EXISTS context_id VARCHAR(255); -- stores folder_name or file_id

-- Step 2: Migrate existing data (if any)
-- For existing entries, try to infer chat_type and context_id from folder_name
UPDATE prompt_cache 
SET 
  chat_type = CASE 
    WHEN folder_name IS NOT NULL THEN 'folder'
    ELSE 'file'
  END,
  context_id = COALESCE(folder_name, 'unknown')
WHERE chat_type IS NULL OR context_id IS NULL;

-- Step 3: Make columns NOT NULL after migration
-- First, set default values for any remaining NULLs
UPDATE prompt_cache 
SET 
  chat_type = COALESCE(chat_type, 'file'),
  context_id = COALESCE(context_id, 'unknown')
WHERE chat_type IS NULL OR context_id IS NULL;

-- Step 4: Drop old unique constraint
ALTER TABLE prompt_cache 
DROP CONSTRAINT IF EXISTS unique_user_prompt;

-- Step 5: Add new unique constraint with context
ALTER TABLE prompt_cache 
ADD CONSTRAINT unique_user_context_prompt 
UNIQUE (user_id, context_id, prompt_hash);

-- Step 6: Drop old folder_name column (no longer needed, context_id replaces it)
-- Note: Uncomment this if you want to remove the old column
-- ALTER TABLE prompt_cache DROP COLUMN IF EXISTS folder_name;

-- Step 7: Update indexes
DROP INDEX IF EXISTS idx_prompt_cache_user_hash;
CREATE INDEX IF NOT EXISTS idx_prompt_cache_user_context_hash ON prompt_cache(user_id, context_id, prompt_hash);

-- Step 8: Add index for chat_type lookups (optional, for analytics)
CREATE INDEX IF NOT EXISTS idx_prompt_cache_chat_type ON prompt_cache(chat_type);

-- Comments
COMMENT ON COLUMN prompt_cache.chat_type IS 'Type of chat: ''folder'' for folder chats, ''file'' for single file chats';
COMMENT ON COLUMN prompt_cache.context_id IS 'Context identifier: folder_name for folder chats, file_id for file chats';

