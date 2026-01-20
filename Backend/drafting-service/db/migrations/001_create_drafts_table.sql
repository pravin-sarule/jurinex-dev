-- Create extension for UUID generation if not exists
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create drafts table for document drafting workflow
CREATE TABLE IF NOT EXISTS drafts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    google_file_id VARCHAR(255) NOT NULL,
    template_file_id VARCHAR(255) NOT NULL,
    user_id VARCHAR(255) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'DRAFTING' CHECK (status IN ('DRAFTING', 'FINALIZED')),
    metadata JSONB DEFAULT '{}'::jsonb,
    file_name VARCHAR(500),
    file_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_drafts_user_id ON drafts(user_id);
CREATE INDEX IF NOT EXISTS idx_drafts_google_file_id ON drafts(google_file_id);
CREATE INDEX IF NOT EXISTS idx_drafts_template_file_id ON drafts(template_file_id);
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

-- Comments for documentation
COMMENT ON TABLE drafts IS 'Stores document drafts created from Google Docs templates';
COMMENT ON COLUMN drafts.id IS 'Unique identifier for the draft';
COMMENT ON COLUMN drafts.google_file_id IS 'Google Drive file ID of the created draft';
COMMENT ON COLUMN drafts.template_file_id IS 'Google Drive file ID of the source template';
COMMENT ON COLUMN drafts.user_id IS 'User who created the draft';
COMMENT ON COLUMN drafts.status IS 'Current status: DRAFTING (editable) or FINALIZED (locked)';
COMMENT ON COLUMN drafts.metadata IS 'JSONB storing template variables and other metadata';
COMMENT ON COLUMN drafts.file_name IS 'Name of the created draft file';
COMMENT ON COLUMN drafts.file_url IS 'Direct URL to the Google Docs file';

