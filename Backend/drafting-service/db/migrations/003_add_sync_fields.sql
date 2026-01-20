-- Migration: Add fields for file synchronization system
-- Adds: drive_item_id, drive_path, last_opened_at, editor_type (if not exists)

-- Add editor_type if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'drafts' AND column_name = 'editor_type'
    ) THEN
        ALTER TABLE drafts ADD COLUMN editor_type VARCHAR(50);
    END IF;
END $$;

-- Add drive_item_id (same as google_file_id, but kept for clarity)
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'drafts' AND column_name = 'drive_item_id'
    ) THEN
        ALTER TABLE drafts ADD COLUMN drive_item_id VARCHAR(100);
        -- Populate drive_item_id from google_file_id if it exists
        UPDATE drafts SET drive_item_id = google_file_id WHERE google_file_id IS NOT NULL AND drive_item_id IS NULL;
    END IF;
END $$;

-- Add drive_path (path in Google Drive)
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'drafts' AND column_name = 'drive_path'
    ) THEN
        ALTER TABLE drafts ADD COLUMN drive_path VARCHAR(512);
    END IF;
END $$;

-- Add last_opened_at (timestamp when document was last opened)
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'drafts' AND column_name = 'last_opened_at'
    ) THEN
        ALTER TABLE drafts ADD COLUMN last_opened_at TIMESTAMP;
    END IF;
END $$;

-- Create index on drive_item_id
CREATE INDEX IF NOT EXISTS idx_drafts_drive_item_id ON drafts(drive_item_id);

-- Comments
COMMENT ON COLUMN drafts.editor_type IS 'Editor type: google, local, etc.';
COMMENT ON COLUMN drafts.drive_item_id IS 'Google Drive item ID (same as google_file_id)';
COMMENT ON COLUMN drafts.drive_path IS 'Path in Google Drive';
COMMENT ON COLUMN drafts.last_opened_at IS 'Last time document was opened by user';


