ALTER TABLE dt_draft_section_prompts
ADD COLUMN IF NOT EXISTS section_name TEXT,
ADD COLUMN IF NOT EXISTS section_type TEXT;
