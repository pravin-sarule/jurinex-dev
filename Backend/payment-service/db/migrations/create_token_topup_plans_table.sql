-- token_topup_plans: one-time purchasable token packs.
-- Tokens credited to user_subscriptions.topup_token_balance after payment.

CREATE TABLE IF NOT EXISTS token_topup_plans (
  id               SERIAL PRIMARY KEY,
  name             VARCHAR(100)          NOT NULL,
  description      TEXT,
  price            NUMERIC(10, 2)        NOT NULL DEFAULT 0,
  currency         VARCHAR(10)           NOT NULL DEFAULT 'INR',
  tokens           INTEGER               NOT NULL DEFAULT 0,
  validity_days    INTEGER               NOT NULL DEFAULT 30,
  is_active        BOOLEAN               NOT NULL DEFAULT true,
  sort_order       INTEGER               NOT NULL DEFAULT 0,
  razorpay_plan_id VARCHAR(100),
  created_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_token_topup_plans_active ON token_topup_plans (is_active, sort_order);

CREATE OR REPLACE FUNCTION update_token_topup_plans_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_token_topup_plans_updated_at ON token_topup_plans;
CREATE TRIGGER trg_token_topup_plans_updated_at
  BEFORE UPDATE ON token_topup_plans
  FOR EACH ROW EXECUTE FUNCTION update_token_topup_plans_updated_at();

-- Track individual topup purchases for audit / expiry enforcement
CREATE TABLE IF NOT EXISTS user_token_topup_purchases (
  id                   SERIAL PRIMARY KEY,
  user_id              INTEGER               NOT NULL,
  topup_plan_id        INTEGER               NOT NULL REFERENCES token_topup_plans(id),
  tokens_credited      INTEGER               NOT NULL DEFAULT 0,
  razorpay_order_id    VARCHAR(100),
  razorpay_payment_id  VARCHAR(100),
  razorpay_signature   VARCHAR(256),
  amount               NUMERIC(10, 2),
  currency             VARCHAR(10)           DEFAULT 'INR',
  status               VARCHAR(20)           NOT NULL DEFAULT 'pending',
  expires_at           TIMESTAMP WITH TIME ZONE,
  created_at           TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_user_token_topup_user ON user_token_topup_purchases (user_id, status, expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_token_topup_payment ON user_token_topup_purchases (razorpay_payment_id)
  WHERE razorpay_payment_id IS NOT NULL;
