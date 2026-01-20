const { google } = require('googleapis');
const axios = require('axios');

/**
 * OAuth2 Client Utility for Google Drive/Docs API
 * Fetches refresh tokens from Auth Service and manages token refresh
 */

// Get Auth Service URL from environment
const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://localhost:5001';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
  console.warn('⚠️  GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET not set in environment');
}

/**
 * Initialize OAuth2 client with credentials
 * @returns {google.auth.OAuth2Client} OAuth2 client instance
 */
const getOAuth2Client = () => {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    throw new Error('Google OAuth2 credentials not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.');
  }

  const redirectUri = process.env.GOOGLE_DRIVE_REDIRECT_URI || 
                     process.env.GATEWAY_URL + '/api/auth/google/callback' ||
                     'http://localhost:5000/api/auth/google/callback';

  const oauth2Client = new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    redirectUri
  );

  return oauth2Client;
};

/**
 * Fetch user's Google Drive refresh token from Auth Service
 * 
 * NOTE: This requires the Auth Service to have an internal endpoint that returns
 * Google Drive tokens. If not available, you have two options:
 * 1. Add an internal endpoint in Auth Service: GET /api/auth/internal/user/:userId/tokens
 * 2. Use shared database access (less secure, not recommended)
 * 
 * @param {number} userId - User ID
 * @returns {Promise<Object>} User data with refresh token
 */
const fetchUserTokensFromAuthService = async (userId) => {
  try {
    // Option 1: Try internal endpoint (recommended)
    // Add this endpoint to Auth Service if it doesn't exist:
    // GET /api/auth/internal/user/:userId/tokens
    // Should return: { google_drive_refresh_token, google_drive_token_expiry, email }
    try {
      const response = await axios.get(
        `${AUTH_SERVICE_URL}/api/auth/internal/user/${userId}/tokens`,
        {
          headers: {
            'Authorization': `Bearer ${process.env.INTERNAL_SERVICE_TOKEN || ''}`,
            'Content-Type': 'application/json',
            'X-Internal-Request': 'true'
          },
          timeout: 5000
        }
      );

      const tokenData = response.data;
      
      if (!tokenData.google_drive_refresh_token) {
        throw new Error(`User ${userId} has not connected Google Drive`);
      }

      return {
        google_drive_refresh_token: tokenData.google_drive_refresh_token,
        google_drive_token_expiry: tokenData.google_drive_token_expiry,
        email: tokenData.email
      };
    } catch (internalError) {
      // If internal endpoint doesn't exist, try regular endpoint
      if (internalError.response?.status === 404) {
        console.warn(`[OAuth2] Internal token endpoint not found, trying regular endpoint...`);
        
        // Option 2: Fallback to regular endpoint (may not include tokens)
        const response = await axios.get(
          `${AUTH_SERVICE_URL}/api/auth/users/${userId}`,
          {
            headers: {
              'Authorization': `Bearer ${process.env.INTERNAL_SERVICE_TOKEN || ''}`,
              'Content-Type': 'application/json'
            },
            timeout: 5000
          }
        );

        const userData = response.data.user || response.data;
        
        if (!userData) {
          throw new Error(`User ${userId} not found`);
        }

        // Check if tokens are included (they might not be for security)
        if (!userData.google_drive_refresh_token) {
          throw new Error(
            `User ${userId} tokens not available. ` +
            `Please add an internal endpoint in Auth Service: GET /api/auth/internal/user/:userId/tokens`
          );
        }

        return {
          google_drive_refresh_token: userData.google_drive_refresh_token,
          google_drive_token_expiry: userData.google_drive_token_expiry,
          email: userData.email
        };
      }
      
      throw internalError;
    }
  } catch (error) {
    console.error(`[OAuth2] Failed to fetch tokens from Auth Service for user ${userId}:`, error.message);
    
    if (error.response?.status === 404) {
      throw new Error(`User ${userId} not found`);
    }
    
    if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
      throw new Error(`Auth Service is unavailable. Cannot fetch user tokens.`);
    }
    
    throw new Error(`Failed to fetch Google Drive tokens: ${error.message}`);
  }
};

