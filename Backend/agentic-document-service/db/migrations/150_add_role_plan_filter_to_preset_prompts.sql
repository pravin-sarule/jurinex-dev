-- Add role-based and plan-based visibility filtering to preset_prompts.
-- BOTH allowed_roles AND allowed_plan_ids must be non-empty on a preset.
-- User sees the preset only when their role is in allowed_roles AND plan id is in allowed_plan_ids.

ALTER TABLE preset_prompts
    ADD COLUMN IF NOT EXISTS allowed_roles     TEXT[]    NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS allowed_plan_ids  INTEGER[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN preset_prompts.allowed_roles    IS 'Non-empty role slugs; user role must match one entry.';
COMMENT ON COLUMN preset_prompts.allowed_plan_ids IS 'Non-empty plan ids; user active plan must match one entry.';

CREATE INDEX IF NOT EXISTS idx_preset_prompts_roles
    ON preset_prompts USING GIN (allowed_roles);

CREATE INDEX IF NOT EXISTS idx_preset_prompts_plan_ids
    ON preset_prompts USING GIN (allowed_plan_ids);
