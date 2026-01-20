-- Update drafts table schema to match new requirements
-- Change id from UUID to SERIAL
-- Change user_id to INT
-- Add title, gcs_path, last_synced_at
-- Update status default to 'active'

-- First, drop the existing table and recreate with new schema
-- WARNING: This will delete existing data. Use ALTER TABLE in production.

-- Option 1: If table is empty or you want to recreate
DROP TABLE IF EXISTS drafts CASCADE;

CREATE TABLE drafts (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL,
    title VARCHAR(255) NOT NULL,
    google_file_id VARCHAR(100) UNIQUE,
    gcs_path VARCHAR(512),
    last_synced_at TIMESTAMP,
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_drafts_user_id ON drafts(user_id);
CREATE INDEX IF NOT EXISTS idx_drafts_google_file_id ON drafts(google_file_id);
CREATE INDEX IF NOT EXISTS idx_drafts_status ON drafts(status);
CREATE INDEX IF NOT EXISTS idx_drafts_created_at ON drafts(created_at DESC);

-- Add trigger for auto-updating updated_at timestamp
CREATE OR REPLACE FUNCTION update_drafts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_drafts_updated_at ON drafts;
CREATE TRIGGER trigger_update_drafts_updated_at
    BEFORE UPDATE ON drafts
    FOR EACH ROW
    EXECUTE FUNCTION update_drafts_updated_at();

-- Comments
COMMENT ON TABLE drafts IS 'Stores document drafts with Google Docs integration';
COMMENT ON COLUMN drafts.id IS 'Auto-incrementing primary key';
COMMENT ON COLUMN drafts.user_id IS 'User ID from auth service (INT)';
COMMENT ON COLUMN drafts.title IS 'Document title';
COMMENT ON COLUMN drafts.google_file_id IS 'Google Drive file ID (unique)';
COMMENT ON COLUMN drafts.gcs_path IS 'GCS bucket path for exported document';
COMMENT ON COLUMN drafts.last_synced_at IS 'Last time document was synced to GCS';
COMMENT ON COLUMN drafts.status IS 'Draft status (active, archived, etc.)';

