-- Create system_prompts table for storing LLM system prompts
CREATE TABLE IF NOT EXISTS system_prompts (
    id SERIAL PRIMARY KEY,
    system_prompt TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Create index on updated_at for faster queries when fetching latest prompt
CREATE INDEX IF NOT EXISTS idx_system_prompts_updated_at ON system_prompts(updated_at DESC);

-- Add comment to table
COMMENT ON TABLE system_prompts IS 'Stores system prompts used for all LLM models in the document service';

-- Add a trigger to update the updated_at column on each update
-- (Using the existing update_updated_at_column function if it exists, otherwise create it)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_system_prompts_updated_at
BEFORE UPDATE ON system_prompts
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

