

// const express = require("express");
// const cors = require("cors");
// const dotenv = require("dotenv");

// dotenv.config();
// console.log(`[Gateway] PAYMENT_SERVICE_URL: ${process.env.PAYMENT_SERVICE_URL}`);
// console.log(`[Gateway] Gateway Port: ${process.env.PORT || 5000}`);

// const { createProxyMiddleware } = require("http-proxy-middleware");
// const authProxy = require("./routes/authProxy");
// const fileProxy = require("./routes/fileProxy");
// // const paymentProxy = require("./routes/paymentProxy");
// const paymentProxy = require("./routes/paymentProxy");
// const supportProxy = require("./routes/supportProxy");
// const draftProxy = require("./routes/draftProxy");
// const msdraftProxy = require("./routes/msdraftProxy");
// const visualProxy = require("./routes/visualProxy");
// const chatProxy = require("./routes/chatProxy");
// const zohodraftingproxy = require("./routes/zohodraftingproxy");
// // const userResourcesProxy = require("./routes/userResourcesProxy");

// const app = express();

// // Target URL for auth service
// const targetAuth = process.env.AUTH_SERVICE_URL || "http://localhost:5001";

// // const allowedOrigins = ["http://localhost:5173", "http://localhost:5000"];

// // app.use(cors({
// //   origin: allowedOrigins,
// //   credentials: true,
// //   methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
// //   allowedHeaders: ["Origin", "X-Requested-With", "Content-Type", "Accept", "Authorization", "x-user-id"]
// // }));

// // ✅ Update allowed origins for frontend + local dev
// const allowedOrigins = [
//   "http://localhost:5173", // Vite dev server
//   "http://localhost:5000", // local testing
//   "http://localhost:8000", // HTTP server for test pages
//   "http://localhost:3000", // Alternative test server
//   "http://127.0.0.1:8000", // HTTP server (alternative)
//   "http://127.0.0.1:3000", // Alternative test server
//   "https://nexintel.netlify.app" // your production frontend
// ];

// app.use(cors({
//   origin: function (origin, callback) {
//     // Allow requests with no origin (like Postman, curl, or file:// protocol)
//     if (!origin) return callback(null, true);
    
//     // Allow requests from allowed origins
//     if (allowedOrigins.includes(origin)) {
//       return callback(null, true);
//     }
    
//     // For development: allow localhost with any port
//     if (origin && (origin.startsWith("http://localhost:") || origin.startsWith("http://127.0.0.1:"))) {
//       return callback(null, true);
//     }
    
//     return callback(new Error("Not allowed by CORS"));
//   },
//   credentials: true, // if sending cookies
//   methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"],
//   allowedHeaders: ["Origin", "X-Requested-With", "Content-Type", "Accept", "Authorization", "x-user-id", "X-Google-Access-Token"]
// }));


// // Simple logger to see incoming requests
// app.use((req, res, next) => {
//   console.log(`[Gateway] Incoming Request: ${req.method} ${req.originalUrl}`);
//   console.log(`[Gateway] Request Path: ${req.path}`);
//   console.log(`[Gateway] Request Base URL: ${req.baseUrl}`);
//   console.log(`[Gateway] Has Auth Header: ${!!req.headers.authorization}`);
//   next();
// });

// // Health check route
// app.get("/health", (req, res) => {
//   res.json({ status: "API Gateway is running" });
// });

