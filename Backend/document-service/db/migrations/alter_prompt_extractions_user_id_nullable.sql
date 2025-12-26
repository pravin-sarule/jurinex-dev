-- Alter prompt_extractions table to make user_id nullable
-- This allows storing extractions even when userId is not a valid UUID
ALTER TABLE prompt_extractions 
ALTER COLUMN user_id DROP NOT NULL;


