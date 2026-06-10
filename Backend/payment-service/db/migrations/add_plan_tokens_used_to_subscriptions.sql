-- Track tokens consumed from the plan quota (not topup) in the current billing period.
-- Reset to 0 whenever last_reset_date is updated (plan renewal).
-- This separates plan-source usage from topup-source usage so the monthly
-- plan cap is not inflated by topup consumption.

ALTER TABLE user_subscriptions
  ADD COLUMN IF NOT EXISTS plan_tokens_used INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN user_subscriptions.plan_tokens_used IS
  'Plan-source tokens consumed in the current billing period. Reset to 0 on billing period renewal. Does NOT include topup-sourced tokens.';
