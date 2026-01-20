const axios = require('axios');

class GatewayService {
  /**
   * Forward request to gateway service
   */
  static async forwardRequest(endpoint, method = 'GET', data = null, headers = {}) {
    const gatewayUrl = process.env.GATEWAY_SERVICE_URL || 'http://localhost:5000';
    
    try {
      const config = {
        method,
        url: `${gatewayUrl}${endpoint}`,
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
      };
      
      if (data && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
        config.data = data;
      }
      
      const response = await axios(config);
      return response.data;
    } catch (error) {
      console.error('Gateway service error:', error.response?.data || error.message);
      throw new Error(`Gateway service request failed: ${error.message}`);
    }
  }

  /**
   * Get user data from auth service
   */
  static async getUserData(token) {
    const authServiceUrl = process.env.AUTH_SERVICE_URL || 'http://localhost:5001';
    
    try {
      const response = await axios.get(`${authServiceUrl}/api/auth/profile`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      
      return response.data;
    } catch (error) {
      console.error('Auth service error:', error.response?.data || error.message);
      throw new Error('Failed to fetch user data from auth service');
    }
  }

  /**
   * Get user by ID from auth service
   */
  static async getUserById(userId, token) {
    const authServiceUrl = process.env.AUTH_SERVICE_URL || 'http://localhost:5001';
    
    try {
      const response = await axios.get(`${authServiceUrl}/api/auth/users/${userId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      
      return response.data;
    } catch (error) {
      console.error('Auth service error:', error.response?.data || error.message);
      throw new Error('Failed to fetch user data from auth service');
    }
  }
}

module.exports = GatewayService;