// // Google OAuth callback - handle BEFORE other auth routes
// // This is a special route because Google redirects here directly
// // Use app.get() to ensure exact matching and query param preservation
// app.get("/api/auth/google/callback", createProxyMiddleware({
//   target: targetAuth,
//   changeOrigin: true,
//   pathRewrite: (path, req) => {
//     // Preserve query string from original request
//     const queryString = req.url.includes('?') ? req.url.split('?')[1] : '';
//     const targetPath = `/api/auth/google/callback${queryString ? '?' + queryString : ''}`;
//     console.log(`[GATEWAY] Google OAuth callback: ${req.method} ${req.originalUrl}`);
//     console.log(`[GATEWAY] Query string: ${queryString || 'none'}`);
//     console.log(`[GATEWAY] Proxying to: ${targetPath}`);
//     return targetPath;
//   },
//   onProxyReq: (proxyReq, req) => {
//     // Log the actual request being sent
//     console.log(`[GATEWAY] Proxy request path: ${proxyReq.path}`);
//   },
//   onProxyRes: (proxyRes, req, res) => {
//     console.log(`[GATEWAY] Google OAuth callback response: ${proxyRes.statusCode}`);
//   },
//   onError: (err, req, res) => {
//     console.error("[GATEWAY] Google OAuth callback error:", err.message);
//     res.status(502).send("Bad Gateway - auth service unreachable");
//   },
// }));

// // Also handle with trailing slash
// app.get("/api/auth/google/callback/", createProxyMiddleware({
//   target: targetAuth,
//   changeOrigin: true,
//   pathRewrite: (path, req) => {
//     const queryString = req.url.includes('?') ? req.url.split('?')[1] : '';
//     return `/api/auth/google/callback${queryString ? '?' + queryString : ''}`;
//   },
// }));

// // Mount proxies
// app.use(authProxy);
// app.use(fileProxy);
// // app.use(paymentProxy);
// app.use(paymentProxy);
// app.use("/support", supportProxy);
// // Mount msdraftProxy FIRST to handle Microsoft Word auth routes (token in query)
// // This must come before draftProxy to catch auth routes
// app.use("/drafting", msdraftProxy);
// // Mount draftProxy for Google Docs routes (different service/port)
// app.use("/drafting", draftProxy);
// app.use(visualProxy); // Visual Service proxy for flowchart generation
// app.use(chatProxy); // ChatModel Service proxy for document Q&A
// app.use("/api/drafting", zohodraftingproxy); // Zoho Drafting Service proxy

// // app.use(userResourcesProxy);

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

// module.exports = app;


// // const express = require("express");
// // const cors = require("cors");
// // const dotenv = require("dotenv");

// // dotenv.config();

// // console.log(`[Gateway] PAYMENT_SERVICE_URL: ${process.env.PAYMENT_SERVICE_URL}`);
// // console.log(`[Gateway] Gateway Port: ${process.env.PORT || 5000}`);

// // const authProxy = require("./routes/authProxy");
// // const fileProxy = require("./routes/fileProxy");
// // const paymentProxy = require("./routes/paymentProxy");
// // const supportProxy = require("./routes/supportProxy");
// // const draftProxy = require("./routes/draftProxy");

// // const app = express();

// // // ✅ Update allowed origins for frontend + local dev
// // const allowedOrigins = [
// //   "http://localhost:5173", // Vite dev server
// //   "http://localhost:5000", // local testing
// //   "https://nexintel.netlify.app" // your production frontend
// // ];

// // app.use(cors({
// //   origin: function (origin, callback) {
// //     if (!origin) return callback(null, true); // allow server-to-server requests or Postman
// //     if (allowedOrigins.includes(origin)) {
// //       return callback(null, true);
// //     }
// //     return callback(new Error("Not allowed by CORS"));
// //   },
// //   credentials: true, // if sending cookies
// //   methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
// //   allowedHeaders: ["Origin", "X-Requested-With", "Content-Type", "Accept", "Authorization", "x-user-id"]
// // }));


// // // Simple logger to see incoming requests
// // app.use((req, res, next) => {
// //   console.log(`[Gateway] Incoming Request: ${req.method} ${req.originalUrl}`);
// //   next();
// // });

// // // Health check route
// // app.get("/health", (req, res) => {
// //   res.json({ status: "API Gateway is running" });
// // });

