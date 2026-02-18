-- Drop the strict foreign key constraint that forces fields to be only from the system 'templates' table.
-- This allows template_user_field_values to reference custom templates from 'user_templates' as well.
ALTER TABLE template_user_field_values DROP CONSTRAINT IF EXISTS template_user_field_values_template_id_fkey;
