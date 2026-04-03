-- Migration: Backfill chat_type for existing rows that have no tag yet.
-- ChatModel rows have file_id = NULL OR were inserted by the ChatModel service.
-- Since the document-service already saves chat_type = 'analysis', any row
-- with chat_type IS NULL was inserted by the ChatModel service.

UPDATE file_chats
SET chat_type = 'chatmodel'
WHERE chat_type IS NULL;

-- Verify
SELECT chat_type, COUNT(*) FROM file_chats GROUP BY chat_type;
