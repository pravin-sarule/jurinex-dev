const pool = require('../config/db');
const { fetchFirmContext } = require('./firmContextService');

const ACTIVE_SUBSCRIPTION_QUERY = `
  SELECT
    sp.*,
    sp.id AS plan_id,
    sp.name AS plan_name,
    us.start_date,
    us.end_date,
    us.status AS subscription_status,
    us.user_id AS subscription_user_id
  FROM user_subscriptions us
  JOIN subscription_plans sp ON us.plan_id = sp.id
  WHERE us.user_id = $1
    AND LOWER(COALESCE(us.status, 'active')) = 'active'
    AND (us.end_date IS NULL OR us.end_date >= CURRENT_DATE)
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
