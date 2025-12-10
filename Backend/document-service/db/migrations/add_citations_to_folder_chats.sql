-- Add citations column to folder_chats table to store page sources permanently
-- Citations are stored as JSONB array for flexibility and easy querying
ALTER TABLE folder_chats
ADD COLUMN IF NOT EXISTS citations JSONB DEFAULT '[]'::jsonb;

-- Add index for faster queries on citations
CREATE INDEX IF NOT EXISTS idx_folder_chats_citations ON folder_chats USING GIN (citations);



