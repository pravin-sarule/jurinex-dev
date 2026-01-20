const jwt = require('jsonwebtoken');
const AuthClientService = require('../services/auth-client.service');

/**
 * Middleware to authenticate JWT tokens
 * Verifies token and optionally fetches user data from auth-service
 */
const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // "Bearer <token>"

    if (!token) {
      return res.status(401).json({ message: 'Authentication token required' });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (jwtError) {
      console.error('[auth.middleware] JWT verification failed:', {
        name: jwtError.name,
        message: jwtError.message,
        hasJWTSecret: !!process.env.JWT_SECRET,
        jwtSecretLength: process.env.JWT_SECRET?.length
      });
      throw jwtError; // Re-throw to be caught by outer catch
    }
    
    // Set user ID from token
    req.userId = decoded.userId || decoded.id;
    req.user = {
      id: decoded.userId || decoded.id,
      email: decoded.email || null,
      role: decoded.role || null,
    };

    // Optionally fetch full user data from auth-service if needed
    // For now, we'll fetch it when specifically needed (e.g., for Microsoft tokens)
    
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(403).json({ message: 'Invalid token' });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(403).json({ message: 'Token expired' });
    }
    console.error('Auth middleware error:', error);
    res.status(500).json({ message: 'Authentication error' });
  }
};

/**
 * Middleware to verify Microsoft account is connected
 * Fetches user data from auth-service to check Microsoft token status
 */
const requireMicrosoftAuth = async (req, res, next) => {
  try {
    const token = req.headers['authorization']?.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({ message: 'Authentication token required' });
    }

    // Fetch user data from auth-service to get Microsoft tokens
    const userData = await AuthClientService.getUserProfile(token);
    const user = userData.user || userData;
    
    if (!user || !user.ms_access_token) {
      return res.status(401).json({ message: 'Microsoft account not connected' });
    }
    
    // Check if token is expired and attempt refresh
    if (user.ms_token_expiry && new Date(user.ms_token_expiry) < new Date()) {
      console.log('[requireMicrosoftAuth] Token expired, attempting refresh...');
      
      // Try to refresh token if refresh token is available
      if (user.ms_refresh_token) {
        try {
          const AuthService = require('../services/auth.service');
          const SCOPES = ["openid", "profile", "email", "User.Read", "Files.ReadWrite", "offline_access"];
          
          const refreshed = await AuthService.refreshToken(user.ms_refresh_token, SCOPES);
          
          // Update tokens in auth-service
          const AuthClientService = require('../services/auth-client.service');
          await AuthClientService.updateMicrosoftTokens(
            token,
            refreshed.accessToken,
            refreshed.refreshToken,
            refreshed.expiresOn
          );
          
          // Use refreshed token
          req.user = {
            ...req.user,
            ms_access_token: refreshed.accessToken,
            ms_refresh_token: refreshed.refreshToken,
            ms_token_expiry: refreshed.expiresOn,
          };
          
          console.log('[requireMicrosoftAuth] Token refreshed successfully');
          return next();
        } catch (refreshError) {
          console.error('[requireMicrosoftAuth] Token refresh failed:', refreshError.message);
          return res.status(401).json({ 
            message: 'Microsoft token expired and refresh failed. Please reconnect your Microsoft account.',
            code: 'TOKEN_REFRESH_FAILED'
          });
        }
      } else {
        return res.status(401).json({ 
          message: 'Microsoft token expired. Please reconnect your Microsoft account.',
          code: 'TOKEN_EXPIRED'
        });
      }
    }
    
    // Attach Microsoft tokens to req.user
    req.user = {
      ...req.user,
      ms_access_token: user.ms_access_token,
      ms_refresh_token: user.ms_refresh_token,
      ms_token_expiry: user.ms_token_expiry,
    };
    
    next();
  } catch (error) {
    console.error('Microsoft auth middleware error:', error);
    res.status(500).json({ message: 'Microsoft authentication check failed' });
  }
};

module.exports = {
  authenticateToken,
  requireMicrosoftAuth,
};
