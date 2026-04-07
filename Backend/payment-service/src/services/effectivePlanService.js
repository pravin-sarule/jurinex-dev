const pool = require('../config/db');
const { fetchFirmContext } = require('./firmContextService');

const ACTIVE_SUBSCRIPTION_QUERY = `
  SELECT
    sp.id AS plan_id,
    sp.name AS plan_name,
    sp.description,
    sp.price,
    sp.currency,
    sp.interval,
    sp.type,
    sp.token_limit,
    sp.carry_over_limit,
    sp.document_limit,
    sp.ai_analysis_limit,
    sp.template_access,
    sp.storage_limit_gb,
    sp.drafting_type,
    sp.limits,
    us.start_date,
    us.end_date,
    us.status AS subscription_status,
    us.user_id AS subscription_user_id
  FROM user_subscriptions us
  JOIN subscription_plans sp ON us.plan_id = sp.id
  WHERE us.user_id = $1
    AND LOWER(us.status) = 'active'
  ORDER BY us.start_date DESC
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
