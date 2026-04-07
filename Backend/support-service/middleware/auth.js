const jwt = require("jsonwebtoken");
require("dotenv").config();

function authenticate(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ success: false, message: "Authentication token required." });
  }

  if (!process.env.JWT_SECRET) {
    return res.status(500).json({ success: false, message: "JWT_SECRET is not configured." });
  }

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    return next();
  } catch (error) {
    return res.status(403).json({
      success: false,
      message: "Invalid or expired token.",
      details: error.message,
    });
  }
}

function isAdminUser(user) {
  if (!user) return false;

  const role = String(user.role || "").toUpperCase();
  const accountType = String(user.account_type || "").toUpperCase();

  return (
    role === "ADMIN" ||
    role === "SUPER_ADMIN" ||
    accountType === "FIRM_ADMIN"
  );
}

function requireAdmin(req, res, next) {
  if (!isAdminUser(req.user)) {
    return res.status(403).json({
      success: false,
      message: "Admin access is required for this action.",
    });
  }

  return next();
}

module.exports = {
  authenticate,
  requireAdmin,
  isAdminUser,
};
