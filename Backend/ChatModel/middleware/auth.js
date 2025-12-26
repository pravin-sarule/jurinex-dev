const { verifyToken } = require('../utils/jwt');

const authenticateToken = (req, res, next) => {
  try {
    console.log("🔐 ChatModel: Checking token...");

    const authHeader = req.headers['authorization'];
    const token = authHeader?.split(' ')[1]; // "Bearer <token>"

    if (!token) {
      console.log("❌ ChatModel: No authentication token provided.");
      return res.status(401).json({ message: 'Authentication token required' });
    }

    console.log("✅ ChatModel: Token received, verifying...");
    const decoded = verifyToken(token);

    if (!decoded) {
      console.log("❌ ChatModel: Invalid or expired token.");
      return res.status(403).json({ message: 'Invalid or expired token' });
    }

    const userId = decoded.id || decoded.userId;
    if (!userId) {
      console.log("❌ ChatModel: User ID missing in token payload.");
      return res.status(400).json({ message: 'User ID missing from token' });
    }

    req.user = {
      id: userId,
      email: decoded.email || null,
      role: decoded.role || 'user',
    };
    req.userId = userId;

    console.log("✅ ChatModel: User authenticated:", req.user);
    next();
  } catch (error) {
    console.error("❌ ChatModel: Error authenticating token:", error.message);
    res.status(500).json({ message: 'Internal server error' });
  }
};

module.exports = {
  protect: authenticateToken,
};



