const { verifyToken } = require('../utils/jwt');

/**
 * Middleware to authenticate JWT tokens from Authorization header
 */
const authenticateToken = (req, res, next) => {
  try {
    console.log("🔐 Checking token...");

    const authHeader = req.headers['authorization'];
    const token = authHeader?.split(' ')[1]; // "Bearer <token>"

    if (!token) {
      console.log("❌ No authentication token provided.");
      return res.status(401).json({ message: 'Authentication token required' });
    }

    console.log("✅ Token received, verifying...");
    const decoded = verifyToken(token);

    if (!decoded) {
      console.log("❌ Invalid or expired token.");
      return res.status(403).json({ message: 'Invalid or expired token' });
    }

    const userId = decoded.id || decoded.userId;
    if (!userId) {
      console.log("❌ User ID missing in token payload.");
      return res.status(400).json({ message: 'User ID missing from token' });
    }

    req.user = {
      id: userId,
      email: decoded.email || null,
      role: decoded.role || 'user',
    };
    req.userId = userId;

    console.log("✅ User authenticated:", req.user);
    next();
  } catch (error) {
    console.error("❌ Error authenticating token:", error.message);
    res.status(500).json({ message: 'Internal server error' });
  }
};

/**
 * Middleware to extract Google Access Token from Authorization header
 * This is used for endpoints that need to interact with Google APIs on behalf of the user
 */
const extractGoogleToken = (req, res, next) => {
  try {
    // Google access token can be passed in:
    // 1. Request body as 'googleAccessToken'
    // 2. Custom header 'X-Google-Access-Token'
    // 3. Query parameter 'googleAccessToken'
    
    const googleAccessToken = 
      req.body?.googleAccessToken || 
      req.headers['x-google-access-token'] ||
      req.query?.googleAccessToken;

    if (googleAccessToken) {
      req.googleAccessToken = googleAccessToken;
      console.log("✅ Google access token extracted");
    }
    
    next();
  } catch (error) {
    console.error("❌ Error extracting Google token:", error.message);
    next();
  }
};

/**
 * Authorization middleware for role-based access
 */
const authorize = (roles = []) => {
  if (typeof roles === 'string') roles = [roles];

  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: 'Unauthorized: User not authenticated' });
    }

    if (roles.length > 0 && !roles.includes(req.user.role)) {
      return res.status(403).json({
        message: 'Forbidden: You do not have permission to access this resource.',
      });
    }

    next();
  };
};

module.exports = {
  protect: authenticateToken,
  extractGoogleToken,
  authorize,
};

