const pool = require('../config/db');
const { fetchFirmContext } = require('./firmContextService');

// Prefers monthly_plans when monthly_plan_id is set (new flow).
// Falls back to subscription_plans via plan_id (legacy flow).
const ACTIVE_SUBSCRIPTION_QUERY = `
  SELECT
    -- monthly_plans fields (preferred)
    COALESCE(mp.id,   sp.id)          AS plan_id,
    COALESCE(mp.name, sp.name)        AS plan_name,
    COALESCE(mp.description, sp.description) AS description,
    COALESCE(mp.price::NUMERIC, sp.price::NUMERIC) AS price,
    COALESCE(mp.currency, sp.currency, 'INR') AS currency,

    -- monthly_plans-specific (token limits)
    mp.monthly_tokens                 AS monthly_tokens,
    mp.billing_interval_months        AS billing_interval_months,
    COALESCE(mp.monthly_tokens, sp.token_limit, 0) AS token_limit,

    -- legacy subscription_plans fields (nullable when using monthly_plans)
    sp.interval                       AS interval,
    sp.type                           AS type,
    COALESCE(mp.storage_limit_gb, sp.storage_limit_gb, 0) AS storage_limit_gb,
    sp.document_limit                 AS document_limit,
    sp.ai_analysis_limit              AS ai_analysis_limit,
    sp.template_access                AS template_access,
    sp.features                       AS features,
    sp.chat_token_limit               AS chat_token_limit,

    -- Which table is being used
    CASE WHEN mp.id IS NOT NULL THEN 'monthly_plans' ELSE 'subscription_plans' END AS plan_source,
    us.monthly_plan_id,

    -- Subscription state
    us.start_date,
    us.end_date,
    us.status                         AS subscription_status,
    us.user_id                        AS subscription_user_id,
    us.topup_token_balance,
    us.current_token_balance,
    us.last_reset_date

  FROM user_subscriptions us
  LEFT JOIN monthly_plans mp    ON mp.id = us.monthly_plan_id AND mp.is_active = true
  LEFT JOIN subscription_plans sp ON sp.id = us.plan_id
  WHERE us.user_id = $1
    AND LOWER(COALESCE(us.status, 'active')) = 'active'
    AND (us.end_date IS NULL OR us.end_date >= (NOW() AT TIME ZONE 'Asia/Kolkata')::date)
    AND (mp.id IS NOT NULL OR sp.id IS NOT NULL)
  ORDER BY us.activated_at DESC NULLS LAST, us.start_date DESC, us.updated_at DESC
  LIMIT 1
`;

async function getDirectActivePlan(userId) {
  const result = await pool.query(ACTIVE_SUBSCRIPTION_QUERY, [userId]);
  return result.rows[0] || null;
}

function decoratePlan(plan, metadata = {}) {
  if (!plan) return null;

  return {
    ...plan,
    id: plan.plan_id,
    is_inherited_from_firm: !!metadata.isInheritedFromFirm,
    plan_owner_user_id: metadata.planOwnerUserId ?? plan.subscription_user_id ?? null,
    firm_id: metadata.firmId ?? null,
    inherited_for_user_id: metadata.inheritedForUserId ?? null,
    effective_account_type: metadata.accountType ?? null,
  };
}

async function resolveEffectivePlan(userId) {
  const normalizedUserId = Number(userId);
  if (!normalizedUserId) {
    return {
      activePlan: null,
      firmContext: null,
    };
  }

  let firmContext = null;
  try {
    firmContext = await fetchFirmContext(normalizedUserId);
  } catch (error) {
    console.warn('[EffectivePlanService] Failed to fetch firm context:', error.message);
  }

  const directPlan = await getDirectActivePlan(normalizedUserId);
  if (directPlan) {
    return {
      activePlan: decoratePlan(directPlan, {
        isInheritedFromFirm: false,
        planOwnerUserId: normalizedUserId,
        firmId: firmContext?.firmId || null,
        accountType: firmContext?.accountType || null,
      }),
      firmContext,
    };
  }

  const accountType = String(firmContext?.accountType || '').toUpperCase();
  if (
    accountType === 'FIRM_USER'
    && firmContext?.firmAdminUserId
    && Number(firmContext.firmAdminUserId) !== normalizedUserId
  ) {
    const inheritedPlan = await getDirectActivePlan(Number(firmContext.firmAdminUserId));
    if (inheritedPlan) {
      return {
        activePlan: decoratePlan(inheritedPlan, {
          isInheritedFromFirm: true,
          planOwnerUserId: Number(firmContext.firmAdminUserId),
          firmId: firmContext?.firmId || null,
          inheritedForUserId: normalizedUserId,
          accountType,
        }),
        firmContext,
      };
    }
  }

  return {
    activePlan: null,
    firmContext,
  };
}

module.exports = {
  getDirectActivePlan,
  resolveEffectivePlan,
};
