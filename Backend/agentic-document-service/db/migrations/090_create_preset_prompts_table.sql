CREATE TABLE IF NOT EXISTS preset_prompts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    prompt_template TEXT NOT NULL,
    required_doc_types JSONB NOT NULL DEFAULT '[]'::jsonb,
    output_format VARCHAR(100) NOT NULL DEFAULT 'structured',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_preset_prompts_name_unique
    ON preset_prompts (LOWER(name));

CREATE INDEX IF NOT EXISTS idx_preset_prompts_active
    ON preset_prompts(is_active);

COMMENT ON TABLE preset_prompts IS 'Server-managed hidden prompt templates for reusable legal workflows.';

