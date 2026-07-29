const pool = require('../config/db');

// A session is "active" while logout_time IS NULL. Each login row carries the
// device metadata shown in Settings → "Where you're logged in", plus `sid` —
// the UUID also embedded in the JWT so the protect middleware can reject
// tokens whose session was revoked (device limit, remote sign-out, logout).
const MAX_ACTIVE_SESSIONS = 3;

class Session {
  static async create({
    user_id,
    token,
    sid = null,
    ip_address = null,
    user_agent = null,
    browser = null,
    os = null,
    device_type = null,
    location = null,
  }) {
    try {
      const result = await pool.query(
        `INSERT INTO user_sessions
           (user_id, token, sid, ip_address, user_agent, browser, os, device_type, location, login_time, last_active_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         RETURNING *`,
        [user_id, token, sid, ip_address, user_agent, browser, os, device_type, location]
      );
      return result.rows[0];
    } catch (error) {
      console.error('Error creating session:', error);
      throw error;
    }
  }

  /**
   * Device-wise dedupe: signing in again from the SAME device (same user-agent
   * string) replaces its previous session instead of consuming another of the
   * user's 3 slots. Called right before creating the new session row.
   */
  static async revokeSameDevice(userId, userAgent) {
    if (!userAgent) return 0;
    const result = await pool.query(
      `UPDATE user_sessions SET logout_time = CURRENT_TIMESTAMP
       WHERE user_id = $1 AND logout_time IS NULL AND user_agent = $2`,
      [userId, userAgent]
    );
    return result.rowCount;
  }

  /**
   * Concurrent-device limit: before a new login is recorded, sign out the
   * oldest active sessions so at most (MAX_ACTIVE_SESSIONS - 1) survive —
   * the new login then becomes the Nth. Returns how many were signed out.
   */
  static async enforceDeviceLimit(userId, limit = MAX_ACTIVE_SESSIONS) {
    const keep = Math.max(0, limit - 1);
    const result = await pool.query(
      `UPDATE user_sessions SET logout_time = CURRENT_TIMESTAMP
       WHERE user_id = $1 AND logout_time IS NULL
         AND id NOT IN (
           SELECT id FROM user_sessions
           WHERE user_id = $1 AND logout_time IS NULL AND sid IS NOT NULL
           ORDER BY login_time DESC NULLS LAST, id DESC
           LIMIT $2
         )`,
      [userId, keep]
    );
    return result.rowCount;
  }

  /**
   * Auto sign-out (self-heal, run before every list): closes this user's
   * - legacy pre-feature rows (no sid, no metadata), and
   * - sessions whose 24h JWT has expired (login_time > 24h ago) — the token is
   *   dead, so the "device" cannot be active anymore.
   * Only genuinely live sessions remain in the panel.
   */
  static async autoSignOutStale(userId) {
    await pool.query(
      `UPDATE user_sessions SET logout_time = CURRENT_TIMESTAMP
       WHERE user_id = $1 AND logout_time IS NULL
         AND (sid IS NULL OR login_time < NOW() - INTERVAL '24 hours')`,
      [userId]
    );
  }

  /** Bulk sign-out of user-selected sessions. Owner-scoped. */
  static async revokeManyForUser(sessionIds, userId) {
    if (!Array.isArray(sessionIds) || sessionIds.length === 0) return 0;
    const result = await pool.query(
      `UPDATE user_sessions SET logout_time = CURRENT_TIMESTAMP
       WHERE user_id = $2 AND logout_time IS NULL AND id = ANY($1::int[])
       RETURNING id`,
      [sessionIds, userId]
    );
    return result.rowCount;
  }

  /** "Sign out all other devices" — everything except the caller's own session. */
  static async revokeAllForUserExceptSid(userId, sid) {
    const result = await pool.query(
      `UPDATE user_sessions SET logout_time = CURRENT_TIMESTAMP
       WHERE user_id = $1 AND logout_time IS NULL
         AND ($2::text IS NULL OR sid IS DISTINCT FROM $2)
       RETURNING id`,
      [userId, sid || null]
    );
    return result.rowCount;
  }

  static async listActive(userId) {
    // sid IS NOT NULL: only device-tracked sessions — legacy pre-feature rows
    // (no sid, no metadata) must never appear as "Unknown browser" entries.
    const result = await pool.query(
      `SELECT id, sid, ip_address, browser, os, device_type, location, login_time, last_active_at
       FROM user_sessions
       WHERE user_id = $1 AND logout_time IS NULL AND sid IS NOT NULL
       ORDER BY login_time DESC NULLS LAST, id DESC`,
      [userId]
    );
    return result.rows;
  }

  /** True when the sid exists and has not been signed out. */
  static async isActiveBySid(sid) {
    if (!sid) return false;
    const result = await pool.query(
      `SELECT 1 FROM user_sessions WHERE sid = $1 AND logout_time IS NULL LIMIT 1`,
      [sid]
    );
    return result.rowCount > 0;
  }

  static async touchBySid(sid) {
    if (!sid) return;
    await pool.query(
      `UPDATE user_sessions SET last_active_at = CURRENT_TIMESTAMP
       WHERE sid = $1 AND logout_time IS NULL`,
      [sid]
    );
  }

  /** Remote sign-out from the Settings panel. Scoped to the owner. */
  static async revokeByIdForUser(sessionId, userId) {
    const result = await pool.query(
      `UPDATE user_sessions SET logout_time = CURRENT_TIMESTAMP
       WHERE id = $1 AND user_id = $2 AND logout_time IS NULL
       RETURNING id`,
      [sessionId, userId]
    );
    return result.rowCount > 0;
  }

  static async revokeBySid(sid) {
    if (!sid) return false;
    const result = await pool.query(
      `UPDATE user_sessions SET logout_time = CURRENT_TIMESTAMP
       WHERE sid = $1 AND logout_time IS NULL RETURNING id`,
      [sid]
    );
    return result.rowCount > 0;
  }

  /** Logout with the presented bearer token. (Was previously missing — logout 500'd.) */
  static async deleteByToken(token) {
    if (!token) return false;
    const result = await pool.query(
      `UPDATE user_sessions SET logout_time = CURRENT_TIMESTAMP
       WHERE token = $1 AND logout_time IS NULL RETURNING id`,
      [token]
    );
    return result.rowCount > 0;
  }

  static async logout(sessionId) {
    try {
      const result = await pool.query(
        `UPDATE user_sessions
         SET logout_time = CURRENT_TIMESTAMP
         WHERE id = $1
         RETURNING *`,
        [sessionId]
      );
      return result.rows[0];
    } catch (error) {
      console.error('Error updating logout time:', error);
      throw error;
    }
  }

  static async updateLocationBySid(sid, location) {
    if (!sid || !location) return;
    await pool.query(`UPDATE user_sessions SET location = $2 WHERE sid = $1`, [sid, location]);
  }
}

Session.MAX_ACTIVE_SESSIONS = MAX_ACTIVE_SESSIONS;

module.exports = Session;
