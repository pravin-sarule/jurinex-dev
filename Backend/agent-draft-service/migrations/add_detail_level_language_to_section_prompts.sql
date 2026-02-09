-- Migration: Add detail_level and language columns to dt_draft_section_prompts table
-- Date: 2026-02-04
-- Description: Adds support for language selection and detail level (detailed/concise/short) per section

-- Add detail_level column (default: 'concise')
ALTER TABLE dt_draft_section_prompts 
ADD COLUMN IF NOT EXISTS detail_level VARCHAR(20) DEFAULT 'concise';

-- Add language column (default: 'en' for English)
ALTER TABLE dt_draft_section_prompts 
ADD COLUMN IF NOT EXISTS language VARCHAR(10) DEFAULT 'en';

-- Add comments for documentation
COMMENT ON COLUMN dt_draft_section_prompts.detail_level IS 'Level of detail for section generation: detailed, concise, or short';
COMMENT ON COLUMN dt_draft_section_prompts.language IS 'Language code for section generation (e.g., en, hi, bn, te, etc.)';
