/**
 * Central token quota check — single source of truth for all backend services.
 *
 * Monthly model:
 *   planExhausted = planTokensUsed >= monthlyLimit
 *
 *   planTokensUsed tracks ONLY plan-sourced tokens (not topup), so topup usage
 *   does not inflate the monthly cap.
 *
 * Topup model:
 *   Topup tokens are consumed only when the plan is exhausted.
 *   topup_token_balance is tracked in user_subscriptions.
 */
const db = require('../config/db');
const { fetchFirmContext } = require('./firmContextService');

function nextUtcMidnight() {
  const now = new Date();
  return new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0, 0, 0, 0
  ));
}

function getCurrentMonthWindow() {
  const now = new Date();
  const startDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
  const endDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999));
  return { startDate, endDate };
}

/**
 * @param {number|string} userId
 * @param {{ estimatedTokens?: number, checkFirmCap?: boolean, service?: string, endpoint?: string }} opts
 */
async function checkUserTokenAvailability(userId, opts = {}) {
  const uid = Number(userId);
  const estimatedTokens = Math.max(0, Math.floor(Number(opts.estimatedTokens) || 0));
  const checkFirmCap = opts.checkFirmCap !== false;

  if (!Number.isInteger(uid) || uid <= 0) {
    return {
      allowed: false,
      blocked: true,
      code: 'INVALID_USER',
      message: 'Valid user id is required.',
      details: {},
    };
  }

  // Today's usage (IST calendar day) — used for daily limit check and UI display
  const usageResult = await db.query(
    `SELECT
       COALESCE(
         SUM(total_tokens) FILTER (
           WHERE (used_at AT TIME ZONE 'Asia/Kolkata')::date = (NOW() AT TIME ZONE 'Asia/Kolkata')::date
         ),
         0
       )::bigint AS tokens_today
     FROM public.llm_usage_logs
     WHERE user_id = $1`,
    [uid]
  );
  const tokensToday = Number(usageResult.rows[0]?.tokens_today || 0);

  // Subscription: fetch plan limits and plan-source token consumption.
  // plan_tokens_used tracks only plan-sourced tokens (not topup) so monthly cap
  // is not inflated by topup usage. Zero out plan limits when plan is expired.
  const subResult = await db.query(
    `SELECT
       CASE WHEN (us.topup_expires_at IS NULL OR us.topup_expires_at > NOW())
            THEN COALESCE(us.topup_token_balance, 0)
            ELSE 0
       END                                                AS topup_token_balance,
       COALESCE(us.last_reset_date, us.start_date)       AS billing_period_start,
       CASE WHEN (us.end_date IS NULL OR us.end_date >= (NOW() AT TIME ZONE 'Asia/Kolkata')::date)
            THEN COALESCE(mp.monthly_tokens, sp.token_limit, 0)
            ELSE 0
       END                                                AS monthly_tokens,
       COALESCE(mp.name, sp.name)                        AS plan_name,
       mp.id                                             AS monthly_plan_id,
       COALESCE(us.plan_tokens_used, 0)                  AS plan_tokens_used
     FROM user_subscriptions us
     LEFT JOIN monthly_plans mp    ON mp.id = us.monthly_plan_id
     LEFT JOIN subscription_plans sp ON sp.id = us.plan_id
     WHERE us.user_id = $1
       AND LOWER(COALESCE(us.status, 'active')) IN ('active', 'topup_only')
     ORDER BY us.updated_at DESC
     LIMIT 1`,
    [uid]
  );

  const sub = subResult.rows[0] || {};
  const monthlyLimit = Number(sub.monthly_tokens || 0);
  const topupBalance = Number(sub.topup_token_balance || 0);

  // ── FREE TIER GATE (₹150 cumulative INR limit) ─────────────────────────────
  // Applies when the user has no paid plan AND no top-up balance.
  const FREE_TIER_LIMIT_INR = 150;
  const isFreeTier = !subResult.rows.length || (monthlyLimit === 0 && topupBalance === 0);

  if (isFreeTier) {
    const costRes = await db.query(
      `SELECT COALESCE(SUM(total_cost), 0)::numeric AS total_cost_inr
       FROM public.llm_usage_logs
       WHERE user_id = $1`,
      [uid]
    );
    const usedInr   = parseFloat(costRes.rows[0]?.total_cost_inr || 0);
    const remainInr = Math.max(0, FREE_TIER_LIMIT_INR - usedInr);
    const pctUsed   = Math.min(100, (usedInr / FREE_TIER_LIMIT_INR) * 100);

    if (usedInr >= FREE_TIER_LIMIT_INR) {
      return {
        allowed:      false,
        blocked:      true,
        source:       'none',
        code:         'FREE_TIER_QUOTA_EXHAUSTED',
        message:      `Your free quota of ₹${FREE_TIER_LIMIT_INR} has been exhausted. Upgrade to a plan to continue using all AI features.`,
        block_reason: 'free_tier',
        shared_pool:  true,
        plan_name:    null,
        monthly_plan_id: null,
        tokens_used_today: tokensToday,
        tokens_used_this_period: 0,
        plan_tokens_used_this_period: 0,
        monthly_token_limit: 0,
        total_available_this_cycle: null,
        topup_token_balance: 0,
        plan_exhausted:  false,
        monthly_exhausted: false,
        can_use_topup:   false,
        remaining: { monthly: null, plan: null, topup: 0 },
        estimated_tokens: estimatedTokens,
        reset_at_utc: nextUtcMidnight().toISOString(),
        free_tier: {
          is_free_tier:    true,
          limit_inr:       FREE_TIER_LIMIT_INR,
          used_inr:        usedInr,
          remaining_inr:   0,
          percentage_used: 100,
          exhausted:       true,
        },
        firm_cap: { enforced: false, allowed: true },
      };
    }

    // Free tier still has budget — allow but attach free_tier metadata
    const freeTierMeta = {
      is_free_tier:    true,
      limit_inr:       FREE_TIER_LIMIT_INR,
      used_inr:        usedInr,
      remaining_inr:   remainInr,
      percentage_used: pctUsed,
      exhausted:       false,
    };

    // Build a lean allowed response for free-tier users
    return {
      allowed:      true,
      blocked:      false,
      source:       'free_tier',
      code:         null,
      message:      null,
      block_reason: null,
      shared_pool:  true,
      plan_name:    'Free',
      monthly_plan_id: null,
      tokens_used_today: tokensToday,
      tokens_used_this_period: 0,
      plan_tokens_used_this_period: 0,
      monthly_token_limit: 0,
      total_available_this_cycle: null,
      topup_token_balance: 0,
      plan_exhausted:  false,
      monthly_exhausted: false,
      can_use_topup:   false,
      remaining: { monthly: null, plan: null, topup: 0 },
      estimated_tokens: estimatedTokens,
      reset_at_utc: nextUtcMidnight().toISOString(),
      free_tier: freeTierMeta,
      firm_cap: { enforced: false, allowed: true },
    };
  }
  // ── END FREE TIER GATE ─────────────────────────────────────────────────────
  const billingPeriodStart = sub.billing_period_start || null;
  // Plan-sourced tokens this billing period (excludes topup tokens)
  const planTokensUsed = Number(sub.plan_tokens_used || 0);

  // Total tokens used since billing period start (plan + topup combined, for UI display only)
  let tokensThisPeriod = tokensToday;
  if (billingPeriodStart) {
    const periodResult = await db.query(
      `SELECT COALESCE(SUM(total_tokens), 0)::bigint AS tokens_period
       FROM public.llm_usage_logs
       WHERE user_id = $1
         AND used_at >= $2::timestamptz`,
      [uid, billingPeriodStart]
    );
    tokensThisPeriod = Number(periodResult.rows[0]?.tokens_period || 0);
  }

  // Monthly availability: planTokensUsed (plan-source only) vs monthlyLimit
  const totalAvailableThisCycle = monthlyLimit > 0 ? monthlyLimit : null;
  const planExhausted = totalAvailableThisCycle !== null && planTokensUsed >= totalAvailableThisCycle;

  const effectiveTopup = topupBalance;
  const canUseTopup = effectiveTopup > 0 && planExhausted;
  const planBlocked = planExhausted && effectiveTopup <= 0;

  const monthlyRemaining = monthlyLimit > 0 ? Math.max(0, monthlyLimit - planTokensUsed) : null;
  const monthlyExhausted = monthlyLimit > 0 && planTokensUsed >= monthlyLimit;

  let source = 'unlimited';
  if (totalAvailableThisCycle !== null) {
    if (planBlocked) source = 'none';
    else if (canUseTopup) source = 'topup';
    else source = 'plan';
  }

  let blockReason = null;
  let code = null;
  let message = null;

  if (planExhausted && effectiveTopup <= 0) {
    blockReason = 'monthly';
    code = 'MONTHLY_TOKEN_LIMIT_EXHAUSTED';
    message = (
      'You have used all your monthly plan tokens. '
      + 'Purchase a top-up to continue, upgrade your plan, or wait for your next billing date.'
    );
  }

  // Insufficient tokens for the estimated task size (plan pool only; topup allows continuation)
  if (!planBlocked && estimatedTokens > 0 && source === 'plan') {
    if (monthlyRemaining != null && estimatedTokens > monthlyRemaining) {
      if (effectiveTopup <= 0) {
        code = 'INSUFFICIENT_TOKENS';
        message = `This task needs about ${estimatedTokens.toLocaleString()} tokens but you only have ${monthlyRemaining.toLocaleString()} remaining this month.`;
        blockReason = 'insufficient';
      }
    }
  }

  const blocked = !!code;
  const allowed = !blocked;

  const data = {
    allowed,
    blocked,
    source,
    code,
    message,
    block_reason: blockReason,
    shared_pool: true,
    plan_name: sub.plan_name || null,
    monthly_plan_id: sub.monthly_plan_id || null,
    tokens_used_today: tokensToday,
    tokens_used_this_period: tokensThisPeriod,
    plan_tokens_used_this_period: planTokensUsed,
    monthly_token_limit: monthlyLimit,
    total_available_this_cycle: totalAvailableThisCycle,
    topup_token_balance: effectiveTopup,
    plan_exhausted: planExhausted,
    monthly_exhausted: monthlyExhausted,
    can_use_topup: canUseTopup,
    remaining: {
      monthly: monthlyRemaining,
      plan: monthlyRemaining,
      topup: effectiveTopup > 0 ? effectiveTopup : 0,
    },
    estimated_tokens: estimatedTokens,
    reset_at_utc: nextUtcMidnight().toISOString(),
    service: opts.service || null,
    endpoint: opts.endpoint || null,
    firm_cap:  { enforced: false, allowed: true },
    free_tier: null,
  };

  if (checkFirmCap && allowed) {
    try {
      const firmContext = await fetchFirmContext(uid);
      const accountType = String(firmContext?.accountType || '').toUpperCase();
      if (firmContext?.firmId && accountType === 'FIRM_USER') {
        const limitResult = await db.query(
          `SELECT monthly_token_limit, hard_stop_enabled
           FROM firm_user_token_limits
           WHERE firm_id = $1 AND user_id = $2
           LIMIT 1`,
          [firmContext.firmId, uid]
        );
        const limitRow = limitResult.rows[0];
        if (limitRow && limitRow.monthly_token_limit != null) {
          const { startDate, endDate } = getCurrentMonthWindow();
          const firmUsage = await db.query(
            `SELECT COALESCE(SUM(total_tokens), 0)::bigint AS total_tokens
             FROM public.llm_usage_logs
             WHERE user_id = $1 AND used_at >= $2 AND used_at <= $3`,
            [uid, startDate, endDate]
          );
          const usedFirmMonth = Number(firmUsage.rows[0]?.total_tokens || 0);
          const firmLimit = Number(limitRow.monthly_token_limit);
          const hardStop = limitRow.hard_stop_enabled !== false;
          const projected = usedFirmMonth + estimatedTokens;
          const firmExceeded = projected > firmLimit;

          data.firm_cap = {
            enforced: true,
            allowed: !hardStop || !firmExceeded,
            monthly_token_limit: firmLimit,
            current_month_tokens_used: usedFirmMonth,
            requested_tokens: estimatedTokens,
            projected_usage: projected,
            remaining_this_month: Math.max(0, firmLimit - usedFirmMonth),
          };

          if (hardStop && firmExceeded) {
            data.allowed = false;
            data.blocked = true;
            data.code = 'FIRM_TOKEN_CAP_EXCEEDED';
            data.message = 'Your firm administrator has set a monthly token cap that would be exceeded by this request.';
            data.block_reason = 'firm_cap';
          }
        }
      }
    } catch (firmErr) {
      console.warn('[TokenQuotaCheck] firm cap check failed:', firmErr.message);
    }
  }

  return data;
}

module.exports = { checkUserTokenAvailability };
