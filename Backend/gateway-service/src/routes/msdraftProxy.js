const { createProxyMiddleware } = require("http-proxy-middleware");
const express = require("express");
const { authMiddleware } = require("../middlewares/authMiddleware");

const router = express.Router();

// Helper function to check if route is Microsoft Word route
const isMicrosoftRoute = (path) => {
  return path === '/api/auth' ||
    path === '/api/documents' ||
    path === '/api/word' ||
    path.startsWith('/api/auth/') || 
    path.startsWith('/api/documents/') || 
    path.startsWith('/api/word/');
};

// CRITICAL: Only handle Microsoft Word routes, NOT Google Docs routes
// Microsoft Word routes: /api/auth/*, /api/documents/*, /api/word/*
// Google Docs routes: /api/drafts/* should be handled by draftProxy.js
router.use((req, res, next) => {
  if (!isMicrosoftRoute(req.path)) {
    // NOT a Microsoft Word route - pass to draftProxy immediately
    console.log('[Gateway MS Draft Proxy] ⏭️  NOT a Microsoft Word route, passing to draftProxy:', req.path);
    return next(); // This will pass to the next router (draftProxy)
  }
  
  // IS a Microsoft Word route - continue processing
  console.log("[Gateway MS Draft Proxy] Received Microsoft Word route:", req.method, req.originalUrl, "Query:", req.query);
  next();
});

// Exempt auth routes from middleware (signin, callback need token in query, not header)
// status route can work with or without token
router.use((req, res, next) => {
  // Only apply this middleware to Microsoft routes (should already be filtered, but double-check)
  if (!isMicrosoftRoute(req.path)) {
    return next(); // Pass to next router
  }
  
  const isAuthRoute = req.path === '/api/auth/signin' || req.path === '/api/auth/callback' || req.path === '/api/auth/status';
  if (isAuthRoute) {
    console.log('[Gateway MS Draft Proxy] Skipping auth middleware for:', req.path);
    return next(); // Skip auth middleware
  }
  // Apply auth middleware for other Microsoft routes
  authMiddleware(req, res, next);
});

// Proxy: /drafting/api/* → Draft Service /api/*
// When mounted at /drafting, request /drafting/api/auth/signin becomes /api/auth/signin here
// IMPORTANT: Always target the draft-service directly (port 4000), not the gateway
const DRAFTING_SERVICE_TARGET = process.env.DRAFT_SERVICE_URL || process.env.DRAFTING_SERVICE_URL || "http://localhost:4000";
// Ensure it's not pointing to gateway (port 5000) or drafting-service (port 5005)
const finalTarget = (DRAFTING_SERVICE_TARGET.includes('5000') || DRAFTING_SERVICE_TARGET.includes('5005')) 
  ? "http://localhost:4000" 
  : DRAFTING_SERVICE_TARGET;
console.log("[Gateway MS Draft Proxy] Target configured:", finalTarget, "(from env:", process.env.DRAFT_SERVICE_URL || process.env.DRAFTING_SERVICE_URL, ")");

// Create proxy middleware once (more efficient)
const proxyMiddleware = createProxyMiddleware({
  target: finalTarget,
  changeOrigin: true,
  // No path rewrite needed - the path (/api/auth/signin) is already correct
  // Query parameters are automatically preserved by http-proxy-middleware
  logLevel: "debug",
  proxyTimeout: 10000, // 10 seconds - faster timeout detection
  timeout: 10000,
  onProxyReq: (proxyReq, req, res) => {
    // CRITICAL: Log path before modification
    console.log("[Gateway MS Draft Proxy] 📤 onProxyReq - Request details:", {
      method: req.method,
      originalPath: req.path,
      originalUrl: req.originalUrl,
      proxyPath: proxyReq.path,
      proxyUrl: proxyReq.url,
      query: req.query
    });
    
    // CRITICAL: Ensure path is correct - should be /api/auth/signin, not /
    if (req.path === '/' || req.path === '') {
      console.error("[Gateway MS Draft Proxy] ❌ ERROR: Path is root! Original URL:", req.originalUrl);
      // Try to extract correct path from originalUrl
      const match = req.originalUrl.match(/\/api\/[^?]*/);
      if (match) {
        const correctPath = match[0];
        console.log("[Gateway MS Draft Proxy] ⚠️  Fixing path from root to:", correctPath);
        proxyReq.path = correctPath;
      }
    }
    
    // CRITICAL: Extract token from query parameter and add to Authorization header
    if (req.query && req.query.token) {
      const token = req.query.token;
      proxyReq.setHeader('Authorization', `Bearer ${token}`);
      console.log("[Gateway MS Draft Proxy] ✅ Token extracted from query and added to Authorization header");
    }
    
    // Also check if token is in Authorization header already (from regular requests)
    if (req.headers.authorization && !proxyReq.getHeader('Authorization')) {
      proxyReq.setHeader('Authorization', req.headers.authorization);
      console.log("[Gateway MS Draft Proxy] ✅ Using Authorization header from request");
    }
    
    // Manually preserve query string if it exists
    if (req.query && Object.keys(req.query).length > 0) {
      const queryString = Object.entries(req.query)
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
        .join('&');
      const separator = proxyReq.path.includes('?') ? '&' : '?';
      proxyReq.path = `${proxyReq.path}${separator}${queryString}`;
    }
    
    // Log the full request being proxied
    const targetUrl = `${finalTarget}${proxyReq.path}`;
    console.log("[Gateway MS Draft Proxy] ➡️  Proxying to:", {
      method: proxyReq.method,
      path: proxyReq.path,
      query: req.query,
      originalUrl: req.originalUrl,
      targetUrl: targetUrl,
      hasAuthHeader: !!proxyReq.getHeader('Authorization')
    });
  },
  onProxyRes: (proxyRes, req, res) => {
    console.log(`[Gateway MS Draft Proxy] ✅ Response: ${req.method} ${req.originalUrl} → ${proxyRes.statusCode}`);
    if (proxyRes.statusCode === 302 || proxyRes.statusCode === 301) {
      console.log(`[Gateway MS Draft Proxy] 🔄 Redirect detected: ${proxyRes.headers.location}`);
    }
  },
  onError: (err, req, res) => {
    console.error("[Gateway MS Draft Proxy] Error:", {
      message: err.message,
      code: err.code,
      target: finalTarget,
      path: req.path,
      method: req.method
    });
    if (!res.headersSent) {
      res.status(503).json({ 
        error: "Draft Service is unavailable",
        details: err.code === 'ECONNREFUSED' ? 'Connection refused - is the draft-service running on port 4000?' : err.message
      });
    }
  },
});

// CRITICAL: Only apply proxy middleware to Microsoft routes
// For non-Microsoft routes, the earlier middleware already called next() to pass to draftProxy
router.use((req, res, next) => {
  if (!isMicrosoftRoute(req.path)) {
    // NOT a Microsoft route - already passed to draftProxy by earlier middleware
    // This should not be reached, but just in case, pass through
    return next();
  }
  
  // IS a Microsoft route - apply proxy middleware
  proxyMiddleware(req, res, next);
});

module.exports = router;
