-- Migration 151: Apply role/plan filters to existing preset_prompts
-- Run AFTER migration 150 (adds allowed_roles + allowed_plan_ids columns).
--
-- Usage: update the WHERE clause below to match the actual preset names/IDs in your DB.
-- Run against Document_DB.

-- ─── Step 1: Apply migration 150 first if not already done ────────────────────
ALTER TABLE preset_prompts
    ADD COLUMN IF NOT EXISTS allowed_roles     TEXT[]    NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS allowed_plan_ids  INTEGER[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_preset_prompts_roles     ON preset_prompts USING GIN (allowed_roles);
CREATE INDEX IF NOT EXISTS idx_preset_prompts_plan_ids  ON preset_prompts USING GIN (allowed_plan_ids);

-- ─── Step 2: Set role restrictions on role-specific presets ───────────────────
-- Update banking presets (visible only to users with role = 'banking')
UPDATE preset_prompts
SET allowed_roles = ARRAY['banking']
WHERE LOWER(name) LIKE '%bank%'
   OR LOWER(prompt_template) LIKE '%banking%'
   OR LOWER(prompt_template) LIKE '%bank loan%'
   OR LOWER(prompt_template) LIKE '%financial institution%';

-- Update family law presets (visible only to users with role = 'family')
UPDATE preset_prompts
SET allowed_roles = ARRAY['family']
WHERE LOWER(name) LIKE '%family%'
   OR LOWER(prompt_template) LIKE '%family law%'
   OR LOWER(prompt_template) LIKE '%divorce%'
   OR LOWER(prompt_template) LIKE '%custody%';

-- Update corporate / business presets
UPDATE preset_prompts
SET allowed_roles = ARRAY['corporate', 'business']
WHERE LOWER(name) LIKE '%corporate%'
   OR LOWER(prompt_template) LIKE '%corporate%'
   OR LOWER(prompt_template) LIKE '%merger%'
   OR LOWER(prompt_template) LIKE '%acquisition%';

-- ─── Step 3: Leave general legal presets globally visible (empty arrays) ──────
-- Presets where allowed_roles = '{}' are visible to ALL authenticated users.
-- Case Brief, Risk Scan, and similar general presets remain untouched.

-- ─── Step 4: Verify ───────────────────────────────────────────────────────────
-- Run this SELECT to review what was set:
-- SELECT id, name, allowed_roles, allowed_plan_ids FROM preset_prompts ORDER BY name;
