-- Backfill: migrate existing FREE-plan subscriptions to the admin-managed
-- monthly free plan (the active monthly_plans row with price = 0, e.g.
-- "Free Trial" / 300k tokens). Before this, free users were on the legacy
-- subscription_plans "free" row (e.g. 2k tokens), so billing/limits ignored the
-- admin's monthly-plan config.
--
-- SAFE: only touches users currently on the legacy free plan (monthly_plan_id
-- NULL AND their subscription_plan is free — name 'free' OR price 0). Paid users
-- (monthly_plan_id set, or a priced subscription_plan) are left untouched.
-- Idempotent: re-running changes nothing once users already point at the plan.
--
-- Run once:  psql "$PAYMENT_DB_URL" -f Backend/payment-service/db/migrations/backfill_free_users_to_monthly_plan.sql

DO $$
DECLARE
  free_mp_id     INTEGER;
  free_mp_tokens INTEGER;
  moved          INTEGER;
BEGIN
  SELECT id, monthly_tokens
    INTO free_mp_id, free_mp_tokens
  FROM monthly_plans
  WHERE price = 0 AND is_active = true
  ORDER BY (monthly_tokens > 0) DESC, sort_order ASC, id ASC
  LIMIT 1;

  IF free_mp_id IS NULL THEN
    RAISE NOTICE 'No active price-0 monthly plan found — nothing to backfill.';
    RETURN;
  END IF;

  UPDATE user_subscriptions us
  SET monthly_plan_id       = free_mp_id,
      plan_id               = NULL,
      current_token_balance = COALESCE(free_mp_tokens, 0),
      plan_tokens_used      = 0,
      last_reset_date       = CURRENT_DATE,
      status                = 'active',
      updated_at            = CURRENT_TIMESTAMP
  FROM subscription_plans sp
  WHERE us.monthly_plan_id IS NULL
    AND us.plan_id = sp.id
    AND (LOWER(sp.name) = 'free' OR COALESCE(sp.price, 0) = 0);

  GET DIAGNOSTICS moved = ROW_COUNT;
  RAISE NOTICE 'Backfilled % free subscription(s) to monthly plan id % (% tokens).',
    moved, free_mp_id, free_mp_tokens;
END $$;
