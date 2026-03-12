const axios = require('axios');
const { verifyToken } = require('../utils/jwt');

const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://localhost:5001';

async function fetchAccountTypeFromAuth(userId) {
  try {
    const url = `${AUTH_SERVICE_URL}/api/auth/internal/user/${userId}/account-type`;
    const res = await axios.get(url, { timeout: 3000 });
    const v = res.data?.account_type;
    return (v && String(v).trim()) ? String(v).toUpperCase() : 'SOLO';
  } catch (err) {
    console.warn('[Auth] Could not fetch account_type from auth service:', err.message);
    return 'SOLO';
  }
}

const authenticateToken = async (req, res, next) => {
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

    let accountType = (decoded.account_type && String(decoded.account_type).trim())
      ? String(decoded.account_type).toUpperCase()
      : 'SOLO';
    // Resolve from auth service when token has SOLO (e.g. old tokens without account_type) so FIRM_ADMIN works without re-login
    if (accountType === 'SOLO') {
      const resolved = await fetchAccountTypeFromAuth(userId);
      if (resolved && resolved !== 'SOLO') accountType = resolved;
    }
    req.user = {
      id: userId,
      email: decoded.email || null,
      role: decoded.role || 'user',
      account_type: accountType, // SOLO | FIRM_ADMIN | FIRM_USER - skip plan limits for FIRM_ADMIN
    };
    req.userId = userId;

    console.log("✅ User authenticated:", req.user);
    next();
  } catch (error) {
    console.error("❌ Error authenticating token:", error.message);
    res.status(500).json({ message: 'Internal server error' });
  }
};

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
  authorize,
};
