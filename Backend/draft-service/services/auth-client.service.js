const axios = require('axios');

/**
 * Service to interact with auth-service for user operations
 */
class AuthClientService {
  static getAuthServiceUrl() {
    return process.env.AUTH_SERVICE_URL || 'http://localhost:5001';
  }

  /**
   * Get user profile data from auth-service
   */
  static async getUserProfile(token) {
    try {
      console.log('[AuthClientService] Getting user profile from auth-service:', {
        url: `${this.getAuthServiceUrl()}/api/auth/profile`,
        hasToken: !!token,
        tokenLength: token?.length
      });
      
      const response = await axios.get(`${this.getAuthServiceUrl()}/api/auth/profile`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      
      console.log('[AuthClientService] User profile retrieved successfully');
      return response.data;
    } catch (error) {
      console.error('[AuthClientService] Error getting user profile:', {
        message: error.message,
        status: error.response?.status,
        data: error.response?.data,
        url: error.config?.url
      });
      
      // Re-throw with more context
      if (error.response?.status === 401 || error.response?.status === 403) {
        throw new Error('Authentication failed: Invalid or expired token');
      }
      throw new Error(`Failed to fetch user profile: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Get user info from auth-service
   */
  static async getUserInfo(token) {
    try {
      const response = await axios.get(`${this.getAuthServiceUrl()}/api/auth/user-info`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      
      return response.data;
    } catch (error) {
      console.error('Auth service error getting user info:', error.response?.data || error.message);
      throw new Error('Failed to fetch user info from auth service');
    }
  }

  /**
   * Get user by ID from auth-service (for admin operations)
   */
  static async getUserById(userId, token) {
    try {
      const response = await axios.get(`${this.getAuthServiceUrl()}/api/auth/users/${userId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      
      return response.data;
    } catch (error) {
      console.error('Auth service error getting user by ID:', error.response?.data || error.message);
      throw new Error('Failed to fetch user from auth service');
    }
  }

  /**
   * Update Microsoft tokens via auth-service
   * Tries multiple endpoints to update Microsoft tokens
   */
  static async updateMicrosoftTokens(token, msAccessToken, msRefreshToken, msTokenExpiry) {
    try {
      const payload = {
        ms_access_token: msAccessToken,
        ms_refresh_token: msRefreshToken,
        ms_token_expiry: msTokenExpiry,
      };
      
      const headers = {
        Authorization: `Bearer ${token}`,
      };
      
      // Try dedicated Microsoft tokens endpoint first
      try {
        const response = await axios.put(
          `${this.getAuthServiceUrl()}/api/auth/update-microsoft-tokens`,
          payload,
          { headers }
        );
        console.log('[AuthClientService] Microsoft tokens updated via dedicated endpoint');
        return response.data;
      } catch (endpointError) {
        console.log('[AuthClientService] Dedicated endpoint not available, trying update endpoint');
        
        // Fallback to update profile endpoint
        const response = await axios.put(
          `${this.getAuthServiceUrl()}/api/auth/update`,
          payload,
          { headers }
        );
        console.log('[AuthClientService] Microsoft tokens updated via profile endpoint');
        return response.data;
      }
    } catch (error) {
      console.error('[AuthClientService] Error updating Microsoft tokens:', {
        message: error.message,
        status: error.response?.status,
        data: error.response?.data,
        url: error.config?.url
      });
      throw new Error(`Failed to update Microsoft tokens: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Clear Microsoft tokens via auth-service
   */
  static async clearMicrosoftTokens(token) {
    try {
      console.log('[AuthClientService] Clearing Microsoft tokens for user');
      return await this.updateMicrosoftTokens(token, null, null, null);
    } catch (error) {
      console.error('[AuthClientService] Error clearing Microsoft tokens:', {
        message: error.message,
        status: error.response?.status,
        data: error.response?.data
      });
      throw error;
    }
  }
}

module.exports = AuthClientService;
