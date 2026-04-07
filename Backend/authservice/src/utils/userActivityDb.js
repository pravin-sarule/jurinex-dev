const pool = require('../config/db');

async function initializeUserActivitySchema() {
  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMP WITH TIME ZONE;
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_users_last_login_at
    ON users(last_login_at);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_users_last_seen_at
    ON users(last_seen_at);
  `);
}

module.exports = {
  initializeUserActivitySchema,
};
