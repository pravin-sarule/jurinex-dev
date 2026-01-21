-- Migration: Add last_activity column to agent_file_chats table
-- This column tracks when a session was last active for auto-deletion

-- Add last_activity column if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'agent_file_chats' 
        AND column_name = 'last_activity'
    ) THEN
        ALTER TABLE agent_file_chats 
        ADD COLUMN last_activity TIMESTAMP DEFAULT NOW();
        
        -- Set initial last_activity for existing records
        UPDATE agent_file_chats 
        SET last_activity = created_at 
        WHERE last_activity IS NULL;
        
        -- Create index for faster cleanup queries
        CREATE INDEX IF NOT EXISTS idx_agent_file_chats_last_activity 
        ON agent_file_chats(last_activity);
        
        CREATE INDEX IF NOT EXISTS idx_agent_file_chats_session_id 
        ON agent_file_chats(session_id);
        
        RAISE NOTICE 'Added last_activity column and indexes to agent_file_chats table';
    ELSE
        RAISE NOTICE 'Column last_activity already exists in agent_file_chats table';
    END IF;
END $$;
