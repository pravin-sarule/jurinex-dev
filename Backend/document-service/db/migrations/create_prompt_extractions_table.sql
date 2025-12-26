-- Create prompt_extractions table for storing extracted data from prompts
CREATE TABLE IF NOT EXISTS prompt_extractions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    input_template_id UUID REFERENCES template_files(id) ON DELETE SET NULL,
    file_id UUID,
    session_id UUID,
    user_id UUID,
    extracted_data JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create index on input_template_id for faster queries
CREATE INDEX IF NOT EXISTS idx_prompt_extractions_input_template_id ON prompt_extractions(input_template_id);

-- Create index on file_id for faster queries
CREATE INDEX IF NOT EXISTS idx_prompt_extractions_file_id ON prompt_extractions(file_id);

-- Create index on session_id for faster queries
CREATE INDEX IF NOT EXISTS idx_prompt_extractions_session_id ON prompt_extractions(session_id);

-- Create index on user_id for faster queries
CREATE INDEX IF NOT EXISTS idx_prompt_extractions_user_id ON prompt_extractions(user_id);

-- Create index on created_at for faster queriesac
CREATE INDEX IF NOT EXISTS idx_prompt_extractions_created_at ON prompt_extractions(created_at DESC);

-- Add comment to table
COMMENT ON TABLE prompt_extractions IS 'Stores extracted data from prompts before sending to LLM';

-- Add a trigger to update the updated_at column on each update
CREATE OR REPLACE FUNCTION update_prompt_extractions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;a
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_prompt_extractions_updated_at
BEFORE UPDATE ON prompt_extractions
FOR EACH ROW
EXECUTE FUNCTION update_prompt_extractions_updated_at();