/**
 * Get authorized OAuth2 client for a user
 * Fetches refresh token from Auth Service and refreshes access token if needed
 * @param {number} userId - User ID
 * @returns {Promise<google.auth.OAuth2Client>} Authorized OAuth2 client
 */
const getAuthorizedClient = async (userId) => {
  try {
    // Fetch user's refresh token from Auth Service
    const userData = await fetchUserTokensFromAuthService(userId);
    
    if (!userData.google_drive_refresh_token) {
      throw new Error(`User ${userId} has not connected Google Drive. Please connect Google Drive first.`);
    }

    const oauth2Client = getOAuth2Client();
    
    // Set refresh token
    oauth2Client.setCredentials({
      refresh_token: userData.google_drive_refresh_token
    });

    // Check if token is expired
    const isExpired = userData.google_drive_token_expiry && 
                     new Date(userData.google_drive_token_expiry) < new Date();

    // Refresh access token if expired or about to expire (within 5 minutes)
    if (isExpired || !userData.google_drive_token_expiry) {
      console.log(`[OAuth2] Refreshing access token for user ${userId}`);
      
      try {
        const { credentials } = await oauth2Client.refreshAccessToken();
        
        // Optionally update expiry in Auth Service (if endpoint exists)
        // This is a fire-and-forget operation, don't block on it
        axios.patch(
          `${AUTH_SERVICE_URL}/api/auth/user/${userId}/google-tokens`,
          {
            google_drive_token_expiry: credentials.expiry_date ? new Date(credentials.expiry_date).toISOString() : null
          },
          {
            headers: {
              'Authorization': `Bearer ${process.env.INTERNAL_SERVICE_TOKEN || ''}`
            }
          }
        ).catch(err => {
          console.warn(`[OAuth2] Failed to update token expiry in Auth Service (non-critical):`, err.message);
        });

        console.log(`[OAuth2] ✅ Access token refreshed for user ${userId}`);
      } catch (refreshError) {
        console.error(`[OAuth2] Failed to refresh access token:`, refreshError);
        
        if (refreshError.message?.includes('invalid_grant') || 
            refreshError.message?.includes('Token has been expired or revoked')) {
          throw new Error(`Google Drive connection expired. Please reconnect your Google Drive account.`);
        }
        
        throw new Error(`Failed to refresh Google Drive access token: ${refreshError.message}`);
      }
    }

    return oauth2Client;
  } catch (error) {
    console.error(`[OAuth2] Error getting authorized client for user ${userId}:`, error);
    throw error;
  }
};

/**
 * Get user's email from Auth Service
 * @param {number} userId - User ID
 * @returns {Promise<string>} User email
 */
const getUserEmail = async (userId) => {
  const internalToken = process.env.INTERNAL_SERVICE_TOKEN;
  
  if (!internalToken) {
    throw new Error('INTERNAL_SERVICE_TOKEN not configured. Cannot fetch user email from auth service.');
  }

  try {
    const response = await axios.get(
      `${AUTH_SERVICE_URL}/api/auth/users/${userId}`,
      {
        headers: {
          'Authorization': `Bearer ${internalToken}`,
          'Content-Type': 'application/json'
        },
        timeout: 5000
      }
    );

    return response.data.email;
  } catch (error) {
    // Don't log full error details if it's just a missing token
    if (error.response?.status === 401) {
      throw new Error('Authentication failed - INTERNAL_SERVICE_TOKEN may be invalid or expired');
    }
    throw new Error(`Failed to fetch user email: ${error.message}`);
  }
};

module.exports = {
  getOAuth2Client,
  getAuthorizedClient,
  getUserEmail,
  fetchUserTokensFromAuthService
};

