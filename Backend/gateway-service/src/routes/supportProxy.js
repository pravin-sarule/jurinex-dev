

// module.exports = router;
const { createProxyMiddleware } = require("http-proxy-middleware");
const express = require("express");
const { authMiddleware } = require("../middlewares/authMiddleware");

const router = express.Router();

// Debug log
router.use((req, res, next) => {
  console.log("Gateway Support Proxy:", req.method, req.originalUrl);
  next();
});

// Protect support routes
router.use(authMiddleware);

// Proxy requests → Support Service
router.use(
  "/",
  createProxyMiddleware({
    target: process.env.SUPPORT_SERVICE_URL || "http://localhost:5004",
    changeOrigin: true,
    pathRewrite: {
      "^/": "/api/support", // take whatever comes in and forward to /api/support
    },
    logLevel: "debug",
    onError: (err, req, res) => {
      console.error("❌ Support service proxy error:", err.message);
      res.status(500).json({ error: "Support Service is unavailable" });
    },
  })
);

module.exports = router;
