const { google } = require('googleapis');
const User = require('../models/User');

// Google OAuth2 scopes for Drive access
const SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/drive.file'
];

/**
 * Redirect URI sent to Google must match Google Cloud Console → OAuth client → Authorized redirect URIs (exact string).
 * Trailing slashes and stray spaces in .env cause redirect_uri_mismatch.
 */
function resolveDriveRedirectUri() {
  const fallback = 'http://localhost:5000/api/auth/google/drive/callback';
  const raw =
    (process.env.GOOGLE_DRIVE_REDIRECT_URI || '').trim() ||
    (process.env.GOOGLE_DRIVE_CALLBACK_URL || '').trim() ||
    (process.env.GATEWAY_URL && process.env.GATEWAY_URL.trim()
      ? `${process.env.GATEWAY_URL.replace(/\/$/, '')}/api/auth/google/drive/callback`
      : fallback);
  const base = String(raw || fallback).trim();
  const uri = base.startsWith('http') ? base : fallback;
  const normalized = uri.replace(/\/+$/, '');
  // Keep Google Drive OAuth on the dedicated callback path even if an older env
  // value points to the generic Google callback.
  return normalized.replace(/\/api\/auth\/google\/callback$/i, '/api/auth/google/drive/callback');
}

/**
 * Get OAuth2 client for Google Drive
 */
const getOAuth2Client = () => {
  const redirectUri = resolveDriveRedirectUri();
  console.log('[GoogleDrive] Using redirect URI:', redirectUri);

  const clientId = process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_DRIVE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || process.env.GOOGLE_DRIVE_CLIENT_SECRET;

  const oauth2Client = new google.auth.OAuth2(
    clientId,
    clientSecret,
    redirectUri
  );
  return oauth2Client;
};

/**
 * Initiate Google Drive OAuth flow
 * GET /google/drive
 */
const initiateAuth = async (req, res) => {
  try {
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ message: 'User not authenticated' });
    }

    const clientId = process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_DRIVE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET || process.env.GOOGLE_DRIVE_CLIENT_SECRET;
    if (!clientId || !clientId.trim() || !clientSecret || !clientSecret.trim()) {
      console.error('[GoogleDrive] Missing GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET (or GOOGLE_DRIVE_* variants)');
      return res.status(503).json({
        message:
          'Google Drive OAuth is not configured. In Backend/authservice/.env set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (Web OAuth client from Google Cloud Console). In the console, add Authorized redirect URI http://localhost:5000/api/auth/google/drive/callback (or your GATEWAY_URL + /api/auth/google/drive/callback).',
        code: 'OAUTH_NOT_CONFIGURED'
      });
    }

    const redirectUri = resolveDriveRedirectUri();
    const oauth2Client = getOAuth2Client();

    // Must match Authorized redirect URIs for this Web client (exact string). Passing explicitly avoids SDK drift.
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      prompt: 'consent',
      state: userId.toString(),
      redirect_uri: redirectUri,
    });

    console.log('[GoogleDrive] OAuth redirect_uri (must match Google Cloud Console):', redirectUri);

    // Helps fix redirect_uri_mismatch: add this exact string in Google Cloud Console for this client ID
    res.json({ authUrl, redirectUri });
  } catch (error) {
    console.error('[GoogleDrive] Error initiating auth:', error);
    res.status(500).json({ message: 'Failed to initiate Google Drive authorization' });
  }
};

/**
 * Handle OAuth callback and store tokens (GET - from Google redirect)
 * GET /google/drive/callback
 */
