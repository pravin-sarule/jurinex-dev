// const jwt = require("jsonwebtoken");

// /**
//  * Logs every request going through the gateway
//  */
// function requestLogger(req, res, next) {
//   console.log(`${req.method} ${req.originalUrl}`);
//   next();
// }

// /**
//  * Auth middleware: checks for valid JWT in Authorization header
//  * Only needed if you want the gateway to enforce authentication.
//  */
// function authMiddleware(req, res, next) {
//   const authHeader = req.headers["authorization"];
//   if (!authHeader) {
//     return res.status(401).json({ error: "No token provided" });
//   }

//   const token = authHeader.split(" ")[1];
//   if (!token) {
//     return res.status(401).json({ error: "Invalid token format" });
//   }

//   try {
//     const decoded = jwt.verify(token, process.env.JWT_SECRET);
//     req.user = decoded; // attach user data to request
//     next();
//   } catch (err) {
//     return res.status(403).json({ error: "Invalid or expired token" });
//   }
// }

// /**
//  * Generic error handler
//  */
// function errorHandler(err, req, res, next) {
//   console.error("Gateway error:", err.message);
//   res.status(500).json({ error: "Something went wrong at API Gateway" });
// }

// module.exports = {
//   requestLogger,
//   authMiddleware,
//   errorHandler,
// };


const jwt = require("jsonwebtoken");
require("dotenv").config();

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
    console.log("[Gateway Auth] No authorization header provided");
    return res.status(401).json({ error: "No token provided" });
  }

  const token = authHeader.split(" ")[1];
  if (!token) {
    console.log("[Gateway Auth] Invalid token format");
    return res.status(401).json({ error: "Invalid token format" });
  }

  // Check if JWT_SECRET is configured
  if (!process.env.JWT_SECRET) {
    console.error("[Gateway Auth] JWT_SECRET is not configured");
    return res.status(500).json({ error: "Server configuration error" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // attach user data to request
    console.log(`[Gateway Auth] Token verified successfully for user: ${decoded.id || decoded.userId}`);
    next();
  } catch (err) {
    console.error(`[Gateway Auth] Token verification failed: ${err.message}`);
    // Provide more specific error messages
    if (err.name === "TokenExpiredError") {
      return res.status(403).json({ error: "Token expired", details: err.message });
    } else if (err.name === "JsonWebTokenError") {
      return res.status(403).json({ error: "Invalid token", details: err.message });
    }
    return res.status(403).json({ error: "Invalid or expired token", details: err.message });
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
