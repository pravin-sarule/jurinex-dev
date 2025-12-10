const pool = require('../config/db');

// Cache for system prompt to avoid repeated database queries
let systemPromptCache = null;
let cacheTimestamp = null;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes cache

const SystemPrompt = {
  /**
   * Get the latest system prompt from the database
   * @returns {Promise<string|null>} The system prompt text or null if not found
   */
  async getLatestSystemPrompt() {
    // Check cache first
    const now = Date.now();
    if (systemPromptCache && cacheTimestamp && (now - cacheTimestamp) < CACHE_TTL) {
      console.log('[SystemPrompt] Using cached system prompt');
      return systemPromptCache;
    }

    try {
      const query = `
        SELECT system_prompt
        FROM system_prompts
        ORDER BY updated_at DESC, created_at DESC
        LIMIT 1;
      `;
      const { rows } = await pool.query(query);
      
      if (rows.length === 0 || !rows[0].system_prompt) {
        console.warn('[SystemPrompt] No system prompt found in database');
        return null;
      }

      const prompt = rows[0].system_prompt;
      
      // Update cache
      systemPromptCache = prompt;
      cacheTimestamp = now;
      
      console.log('[SystemPrompt] ✅ Fetched system prompt from database (length:', prompt.length, 'chars)');
      return prompt;
    } catch (err) {
      console.error('[SystemPrompt] Error fetching system prompt:', err.message);
      // Return cached value if available, even if expired
      if (systemPromptCache) {
        console.warn('[SystemPrompt] Using expired cache due to database error');
        return systemPromptCache;
      }
      return null;
    }
  },

  /**
   * Clear the system prompt cache (useful for testing or when prompt is updated)
   */
  clearCache() {
    systemPromptCache = null;
    cacheTimestamp = null;
    console.log('[SystemPrompt] Cache cleared');
  }
};

module.exports = SystemPrompt;

