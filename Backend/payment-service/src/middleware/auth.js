const { verifyToken } = require('../utils/jwt');

const authenticateToken = async (req, res, next) => {
  console.log("DEBUG: authenticateToken - Middleware entered.");
  try {
    console.log("🔐 Checking token...");
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      console.log("❌ No authentication token provided.");
      console.log("❌ Authentication failed: No token provided.");
      return res.status(401).json({ message: 'Authentication token required' });
    }
    console.log("✅ Token received, attempting to verify...");

    const decoded = verifyToken(token);
    if (!decoded) {
      console.log("❌ Invalid or expired token.");
      console.log("❌ Authentication failed: Invalid or expired token.");
      return res.status(403).json({ message: 'Invalid or expired token' });
    }
    console.log("✅ Token decoded, userId:", decoded.id || decoded.userId);

    const userId = decoded.id || decoded.userId;
    if (!userId) {
      console.log("❌ User ID missing from token.");
      console.log("❌ Authentication failed: User ID missing from token payload.");
      return res.status(400).json({ message: 'User ID missing from token' });
    }
    
    req.user = {
      id: decoded.id || decoded.userId,
      email: decoded.email,
      role: decoded.role
    };
    req.userId = decoded.id || decoded.userId;
    console.log("✅ User authenticated from token:", req.user.email);
    next();
  } catch (error) {
    console.error('❌ Error authenticating token:', error.message);
    res.status(500).json({ message: 'Internal server error' });
  }
};

const authorize = (roles = []) => {
  if (typeof roles === 'string') roles = [roles];
  return (req, res, next) => {
    if (!req.user || (roles.length > 0 && !roles.includes(req.user.role))) {
      return res
        .status(403)
        .json({ message: 'Forbidden: You do not have permission to access this resource.' });
    }
    next();
  };
};

module.exports = {
  protect: authenticateToken,
  authorize,
};
