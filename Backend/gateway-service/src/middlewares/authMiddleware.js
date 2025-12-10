const jwt = require("jsonwebtoken");

/**
 * Logs every request going through the gateway
 */
function requestLogger(req, res, next) {
  console.log(`${req.method} ${req.originalUrl}`);
  next();
}

/**
 * Auth middleware: checks for valid JWT in Authorization header
 * Only needed if you want the gateway to enforce authentication.
 */
function authMiddleware(req, res, next) {
  const authHeader = req.headers["authorization"];
  if (!authHeader) {
    return res.status(401).json({ error: "No token provided" });
  }

  const token = authHeader.split(" ")[1];
  if (!token) {
    return res.status(401).json({ error: "Invalid token format" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // attach user data to request
    next();
  } catch (err) {
    return res.status(403).json({ error: "Invalid or expired token" });
  }
}

/**
 * Generic error handler
 */
function errorHandler(err, req, res, next) {
  console.error("Gateway error:", err.message);
  res.status(500).json({ error: "Something went wrong at API Gateway" });
}

module.exports = {
  requestLogger,
  authMiddleware,
  errorHandler,
};