// // // Mount proxies
// // app.use("/auth/api/auth", authProxy);
// // app.use("/file", fileProxy);
// // app.use("/payment", paymentProxy);
// // app.use("/support", supportProxy);
// // app.use("/drafting", draftProxy);

// // // Catch-all for 404 errors
// // app.use((req, res, next) => {
// //   console.log(`[Gateway] 404 Not Found: ${req.method} ${req.originalUrl}`);
// //   res.status(404).json({ error: `Cannot ${req.method} ${req.originalUrl}` });
// // });

// // // General error handler
// // app.use((err, req, res, next) => {
// //   console.error("[Gateway] Unhandled Error:", err.stack);
// //   res.status(500).json({ error: "Internal Server Error", message: err.message });
// // });

// // // Start server
// // const PORT = process.env.PORT || 5000;
// // app.listen(PORT, () => {
// //   console.log(`[Gateway] API Gateway running on port ${PORT}`);
// // });

// // module.exports = app;




const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");

dotenv.config();
console.log(`[Gateway] PAYMENT_SERVICE_URL: ${process.env.PAYMENT_SERVICE_URL}`);
console.log(`[Gateway] Gateway Port: ${process.env.PORT || 5000}`);

const { createProxyMiddleware } = require("http-proxy-middleware");
const { authMiddleware } = require("./middlewares/authMiddleware");
const authProxy = require("./routes/authProxy");
const fileProxy = require("./routes/fileProxy");
// const paymentProxy = require("./routes/paymentProxy");
const paymentProxy = require("./routes/paymentProxy");
const supportProxy = require("./routes/supportProxy");
const draftProxy = require("./routes/draftProxy");
const msdraftProxy = require("./routes/msdraftProxy");
const visualProxy = require("./routes/visualProxy");
const chatProxy = require("./routes/chatProxy");
const zohodraftingproxy = require("./routes/zohodraftingproxy");
const draftingTemplateProxy = require("./routes/draftingTemplateProxy");
const draftingAiProxy = require("./routes/draftingAiProxy");
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
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"],
  allowedHeaders: ["Origin", "X-Requested-With", "Content-Type", "Accept", "Authorization", "x-user-id", "X-Google-Access-Token"]
}));


// Simple logger to see incoming requests
app.use((req, res, next) => {
  console.log(`[Gateway] Incoming Request: ${req.method} ${req.originalUrl}`);
  console.log(`[Gateway] Request Path: ${req.path}`);
  console.log(`[Gateway] Request Base URL: ${req.baseUrl}`);
  console.log(`[Gateway] Has Auth Header: ${!!req.headers.authorization}`);
  next();
});

// Health check route
app.get("/health", (req, res) => {
  res.json({ status: "API Gateway is running" });
});

// Google OAuth callback - handle BEFORE other auth routes
// This is a special route because Google redirects here directly
// Use app.get() to ensure exact matching and query param preservation
app.get("/api/auth/google/callback", createProxyMiddleware({
  target: targetAuth,
  changeOrigin: true,
  pathRewrite: (path, req) => {
    // Preserve query string from original request
    const queryString = req.url.includes('?') ? req.url.split('?')[1] : '';
    const targetPath = `/api/auth/google/callback${queryString ? '?' + queryString : ''}`;
    console.log(`[GATEWAY] Google OAuth callback: ${req.method} ${req.originalUrl}`);
    console.log(`[GATEWAY] Query string: ${queryString || 'none'}`);
    console.log(`[GATEWAY] Proxying to: ${targetPath}`);
    return targetPath;
  },
  onProxyReq: (proxyReq, req) => {
    // Log the actual request being sent
    console.log(`[GATEWAY] Proxy request path: ${proxyReq.path}`);
  },
  onProxyRes: (proxyRes, req, res) => {
    console.log(`[GATEWAY] Google OAuth callback response: ${proxyRes.statusCode}`);
  },
  onError: (err, req, res) => {
    console.error("[GATEWAY] Google OAuth callback error:", err.message);
    res.status(502).send("Bad Gateway - auth service unreachable");
  },
}));