const handleCallbackGet = async (req, res) => {
  try {
    const { code, state, error: googleError } = req.query;
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

    console.log('[GoogleDrive] Callback received:', { 
      method: req.method,
      url: req.url,
      originalUrl: req.originalUrl,
      hasCode: !!code, 
      hasState: !!state, 
      googleError,
      query: req.query,
      queryString: req.url.split('?')[1] || 'none',
      headers: {
        referer: req.headers.referer,
        userAgent: req.headers['user-agent']
      }
    });

    // If no query parameters at all, this might not be a Google OAuth callback
    // Could be a direct GET request or health check - just redirect to frontend
    if (Object.keys(req.query).length === 0 && !code && !state && !googleError) {
      console.log('[GoogleDrive] Empty query - redirecting to frontend (likely not a Google callback)');
      return res.redirect(`${frontendUrl}/auth/google/drive/callback?error=invalid_request`);
    }

    // Check if Google returned an error
    if (googleError) {
      console.error('[GoogleDrive] Google OAuth error:', googleError);
      return res.redirect(`${frontendUrl}/auth/google/drive/callback?error=${encodeURIComponent(googleError)}`);
    }

    if (!code) {
      console.error('[GoogleDrive] No authorization code received');
      return res.redirect(`${frontendUrl}/auth/google/drive/callback?error=no_code`);
    }

    if (!state) {
      console.error('[GoogleDrive] No state parameter received');
      return res.redirect(`${frontendUrl}/auth/google/drive/callback?error=no_state`);
    }

    const userId = parseInt(state);
    if (!userId || isNaN(userId)) {
      console.error('[GoogleDrive] Invalid state parameter:', state);
      return res.redirect(`${frontendUrl}/auth/google/drive/callback?error=invalid_state`);
    }

    // Verify user exists
    const user = await User.findById(userId);
    if (!user) {
      console.error('[GoogleDrive] User not found for ID:', userId);
      return res.redirect(`${frontendUrl}/auth/google/drive/callback?error=user_not_found`);
    }

    console.log('[GoogleDrive] Exchanging code for tokens...');
    const redirectUriForToken = resolveDriveRedirectUri();
    const oauth2Client = getOAuth2Client();

    const { tokens } = await oauth2Client.getToken({
      code,
      redirect_uri: redirectUriForToken,
    });
    
    const { access_token, refresh_token, expiry_date } = tokens;

    console.log('[GoogleDrive] Tokens received:', { 
      hasAccessToken: !!access_token, 
      hasRefreshToken: !!refresh_token,
      expiryDate: expiry_date 
    });

    if (!refresh_token) {
      console.error('[GoogleDrive] No refresh token received');
      return res.redirect(`${frontendUrl}/auth/google/drive/callback?error=no_refresh_token`);
    }

    // Store refresh token and expiry in database
    const expiryTimestamp = expiry_date ? new Date(expiry_date) : null;
    
    await User.update(userId, {
      google_drive_refresh_token: refresh_token,
      google_drive_token_expiry: expiryTimestamp
    });

    console.log('[GoogleDrive] ✅ Tokens stored successfully for user:', userId);

    // Redirect to frontend with success
    res.redirect(`${frontendUrl}/auth/google/drive/callback?success=true`);
  } catch (error) {
    console.error('[GoogleDrive] Error handling callback (GET):', error);
    console.error('[GoogleDrive] Error details:', {
      message: error.message,
      stack: error.stack,
      response: error.response?.data
    });
    
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    
    if (error.message.includes('invalid_grant') || error.message.includes('invalid_request')) {
      return res.redirect(`${frontendUrl}/auth/google/drive/callback?error=invalid_grant`);
    }
    
    if (error.message.includes('redirect_uri_mismatch')) {
      return res.redirect(`${frontendUrl}/auth/google/drive/callback?error=redirect_uri_mismatch`);
    }
    
    return res.redirect(`${frontendUrl}/auth/google/drive/callback?error=server_error&details=${encodeURIComponent(error.message)}`);
  }
};

/**
 * Handle OAuth callback and store tokens (POST - from frontend)
 * POST /google/drive/callback
 */
