require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const cols = await pool.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'user_subscriptions'
    ORDER BY ordinal_position`);
  console.log("user_subscriptions:", cols.rows.map((r) => r.column_name).join(", "));

  const idx = await pool.query(`
    SELECT indexname, indexdef FROM pg_indexes
    WHERE tablename = 'user_subscriptions'`);
  console.log("indexes:", idx.rows);

  const testUser = await pool.query(`
    SELECT user_id, topup_token_balance, status FROM user_subscriptions LIMIT 1`);
  console.log("sample sub:", testUser.rows[0]);

  const purchases = await pool.query(`
    SELECT id, user_id, topup_plan_id, status, razorpay_order_id, razorpay_payment_id
    FROM user_token_topup_purchases ORDER BY created_at DESC LIMIT 5`);
  console.log("recent purchases:", purchases.rows);

  // Test ON CONFLICT query shape (dry run with rollback)
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const uid = testUser.rows[0]?.user_id || 1;
    await client.query(
      `INSERT INTO user_subscriptions
         (user_id, topup_token_balance, topup_expires_at, status,
          current_token_balance, last_reset_date, created_at, updated_at)
       VALUES ($1, 0, NULL, 'active', 0, CURRENT_DATE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT (user_id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
       RETURNING topup_token_balance`,
      [uid]
    );
    await client.query("ROLLBACK");
    console.log("ON CONFLICT (user_id): OK");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("ON CONFLICT test FAILED:", e.message);
  } finally {
    client.release();
  }

  const fk = await pool.query(`
    SELECT conname, pg_get_constraintdef(oid) AS def
    FROM pg_constraint
    WHERE conrelid = 'user_token_topup_purchases'::regclass`);
  console.log("purchase FKs:", fk.rows);

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
