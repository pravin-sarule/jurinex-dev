// const { createProxyMiddleware } = require("http-proxy-middleware");
// const express = require("express");

// const router = express.Router();

// // Forward /drafting → DRAFTING_SERVICE
// router.use(
//   "/drafting",
//   createProxyMiddleware({
//     target: process.env.DRAFTING_SERVICE_URL || "http://localhost:5005", // Assuming 3000 for drafting service
//     changeOrigin: true,
//     pathRewrite: { "^/drafting": "/api/templates" }, // e.g. /drafting/templates → /api/templates/templates
//   })
// );

// module.exports = router;

// routes/draftProxy.js
// const { createProxyMiddleware } = require("http-proxy-middleware");
// const express = require("express");

// const router = express.Router();

// // Forward /drafting → DRAFTING_SERVICE
// // router.use(
// //   "/drafting",
// //   createProxyMiddleware({
// //     target: process.env.DRAFTING_SERVICE_URL || "http://localhost:5005", 
// //     changeOrigin: true,
// //     pathRewrite: { "^/drafting": "/api/template" }, // match service base path
// //     logLevel: "debug",
// //   })
// // );
// router.use(
//   "/drafting",
//   createProxyMiddleware({
//     target: process.env.DRAFTING_SERVICE_URL || "http://localhost:5005",
//     changeOrigin: true,
//     pathRewrite: { "^/drafting": "/api/template" }, 
//     logLevel: "debug",
//   })
// );


// module.exports = router;

// // src/routes/draftProxy.js
// const { createProxyMiddleware } = require("http-proxy-middleware");
// const express = require("express");
// const { authMiddleware } = require("../middlewares/authMiddleware");

// const router = express.Router();

// // Debug log before proxying
// router.use("/drafting", (req, res, next) => {
//   console.log("Gateway Drafting Proxy received:", req.method, req.originalUrl);
//   next();
// });

// // Protect all /drafting routes with JWT
// router.use("/drafting", authMiddleware);

// // Proxy: /drafting/* → Drafting Service /api/template/*
// router.use(
//   "/drafting",
//   createProxyMiddleware({
//     target: process.env.DRAFTING_SERVICE_URL || "http://localhost:5005",
//     changeOrigin: true,
//     pathRewrite: {
//       "^/drafting": "/api/templates", // maps /drafting → /api/template
//     },
//     logLevel: "debug",
//     proxyTimeout: 60000,
//     timeout: 60000,
//     onError: (err, req, res) => {
//       console.error("Drafting service proxy error:", err.message);
//       res.status(500).json({ error: "Drafting Service is unavailable" });
//     },
//   })
// );

// module.exports = router;
const { createProxyMiddleware } = require("http-proxy-middleware");
const express = require("express");
const { authMiddleware } = require("../middlewares/authMiddleware");

const router = express.Router();

// Debug log before proxying
router.use("/", (req, res, next) => { // Apply to all routes under /drafting
  console.log("Gateway Drafting Proxy received:", req.method, req.originalUrl);
  next();
});

// Protect all drafting routes
router.use("/", authMiddleware); // Apply to all routes under /drafting

// Proxy: /drafting/* → Drafting Service /api/template/*
router.use(
  "/", // Listen for root of mounted path (/drafting)
  createProxyMiddleware({
    target: process.env.DRAFTING_SERVICE_URL || "https://drafting-service.onrender.com",
    changeOrigin: true,
    pathRewrite: {
      "^/": "/api/templates/", // maps / → /api/templates/
    },
    logLevel: "debug",
    proxyTimeout: 60000,
    timeout: 60000,
    onError: (err, req, res) => {
      console.error("Drafting service proxy error:", err.message);
      res.status(500).json({ error: "Drafting Service is unavailable" });
    },
  })
);

module.exports = router;
