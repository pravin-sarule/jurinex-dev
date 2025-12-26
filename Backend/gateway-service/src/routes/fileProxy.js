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
router.use("/mindmap", authMiddleware);
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

// Proxy: /docs/* → File Service /api/files/*
router.use(
  "/docs",
  createProxyMiddleware({
    target: process.env.FILE_SERVICE_URL || "http://localhost:5002",
    changeOrigin: true,
    pathRewrite: {
      "^/": "/api/files/", // Rewrite /docs/* to /api/files/*
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

// Proxy: /mindmap/* → File Service /api/mindmap/*
router.use(
  "/mindmap",
  createProxyMiddleware({
    target: process.env.FILE_SERVICE_URL || "http://localhost:5002",
    changeOrigin: true,
    pathRewrite: (path) => {
      // When router matches /mindmap, the remaining path (e.g., /files) is passed here
      // So we need to prefix it with /api/mindmap
      const rewritten = `/api/mindmap${path}`;
      console.log(`[Gateway] Rewriting mindmap path: ${path} -> ${rewritten}`);
      return rewritten;
    },
    onProxyReq: (proxyReq, req) => {
      // Inject user ID from JWT into header for Document Service
      if (req.user && req.user.id) {
        proxyReq.setHeader("x-user-id", req.user.id);
      }
      // Forward Authorization header
      if (req.headers.authorization) {
        proxyReq.setHeader("Authorization", req.headers.authorization);
      }
      console.log(`[Gateway] Proxying mindmap request to: ${proxyReq.path}`);
    },
    logLevel: "debug", // shows proxy details
    proxyTimeout: 120000, // 2 minutes for file uploads and mindmap generation
    timeout: 120000,
    onError: (err, req, res) => {
      console.error("Mindmap service proxy error:", err.message);
      res.status(500).json({ error: "Mindmap Service is unavailable" });
    },
  })
);

module.exports = router;
