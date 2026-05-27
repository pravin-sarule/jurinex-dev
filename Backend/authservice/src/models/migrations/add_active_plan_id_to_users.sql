-- Denormalized active subscription plan (subscription_plans.id from Payment_DB).
-- Updated by payment-service after successful checkout.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS active_plan_id INTEGER,
  ADD COLUMN IF NOT EXISTS active_plan_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS active_plan_updated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_users_active_plan_id ON users (active_plan_id);
