-- Chat Model: persist all attached files (ids, names, GCS URIs) per message for session restore.
ALTER TABLE file_chats
  ADD COLUMN IF NOT EXISTS attached_files JSONB DEFAULT NULL;

COMMENT ON COLUMN file_chats.attached_files IS 'Chat Model: snapshot of attached files [{file_id, filename, mimetype, size, gcs_uri}] for multi-file session continuation.';
