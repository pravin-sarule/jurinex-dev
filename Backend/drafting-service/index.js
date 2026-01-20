const express = require('express');
const morgan = require('morgan');
const cors = require('cors');
require('dotenv').config({ path: './.env' });

const draftRoutes = require('./routes/draftRoutes');
const { handleGoogleDriveWebhook } = require('./controllers/webhookController');

const app = express();

// Middleware
app.use(express.json());
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('dev'));
}

// Webhook endpoint for Google Drive Push Notifications
// Must be before CORS to allow Google's requests
// Note: This endpoint does NOT require authentication (Google calls it directly)
app.post('/api/webhooks/google-drive', handleGoogleDriveWebhook);

// CORS Configuration
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',
  'http://localhost:5000',
  'https://jurinex-production.netlify.app',
  'https://microservicefrontend.netlify.app',
  'https://jurinex-dev.netlify.app'
];

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like Postman, curl, server-to-server, or Google webhooks)
    if (!origin) return callback(null, true);
    
    // Allow requests from allowed origins
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    
    // Allow Chrome extension origins for development/testing (Postman, browser extensions)
    if (origin.startsWith('chrome-extension://')) {
      return callback(null, true);
    }
    
    // Allow localhost with any port for development
    if (origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')) {
      return callback(null, true);
    }
    
    // Allow Google webhook requests (Google doesn't send Origin header, but allow if it does)
    if (origin.includes('googleapis.com') || origin.includes('google.com')) {
      return callback(null, true);
    }
    
    return callback(new Error(`CORS: Origin ${origin} Not Allowed`));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
  credentials: true,
  allowedHeaders: [
    'Origin',
    'X-Requested-With',
    'Content-Type',
    'Accept',
    'Authorization',
    'x-user-id',
    'X-Google-Access-Token',
    'x-goog-resource-id',
    'x-goog-resource-state',
    'x-goog-resource-uri',
    'x-goog-channel-id',
    'x-goog-channel-expiration'
  ]
}));

// Google Search Console Verification Route
// This route serves the verification meta tag for Google to confirm domain ownership
// Accessible at: https://floury-extenuatory-earnestine.ngrok-free.dev/
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <meta name="google-site-verification" content="mDyB-QZ1eB0AXv5274qRTU71hYkXieOg7PCnpECJNmw" />
        <title>Domain Verification</title>
      </head>
      <body>
        <h1>Domain Verification in Progress</h1>
        <p>This page is used for Google Search Console domain verification.</p>
        <p>If you can see this message, the verification route is working correctly.</p>
      </body>
    </html>
  `);
});

// Routes
// All draft routes are now unified in draftRoutes
app.use('/api/drafts', draftRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({ 
    status: 'healthy',
    service: 'drafting-service',
    timestamp: new Date().toISOString()
  });
});

// Test route
app.get('/api/test-route', (req, res) => {
  res.send('✅ Drafting Service test route is working!');
});

// Error handler
function errorHandler(err, req, res, next) {
  console.error(err.stack);
  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    status: 'error',
    message: err.message || 'Internal Server Error'
  });
}
app.use(errorHandler);

// Start server
const PORT = process.env.PORT || 5005;

const server = app.listen(PORT, () => {
  console.log(`✅ Drafting Service running on port ${PORT}`);
});

// Graceful shutdown
process.on('unhandledRejection', (err) => {
  console.error(`❌ Unhandled Rejection: ${err.message}`);
  server.close(() => {
    process.exit(1);
  });
});

process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received. Shutting down gracefully.');
  server.close(() => {
    console.log('✅ Server closed. Process terminated.');
  });
});

module.exports = app;

