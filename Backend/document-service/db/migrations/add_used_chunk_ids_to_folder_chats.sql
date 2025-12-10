-- Add used_chunk_ids column to folder_chats table
ALTER TABLE folder_chats
ADD COLUMN used_chunk_ids UUID[] DEFAULT ARRAY[]::UUID[];