-- Create input_templates table for storing prompt templates
CREATE TABLE IF NOT EXISTS input_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    prompt TEXT NULL,
    created_by UUID,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create index on created_at for faster queries
CREATE INDEX IF NOT EXISTS idx_input_templates_created_at ON input_templates(created_at DESC);

-- Create index on created_by for user-specific queries
CREATE INDEX IF NOT EXISTS idx_input_templates_created_by ON input_templates(created_by);

-- Add comment to table
COMMENT ON TABLE input_templates IS 'Stores prompt templates that users can select for document analysis';

-- Add a trigger to update the updated_at column on each update
CREATE OR REPLACE FUNCTION update_input_templates_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_input_templates_updated_at
BEFORE UPDATE ON input_templates
FOR EACH ROW
EXECUTE FUNCTION update_input_templates_updated_at();

