// src/routes/aiAgentProxy.js
// Proxy for AI-Agent service - Document processing and multi-file chat
const { createProxyMiddleware } = require("http-proxy-middleware");
const express = require("express");

const router = express.Router();

// Log all incoming AI-Agent requests
router.use("/ai-agent", (req, res, next) => {
  console.log("[Gateway] AI-Agent service request:", req.method, req.originalUrl);
  console.log("[Gateway] Request path:", req.path);
  console.log("[Gateway] Request originalUrl:", req.originalUrl);
  next();
});

// Proxy for /ai-agent/documents/* → AI-Agent Service /api/documents/*
// Note: No authentication middleware - designed for backend-to-backend communication
router.use(
  "/ai-agent/documents",
  createProxyMiddleware({
    target: process.env.AI_AGENT_SERVICE_URL || "http://localhost:3001",
    changeOrigin: true,
    pathRewrite: (path) => {
      // When router matches /ai-agent/documents, the remaining path is passed here
      // So we need to prefix it with /api/documents
      const rewritten = `/api/documents${path}`;
      console.log(`[Gateway] Rewriting AI-Agent path: ${path} -> ${rewritten}`);
      return rewritten;
    },
    logLevel: "debug",
    onProxyReq: (proxyReq, req) => {
      // Forward service name header for tracking
      if (req.headers['x-service-name']) {
        proxyReq.setHeader("X-Service-Name", req.headers['x-service-name']);
      } else {
        // Default service name if not provided
        proxyReq.setHeader("X-Service-Name", "gateway-service");
      }
      
      // Forward other relevant headers
      if (req.headers['authorization']) {
        proxyReq.setHeader("Authorization", req.headers['authorization']);
      }
      
      // Preserve origin header for CORS
      if (req.headers['origin']) {
        proxyReq.setHeader("Origin", req.headers['origin']);
      }
      
      console.log(`[Gateway] Proxying to AI-Agent: ${proxyReq.path}`);
    },
    proxyTimeout: 300000, // 5 minutes for document processing (can take long)
    timeout: 300000,
    onError: (err, req, res) => {
      console.error("[Gateway] AI-Agent service proxy error:", err.message);
      res.status(502).json({ 
        success: false,
        error: "AI-Agent Service is unavailable",
        message: err.message 
      });
    },
  })
);

// Health check proxy for AI-Agent service
router.get("/ai-agent/health", createProxyMiddleware({
  target: process.env.AI_AGENT_SERVICE_URL || "http://localhost:3001",
  changeOrigin: true,
  pathRewrite: {
    "^/ai-agent": "", // Remove /ai-agent prefix
  },
  
  logLevel: "debug",
  onError: (err, req, res) => {
    console.error("[Gateway] AI-Agent health check error:", err.message);
    res.status(502).json({ 
      success: false,
      error: "AI-Agent Service is unavailable",
      message: err.message 
    });
  },
}));

module.exports = router;
