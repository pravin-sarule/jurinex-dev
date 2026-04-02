CREATE TABLE IF NOT EXISTS file_chats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_id UUID REFERENCES user_files(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    session_id UUID NOT NULL,
    used_chunk_ids UUID[] DEFAULT ARRAY[]::UUID[],
    used_secret_prompt BOOLEAN DEFAULT FALSE,
    prompt_label TEXT,
    secret_id UUID,
    chat_history JSONB DEFAULT '[]'::jsonb,
    citations JSONB DEFAULT '[]'::jsonb,
    chat_type VARCHAR(50) DEFAULT 'analysis',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE file_chats
    ADD COLUMN IF NOT EXISTS used_chunk_ids UUID[] DEFAULT ARRAY[]::UUID[],
    ADD COLUMN IF NOT EXISTS used_secret_prompt BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS prompt_label TEXT,
    ADD COLUMN IF NOT EXISTS secret_id UUID,
    ADD COLUMN IF NOT EXISTS chat_history JSONB DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS citations JSONB DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS chat_type VARCHAR(50) DEFAULT 'analysis',
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_file_chats_file_id ON file_chats(file_id);
CREATE INDEX IF NOT EXISTS idx_file_chats_user_id ON file_chats(user_id);
CREATE INDEX IF NOT EXISTS idx_file_chats_session_id ON file_chats(session_id);
CREATE INDEX IF NOT EXISTS idx_file_chats_chat_type ON file_chats(chat_type);
CREATE INDEX IF NOT EXISTS idx_file_chats_citations ON file_chats USING GIN (citations);

COMMENT ON TABLE file_chats IS 'Single-document grounded chat history with chunk lineage and citations.';

