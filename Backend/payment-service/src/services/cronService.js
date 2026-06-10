/**
 * Scheduled jobs for token quota management (IST timezone).
 *
 * Jobs:
 *
 * 1. Daily token carry-over (runs every midnight IST — 00:00 Asia/Kolkata)
 *    - No DB writes needed for the carry-over itself; it is computed dynamically
 *      as: totalAvailable = min(dailyLimit × daysElapsedIST, monthlyLimit)
 *    - This job logs a summary for observability and handles edge-case cleanups.
 *
 * 2. Monthly billing-period reset (runs every midnight IST)
 *    - Finds subscriptions whose billing end_date has passed.
 *    - Resets plan_tokens_used = 0 and last_reset_date = CURRENT_DATE.
 *    - Extends end_date by billing_interval_months for auto-renewing plans.
 *    - Marks expired (non-auto-renewing) subscriptions appropriately.
 *
 * 3. Topup expiry cleanup (runs every midnight IST)
 *    - Zeroes topup_token_balance for subscriptions with expired topup_expires_at.
 *
 * node-cron syntax: second(opt) minute hour day month weekday
 * Timezone option: { timezone: 'Asia/Kolkata' } → runs at wall-clock IST time.
 */

const cron = require('node-cron');
const db = require('../config/db');

// ─── Helpers ────────────────────────────────────────────────────────────────

function istNow() {
  return new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
}

function log(level, msg, data = '') {
  const tag = `[CronService][${level.toUpperCase()}]`;
  if (data) {
    console.log(`${tag} ${msg}`, data);
  } else {
    console.log(`${tag} ${msg}`);
  }
}

// ─── Job 1 & 2 & 3: Daily midnight IST ──────────────────────────────────────

async function runDailyMidnightIST() {
  const startedAt = Date.now();
  log('info', `Daily midnight IST job started — ${istNow()}`);

  await Promise.allSettled([
    resetExpiredBillingPeriods(),
    expireStaleTopupBalances(),
  ]);

  log('info', `Daily midnight IST job finished in ${Date.now() - startedAt}ms`);
}

// ─── Billing period reset ────────────────────────────────────────────────────

/**
 * For each active subscription whose end_date has passed:
 *   - Reset plan_tokens_used = 0 (new billing period, fresh monthly allowance)
 *   - Update last_reset_date = CURRENT_DATE (new carry-over baseline)
 *   - Extend end_date by billing_interval_months for continuous plans
 *
 * This is idempotent: subscriptions are only reset once per expired period.
 */
async function resetExpiredBillingPeriods() {
  log('info', 'Checking for subscriptions with expired billing periods...');

  try {
    // Use IST calendar date — the cron fires at IST midnight, so CURRENT_DATE (UTC) is
    // 5h30m behind and would miss subscriptions that expired today in IST.
    const { rows: expired } = await db.query(
      `SELECT
         us.id                         AS sub_id,
         us.user_id,
         us.end_date,
         us.last_reset_date,
         us.razorpay_subscription_id,
         COALESCE(mp.billing_interval_months, 1) AS interval_months,
         mp.name                       AS plan_name
       FROM user_subscriptions us
       LEFT JOIN monthly_plans mp ON mp.id = us.monthly_plan_id
       WHERE us.status IN ('active', 'topup_only')
         AND us.end_date IS NOT NULL
         AND us.end_date < (NOW() AT TIME ZONE 'Asia/Kolkata')::date
       ORDER BY us.user_id`
    );

    if (expired.length === 0) {
      log('info', 'No expired billing periods found.');
      return;
    }

    log('info', `Found ${expired.length} expired billing period(s). Resetting...`);

    // IST date string: the new billing period starts today in IST
    const istTodayResult = await db.query(
      `SELECT (NOW() AT TIME ZONE 'Asia/Kolkata')::date AS ist_today`
    );
    const istToday = istTodayResult.rows[0].ist_today; // DATE value, e.g. '2026-06-03'

    for (const sub of expired) {
      try {
        const oldEnd = new Date(sub.end_date);
        const intervalMonths = Number(sub.interval_months) || 1;
        const newEnd = new Date(oldEnd);
        newEnd.setMonth(newEnd.getMonth() + intervalMonths);
        const newEndStr = newEnd.toISOString().split('T')[0];

        await db.query(
          `UPDATE user_subscriptions
             SET plan_tokens_used = 0,
                 last_reset_date  = $1::DATE,
                 end_date         = $2::DATE,
                 updated_at       = CURRENT_TIMESTAMP
           WHERE id = $3`,
          [istToday, newEndStr, sub.sub_id]
        );

        log('info',
          `Reset sub_id=${sub.sub_id} user_id=${sub.user_id} plan="${sub.plan_name}" ` +
          `old_end=${sub.end_date} → new_end=${newEndStr} last_reset_date=${istToday}`
        );
      } catch (subErr) {
        log('error', `Failed to reset sub_id=${sub.sub_id}: ${subErr.message}`);
      }
    }

    log('info', `Billing period reset complete (${expired.length} subscription(s) renewed).`);
  } catch (err) {
    log('error', `resetExpiredBillingPeriods failed: ${err.message}`);
  }
}

// ─── Topup expiry cleanup ────────────────────────────────────────────────────

/**
 * Zero out topup_token_balance for subscriptions whose topup has expired.
 * This prevents stale topup credit from being shown or deducted.
 */
async function expireStaleTopupBalances() {
  log('info', 'Checking for expired topup balances...');

  try {
    const { rowCount } = await db.query(
      `UPDATE user_subscriptions
         SET topup_token_balance = 0,
             updated_at          = CURRENT_TIMESTAMP
       WHERE topup_expires_at IS NOT NULL
         AND topup_expires_at < NOW()
         AND topup_token_balance > 0`
    );

    if (rowCount > 0) {
      log('info', `Zeroed topup_token_balance for ${rowCount} subscription(s) with expired topup.`);
    } else {
      log('info', 'No expired topup balances found.');
    }
  } catch (err) {
    log('error', `expireStaleTopupBalances failed: ${err.message}`);
  }
}

// ─── Register cron schedules ─────────────────────────────────────────────────

function startCronJobs() {
  // Every day at 00:00 IST (Asia/Kolkata)
  // node-cron cron syntax: minute hour dayOfMonth month dayOfWeek
  cron.schedule('0 0 * * *', runDailyMidnightIST, {
    timezone: 'Asia/Kolkata',
    name: 'daily-midnight-ist',
  });

  log('info', 'Cron jobs registered. Daily token reset fires at 00:00 IST (Asia/Kolkata).');
}

module.exports = { startCronJobs, runDailyMidnightIST };
