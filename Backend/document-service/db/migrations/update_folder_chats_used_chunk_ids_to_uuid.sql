-- Migration: Update folder_chats.used_chunk_ids from bigint[] to UUID[]
-- This aligns with the new file_chunks.id being UUID

DO $$
BEGIN
    -- Check if folder_chats table exists
    IF EXISTS (
        SELECT 1 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'folder_chats'
    ) THEN
        -- Check if used_chunk_ids column exists and is bigint[]
        IF EXISTS (
            SELECT 1 
            FROM information_schema.columns 
            WHERE table_schema = 'public' 
            AND table_name = 'folder_chats' 
            AND column_name = 'used_chunk_ids'
            AND udt_name = '_int8'  -- bigint[] in PostgreSQL
        ) THEN
            RAISE NOTICE '🔄 Converting folder_chats.used_chunk_ids from bigint[] to UUID[]...';
            
            -- Clear existing data (since bigint IDs cannot be converted to UUIDs)
            -- WARNING: This will clear all used_chunk_ids data!
            -- Comment out the next line if you want to preserve data (though it won't be valid)
            UPDATE folder_chats SET used_chunk_ids = ARRAY[]::bigint[] WHERE used_chunk_ids IS NOT NULL;
            RAISE NOTICE '⚠️ Cleared existing used_chunk_ids data (bigint IDs cannot be converted to UUIDs)';
            
            -- Change the column type to UUID[]
            ALTER TABLE folder_chats 
            ALTER COLUMN used_chunk_ids TYPE UUID[] USING ARRAY[]::UUID[];
            
            -- Set default if not already set
            ALTER TABLE folder_chats 
            ALTER COLUMN used_chunk_ids SET DEFAULT ARRAY[]::UUID[];
            
            RAISE NOTICE '✅ Successfully converted folder_chats.used_chunk_ids to UUID[]';
        ELSIF EXISTS (
            SELECT 1 
            FROM information_schema.columns 
            WHERE table_schema = 'public' 
            AND table_name = 'folder_chats' 
            AND column_name = 'used_chunk_ids'
            AND udt_name = '_uuid'  -- uuid[] in PostgreSQL
        ) THEN
            RAISE NOTICE '✅ folder_chats.used_chunk_ids is already UUID[]';
        ELSE
            RAISE NOTICE '⚠️ folder_chats.used_chunk_ids column does not exist, creating it...';
            ALTER TABLE folder_chats
            ADD COLUMN used_chunk_ids UUID[] DEFAULT ARRAY[]::UUID[];
            RAISE NOTICE '✅ Created folder_chats.used_chunk_ids as UUID[]';
        END IF;
    ELSE
        RAISE NOTICE '⚠️ folder_chats table does not exist, skipping migration';
    END IF;
END $$;

