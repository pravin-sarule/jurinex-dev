-- Migration: Update case_drafts table to use UUID for id and user_id
-- This aligns with the new schema where id is UUID with DEFAULT gen_random_uuid()

DO $$
BEGIN
    -- Check if case_drafts table exists
    IF EXISTS (
        SELECT 1 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'case_drafts'
    ) THEN
        -- Check if id column exists and is not UUID
        IF EXISTS (
            SELECT 1 
            FROM information_schema.columns 
            WHERE table_schema = 'public' 
            AND table_name = 'case_drafts' 
            AND column_name = 'id'
            AND data_type != 'uuid'
        ) THEN
            RAISE NOTICE '🔄 Converting case_drafts.id from integer to UUID...';
            
            -- Drop the unique constraint/index on user_id if it exists
            IF EXISTS (
                SELECT 1 
                FROM pg_constraint 
                WHERE conname = 'idx_case_drafts_user_id'
            ) THEN
                DROP INDEX IF EXISTS idx_case_drafts_user_id;
                RAISE NOTICE '✅ Dropped index idx_case_drafts_user_id';
            END IF;
            
            -- Drop foreign key constraint if it exists
            IF EXISTS (
                SELECT 1 
                FROM pg_constraint 
                WHERE conname LIKE '%case_drafts_user_id%' 
                AND contype = 'f'
            ) THEN
                -- Find and drop the foreign key
                DECLARE
                    fk_name TEXT;
                BEGIN
                    SELECT conname INTO fk_name
                    FROM pg_constraint 
                    WHERE conrelid = 'case_drafts'::regclass
                    AND contype = 'f'
                    AND conkey::text LIKE '%user_id%';
                    
                    IF fk_name IS NOT NULL THEN
                        EXECUTE format('ALTER TABLE case_drafts DROP CONSTRAINT %I', fk_name);
                        RAISE NOTICE '✅ Dropped foreign key constraint: %', fk_name;
                    END IF;
                END;
            END IF;
            
            -- Clear existing data (since integer IDs cannot be converted to UUIDs)
            -- WARNING: This will delete all existing drafts!
            DELETE FROM case_drafts;
            RAISE NOTICE '⚠️ Cleared existing case_drafts data (integer IDs cannot be converted to UUIDs)';
            
            -- Change id column type to UUID
            ALTER TABLE case_drafts 
            ALTER COLUMN id TYPE UUID USING NULL;
            
            -- Set default for id
            ALTER TABLE case_drafts 
            ALTER COLUMN id SET DEFAULT gen_random_uuid();
            
            -- Change user_id column type to UUID if it's not already
            IF EXISTS (
                SELECT 1 
                FROM information_schema.columns 
                WHERE table_schema = 'public' 
                AND table_name = 'case_drafts' 
                AND column_name = 'user_id'
                AND data_type != 'uuid'
            ) THEN
                ALTER TABLE case_drafts 
                ALTER COLUMN user_id TYPE UUID USING NULL;
                RAISE NOTICE '✅ Converted user_id to UUID';
            END IF;
            
            -- Re-add the unique index on user_id
            CREATE UNIQUE INDEX IF NOT EXISTS idx_case_drafts_user_id
            ON case_drafts (user_id);
            RAISE NOTICE '✅ Re-added unique index on user_id';
            
            -- Re-add foreign key constraint to user_files if the table exists
            IF EXISTS (
                SELECT 1 
                FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name = 'user_files'
            ) THEN
                ALTER TABLE case_drafts 
                ADD CONSTRAINT case_drafts_user_id_fkey 
                FOREIGN KEY (user_id) 
                REFERENCES user_files(id) 
                ON DELETE CASCADE;
                RAISE NOTICE '✅ Re-added foreign key constraint to user_files';
            END IF;
            
            RAISE NOTICE '✅ Successfully converted case_drafts.id to UUID';
        ELSE
            RAISE NOTICE '✅ case_drafts.id is already UUID or does not exist';
        END IF;
        
        -- Ensure user_id is UUID
        IF EXISTS (
            SELECT 1 
            FROM information_schema.columns 
            WHERE table_schema = 'public' 
            AND table_name = 'case_drafts' 
            AND column_name = 'user_id'
            AND data_type != 'uuid'
        ) THEN
            RAISE NOTICE '🔄 Converting case_drafts.user_id to UUID...';
            ALTER TABLE case_drafts 
            ALTER COLUMN user_id TYPE UUID USING NULL;
            RAISE NOTICE '✅ Converted user_id to UUID';
        END IF;
        
        -- Ensure id has DEFAULT gen_random_uuid()
        IF EXISTS (
            SELECT 1 
            FROM information_schema.columns 
            WHERE table_schema = 'public' 
            AND table_name = 'case_drafts' 
            AND column_name = 'id'
            AND (column_default IS NULL OR column_default NOT LIKE '%gen_random_uuid%')
        ) THEN
            ALTER TABLE case_drafts 
            ALTER COLUMN id SET DEFAULT gen_random_uuid();
            RAISE NOTICE '✅ Set DEFAULT gen_random_uuid() for id';
        END IF;
    ELSE
        RAISE NOTICE '⚠️ case_drafts table does not exist, skipping migration';
    END IF;
END $$;