const handleCallbackPost = async (req, res) => {
  try {
    const { code, state } = req.body;
    const userId = req.userId;

    if (!code) {
      return res.status(400).json({ message: 'Authorization code is required' });
    }

    if (!userId) {
      return res.status(401).json({ message: 'User not authenticated' });
    }

    // Verify state matches user ID (security check)
    if (state && parseInt(state) !== userId) {
      return res.status(403).json({ message: 'Invalid state parameter' });
    }

    const redirectUriForToken = resolveDriveRedirectUri();
    const oauth2Client = getOAuth2Client();

    const { tokens } = await oauth2Client.getToken({
      code,
      redirect_uri: redirectUriForToken,
    });

    const { access_token, refresh_token, expiry_date } = tokens;

    if (!refresh_token) {
      return res.status(400).json({ 
        message: 'No refresh token received. Please disconnect and reconnect Google Drive.' 
      });
    }

    // Store refresh token and expiry in database
    const expiryTimestamp = expiry_date ? new Date(expiry_date) : null;
    
    await User.update(userId, {
      google_drive_refresh_token: refresh_token,
      google_drive_token_expiry: expiryTimestamp
    });

    res.json({ 
      message: 'Google Drive connected successfully',
      connected: true 
    });
  } catch (error) {
    console.error('[GoogleDrive] Error handling callback (POST):', error);
    console.error('[GoogleDrive] Error details:', {
      message: error.message,
      code: error.code,
      response: error.response?.data
    });
    
    // Handle invalid_grant (code already used or expired)
    if (error.message.includes('invalid_grant') || error.code === 'invalid_grant') {
      // Check if user already has a refresh token (might be duplicate callback)
      const user = await User.findById(userId);
      if (user?.google_drive_refresh_token) {
        console.log('[GoogleDrive] Code already used, but user already has refresh token - likely duplicate callback');
        // Return success since connection already exists
        return res.json({ 
          message: 'Google Drive is already connected',
          connected: true 
        });
      }
      
      return res.status(400).json({ 
        message: 'Authorization code has already been used or expired. Please try connecting again.' 
      });
    }
    
    res.status(500).json({ message: 'Failed to complete Google Drive authorization' });
  }
};

/**
 * Check Google Drive connection status
 * GET /google/drive/status
 */
const getConnectionStatus = async (req, res) => {
  try {
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ message: 'User not authenticated' });
    }

    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const isConnected = !!user.google_drive_refresh_token;
    
    // Check if token is expired
    let isExpired = false;
    if (user.google_drive_token_expiry) {
      isExpired = new Date(user.google_drive_token_expiry) < new Date();
    }

    res.json({ 
      connected: isConnected && !isExpired,
      hasRefreshToken: isConnected
    });
  } catch (error) {
    console.error('[GoogleDrive] Error checking status:', error);
    res.status(500).json({ message: 'Failed to check Google Drive connection status' });
  }
};

/**
 * Get fresh access token for Google Drive API
 * GET /google/drive/token
 */
const getAccessToken = async (req, res) => {
  try {
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ message: 'User not authenticated' });
    }

    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (!user.google_drive_refresh_token) {
      return res.status(400).json({ 
        message: 'Google Drive not connected. Please connect your Google Drive account first.' 
      });
    }

    const oauth2Client = getOAuth2Client();
    
    // Set refresh token
    oauth2Client.setCredentials({
      refresh_token: user.google_drive_refresh_token
    });

    // Get fresh access token
    const { credentials } = await oauth2Client.refreshAccessToken();
    
    const { access_token, expiry_date } = credentials;

    // Update expiry in database
    if (expiry_date) {
      await User.update(userId, {
        google_drive_token_expiry: new Date(expiry_date)
      });
    }

    res.json({ 
      accessToken: access_token,
      expiresAt: expiry_date ? new Date(expiry_date).toISOString() : null
    });
  } catch (error) {
    console.error('[GoogleDrive] Error getting access token:', error);
    
    if (error.message.includes('invalid_grant') || error.message.includes('Token has been expired or revoked')) {
      // Refresh token is invalid, clear it from database
      await User.update(req.userId, {
        google_drive_refresh_token: null,
        google_drive_token_expiry: null
      });
      
      return res.status(401).json({ 
        message: 'Google Drive connection expired. Please reconnect your account.',
        expired: true
      });
    }
    
    res.status(500).json({ message: 'Failed to get Google Drive access token' });
  }
};

/**
 * Disconnect Google Drive
 * DELETE /google/drive
 */
const disconnect = async (req, res) => {
  try {
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ message: 'User not authenticated' });
    }

    // Clear Google Drive tokens from database
    await User.update(userId, {
      google_drive_refresh_token: null,
      google_drive_token_expiry: null
    });

    res.json({ 
      message: 'Google Drive disconnected successfully',
      connected: false 
    });
  } catch (error) {
    console.error('[GoogleDrive] Error disconnecting:', error);
    res.status(500).json({ message: 'Failed to disconnect Google Drive' });
  }
};

module.exports = {
  initiateAuth,
  handleCallbackGet,
  handleCallbackPost,
  getConnectionStatus,
  getAccessToken,
  disconnect
};
