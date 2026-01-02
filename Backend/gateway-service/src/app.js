

const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");

dotenv.config();
console.log(`[Gateway] PAYMENT_SERVICE_URL: ${process.env.PAYMENT_SERVICE_URL}`);
console.log(`[Gateway] Gateway Port: ${process.env.PORT || 5000}`);

const { createProxyMiddleware } = require("http-proxy-middleware");
const authProxy = require("./routes/authProxy");
const fileProxy = require("./routes/fileProxy");
// const paymentProxy = require("./routes/paymentProxy");
const paymentProxy = require("./routes/paymentProxy");
const supportProxy = require("./routes/supportProxy");
const draftProxy = require("./routes/draftProxy");
const visualProxy = require("./routes/visualProxy");
const chatProxy = require("./routes/chatProxy");
// const userResourcesProxy = require("./routes/userResourcesProxy");

const app = express();

// Target URL for auth service
const targetAuth = process.env.AUTH_SERVICE_URL || "http://localhost:5001";

// const allowedOrigins = ["http://localhost:5173", "http://localhost:5000"];

// app.use(cors({
//   origin: allowedOrigins,
//   credentials: true,
//   methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
//   allowedHeaders: ["Origin", "X-Requested-With", "Content-Type", "Accept", "Authorization", "x-user-id"]
// }));

// ✅ Update allowed origins for frontend + local dev
const allowedOrigins = [
  "http://localhost:5173", // Vite dev server
  "http://localhost:5000", // local testing
  "http://localhost:8000", // HTTP server for test pages
  "http://localhost:3000", // Alternative test server
  "http://127.0.0.1:8000", // HTTP server (alternative)
  "http://127.0.0.1:3000", // Alternative test server
  "https://nexintel.netlify.app" // your production frontend
];

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like Postman, curl, or file:// protocol)
    if (!origin) return callback(null, true);
    
    // Allow requests from allowed origins
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    
    // For development: allow localhost with any port
    if (origin && (origin.startsWith("http://localhost:") || origin.startsWith("http://127.0.0.1:"))) {
      return callback(null, true);
    }
    
    return callback(new Error("Not allowed by CORS"));
  },
  credentials: true, // if sending cookies
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Origin", "X-Requested-With", "Content-Type", "Accept", "Authorization", "x-user-id"]
}));


// Simple logger to see incoming requests
app.use((req, res, next) => {
  console.log(`[Gateway] Incoming Request: ${req.method} ${req.originalUrl}`);
  next();
});

// Health check route
app.get("/health", (req, res) => {
  res.json({ status: "API Gateway is running" });
});

// Google OAuth callback - handle BEFORE other auth routes
// This is a special route because Google redirects here directly
app.use("/api/auth/google/callback", createProxyMiddleware({
  target: targetAuth,
  changeOrigin: true,
  pathRewrite: (path, req) => {
    // Preserve the full path including query params
    const fullPath = `/api/auth/google/callback${path}`;
    console.log(`[GATEWAY] Google OAuth callback: ${req.originalUrl} -> ${fullPath}`);
    return fullPath;
  },
  onProxyRes: (proxyRes, req, res) => {
    console.log(`[GATEWAY] Google OAuth callback response: ${proxyRes.statusCode}`);
  },
  onError: (err, req, res) => {
    console.error("[GATEWAY] Google OAuth callback error:", err.message);
    res.status(502).send("Bad Gateway - auth service unreachable");
  },
}));

// Mount proxies
app.use(authProxy);
app.use(fileProxy);
// app.use(paymentProxy);
app.use(paymentProxy);
app.use("/support", supportProxy);
app.use("/drafting", draftProxy);
app.use(visualProxy); // Visual Service proxy for flowchart generation
app.use(chatProxy); // ChatModel Service proxy for document Q&A
// app.use(userResourcesProxy);

// Catch-all for 404 errors
app.use((req, res, next) => {
  console.log(`[Gateway] 404 Not Found: ${req.method} ${req.originalUrl}`);
  res.status(404).json({ error: `Cannot ${req.method} ${req.originalUrl}` });
});

// General error handler
app.use((err, req, res, next) => {
  console.error("[Gateway] Unhandled Error:", err.stack);
  res.status(500).json({ error: "Internal Server Error", message: err.message });
});

module.exports = app;


// const express = require("express");
// const cors = require("cors");
// const dotenv = require("dotenv");

// dotenv.config();

// console.log(`[Gateway] PAYMENT_SERVICE_URL: ${process.env.PAYMENT_SERVICE_URL}`);
// console.log(`[Gateway] Gateway Port: ${process.env.PORT || 5000}`);

// const authProxy = require("./routes/authProxy");
// const fileProxy = require("./routes/fileProxy");
// const paymentProxy = require("./routes/paymentProxy");
// const supportProxy = require("./routes/supportProxy");
// const draftProxy = require("./routes/draftProxy");

// const app = express();

// // ✅ Update allowed origins for frontend + local dev
// const allowedOrigins = [
//   "http://localhost:5173", // Vite dev server
//   "http://localhost:5000", // local testing
//   "https://nexintel.netlify.app" // your production frontend
// ];

// app.use(cors({
//   origin: function (origin, callback) {
//     if (!origin) return callback(null, true); // allow server-to-server requests or Postman
//     if (allowedOrigins.includes(origin)) {
//       return callback(null, true);
//     }
//     return callback(new Error("Not allowed by CORS"));
//   },
//   credentials: true, // if sending cookies
//   methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
//   allowedHeaders: ["Origin", "X-Requested-With", "Content-Type", "Accept", "Authorization", "x-user-id"]
// }));


// // Simple logger to see incoming requests
// app.use((req, res, next) => {
//   console.log(`[Gateway] Incoming Request: ${req.method} ${req.originalUrl}`);
//   next();
// });

// // Health check route
// app.get("/health", (req, res) => {
//   res.json({ status: "API Gateway is running" });
// });

// // Mount proxies
// app.use("/auth/api/auth", authProxy);
// app.use("/file", fileProxy);
// app.use("/payment", paymentProxy);
// app.use("/support", supportProxy);
// app.use("/drafting", draftProxy);

// // Catch-all for 404 errors
// app.use((req, res, next) => {
//   console.log(`[Gateway] 404 Not Found: ${req.method} ${req.originalUrl}`);
//   res.status(404).json({ error: `Cannot ${req.method} ${req.originalUrl}` });
// });

// // General error handler
// app.use((err, req, res, next) => {
//   console.error("[Gateway] Unhandled Error:", err.stack);
//   res.status(500).json({ error: "Internal Server Error", message: err.message });
// });

// // Start server
// const PORT = process.env.PORT || 5000;
// app.listen(PORT, () => {
//   console.log(`[Gateway] API Gateway running on port ${PORT}`);
// });

// module.exports = app;
