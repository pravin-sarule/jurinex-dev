-- Case Storage ("Ask Jurinex") chats are tagged chat_type='case_storage' so they
-- never appear in ChatModel's conversation listings (which filter chat_type='chat_model').
-- Per-file history endpoints have no chat_type filter, so Ask Jurinex still sees them.
ALTER TABLE file_chats DROP CONSTRAINT IF EXISTS check_file_chats_chat_type;
ALTER TABLE file_chats DROP CONSTRAINT IF EXISTS file_chats_chat_type_check;
ALTER TABLE file_chats ADD CONSTRAINT check_file_chats_chat_type
  CHECK (chat_type IS NULL OR chat_type::text = ANY (ARRAY['analysis','chat_model','case_storage']::text[]));

-- Backfill: chats on files living in Case Storage folders (folder rows with
-- folder_path='case-storage') or on hidden chat-snapshot rows.
UPDATE file_chats SET chat_type = 'case_storage'
WHERE chat_type = 'chat_model' AND file_id IN (
  SELECT f.id FROM user_files f
  WHERE f.is_folder = false AND (
    f.folder_path IN (
      SELECT folder.originalname FROM user_files folder
      WHERE folder.is_folder = true AND folder.folder_path = 'case-storage'
    )
    OR (f.folder_path IS NULL AND f.metadata ? 'snapshot_of')
  )
);
