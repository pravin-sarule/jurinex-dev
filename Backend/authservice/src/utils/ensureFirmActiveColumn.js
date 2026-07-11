const pool = require('../config/db');

/**
 * Ensure firms.is_active exists (true = firm enabled, false = all members blocked from login).
 */
async function ensureFirmActiveColumn() {
  try {
    await pool.query(`
      ALTER TABLE firms
      ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true
    `);
    console.log('[Schema] firms.is_active ready');
  } catch (error) {
    console.error('[Schema] Failed to ensure firms.is_active:', error.message);
  }
}

module.exports = { ensureFirmActiveColumn };

if (require.main === module) {
  ensureFirmActiveColumn()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
