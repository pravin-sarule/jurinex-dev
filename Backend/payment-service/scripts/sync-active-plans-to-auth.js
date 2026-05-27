/**
 * Backfill users.active_plan_id in authservice from Payment_DB user_subscriptions.
 * Usage: node scripts/sync-active-plans-to-auth.js [userId]
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const pool = require('../src/config/db');
const { resolveEffectivePlan } = require('../src/services/effectivePlanService');
const { syncUserActivePlanToAuth } = require('../src/services/userPlanSyncService');

const onlyUserId = process.argv[2] ? Number(process.argv[2]) : null;

(async () => {
  let userIds = [];
  if (onlyUserId) {
    userIds = [onlyUserId];
  } else {
    const result = await pool.query(
      `SELECT DISTINCT user_id FROM user_subscriptions
       WHERE LOWER(COALESCE(status, 'active')) = 'active'`
    );
    userIds = result.rows.map((r) => Number(r.user_id)).filter(Boolean);
  }

  for (const userId of userIds) {
    const { activePlan } = await resolveEffectivePlan(userId);
    if (!activePlan) {
      console.log(`skip user ${userId}: no active plan`);
      continue;
    }
    const ok = await syncUserActivePlanToAuth(userId, activePlan);
    console.log(
      ok
        ? `synced user ${userId} -> plan ${activePlan.plan_id} (${activePlan.plan_name})`
        : `FAILED user ${userId}`
    );
  }
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
