/**
 * PKCE (Proof Key for Code Exchange) Temporary Storage
 * Stores code_verifier mapped to userId for OAuth callback
 * Expires after 5 minutes
 */

class PKCEStore {
  constructor() {
    // In-memory Map: userId -> { code_verifier, expiresAt }
    this.store = new Map();
    
    // Clean up expired entries every minute
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 60000); // 1 minute
  }

  /**
   * Store code_verifier for a user
   * @param {string} userId - User ID
   * @param {string} code_verifier - PKCE code verifier
   * @param {number} ttlMinutes - Time to live in minutes (default: 5)
   */
  set(userId, code_verifier, ttlMinutes = 5) {
    const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);
    this.store.set(userId, {
      code_verifier,
      expiresAt
    });
    
    console.log('[PKCEStore] Stored code_verifier for userId:', userId, 'expires at:', expiresAt);
  }

  /**
   * Get code_verifier for a user
   * @param {string} userId - User ID
   * @returns {string|null} - Code verifier or null if not found/expired
   */
  get(userId) {
    const entry = this.store.get(userId);
    
    if (!entry) {
      console.log('[PKCEStore] No code_verifier found for userId:', userId);
      return null;
    }

    // Check if expired
    if (new Date() > entry.expiresAt) {
      console.log('[PKCEStore] Code verifier expired for userId:', userId);
      this.store.delete(userId);
      return null;
    }

    return entry.code_verifier;
  }

  /**
   * Delete code_verifier for a user (after successful token exchange)
   * @param {string} userId - User ID
   */
  delete(userId) {
    const deleted = this.store.delete(userId);
    if (deleted) {
      console.log('[PKCEStore] Deleted code_verifier for userId:', userId);
    }
    return deleted;
  }

  /**
   * Clean up expired entries
   */
  cleanup() {
    const now = new Date();
    let cleaned = 0;
    
    for (const [userId, entry] of this.store.entries()) {
      if (now > entry.expiresAt) {
        this.store.delete(userId);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      console.log('[PKCEStore] Cleaned up', cleaned, 'expired entries');
    }
  }

  /**
   * Get store size (for debugging)
   */
  size() {
    return this.store.size;
  }

  /**
   * Clear all entries (for testing/cleanup)
   */
  clear() {
    this.store.clear();
    console.log('[PKCEStore] Cleared all entries');
  }
}

// Export singleton instance
module.exports = new PKCEStore();
