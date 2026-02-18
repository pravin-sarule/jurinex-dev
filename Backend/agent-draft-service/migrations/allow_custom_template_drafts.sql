-- Drop the strict foreign key constraint that forces templates to be only from the system 'templates' table.
-- This allows user_drafts to reference custom templates from 'user_templates' as well.
ALTER TABLE user_drafts DROP CONSTRAINT IF EXISTS fk_template_draft;