// Also handle with trailing slash
app.get("/api/auth/google/callback/", createProxyMiddleware({
  target: targetAuth,
  changeOrigin: true,
  pathRewrite: (path, req) => {
    const queryString = req.url.includes('?') ? req.url.split('?')[1] : '';
    return `/api/auth/google/callback${queryString ? '?' + queryString : ''}`;
  },
}));

// Mount proxies
app.use(authProxy);
app.use(fileProxy);
// app.use(paymentProxy);
app.use(paymentProxy);
app.use("/support", supportProxy);
// Mount msdraftProxy FIRST to handle Microsoft Word auth routes (token in query)
// This must come before draftProxy to catch auth routes
app.use("/drafting", msdraftProxy);
// Mount draftProxy for Google Docs routes (different service/port)
app.use("/drafting", draftProxy);
app.use(visualProxy); // Visual Service proxy for flowchart generation
app.use(chatProxy); // ChatModel Service proxy for document Q&A
app.use("/api/drafting", zohodraftingproxy); // Zoho Drafting Service proxy
app.use("/api/drafting-templates", draftingTemplateProxy); // Drafting Template Service proxy
app.use("/api/drafting-ai", draftingAiProxy); // Drafting AI proxy (ChatModel)

// Direct route for /api/drafts → Drafting Template Service
const targetDraftingTemplate = process.env.DRAFTING_TEMPLATE_SERVICE_URL || "http://localhost:5010";

app.use("/api/drafts", authMiddleware, createProxyMiddleware({
    target: targetDraftingTemplate,
    changeOrigin: true,
    pathRewrite: (path, req) => {
        // When mounted at /api/drafts, Express strips the prefix
        // So /api/drafts becomes /, /api/drafts/:id becomes /:id
        // We need to prepend /api/drafts back to the path
        const rewrittenPath = `/api/drafts${path}`;
        console.log(`[Gateway] Drafts API path rewrite: ${path} → ${rewrittenPath}`);
        return rewrittenPath;
    },
    onProxyReq: (proxyReq, req) => {
        // Forward Authorization header
        if (req.headers.authorization) {
            proxyReq.setHeader("Authorization", req.headers.authorization);
        }
        // Inject user ID from JWT into header
        if (req.user && req.user.id) {
            proxyReq.setHeader("x-user-id", req.user.id);
        }
        // Forward firm ID if present
        if (req.headers["x-firm-id"]) {
            proxyReq.setHeader("x-firm-id", req.headers["x-firm-id"]);
        }
        console.log(`[Gateway] Proxying /api/drafts to Drafting Template Service: ${proxyReq.path}`);
    },
    logLevel: "debug",
    proxyTimeout: 120000,
    timeout: 120000,
    onError: (err, req, res) => {
        console.error(`[Gateway] Drafts API proxy error: ${err.message}`);
        if (!res.headersSent) {
            res.status(502).json({
                success: false,
                error: "Drafting Template Service is unavailable",
                message: err.message
            });
        }
    },
}));

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

// console.log([Gateway] PAYMENT_SERVICE_URL: ${process.env.PAYMENT_SERVICE_URL});
// console.log([Gateway] Gateway Port: ${process.env.PORT || 5000});

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
//   console.log([Gateway] Incoming Request: ${req.method} ${req.originalUrl});
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
//   console.log([Gateway] 404 Not Found: ${req.method} ${req.originalUrl});
//   res.status(404).json({ error: Cannot ${req.method} ${req.originalUrl} });
// });

// // General error handler
// app.use((err, req, res, next) => {
//   console.error("[Gateway] Unhandled Error:", err.stack);
//   res.status(500).json({ error: "Internal Server Error", message: err.message });
// });

// // Start server
// const PORT = process.env.PORT || 5000;
// app.listen(PORT, () => {
//   console.log([Gateway] API Gateway running on port ${PORT});
// });

// module.exports = app;