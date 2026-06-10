/**
 * Deduct purchased top-up tokens when usage exceeds the monthly plan allowance.
 *
 * Monthly model:
 *   totalAvailableThisCycle = monthlyLimit
 *   planCapacity = max(0, monthlyLimit - planTokensUsed)
 *
 * plan_tokens_used tracks ONLY plan-sourced tokens (not topup) so topup usage
 * never inflates the plan counter.
 *
 * Called after every usage is logged to llm_usage_logs.
 */
const pool = require('../config/db');

async function maybeDeductTopupAfterUsage(userId, tokensAdded) {
  const uid   = Number(userId);
  const added = Math.max(0, Math.floor(Number(tokensAdded) || 0));
  if (!Number.isInteger(uid) || uid <= 0 || added <= 0) return;

  try {
    const { rows: subRows } = await pool.query(
      `SELECT
         CASE WHEN (us.end_date IS NULL OR us.end_date >= (NOW() AT TIME ZONE 'Asia/Kolkata')::date)
              THEN COALESCE(mp.monthly_tokens, sp.token_limit, 0)
              ELSE 0
         END                                              AS monthly_limit,
         COALESCE(us.topup_token_balance, 0)             AS topup_balance,
         us.topup_expires_at,
         COALESCE(us.plan_tokens_used, 0)                AS plan_tokens_used
       FROM user_subscriptions us
       LEFT JOIN monthly_plans mp ON mp.id = us.monthly_plan_id
       LEFT JOIN subscription_plans sp ON sp.id = us.plan_id
       WHERE us.user_id = $1
         AND LOWER(COALESCE(us.status, 'active')) IN ('active', 'topup_only')
       ORDER BY us.updated_at DESC NULLS LAST
       LIMIT 1`,
      [uid]
    );
    const sub = subRows[0];
    if (!sub) return;

    const monthlyLimit   = Number(sub.monthly_limit    || 0);
    const topupBalance   = Number(sub.topup_balance    || 0);
    const planTokensUsed = Number(sub.plan_tokens_used || 0);

    if (monthlyLimit === 0) return;

    const topupExpiresAt = sub.topup_expires_at ? new Date(sub.topup_expires_at) : null;
    const topupValid     = topupBalance > 0 && (!topupExpiresAt || topupExpiresAt > new Date());

    const planCapacityRemaining = Math.max(0, monthlyLimit - planTokensUsed);
    const planAlreadyFull = planCapacityRemaining === 0;

    let planPortion = 0;
    let deduct      = 0;

    if (planAlreadyFull) {
      deduct = topupValid ? Math.min(added, topupBalance) : 0;
    } else {
      planPortion = Math.min(added, planCapacityRemaining);
      const topupNeeded = added - planPortion;
      deduct = topupValid ? Math.min(topupNeeded, topupBalance) : 0;
    }

    if (deduct > 0) {
      await pool.query(
        `UPDATE user_subscriptions SET
           topup_token_balance = GREATEST(0, topup_token_balance - $1),
           updated_at = CURRENT_TIMESTAMP
         WHERE user_id = $2
           AND topup_token_balance > 0
           AND (topup_expires_at IS NULL OR topup_expires_at > CURRENT_TIMESTAMP)`,
        [deduct, uid]
      );
    }

    if (planPortion > 0) {
      await pool.query(
        `UPDATE user_subscriptions SET
           plan_tokens_used = plan_tokens_used + $1,
           updated_at = CURRENT_TIMESTAMP
         WHERE user_id = $2`,
        [planPortion, uid]
      );
    }
  } catch (err) {
    console.warn('[TopupDeduction] failed:', err.message);
  }
}

module.exports = { maybeDeductTopupAfterUsage };
