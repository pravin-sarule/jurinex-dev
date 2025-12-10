

// src/routes/fileProxy.js
const { createProxyMiddleware } = require("http-proxy-middleware");
const express = require("express");
const { authMiddleware } = require("../middlewares/authMiddleware");

const router = express.Router();

// Debug log before proxying
router.use("/files", (req, res, next) => {
  console.log("Gateway received:", req.method, req.originalUrl);
  next();
});

// Protect all /files routes with JWT
router.use("/files", authMiddleware);
router.use("/docs", authMiddleware);
// Proxy: /files/* → File Service /api/doc/*
router.use(
  "/files",
  createProxyMiddleware({
    target: process.env.FILE_SERVICE_URL || "http://localhost:5002",
    changeOrigin: true,
    pathRewrite: {
      "^/": "/api/doc/", // Rewrite /batch-upload to /api/doc/batch-upload
    },
    onProxyReq: (proxyReq, req) => {
      // Inject user ID from JWT into header for Document Service
      if (req.user && req.user.id) {
        proxyReq.setHeader("x-user-id", req.user.id);
      }
    },
    logLevel: "debug", // shows proxy details
    proxyTimeout: 60000,
    timeout: 60000,
    onError: (err, req, res) => {
      console.error("File service proxy error:", err.message);
      res.status(500).json({ error: "File Service is unavailable" });
    },
  })
);

// Proxy: /files/* → File Service /api/doc/*
router.use(
  "/docs",
  createProxyMiddleware({
    target: process.env.FILE_SERVICE_URL || "http://localhost:5002",
    changeOrigin: true,
    pathRewrite: {
      "^/": "/api/files/", // Rewrite /batch-upload to /api/doc/batch-upload
    },
    onProxyReq: (proxyReq, req) => {
      // Inject user ID from JWT into header for Document Service
      if (req.user && req.user.id) {
        proxyReq.setHeader("x-user-id", req.user.id);
      }
    },
    logLevel: "debug", // shows proxy details
    proxyTimeout: 60000,
    timeout: 60000,
    onError: (err, req, res) => {
      console.error("File service proxy error:", err.message);
      res.status(500).json({ error: "File Service is unavailable" });
    },
  })
);

module.exports = router;
