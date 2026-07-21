-- 160: User-defined custom prompt groups (folders) + prompts.
--
-- Users can build their own prompt library next to the admin-managed preset
-- prompts (secret_manager). A group is a per-user folder; each folder holds
-- any number of prompts. Prompts can be hand-written or AI-generated from a
-- plain-language description (POST /custom-prompts/generate in both the
-- agentic-chat-service and the agentic-document-service).
--
-- Both services share DATABASE_URL, so these tables are visible to both.
-- The services also run this DDL lazily (CREATE TABLE IF NOT EXISTS) on first
-- use, so applying this file manually is optional but recommended.

CREATE TABLE IF NOT EXISTS user_prompt_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_prompt_groups_user_name
    ON user_prompt_groups (user_id, LOWER(name));

CREATE INDEX IF NOT EXISTS idx_user_prompt_groups_user
    ON user_prompt_groups (user_id);

CREATE TABLE IF NOT EXISTS user_custom_prompts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id UUID NOT NULL REFERENCES user_prompt_groups(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    prompt_text TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_custom_prompts_group
    ON user_custom_prompts (group_id);

CREATE INDEX IF NOT EXISTS idx_user_custom_prompts_user
    ON user_custom_prompts (user_id);
