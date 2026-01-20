const axios = require('axios');
const crypto = require('crypto');

class AuthService {
  /**
   * Generate PKCE code_verifier (random, URL-safe string)
   * @returns {string} - 43-128 character URL-safe string
   */
  static generateCodeVerifier() {
    // Generate 32 random bytes, base64url encode
    const randomBytes = crypto.randomBytes(32);
    const codeVerifier = randomBytes
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '')
      .substring(0, 43); // Ensure 43-128 characters
    
    console.log('[AuthService] Generated code_verifier, length:', codeVerifier.length);
    return codeVerifier;
  }

  /**
   * Generate PKCE code_challenge from code_verifier using SHA-256
   * @param {string} codeVerifier - The code verifier
   * @returns {string} - Base64url encoded SHA-256 hash
   */
  static generateCodeChallenge(codeVerifier) {
    const hash = crypto.createHash('sha256').update(codeVerifier).digest();
    const codeChallenge = hash
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
    
    console.log('[AuthService] Generated code_challenge, length:', codeChallenge.length);
    return codeChallenge;
  }

  /**
   * Get Microsoft OAuth authorization URL with PKCE
   * @param {string[]} scopes - OAuth scopes
   * @param {string} redirectUri - Redirect URI
   * @param {string} state - State parameter (JSON string with userId)
   * @param {string} codeVerifier - PKCE code verifier (optional, will generate if not provided)
   * @returns {Object} - { authUrl: string, codeVerifier: string }
   */
  static async getAuthCodeUrl(scopes, redirectUri, state, codeVerifier = null) {
    const clientId = process.env.CLIENT_ID;
    const authUrl = new URL('https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
    
    // Generate PKCE if not provided
    if (!codeVerifier) {
      codeVerifier = this.generateCodeVerifier();
    }
    const codeChallenge = this.generateCodeChallenge(codeVerifier);
    
    console.log('[AuthService] Creating OAuth URL with PKCE');
    console.log('[AuthService] Redirect URI:', redirectUri);
    console.log('[AuthService] Client ID:', clientId);
    
    // Required OAuth parameters
    authUrl.searchParams.append('response_type', 'code');
    authUrl.searchParams.append('client_id', clientId);
    authUrl.searchParams.append('redirect_uri', redirectUri);
    authUrl.searchParams.append('scope', scopes.join(' '));
    authUrl.searchParams.append('state', state);
    
    // PKCE parameters (REQUIRED for personal Microsoft accounts)
    authUrl.searchParams.append('code_challenge', codeChallenge);
    authUrl.searchParams.append('code_challenge_method', 'S256');
    
    // Optional parameters
    authUrl.searchParams.append('response_mode', 'query');
    authUrl.searchParams.append('prompt', 'select_account');
    
    // Optional domain hint
    if (process.env.DOMAIN_HINT && process.env.DOMAIN_HINT.trim() !== '') {
      authUrl.searchParams.append('domain_hint', process.env.DOMAIN_HINT.trim());
      console.log('[AuthService] Added domain hint:', process.env.DOMAIN_HINT);
    } else {
      console.log('[AuthService] Multi-tenant mode: Supporting users from any organization/domain');
    }
    
    const finalUrl = authUrl.toString();
    console.log('[AuthService] OAuth URL created with PKCE:', finalUrl.substring(0, 200) + '...');
    
    return {
      authUrl: finalUrl,
      codeVerifier: codeVerifier
    };
  }

  /**
   * Exchange authorization code for access token with PKCE
   * @param {string} code - Authorization code from callback
   * @param {string[]} scopes - OAuth scopes
   * @param {string} redirectUri - Redirect URI (must match authorization request)
   * @param {string} codeVerifier - PKCE code verifier (REQUIRED)
   * @returns {Object} - Token response
   */
  static async getTokenByCode(code, scopes, redirectUri, codeVerifier) {
    const clientId = process.env.CLIENT_ID;
    const clientSecret = process.env.CLIENT_SECRET;
    
    if (!codeVerifier) {
      throw new Error('PKCE code_verifier is required for token exchange');
    }
    
    try {
      const tokenUrl = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
      
      const params = new URLSearchParams();
      params.append('grant_type', 'authorization_code');
      params.append('client_id', clientId);
      
      // IMPORTANT: PKCE can be used with BOTH public and confidential clients
      // 
      // - Public clients (Mobile/SPA apps): PKCE only, NO client_secret
      // - Confidential clients (Web apps): PKCE + client_secret (BOTH required)
      //
      // Your Azure app is registered as a "Web" app (confidential client),
      // so you MUST send client_secret even when using PKCE.
      //
      // Error "AADSTS70002: must include a 'client_secret'" = Web app needs client_secret
      // Error "AADSTS90023: Public clients can't send a client secret" = Public app can't use client_secret
      //
      // Since your app is a Web app, we send BOTH PKCE and client_secret:
      
      if (clientSecret) {
        params.append('client_secret', clientSecret);
        console.log('[AuthService] Using PKCE flow with client_secret (confidential client - Web app)');
      } else {
        console.log('[AuthService] Using PKCE flow without client_secret (public client)');
      }
      
      params.append('code', code);
      params.append('redirect_uri', redirectUri);
      params.append('code_verifier', codeVerifier); // PKCE: Required for personal accounts
      params.append('scope', scopes.join(' '));
      
      console.log('[AuthService] Exchanging authorization code for token with PKCE');
      
      const response = await axios.post(tokenUrl, params.toString(), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });
      
      console.log('[AuthService] Token exchange successful');
      
      return {
        accessToken: response.data.access_token,
        refreshToken: response.data.refresh_token,
        expiresOn: new Date(Date.now() + response.data.expires_in * 1000),
        tokenType: response.data.token_type,
      };
    } catch (error) {
      console.error('[AuthService] Error getting token by code:', {
        message: error.message,
        status: error.response?.status,
        data: error.response?.data
      });
      
      // If we get "Public clients can't send a client secret" error,
      // and we haven't tried without client_secret yet, retry without it
      if (error.response?.data?.error === 'invalid_request' && 
          error.response?.data?.error_description?.includes("Public clients can't send a client secret") &&
          clientSecret) {
        console.log('[AuthService] Retrying token exchange without client_secret (public client mode)');
        
        try {
          const params = new URLSearchParams();
          params.append('grant_type', 'authorization_code');
          params.append('client_id', clientId);
          // Don't include client_secret for public clients
          params.append('code', code);
          params.append('redirect_uri', redirectUri);
          params.append('code_verifier', codeVerifier);
          params.append('scope', scopes.join(' '));
          
          const retryResponse = await axios.post(tokenUrl, params.toString(), {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
            },
          });
          
          console.log('[AuthService] Token exchange successful (public client mode)');
          
          return {
            accessToken: retryResponse.data.access_token,
            refreshToken: retryResponse.data.refresh_token,
            expiresOn: new Date(Date.now() + retryResponse.data.expires_in * 1000),
            tokenType: retryResponse.data.token_type,
          };
        } catch (retryError) {
          console.error('[AuthService] Retry also failed:', retryError.response?.data || retryError.message);
          throw new Error(`Failed to exchange authorization code for token: ${retryError.response?.data?.error_description || retryError.message}`);
        }
      }
      
      if (error.response?.data?.error === 'invalid_grant') {
        throw new Error('Invalid authorization code or PKCE verifier. Please try connecting again.');
      }
      
      throw new Error(`Failed to exchange authorization code for token: ${error.response?.data?.error_description || error.message}`);
    }
  }

  /**
   * Refresh access token using refresh token
   */
  static async refreshToken(refreshToken, scopes) {
    const clientId = process.env.CLIENT_ID;
    const clientSecret = process.env.CLIENT_SECRET;
    
    try {
      const tokenUrl = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
      
      const params = new URLSearchParams();
      params.append('client_id', clientId);
      params.append('client_secret', clientSecret);
      params.append('refresh_token', refreshToken);
      params.append('grant_type', 'refresh_token');
      params.append('scope', scopes.join(' '));
      
      const response = await axios.post(tokenUrl, params.toString(), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });
      
      return {
        accessToken: response.data.access_token,
        refreshToken: response.data.refresh_token || refreshToken,
        expiresOn: new Date(Date.now() + response.data.expires_in * 1000),
        tokenType: response.data.token_type,
      };
    } catch (error) {
      console.error('Error refreshing token:', error.response?.data || error.message);
      throw new Error('Failed to refresh access token');
    }
  }
}

module.exports = AuthService;
