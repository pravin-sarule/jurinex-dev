/**
 * Prompt Cache Service
 * 
 * Provides user-specific LLM response caching with automatic invalidation
 * when users upload new documents. Uses SHA-256 hashing for prompt identification.
 * 
 * Features:
 * - User-specific caching
 * - Automatic cache invalidation on document upload
 * - TTL support for automatic expiration
 * - Performance tracking (optional)
 */

const crypto = require('crypto');
const pool = require('../config/db');

/**
 * Normalize prompt text for consistent hashing
 * - Trim whitespace
 * - Convert to lowercase
 * - Remove extra spaces
 * 
 * @param {string} promptText - The original prompt text
 * @returns {string} - Normalized prompt text
 */
function normalizePrompt(promptText) {
  if (!promptText || typeof promptText !== 'string') {
    return '';
  }
  
  return promptText
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' '); // Replace multiple spaces with single space
}

/**
 * Generate SHA-256 hash of the normalized prompt
 * 
 * @param {string} promptText - The prompt text to hash
 * @returns {string} - 64-character hexadecimal hash
 */
function generatePromptHash(promptText) {
  const normalized = normalizePrompt(promptText);
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

/**
 * Get or create user metadata record
 * 
 * @param {number} userId - The user ID
 * @returns {Promise<Object>} - User metadata object
 */
async function getUserMetadata(userId) {
  try {
    // Try to get existing metadata
    const getQuery = `
      SELECT * FROM user_metadata 
      WHERE user_id = $1
    `;
    const { rows } = await pool.query(getQuery, [userId]);
    
    if (rows.length > 0) {
      return rows[0];
    }
    
    // Create new metadata record if it doesn't exist
    const insertQuery = `
      INSERT INTO user_metadata (user_id, last_doc_upload)
      VALUES ($1, NULL)
      RETURNING *
    `;
    const { rows: newRows } = await pool.query(insertQuery, [userId]);
    return newRows[0];
  } catch (error) {
    console.error('[promptCacheService] Error getting user metadata:', error);
    throw error;
  }
}

/**
 * Update last document upload timestamp for a user
 * This invalidates all cache entries created before this timestamp
 * 
 * @param {number} userId - The user ID
 * @returns {Promise<void>}
 */
async function updateLastDocUpload(userId) {
  try {
    const query = `
      INSERT INTO user_metadata (user_id, last_doc_upload, last_cache_invalidation, updated_at)
      VALUES ($1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT (user_id) 
      DO UPDATE SET 
        last_doc_upload = CURRENT_TIMESTAMP,
        last_cache_invalidation = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    `;
    
    await pool.query(query, [userId]);
    console.log(`✅ [promptCacheService] Updated last_doc_upload for user ${userId}`);
  } catch (error) {
    console.error('[promptCacheService] Error updating last_doc_upload:', error);
    throw error;
  }
}

/**
 * Get cached response if valid, otherwise return null
 * 
 * @param {number} userId - The user ID
 * @param {string} promptText - The prompt text (should be the user's original question, not the secret prompt)
 * @param {Object} options - Optional parameters
 * @param {string} options.methodUsed - Method used (e.g., 'rag', 'gemini_eyeball')
 * @param {string} options.chatType - 'folder' or 'file' (REQUIRED)
 * @param {string} options.contextId - folder_name (for folder chats) or file_id (for file chats) (REQUIRED)
 * @param {string} options.secretId - Optional: secret_id to differentiate between different secret prompts
 * @returns {Promise<Object|null>} - Cached response object or null if not found/invalid
 */
async function getCachedResponse(userId, promptText, options = {}) {
  try {
    const { chatType, contextId, secretId } = options;
    
    if (!chatType || !contextId) {
      console.warn('[promptCacheService] chatType and contextId are required for cache lookup');
      return null;
    }
    
    // Build cache key: include secret_id if present to differentiate between secret prompts
    // This ensures the same user question with different secret prompts gets different cache entries
    let cacheKeyText = promptText;
    if (secretId) {
      cacheKeyText = `secret:${secretId}:${promptText}`;
    }
    
    const promptHash = generatePromptHash(cacheKeyText);
    
    // Get user metadata to check last upload time
    const userMeta = await getUserMetadata(userId);
    const lastDocUpload = userMeta?.last_doc_upload;
    
    // Look for cached entry with context
    const cacheQuery = `
      SELECT 
        id,
        cached_output,
        created_at,
        expires_at,
        method_used,
        chat_type,
        context_id,
        session_id
      FROM prompt_cache
      WHERE user_id = $1 AND context_id = $2 AND prompt_hash = $3
    `;
    
    const { rows } = await pool.query(cacheQuery, [userId, contextId, promptHash]);
    
    if (rows.length === 0) {
      // No cache entry found
      return null;
    }
    
    const cachedEntry = rows[0];
    
    // Check if cache entry is expired (TTL)
    if (cachedEntry.expires_at && new Date(cachedEntry.expires_at) < new Date()) {
      console.log(`⏰ [promptCacheService] Cache expired (TTL) for user ${userId}, hash: ${promptHash.substring(0, 8)}...`);
      return null;
    }
    
    // Check if cache is stale (created before last document upload)
    if (lastDocUpload) {
      const cacheCreatedAt = new Date(cachedEntry.created_at);
      const lastUploadAt = new Date(lastDocUpload);
      
      if (cacheCreatedAt < lastUploadAt) {
        console.log(`🔄 [promptCacheService] Cache invalidated (new document uploaded) for user ${userId}, hash: ${promptHash.substring(0, 8)}...`);
        return null;
      }
    }
    
    // Verify chat_type matches
    if (cachedEntry.chat_type !== chatType) {
      console.log(`⚠️ [promptCacheService] Cache chat_type mismatch for user ${userId} (expected: ${chatType}, found: ${cachedEntry.chat_type})`);
      return null;
    }
    
    // Optional: Check method match if provided
    if (options.methodUsed && cachedEntry.method_used && cachedEntry.method_used !== options.methodUsed) {
      console.log(`⚠️ [promptCacheService] Cache method mismatch for user ${userId}`);
      return null;
    }
    
    // Cache is valid!
    console.log(`✅ [promptCacheService] Cache HIT for user ${userId}, hash: ${promptHash.substring(0, 8)}...`);
    
    // Update cache hit statistics (optional)
    try {
      await pool.query(
        `UPDATE user_metadata SET total_cache_hits = total_cache_hits + 1 WHERE user_id = $1`,
        [userId]
      );
    } catch (statError) {
      // Non-critical, just log
      console.warn('[promptCacheService] Failed to update cache hit stats:', statError.message);
    }
    
    return {
      output: cachedEntry.cached_output,
      cachedAt: cachedEntry.created_at,
      methodUsed: cachedEntry.method_used,
      chatType: cachedEntry.chat_type,
      contextId: cachedEntry.context_id,
      sessionId: cachedEntry.session_id
    };
  } catch (error) {
    console.error('[promptCacheService] Error getting cached response:', error);
    // On error, return null to proceed with fresh generation
    return null;
  }
}

/**
 * Store a new cached response
 * 
 * @param {number} userId - The user ID
 * @param {string} promptText - The prompt text (should be the user's original question, not the secret prompt)
 * @param {string} output - The LLM response to cache
 * @param {Object} options - Optional parameters
 * @param {string} options.chatType - 'folder' or 'file' (REQUIRED)
 * @param {string} options.contextId - folder_name (for folder chats) or file_id (for file chats) (REQUIRED)
 * @param {string} options.methodUsed - Method used (e.g., 'rag', 'gemini_eyeball')
 * @param {string} options.secretId - Optional: secret_id to differentiate between different secret prompts
 * @param {string} options.sessionId - Session ID if applicable
 * @param {number} options.ttlDays - Time to live in days (optional, default: no expiration)
 * @returns {Promise<void>}
 */
async function setCachedResponse(userId, promptText, output, options = {}) {
  try {
    const { chatType, contextId, secretId } = options;
    
    if (!chatType || !contextId) {
      console.warn('[promptCacheService] chatType and contextId are required for cache storage');
      return; // Don't throw, just skip caching
    }
    
    // Build cache key: include secret_id if present to differentiate between secret prompts
    let cacheKeyText = promptText;
    if (secretId) {
      cacheKeyText = `secret:${secretId}:${promptText}`;
    }
    
    const promptHash = generatePromptHash(cacheKeyText);
    const {
      methodUsed = null,
      sessionId = null,
      ttlDays = null
    } = options;
    
    // Calculate expires_at if TTL is provided
    let expiresAt = null;
    if (ttlDays && ttlDays > 0) {
      const expiresDate = new Date();
      expiresDate.setDate(expiresDate.getDate() + ttlDays);
      expiresAt = expiresDate.toISOString();
    }
    
    // Store original prompt text (optional, for debugging - can be NULL for privacy)
    const storePromptText = process.env.CACHE_STORE_PROMPTS === 'true' ? promptText : null;
    
    const query = `
      INSERT INTO prompt_cache (
        user_id,
        prompt_hash,
        cached_output,
        prompt_text,
        method_used,
        chat_type,
        context_id,
        session_id,
        expires_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (user_id, context_id, prompt_hash)
      DO UPDATE SET
        cached_output = EXCLUDED.cached_output,
        method_used = EXCLUDED.method_used,
        chat_type = EXCLUDED.chat_type,
        session_id = EXCLUDED.session_id,
        expires_at = EXCLUDED.expires_at,
        updated_at = CURRENT_TIMESTAMP
    `;
    
    await pool.query(query, [
      userId,
      promptHash,
      output,
      storePromptText,
      methodUsed,
      chatType,
      contextId,
      sessionId,
      expiresAt
    ]);
    
    console.log(`💾 [promptCacheService] Cached response for user ${userId}, hash: ${promptHash.substring(0, 8)}...`);
    
    // Update cache miss statistics (since we're storing, it was a miss)
    try {
      await pool.query(
        `UPDATE user_metadata SET total_cache_misses = total_cache_misses + 1 WHERE user_id = $1`,
        [userId]
      );
    } catch (statError) {
      // Non-critical, just log
      console.warn('[promptCacheService] Failed to update cache miss stats:', statError.message);
    }
  } catch (error) {
    console.error('[promptCacheService] Error setting cached response:', error);
    // Don't throw - caching failure shouldn't break the main flow
  }
}

/**
 * Invalidate all cache entries for a user
 * 
 * @param {number} userId - The user ID
 * @returns {Promise<number>} - Number of cache entries deleted
 */
async function invalidateUserCache(userId) {
  try {
    const query = `
      DELETE FROM prompt_cache
      WHERE user_id = $1
    `;
    
    const { rowCount } = await pool.query(query, [userId]);
    console.log(`🗑️ [promptCacheService] Invalidated ${rowCount} cache entries for user ${userId}`);
    return rowCount;
  } catch (error) {
    console.error('[promptCacheService] Error invalidating user cache:', error);
    throw error;
  }
}

/**
 * Clean up expired cache entries
 * 
 * @returns {Promise<number>} - Number of entries deleted
 */
async function cleanupExpiredCache() {
  try {
    const { rowCount } = await pool.query(
      `SELECT cleanup_expired_cache() as deleted_count`
    );
    return rowCount;
  } catch (error) {
    console.error('[promptCacheService] Error cleaning up expired cache:', error);
    throw error;
  }
}

/**
 * Clean up old cache entries (older than specified days)
 * 
 * @param {number} daysOld - Delete entries older than this many days (default: 30)
 * @returns {Promise<number>} - Number of entries deleted
 */
async function cleanupOldCache(daysOld = 30) {
  try {
    const query = `SELECT cleanup_old_cache($1) as deleted_count`;
    const { rows } = await pool.query(query, [daysOld]);
    return rows[0]?.deleted_count || 0;
  } catch (error) {
    console.error('[promptCacheService] Error cleaning up old cache:', error);
    throw error;
  }
}

/**
 * Get cache statistics for a user
 * 
 * @param {number} userId - The user ID
 * @returns {Promise<Object>} - Cache statistics
 */
async function getCacheStats(userId) {
  try {
    const metaQuery = `
      SELECT 
        total_cache_hits,
        total_cache_misses,
        last_doc_upload,
        last_cache_invalidation
      FROM user_metadata
      WHERE user_id = $1
    `;
    
    const { rows: metaRows } = await pool.query(metaQuery, [userId]);
    
    const cacheCountQuery = `
      SELECT COUNT(*) as total_entries
      FROM prompt_cache
      WHERE user_id = $1
    `;
    
    const { rows: countRows } = await pool.query(cacheCountQuery, [userId]);
    
    return {
      totalCacheEntries: parseInt(countRows[0]?.total_entries || 0),
      totalCacheHits: metaRows[0]?.total_cache_hits || 0,
      totalCacheMisses: metaRows[0]?.total_cache_misses || 0,
      lastDocUpload: metaRows[0]?.last_doc_upload,
      lastCacheInvalidation: metaRows[0]?.last_cache_invalidation,
      hitRate: metaRows[0]?.total_cache_hits && metaRows[0]?.total_cache_misses
        ? (metaRows[0].total_cache_hits / (metaRows[0].total_cache_hits + metaRows[0].total_cache_misses) * 100).toFixed(2) + '%'
        : '0%'
    };
  } catch (error) {
    console.error('[promptCacheService] Error getting cache stats:', error);
    throw error;
  }
}

module.exports = {
  normalizePrompt,
  generatePromptHash,
  getUserMetadata,
  updateLastDocUpload,
  getCachedResponse,
  setCachedResponse,
  invalidateUserCache,
  cleanupExpiredCache,
  cleanupOldCache,
  getCacheStats
};

