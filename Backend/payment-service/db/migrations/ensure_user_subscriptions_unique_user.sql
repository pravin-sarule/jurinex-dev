-- One active subscription row per user (required for ON CONFLICT (user_id) in payment verify).
CREATE UNIQUE INDEX IF NOT EXISTS user_subscriptions_user_id_unique ON user_subscriptions (user_id);
