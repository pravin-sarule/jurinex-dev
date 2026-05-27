const axios = require('axios');
const { Pool } = require('pg');

/**
 * Persist active plan on the auth users row so all services can resolve plan without Payment_DB.
 */
async function syncUserActivePlanDirectDb(userId, activePlan) {
  const authDbUrl =
    process.env.AUTH_DATABASE_URL ||
    process.env.AUTH_DB_URL ||
    null;
  if (!authDbUrl || !activePlan?.plan_id) {
    return false;
  }

  const planId = Number(activePlan.plan_id);
  const planName = activePlan.plan_name || activePlan.name || null;
  const pool = new Pool({ connectionString: authDbUrl });

  try {
    await pool.query(
      `UPDATE users
       SET active_plan_id = $1,
           active_plan_name = $2,
           active_plan_updated_at = CURRENT_TIMESTAMP
       WHERE id = $3`,
      [planId, planName, userId]
    );
    return true;
  } catch (error) {
    console.warn(
      `[UserPlanSync] Direct Auth_DB update failed for user ${userId}:`,
      error.message
    );
    return false;
  } finally {
    await pool.end().catch(() => {});
  }
}

async function syncUserActivePlanToAuth(userId, activePlan) {
  const authBase = (process.env.USER_SERVICE_API_URL || process.env.AUTH_SERVICE_URL || 'http://localhost:5001')
    .replace(/\/$/, '');

  if (!userId || !activePlan?.plan_id) {
    return false;
  }

  const planId = Number(activePlan.plan_id);
  if (!Number.isFinite(planId) || planId <= 0) {
    return false;
  }

  const planName = activePlan.plan_name || activePlan.name || null;

  try {
    const resp = await axios.put(
      `${authBase}/api/auth/internal/user/${userId}/active-plan`,
      {
        plan_id: planId,
        plan_name: planName,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-internal-service': 'payment-service',
        },
        timeout: 5000,
      }
    );
    return resp.status >= 200 && resp.status < 300;
  } catch (error) {
    console.warn(
      `[UserPlanSync] Auth API sync failed for user ${userId}:`,
      error.response?.data?.message || error.message
    );
    return syncUserActivePlanDirectDb(userId, activePlan);
  }
}

async function clearUserActivePlanInAuth(userId) {
  const authDbUrl =
    process.env.AUTH_DATABASE_URL ||
    process.env.AUTH_DB_URL ||
    null;

  if (authDbUrl && userId) {
    const pool = new Pool({ connectionString: authDbUrl });
    try {
      await pool.query(
        `UPDATE users
         SET active_plan_id = NULL,
             active_plan_name = NULL,
             active_plan_updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [userId]
      );
    } catch (error) {
      console.warn(`[UserPlanSync] Direct Auth_DB clear failed for user ${userId}:`, error.message);
    } finally {
      await pool.end().catch(() => {});
    }
  }

  const authBase = (process.env.USER_SERVICE_API_URL || process.env.AUTH_SERVICE_URL || 'http://localhost:5001')
    .replace(/\/$/, '');

  if (!userId) return false;

  try {
    const resp = await axios.put(
      `${authBase}/api/auth/internal/user/${userId}/active-plan`,
      { plan_id: null, plan_name: null },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-internal-service': 'payment-service',
        },
        timeout: 5000,
      }
    );
    return resp.status >= 200 && resp.status < 300;
  } catch (error) {
    console.warn(
      `[UserPlanSync] Auth API clear failed for user ${userId}:`,
      error.response?.data?.message || error.message
    );
    return false;
  }
}

module.exports = { syncUserActivePlanToAuth, clearUserActivePlanInAuth };
