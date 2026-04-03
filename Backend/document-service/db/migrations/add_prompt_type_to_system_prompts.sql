-- Align with admin UIs that list id, system_prompt, created_at, updated_at, prompt_type.
-- Fixes empty table / missing column issues when querying system_prompts.

ALTER TABLE system_prompts
  ADD COLUMN IF NOT EXISTS prompt_type TEXT DEFAULT 'default';

COMMENT ON COLUMN system_prompts.prompt_type IS 'Category key (e.g. default, folder_chat).';

CREATE INDEX IF NOT EXISTS idx_system_prompts_prompt_type ON system_prompts (prompt_type);

-- Seed one row if the table has never been populated (common reason for "No rows").
INSERT INTO system_prompts (system_prompt, prompt_type)
SELECT
  'You are JuriNex Legal Assistant — an expert AI assistant specialised in legal matters. Provide accurate, well-reasoned legal information. Responses are informational only and not a substitute for advice from a licensed attorney.',
  'default'
WHERE NOT EXISTS (SELECT 1 FROM system_prompts LIMIT 1);
