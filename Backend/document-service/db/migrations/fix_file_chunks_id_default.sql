-- Migration: Fix file_chunks.id column to have DEFAULT value
-- This ensures the id column auto-generates when not provided in INSERT statements

-- Check if the table exists
DO $$
BEGIN
    -- Check if file_chunks table exists
    IF EXISTS (
        SELECT 1 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'file_chunks'
    ) THEN
        -- Check if id column exists and doesn't have a default
        IF EXISTS (
            SELECT 1 
            FROM information_schema.columns 
            WHERE table_schema = 'public' 
            AND table_name = 'file_chunks' 
            AND column_name = 'id'
            AND column_default IS NULL
        ) THEN
            -- Determine the column type and set appropriate default
            -- If it's INTEGER, make it SERIAL-like with a sequence
            -- If it's already SERIAL, ensure the sequence is linked
            
            -- Try to create or get the sequence
            IF NOT EXISTS (
                SELECT 1 
                FROM pg_sequences 
                WHERE schemaname = 'public' 
                AND sequencename = 'file_chunks_id_seq'
            ) THEN
                -- Create sequence if it doesn't exist
                CREATE SEQUENCE IF NOT EXISTS file_chunks_id_seq;
                
                -- Set the sequence to start from the max id + 1
                PERFORM setval(
                    'file_chunks_id_seq',
                    COALESCE((SELECT MAX(id) FROM file_chunks), 0) + 1,
                    false
                );
            END IF;
            
            -- Set the default to use the sequence
            ALTER TABLE public.file_chunks 
            ALTER COLUMN id SET DEFAULT nextval('file_chunks_id_seq'::regclass);
            
            -- Make sure the sequence is owned by the column
            ALTER SEQUENCE file_chunks_id_seq OWNED BY file_chunks.id;
            
            RAISE NOTICE '✅ Fixed file_chunks.id column to have DEFAULT nextval';
        ELSE
            RAISE NOTICE '✅ file_chunks.id already has a DEFAULT value';
        END IF;
    ELSE
        RAISE NOTICE '⚠️ file_chunks table does not exist, skipping migration';
    END IF;
END $$;

