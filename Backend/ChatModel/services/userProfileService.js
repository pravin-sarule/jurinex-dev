const axios = require('axios');

/**
 * Service to fetch user data from Auth Service
 * Similar to document-service implementation
 */
class UserProfileService {
  /**
   * Get user profile from auth service
   * @param {number} userId - User ID
   * @param {string} authorizationHeader - Authorization header (Bearer token)
   * @returns {Promise<Object|null>} - User profile object or null
   */
  static async getUserProfile(userId, authorizationHeader) {
    try {
      const authServiceUrl = process.env.AUTH_SERVICE_URL || 'http://localhost:5001';
      const gatewayUrl = process.env.API_GATEWAY_URL || 'http://localhost:5000';
      
      const endpoints = [];
      if (process.env.AUTH_SERVICE_URL || !process.env.API_GATEWAY_URL) {
        endpoints.push(`${authServiceUrl}/api/auth/profile`);
      }
      if (process.env.API_GATEWAY_URL) {
        endpoints.push(`${gatewayUrl}/auth/profile`);
      }
      
      if (endpoints.length === 0) {
        endpoints.push(`${authServiceUrl}/api/auth/profile`);
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
          
          if (response.data?.user) {
            console.log(`[UserProfileService] ✅ Successfully fetched user profile for user ${userId}`);
            return response.data.user;
          }
        } catch (error) {
          console.warn(`[UserProfileService] Failed to fetch from ${endpoint}:`, error.response?.status || error.message);
          lastError = error;
          continue;
        }
      }
      
      console.warn(`[UserProfileService] ⚠️ Could not fetch user profile. Last error:`, lastError?.response?.status || lastError?.message);
      return null;
    } catch (error) {
      console.error(`[UserProfileService] ❌ Unexpected error fetching user profile for user ${userId}:`, error.message);
      return null;
    }
  }
}

module.exports = UserProfileService;



