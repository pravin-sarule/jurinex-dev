const axios = require('axios');

const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://localhost:5001';
const API_GATEWAY_URL = process.env.API_GATEWAY_URL || 'http://localhost:5000';

/**
 * Service to fetch user information from Auth Service
 */
class UserService {
  /**
   * Get username by user ID
   * @param {number} userId - User ID
   * @param {string} authorizationHeader - Authorization header (Bearer token)
   * @returns {Promise<string|null>} Username or null
   */
  static async getUsernameById(userId, authorizationHeader) {
    try {
      const endpoints = [];
      if (API_GATEWAY_URL) {
        endpoints.push(`${API_GATEWAY_URL}/auth/users/${userId}`);
      }
      if (AUTH_SERVICE_URL) {
        endpoints.push(`${AUTH_SERVICE_URL}/api/auth/users/${userId}`);
      }
      
      if (endpoints.length === 0) {
        endpoints.push(`${AUTH_SERVICE_URL}/api/auth/users/${userId}`);
      }

      let lastError = null;
      for (const endpoint of endpoints) {
        try {
          const response = await axios.get(endpoint, {
            headers: {
              Authorization: authorizationHeader,
              'Content-Type': 'application/json'
            },
            timeout: 5000
          });
          
          const username = response.data?.user?.username || response.data?.username;
          if (username) {
            console.log(`✅ [UserService] Fetched username for user ${userId}: ${username}`);
            return username;
          }
        } catch (error) {
          console.warn(`⚠️ [UserService] Failed to fetch username from ${endpoint}:`, error.response?.status || error.message);
          lastError = error;
          continue;
        }
      }
      
      console.warn(`⚠️ [UserService] Could not fetch username for user ${userId}`);
      return null;
    } catch (error) {
      console.error(`❌ [UserService] Error fetching username for user ${userId}:`, error.message);
      return null;
    }
  }

  /**
   * Get usernames for multiple user IDs (batch)
   * @param {Array<number>} userIds - Array of user IDs
   * @param {string} authorizationHeader - Authorization header
   * @returns {Promise<Map<number, string>>} Map of userId -> username
   */
  static async getUsernamesByIds(userIds, authorizationHeader) {
    const usernameMap = new Map();
    
    // Fetch usernames in parallel (with limit to avoid overwhelming the service)
    const batchSize = 10;
    for (let i = 0; i < userIds.length; i += batchSize) {
      const batch = userIds.slice(i, i + batchSize);
      const promises = batch.map(async (userId) => {
        const username = await this.getUsernameById(userId, authorizationHeader);
        if (username) {
          usernameMap.set(userId, username);
        }
      });
      
      await Promise.all(promises);
    }
    
    return usernameMap;
  }

  /**
   * Get active users from auth service
   * @param {string} authorizationHeader - Authorization header
   * @returns {Promise<Array>} Array of active users
   */
  static async getActiveUsers(authorizationHeader) {
    try {
      const endpoints = [];
      if (API_GATEWAY_URL) {
        endpoints.push(`${API_GATEWAY_URL}/auth/users/active`);
        endpoints.push(`${API_GATEWAY_URL}/auth/users?is_blocked=false`);
      }
      if (AUTH_SERVICE_URL) {
        endpoints.push(`${AUTH_SERVICE_URL}/api/auth/users/active`);
        endpoints.push(`${AUTH_SERVICE_URL}/api/auth/users?is_blocked=false`);
      }
      
      if (endpoints.length === 0) {
        endpoints.push(`${AUTH_SERVICE_URL}/api/auth/users/active`);
      }

      let lastError = null;
      for (const endpoint of endpoints) {
        try {
          const response = await axios.get(endpoint, {
            headers: {
              Authorization: authorizationHeader,
              'Content-Type': 'application/json'
            },
            timeout: 10000
          });
          
          // Handle different response formats
          const users = response.data?.users || response.data?.data || [];
          if (Array.isArray(users) && users.length > 0) {
            console.log(`✅ [UserService] Fetched ${users.length} active users`);
            return users.map(user => ({
              id: user.id,
              username: user.username || user.name,
              email: user.email,
              status: user.status || 'active'
            }));
          } else if (Array.isArray(users)) {
            // Empty array is valid
            console.log(`✅ [UserService] Fetched 0 active users`);
            return [];
          }
        } catch (error) {
          // If it's 404, try next endpoint. Otherwise log warning
          if (error.response?.status !== 404) {
            console.warn(`⚠️ [UserService] Failed to fetch active users from ${endpoint}:`, error.response?.status || error.message);
          }
          lastError = error;
          continue;
        }
      }
      
      console.warn(`⚠️ [UserService] Could not fetch active users - endpoint may not exist`);
      return [];
    } catch (error) {
      console.error(`❌ [UserService] Error fetching active users:`, error.message);
      return [];
    }
  }
}

module.exports = UserService;

