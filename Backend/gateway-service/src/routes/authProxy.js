
// const { createProxyMiddleware } = require("http-proxy-middleware");
// const express = require("express");

// const router = express.Router();

// router.use(
//   "/auth",
//   createProxyMiddleware({
//     target: process.env.AUTH_SERVICE_URL || "https://auth-service-w1eg.onrender.com",
//     changeOrigin: true,
//     pathRewrite: {
//       "^/auth": "/api/auth" // frontend /auth/login → service /api/auth/login
//     },
//   })
// );

// module.exports = router;


const { createProxyMiddleware } = require("http-proxy-middleware");
const express = require("express");
const router = express.Router();

// Default to localhost for local development, remote URL for production
const targetAuth = process.env.AUTH_SERVICE_URL || "http://localhost:5001";

// Note: /api/auth/google/callback is handled in app.js before this router

router.use(
  "/auth",
  createProxyMiddleware({
    target: targetAuth,
    changeOrigin: true,
    pathRewrite: (path, req) => {
      // Mounted at /api, so path is /auth/... (e.g. /auth/google, /auth/login)
      // Auth service expects /api/auth/...
      // Handle: /api/auth (keep), /auth/... -> /api/auth/..., /... -> /api/auth/...
      if (path.startsWith('/api/auth')) {
        console.log(`[GATEWAY] Auth path (already correct): ${path}`);
        return path;
      }
      if (path.startsWith('/auth')) {
        const newPath = '/api' + path;
        console.log(`[GATEWAY] Auth path rewrite: ${path} -> ${newPath}`);
        return newPath;
      }
      const newPath = `/api/auth${path}`;
      console.log(`[GATEWAY] Auth path rewrite: ${path} -> ${newPath}`);
      return newPath;
    },
    onProxyReq: (proxyReq, req, res) => {
      console.log("[GATEWAY] Proxying auth to:", targetAuth + proxyReq.path);
    },
    onError: (err, req, res) => {
      console.error("[GATEWAY] Proxy error:", err.message);
      res.status(502).send("Bad Gateway - auth service unreachable");
    },
  })
);

module.exports = router;
