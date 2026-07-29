const pool = require('../config/db');

/**
 * Device-session schema — idempotent, run at startup (same pattern as
 * userActivityDb / rbacDb). Extends the pre-existing `user_sessions` table
 * (id, user_id, token, logout_time, ...) with the metadata needed for the
 * "Where you're logged in" panel and the 3-device concurrent-login limit.
 */
async function initializeDeviceSessionSchema() {
  try {
    await pool.query(`
      ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS sid TEXT;
      ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS ip_address TEXT;
      ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS user_agent TEXT;
      ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS browser TEXT;
      ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS os TEXT;
      ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS device_type TEXT;
      ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS location TEXT;
      ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS login_time TIMESTAMP DEFAULT NOW();
      ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMP DEFAULT NOW();
      CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_user_sessions_sid ON user_sessions(sid);
      CREATE INDEX IF NOT EXISTS idx_user_sessions_active
        ON user_sessions(user_id) WHERE logout_time IS NULL;
    `);
    // Auto sign-out at boot: legacy pre-feature rows (no sid — logout was broken
    // for months so they piled up as "Unknown browser" entries) AND any session
    // whose 24h JWT has expired — a dead token means the device is not active.
    // Idempotent; the sessions endpoint also self-heals per user on every read.
    const cleaned = await pool.query(
      `UPDATE user_sessions SET logout_time = CURRENT_TIMESTAMP
       WHERE logout_time IS NULL
         AND (sid IS NULL OR login_time < NOW() - INTERVAL '24 hours')`
    );
    if (cleaned.rowCount > 0) {
      console.log(`[DeviceSessions] auto-signed-out ${cleaned.rowCount} stale/legacy sessions`);
    }
    console.log('[DeviceSessions] user_sessions schema ensured');
  } catch (error) {
    console.error('[DeviceSessions] schema init failed:', error.message);
  }
}

module.exports = { initializeDeviceSessionSchema };
