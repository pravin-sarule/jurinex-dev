-- Migration: Add sort_order column to dt_draft_section_prompts table
-- Date: 2026-02-04
-- Description: Adds support for custom section ordering

ALTER TABLE dt_draft_section_prompts 
ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;

COMMENT ON COLUMN dt_draft_section_prompts.sort_order IS 'Custom display order for the section in this draft';
