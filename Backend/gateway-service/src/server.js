// // Entry point
// const app = require("./app");

// const PORT = process.env.PORT || 5000;

// app.listen(PORT, () => {
//   console.log(`API Gateway running on port ${PORT}`);
// });
// src/server.js
let app;
try {
  app = require("./app");
  console.log("[Gateway] App module loaded successfully");
} catch (error) {
  console.error("[Gateway] Failed to load app module:", error);
  process.exit(1);
}

const PORT = process.env.PORT || 5000;
const HOST = process.env.HOST || '0.0.0.0';

// Start server with error handling
let server;
try {
  server = app.listen(PORT, HOST, () => {
    console.log(`🚀 API Gateway running on ${HOST}:${PORT}`);
    console.log(`[Gateway] Health check: http://${HOST}:${PORT}/health`);
    console.log(`[Gateway] Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`[Gateway] Server is ready to accept connections`);
    
    // Verify server is actually listening
    if (server.listening) {
      console.log(`[Gateway] ✅ Server confirmed listening on port ${PORT}`);
    } else {
      console.error(`[Gateway] ❌ Server not listening!`);
      process.exit(1);
    }
  });
  
  // Additional check after a short delay
  setTimeout(() => {
    if (server && server.listening) {
      console.log(`[Gateway] ✅ Server health check passed after 2 seconds`);
    } else {
      console.error(`[Gateway] ❌ Server failed health check after 2 seconds`);
      process.exit(1);
    }
  }, 2000);
  
} catch (error) {
  console.error("[Gateway] Failed to start server:", error);
  console.error("[Gateway] Error stack:", error.stack);
  process.exit(1);
}

// Handle server errors
server.on('error', (error) => {
  console.error('[Gateway] Server error:', error);
  console.error('[Gateway] Error code:', error.code);
  console.error('[Gateway] Error message:', error.message);
  console.error('[Gateway] Error stack:', error.stack);
  if (error.code === 'EADDRINUSE') {
    console.error(`[Gateway] Port ${PORT} is already in use`);
    process.exit(1);
  } else {
    console.error('[Gateway] Unexpected server error - exiting');
    process.exit(1);
  }
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('[Gateway] ========== UNCAUGHT EXCEPTION ==========');
  console.error('[Gateway] Error name:', error.name);
  console.error('[Gateway] Error message:', error.message);
  console.error('[Gateway] Error stack:', error.stack);
  console.error('[Gateway] ========================================');
  // Give time for logs to flush
  setTimeout(() => {
    process.exit(1);
  }, 1000);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('[Gateway] ========== UNHANDLED REJECTION ==========');
  console.error('[Gateway] Promise:', promise);
  console.error('[Gateway] Reason:', reason);
  if (reason instanceof Error) {
    console.error('[Gateway] Error name:', reason.name);
    console.error('[Gateway] Error message:', reason.message);
    console.error('[Gateway] Error stack:', reason.stack);
  }
  console.error('[Gateway] =========================================');
  // Give time for logs to flush
  setTimeout(() => {
    process.exit(1);
  }, 1000);
});
