require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const pool = require('../src/config/db');

const sqlPath = path.join(
  __dirname,
  '../src/models/migrations/add_active_plan_id_to_users.sql'
);

(async () => {
  const sql = fs.readFileSync(sqlPath, 'utf8');
  await pool.query(sql);
  console.log('Migration applied: add_active_plan_id_to_users.sql');
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
