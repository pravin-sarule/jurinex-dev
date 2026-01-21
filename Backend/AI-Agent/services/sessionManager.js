const pool = require('../config/db');
const { v4: uuidv4 } = require('uuid');

const SESSION_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const CLEANUP_INTERVAL_MS = 60 * 1000; // Run cleanup every 1 minute

function isValidUUID(str) {
  if (!str) return false;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

/**
 * Session Manager for user-specific chat sessions
 * Handles session creation, activity tracking, and auto-deletion
 */
const SessionManager = {
  /**
   * Update session last activity timestamp
   * @param {string} sessionId - Session UUID
   */
  async updateSessionActivity(sessionId) {
    try {
      if (!sessionId) return;
      
      // Validate UUID format before querying
      if (!isValidUUID(sessionId)) {
        console.warn(`[SessionManager] Invalid UUID format for session: ${sessionId}, skipping activity update`);
        return;
      }
      
      await pool.query(
        `UPDATE agent_file_chats 
         SET last_activity = NOW() 
         WHERE session_id = $1::uuid`,
        [sessionId]
      );
      
      console.log(`[SessionManager] Updated activity for session: ${sessionId}`);
    } catch (error) {
      console.error('[SessionManager] Error updating session activity:', error);
    }
  },

  /**
   * Delete all chats for a specific session
   * @param {string} sessionId - Session UUID
   * @returns {number} Number of deleted chats
   */
  async deleteSession(sessionId) {
    try {
      if (!sessionId) return 0;
      
      // Validate UUID format before querying
      if (!isValidUUID(sessionId)) {
        console.warn(`[SessionManager] Invalid UUID format for session: ${sessionId}, skipping deletion`);
        return 0;
      }
      
      const res = await pool.query(
        `DELETE FROM agent_file_chats 
         WHERE session_id = $1::uuid
         RETURNING id`,
        [sessionId]
      );
      
      const deletedCount = res.rows.length;
      console.log(`[SessionManager] Deleted ${deletedCount} chat(s) for session: ${sessionId}`);
      
      return deletedCount;
    } catch (error) {
      console.error('[SessionManager] Error deleting session:', error);
      throw new Error(`Failed to delete session: ${error.message}`);
    }
  },

  /**
   * Delete expired sessions (inactive for more than SESSION_TIMEOUT_MS)
   * @returns {number} Number of deleted sessions
   */
  async cleanupExpiredSessions() {
    try {
      const timeoutMinutes = SESSION_TIMEOUT_MS / (60 * 1000);
      
      const res = await pool.query(
        `DELETE FROM agent_file_chats 
         WHERE last_activity < NOW() - INTERVAL '${timeoutMinutes} minutes'
         OR (last_activity IS NULL AND created_at < NOW() - INTERVAL '${timeoutMinutes} minutes')
         RETURNING session_id, id`,
        []
      );
      
      // Count unique sessions deleted
      const uniqueSessions = new Set(res.rows.map(row => row.session_id));
      const deletedCount = res.rows.length;
      
      if (deletedCount > 0) {
        console.log(`[SessionManager] Cleaned up ${deletedCount} chat(s) from ${uniqueSessions.size} expired session(s)`);
      }
      
      return deletedCount;
    } catch (error) {
      console.error('[SessionManager] Error cleaning up expired sessions:', error);
      return 0;
    }
  },

  /**
   * Get session info
   * @param {string} sessionId - Session UUID
   * @returns {Object|null} Session info
   */
  async getSessionInfo(sessionId) {
    try {
      if (!sessionId) return null;
      
      // Validate UUID format before querying
      if (!isValidUUID(sessionId)) {
        console.warn(`[SessionManager] Invalid UUID format for session: ${sessionId}`);
        return null;
      }
      
      const res = await pool.query(
        `SELECT 
           session_id,
           COUNT(*) as chat_count,
           MIN(created_at) as first_activity,
           MAX(COALESCE(last_activity, created_at)) as last_activity
         FROM agent_file_chats
         WHERE session_id = $1::uuid
         GROUP BY session_id`,
        [sessionId]
      );
      
      if (res.rows.length === 0) return null;
      
      return res.rows[0];
    } catch (error) {
      console.error('[SessionManager] Error getting session info:', error);
      return null;
    }
  }
};

// Start periodic cleanup
let cleanupInterval = null;

function startCleanup() {
  if (cleanupInterval) return; // Already running
  
  cleanupInterval = setInterval(async () => {
    try {
      await SessionManager.cleanupExpiredSessions();
    } catch (error) {
      console.error('[SessionManager] Cleanup interval error:', error);
    }
  }, CLEANUP_INTERVAL_MS);
  
  console.log(`[SessionManager] Started periodic cleanup (every ${CLEANUP_INTERVAL_MS / 1000}s)`);
}

function stopCleanup() {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
    console.log('[SessionManager] Stopped periodic cleanup');
  }
}

// Auto-start cleanup on module load
startCleanup();

// Cleanup on process exit
process.on('SIGTERM', stopCleanup);
process.on('SIGINT', stopCleanup);

module.exports = {
  SessionManager,
  startCleanup,
  stopCleanup,
  SESSION_TIMEOUT_MS
};
