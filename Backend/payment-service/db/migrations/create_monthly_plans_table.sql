-- monthly_plans: subscription plans with daily token limits and Razorpay plan IDs.
-- This table drives the plan selection UI and subscription creation flow.

CREATE TABLE IF NOT EXISTS monthly_plans (
  id                     SERIAL PRIMARY KEY,
  name                   VARCHAR(100)          NOT NULL,
  description            TEXT,
  price                  NUMERIC(10, 2)        NOT NULL DEFAULT 0,
  currency               VARCHAR(10)           NOT NULL DEFAULT 'INR',
  monthly_tokens         INTEGER               NOT NULL DEFAULT 0,
  daily_token_limit      INTEGER               NOT NULL DEFAULT 0,
  is_active              BOOLEAN               NOT NULL DEFAULT true,
  sort_order             INTEGER               NOT NULL DEFAULT 0,
  razorpay_plan_id       VARCHAR(100),
  billing_interval_months INTEGER              NOT NULL DEFAULT 1,
  created_at             TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at             TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_monthly_plans_active ON monthly_plans (is_active, sort_order);

-- Auto-update updated_at on row change
CREATE OR REPLACE FUNCTION update_monthly_plans_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_monthly_plans_updated_at ON monthly_plans;
CREATE TRIGGER trg_monthly_plans_updated_at
  BEFORE UPDATE ON monthly_plans
  FOR EACH ROW EXECUTE FUNCTION update_monthly_plans_updated_at();
