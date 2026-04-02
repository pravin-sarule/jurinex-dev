DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'folder_chats'
          AND column_name = 'used_chunk_ids'
          AND udt_name <> '_uuid'
    ) THEN
        UPDATE folder_chats
           SET used_chunk_ids = ARRAY[]::uuid[]
         WHERE used_chunk_ids IS NOT NULL;

        ALTER TABLE folder_chats
            ALTER COLUMN used_chunk_ids TYPE UUID[]
            USING ARRAY[]::UUID[];
    END IF;
END $$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'file_chats'
          AND column_name = 'used_chunk_ids'
          AND udt_name <> '_uuid'
    ) THEN
        ALTER TABLE file_chats
            ALTER COLUMN used_chunk_ids TYPE UUID[]
            USING ARRAY[]::UUID[];
    END IF;
END $$;
