-- Migration: Update chunk_vectors.chunk_id from bigint to UUID
-- This aligns with the new file_chunks.id being UUID

DO $$
BEGIN
    -- Check if chunk_vectors table exists
    IF EXISTS (
        SELECT 1 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'chunk_vectors'
    ) THEN
        -- Check if chunk_id column exists and is bigint
        IF EXISTS (
            SELECT 1 
            FROM information_schema.columns 
            WHERE table_schema = 'public' 
            AND table_name = 'chunk_vectors' 
            AND column_name = 'chunk_id'
            AND data_type = 'bigint'
        ) THEN
            RAISE NOTICE '🔄 Converting chunk_vectors.chunk_id from bigint to UUID...';
            
            -- Drop the unique constraint/index on chunk_id if it exists
            IF EXISTS (
                SELECT 1 
                FROM pg_constraint 
                WHERE conname = 'chunk_vectors_chunk_id_key'
            ) THEN
                ALTER TABLE chunk_vectors DROP CONSTRAINT chunk_vectors_chunk_id_key;
                RAISE NOTICE '✅ Dropped unique constraint on chunk_id';
            END IF;
            
            -- Drop any foreign key constraint if it exists
            IF EXISTS (
                SELECT 1 
                FROM pg_constraint 
                WHERE conname LIKE '%chunk_id%' 
                AND contype = 'f'
                AND conrelid = 'chunk_vectors'::regclass
            ) THEN
                -- Find and drop the foreign key
                DECLARE
                    fk_name TEXT;
                BEGIN
                    SELECT conname INTO fk_name
                    FROM pg_constraint 
                    WHERE conrelid = 'chunk_vectors'::regclass
                    AND contype = 'f'
                    AND conkey::text LIKE '%chunk_id%';
                    
                    IF fk_name IS NOT NULL THEN
                        EXECUTE format('ALTER TABLE chunk_vectors DROP CONSTRAINT %I', fk_name);
                        RAISE NOTICE '✅ Dropped foreign key constraint: %', fk_name;
                    END IF;
                END;
            END IF;
            
            -- Clear existing data (since bigint IDs can't be converted to UUIDs)
            -- WARNING: This will delete all existing chunk vectors!
            -- Comment out the next line if you want to preserve data
            DELETE FROM chunk_vectors;
            RAISE NOTICE '⚠️ Cleared existing chunk_vectors data (bigint IDs cannot be converted to UUIDs)';
            
            -- Change the column type to UUID
            ALTER TABLE chunk_vectors 
            ALTER COLUMN chunk_id TYPE UUID USING NULL;
            
            -- Re-add the unique constraint
            ALTER TABLE chunk_vectors 
            ADD CONSTRAINT chunk_vectors_chunk_id_key UNIQUE (chunk_id);
            RAISE NOTICE '✅ Re-added unique constraint on chunk_id';
            
            -- Re-add foreign key constraint to file_chunks
            IF EXISTS (
                SELECT 1 
                FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name = 'file_chunks'
            ) THEN
                ALTER TABLE chunk_vectors 
                ADD CONSTRAINT chunk_vectors_chunk_id_fkey 
                FOREIGN KEY (chunk_id) 
                REFERENCES file_chunks(id) 
                ON DELETE CASCADE;
                RAISE NOTICE '✅ Re-added foreign key constraint to file_chunks';
            END IF;
            
            RAISE NOTICE '✅ Successfully converted chunk_vectors.chunk_id to UUID';
        ELSE
            RAISE NOTICE '✅ chunk_vectors.chunk_id is already UUID or does not exist';
        END IF;
    ELSE
        RAISE NOTICE '⚠️ chunk_vectors table does not exist, skipping migration';
    END IF;
END $$;

