require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const pool = require('../src/config/db');

const uid = Number(process.argv[2] || 75);

(async () => {
  const sub = await pool.query('SELECT * FROM user_subscriptions WHERE user_id = $1', [uid]);
  const plans = await pool.query('SELECT id, name, interval, is_active FROM subscription_plans ORDER BY id');
  const eff = await pool.query(
    `SELECT sp.id AS plan_id, sp.name AS plan_name, us.status, us.end_date, us.activated_at
     FROM user_subscriptions us
     JOIN subscription_plans sp ON us.plan_id = sp.id
     WHERE us.user_id = $1
       AND LOWER(COALESCE(us.status, 'active')) = 'active'
       AND (us.end_date IS NULL OR us.end_date >= CURRENT_DATE)`,
    [uid]
  );
  const payments = await pool.query(
    'SELECT id, razorpay_payment_id, status, created_at FROM payments WHERE user_id = $1 ORDER BY created_at DESC LIMIT 5',
    [uid]
  );
  console.log('user_id:', uid);
  console.log('subscriptions:', JSON.stringify(sub.rows, null, 2));
  console.log('effective:', eff.rows);
  console.log('recent payments:', payments.rows);
  console.log('all plans:', plans.rows);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
