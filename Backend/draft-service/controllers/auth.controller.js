const AuthService = require('../services/auth.service');
const AuthClientService = require('../services/auth-client.service');
const pkceStore = require('../services/pkce.store');
const jwt = require('jsonwebtoken');

// OAuth Scopes - CORRECT per architecture requirements
// openid, profile, email: Required for OAuth 2.0
// User.Read: Read user profile
// Files.ReadWrite: Create/edit files in OneDrive (for Option B fallback)
// offline_access: Refresh tokens
const SCOPES = ["openid", "profile", "email", "User.Read", "Files.ReadWrite", "offline_access"];

exports.signIn = async (req, res) => {
  try {
    // Try to get token from query parameter or Authorization header
    const token = req.query.token || req.header('Authorization')?.replace('Bearer ', '') || req.headers.authorization?.replace('Bearer ', '');
    
    console.log('[auth.controller] signIn - Token check:', {
      hasQueryToken: !!req.query.token,
      hasAuthHeader: !!req.header('Authorization'),
      hasToken: !!token,
      queryKeys: Object.keys(req.query)
    });
    
    if (!token) {
      console.error('[auth.controller] No token provided in request');
      return res.status(401).json({ error: 'No token provided' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    // Handle both userId and id fields (different auth-services use different field names)
    const userId = decoded.userId || decoded.id;
    
    console.log('[auth.controller] Token verified:', {
      userId: userId,
      email: decoded.email,
      decodedFields: Object.keys(decoded)
    });
    
    if (!userId) {
      console.error('[auth.controller] No userId or id found in token:', decoded);
      return res.status(401).json({ 
        error: 'Invalid token structure',
        details: 'Token does not contain user ID'
      });
    }
    
    // Generate PKCE and create OAuth URL
    const { authUrl, codeVerifier } = await AuthService.getAuthCodeUrl(
      SCOPES, 
      process.env.REDIRECT_URI,
      JSON.stringify({ userId: userId, userToken: token })
    );
    
    // Store code_verifier temporarily (expires in 5 minutes)
    pkceStore.set(userId, codeVerifier, 5);
    console.log('[auth.controller] Stored PKCE code_verifier for userId:', userId);
    
    // Redirect to Microsoft OAuth
    res.redirect(authUrl);
  } catch (error) {
    console.error('[auth.controller] SignIn error:', {
      name: error.name,
      message: error.message,
      stack: error.stack
    });
    
    if (error.name === 'JsonWebTokenError') {
      console.error('[auth.controller] JWT verification failed - possible JWT_SECRET mismatch');
      return res.status(401).json({ 
        error: 'Invalid token',
        details: 'Token verification failed. Please ensure you are logged in and your session is valid.'
      });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ 
        error: 'Token expired',
        details: 'Your session has expired. Please log in again.'
      });
    }
    res.status(500).json({ 
      error: "Error initiating Microsoft login",
      details: error.message 
    });
  }
};

exports.callback = async (req, res) => {
  const { code, state, error, error_description } = req.query;

  // Handle OAuth errors
  if (error) {
    console.error('[auth.controller] OAuth callback error:', {
      error,
      error_description,
      query: req.query
    });

    // Admin consent required
    if (error === 'access_denied' || error_description?.includes('consent_required') || error_description?.includes('not available')) {
      const adminConsentUrl = `https://login.microsoftonline.com/common/adminconsent?client_id=${process.env.CLIENT_ID}`;
      console.log('[auth.controller] Admin consent required. URL:', adminConsentUrl);
      
      return res.redirect(
        `${process.env.FRONTEND_URL}?error=admin_consent_required&admin_consent_url=${encodeURIComponent(adminConsentUrl)}&details=${encodeURIComponent(error_description || 'App needs admin approval in your organization')}`
      );
    }

    // Other OAuth errors
    return res.redirect(
      `${process.env.FRONTEND_URL}?error=auth_failed&details=${encodeURIComponent(error_description || error)}`
    );
  }

  if (!code) {
    return res.redirect(`${process.env.FRONTEND_URL}?error=no_code`);
  }

  try {
    const stateData = JSON.parse(state);
    const userId = stateData.userId;

    // Retrieve PKCE code_verifier
    const codeVerifier = pkceStore.get(userId);
    
    if (!codeVerifier) {
      console.error('[auth.controller] PKCE code_verifier not found or expired for userId:', userId);
      return res.redirect(`${process.env.FRONTEND_URL}?error=pkce_expired&details=PKCE verification expired. Please try connecting again.`);
    }

    console.log('[auth.controller] Retrieved PKCE code_verifier for userId:', userId);

    // Exchange authorization code for token with PKCE
    const tokenResponse = await AuthService.getTokenByCode(
      code, 
      SCOPES, 
      process.env.REDIRECT_URI,
      codeVerifier // PKCE: Required for personal Microsoft accounts
    );

    // Delete code_verifier after successful exchange (security: one-time use)
    pkceStore.delete(userId);
    console.log('[auth.controller] PKCE code_verifier deleted after successful token exchange');

    // Update user with Microsoft tokens via auth-service API
    // Note: This requires auth-service to support Microsoft token updates in updateProfile endpoint
    // or a dedicated endpoint for Microsoft token management
    const userToken = stateData.userToken || req.query.token || req.header('Authorization')?.replace('Bearer ', '');
    
    try {
      await AuthClientService.updateMicrosoftTokens(
        userToken,
        tokenResponse.accessToken,
        tokenResponse.refreshToken,
        tokenResponse.expiresOn
      );
      console.log('[auth.controller] ✅ Microsoft tokens successfully stored in auth-service');
    } catch (error) {
      console.error('[auth.controller] Failed to update Microsoft tokens via auth-service:', {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status
      });
      // Don't fail the entire flow - tokens are received, but storage failed
      // User can retry connecting if needed
      console.warn('⚠️ Microsoft tokens received but could not be persisted via auth-service API');
    }

    console.log("✅ Microsoft Authentication Successful for user:", userId);

    // Redirect to frontend DRAFTING PAGE with success indicator
    // IMPORTANT: Must redirect to /drafting with platform=microsoft-word, so DraftingPage knows it's MS Word mode
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const redirectUrl = `${frontendUrl}/drafting?platform=microsoft-word&ms_connected=true`;
    console.log('[auth.controller] Redirecting to frontend drafting page:', redirectUrl);
    res.redirect(redirectUrl);

  } catch (error) {
    console.error('[auth.controller] Callback error:', error);
    
    // Clean up PKCE on error
    try {
      const stateData = JSON.parse(state);
      if (stateData.userId) {
        pkceStore.delete(stateData.userId);
        console.log('[auth.controller] Cleaned up PKCE code_verifier after error');
      }
    } catch (parseError) {
      console.error('[auth.controller] Could not parse state for cleanup:', parseError);
    }
    
    const errorMessage = error.message || 'Authentication failed';
    res.redirect(`${process.env.FRONTEND_URL}?error=auth_failed&details=${encodeURIComponent(errorMessage)}`);
  }
};

exports.getStatus = async (req, res) => {
  try {
    const authHeader = req.headers['authorization'] || req.header('Authorization');
    const token = authHeader?.replace('Bearer ', '')?.trim();
    
    console.log('[auth.controller] getStatus - Token check:', {
      hasAuthHeader: !!authHeader,
      hasToken: !!token,
      tokenLength: token?.length
    });
    
    if (!token) {
      console.log('[auth.controller] getStatus - No token provided');
      return res.json({ isConnected: false });
    }

    try {
      // Get user data from auth-service
      const userData = await AuthClientService.getUserProfile(token);
      const user = userData.user || userData;
      
      console.log('[auth.controller] getStatus - User data retrieved:', {
        hasUser: !!user,
        hasMsToken: !!user?.ms_access_token,
        msTokenExpiry: user?.ms_token_expiry
      });
      
      if (!user || !user.ms_access_token) {
        return res.json({ isConnected: false });
      }
      
      const isExpired = user.ms_token_expiry && new Date(user.ms_token_expiry) < new Date();
      
      res.json({ 
        isConnected: !isExpired,
        expiresAt: user.ms_token_expiry
      });
    } catch (authError) {
      console.error('[auth.controller] getStatus - Auth service error:', {
        message: authError.message,
        response: authError.response?.data,
        status: authError.response?.status
      });
      // If token is invalid or auth-service returns error, return not connected
      return res.json({ isConnected: false });
    }
  } catch (error) {
    console.error('[auth.controller] getStatus - Unexpected error:', error);
    res.json({ isConnected: false });
  }
};

exports.disconnect = async (req, res) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ message: 'Authentication token required' });
    }

    // Clear Microsoft tokens via auth-service API
    await AuthClientService.clearMicrosoftTokens(token);

    res.json({ message: 'Microsoft account disconnected' });
  } catch (error) {
    console.error('Disconnect error:', error);
    res.status(500).json({ 
      message: 'Disconnect failed',
      error: error.message 
    });
  }
};
