const { Pool } = require('pg');
require('dotenv').config();

const authDbUrl = process.env.AUTH_DATABASE_URL || process.env.AUTH_DB_URL || null;

const authPool = authDbUrl
  ? new Pool({ connectionString: authDbUrl })
  : null;

if (authPool) {
  authPool
    .connect()
    .then((client) => {
      client.release();
      console.log('✅ ChatModel: Auth DB connected (active_plan_id fallback).');
    })
    .catch((err) => console.warn('⚠️ ChatModel: Auth DB connection failed:', err.message));
} else {
  console.log('ℹ️ ChatModel: AUTH_DATABASE_URL not set — active_plan_id fallback disabled.');
}

module.exports = authPool;
