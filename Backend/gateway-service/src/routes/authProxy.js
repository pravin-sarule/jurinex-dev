
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

router.use(
  "/auth",
  createProxyMiddleware({
    target: targetAuth,
    changeOrigin: true,
    pathRewrite: {
      "^/auth": "/api/auth", // /auth/user-info → /api/auth/user-info
    },
    onProxyReq: (proxyReq, req, res) => {
      console.log("[GATEWAY] Proxying to:", targetAuth + proxyReq.path);
    },
    onError: (err, req, res) => {
      console.error("[GATEWAY] Proxy error:", err.message);
      res.status(502).send("Bad Gateway - auth service unreachable");
    },
  })
);

module.exports = router;
