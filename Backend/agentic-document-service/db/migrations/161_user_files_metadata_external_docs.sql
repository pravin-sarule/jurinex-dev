-- Case Storage external documents (Google Docs / Zoho Writer):
-- metadata stores {provider, external_id, google_file_id | zoho_draft_id} for
-- user_files rows with status 'external' (gcs_path 'external://{provider}/{id}').
ALTER TABLE user_files ADD COLUMN IF NOT EXISTS metadata JSONB;
