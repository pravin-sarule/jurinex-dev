-- Link user_subscriptions to monthly_plans and track topup token balance.

ALTER TABLE user_subscriptions
  ADD COLUMN IF NOT EXISTS monthly_plan_id   INTEGER REFERENCES monthly_plans(id),
  ADD COLUMN IF NOT EXISTS topup_token_balance INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS topup_expires_at  TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_user_subs_monthly_plan ON user_subscriptions (monthly_plan_id)
  WHERE monthly_plan_id IS NOT NULL;
