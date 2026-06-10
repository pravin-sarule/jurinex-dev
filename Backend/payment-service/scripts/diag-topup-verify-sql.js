require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const userId = 76;
  const purchaseId = 10;
  const planId = 4;
  const tokensToCredit = 10;
  const topupExpiresAt = new Date(Date.now() + 86400000);
  const razorpay_payment_id = "pay_TEST_diag_" + Date.now();
  const razorpay_signature = "diag";

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const creditResult = await client.query(
      `INSERT INTO user_subscriptions
         (user_id, topup_token_balance, topup_expires_at, status,
          current_token_balance, last_reset_date, created_at, updated_at)
       VALUES ($1, $2, $3::timestamptz, 'active', 0, CURRENT_DATE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT (user_id) DO UPDATE SET
         topup_token_balance = COALESCE(user_subscriptions.topup_token_balance, 0) + EXCLUDED.topup_token_balance,
         topup_expires_at = CASE
           WHEN EXCLUDED.topup_expires_at IS NULL THEN user_subscriptions.topup_expires_at
           WHEN user_subscriptions.topup_expires_at IS NULL
             OR user_subscriptions.topup_expires_at < EXCLUDED.topup_expires_at
           THEN EXCLUDED.topup_expires_at
           ELSE user_subscriptions.topup_expires_at
         END,
         updated_at = CURRENT_TIMESTAMP
       RETURNING topup_token_balance`,
      [userId, tokensToCredit, topupExpiresAt]
    );
    console.log("credit OK", creditResult.rows[0]);

    await client.query(
      `UPDATE user_token_topup_purchases SET
         razorpay_payment_id = $1,
         razorpay_signature  = $2,
         amount              = $3,
         currency            = $4,
         status              = 'completed',
         expires_at          = $5,
         tokens_credited     = $6
       WHERE id = $7`,
      [razorpay_payment_id, razorpay_signature, 10, "INR", topupExpiresAt, tokensToCredit, purchaseId]
    );
    console.log("purchase update OK");

    await client.query("ROLLBACK");
    console.log("rolled back — no data changed");
  } catch (e) {
    console.error("SQL FAILED:", e.message, e.detail || "");
    await client.query("ROLLBACK").catch(() => {});
  } finally {
    client.release();
    await pool.end();
  }
}

main();
