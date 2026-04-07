const pool = require('../config/db');

async function getColumnType(tableName, columnName) {
  const result = await pool.query(
    `
      SELECT data_type, udt_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
        AND column_name = $2
      LIMIT 1
    `,
    [tableName, columnName]
  );

  return result.rows[0] || null;
}

async function initializeFirmAnalyticsSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS firm_user_token_limits (
      id SERIAL PRIMARY KEY,
      firm_id TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      monthly_token_limit BIGINT,
      hard_stop_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      updated_by INTEGER,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      UNIQUE (firm_id, user_id)
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_firm_user_token_limits_firm_user
    ON firm_user_token_limits(firm_id, user_id);
  `);

  const firmIdColumn = await getColumnType('firm_user_token_limits', 'firm_id');
  if (firmIdColumn?.data_type !== 'text') {
    console.log('[FirmAnalyticsDb] Migrating firm_user_token_limits.firm_id to TEXT', firmIdColumn);
    await pool.query(`
      ALTER TABLE firm_user_token_limits
      ALTER COLUMN firm_id TYPE TEXT
      USING firm_id::text
    `);
  }

  console.log('[FirmAnalyticsDb] firm_user_token_limits schema ready', {
    firmIdType: (await getColumnType('firm_user_token_limits', 'firm_id'))?.data_type || 'unknown',
    userIdType: (await getColumnType('firm_user_token_limits', 'user_id'))?.data_type || 'unknown',
  });
}

module.exports = {
  initializeFirmAnalyticsSchema,
};
