DO $$
DECLARE
    fk_record RECORD;
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'prompt_extractions'
    ) THEN
        FOR fk_record IN
            SELECT con.conname AS constraint_name
            FROM pg_constraint con
            JOIN pg_class rel
              ON rel.oid = con.conrelid
            JOIN pg_attribute att
              ON att.attrelid = rel.oid
             AND att.attnum = ANY(con.conkey)
            WHERE rel.relname = 'prompt_extractions'
              AND con.contype = 'f'
              AND att.attname = 'input_template_id'
        LOOP
            EXECUTE format('ALTER TABLE prompt_extractions DROP CONSTRAINT IF EXISTS %I', fk_record.constraint_name);
        END LOOP;

        IF EXISTS (
            SELECT 1
            FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_name = 'input_templates'
        ) THEN
            ALTER TABLE prompt_extractions
                ADD CONSTRAINT prompt_extractions_input_template_id_fkey
                FOREIGN KEY (input_template_id)
                REFERENCES input_templates(id)
                ON DELETE SET NULL;
        END IF;
    END IF;
END $$;

COMMENT ON COLUMN prompt_extractions.input_template_id IS 'References input_templates(id) for prompt-based extraction workflows.';

