-- Mirror auth users.active_plan_id for services that read Document_DB.users
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS active_plan_id INTEGER,
  ADD COLUMN IF NOT EXISTS active_plan_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS active_plan_updated_at TIMESTAMPTZ;
