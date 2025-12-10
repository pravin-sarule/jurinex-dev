// const express = require('express');
// const morgan = require('morgan');
// const cors = require('cors');
// const cookieParser = require('cookie-parser');

// require('dotenv').config({ path: './.env' });
// const db = require('./src/config/db'); // Import the database connection
// const paymentRoutes = require('./src/routes/paymentRoutes'); // Import payment routes
// const userResourceRoutes = require('./src/routes/userResourcesRoutes');

// const app = express();

// // Routes that need to be defined early (e.g., user resources)
// app.use('/api/user-resources', userResourceRoutes);

// // Middleware
// app.use(cookieParser());
// app.use(express.json());
// app.use(morgan('dev'));

// // ✅ Allowed origins
// const allowedOrigins = ['https://nexinteluser.netlify.app', 'http://localhost:5173']; // Add your frontend URLs

// // ✅ CORS setup
// app.use(cors({
//   origin: function(origin, callback) {
//     if (!origin) return callback(null, true); // Allow non-browser tools like Postman
//     if (allowedOrigins.includes(origin)) {
//       return callback(null, true);
//     }
//     return callback(new Error("Not allowed by CORS"));
//   },
//   credentials: true,
//   methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
//   allowedHeaders: ["Origin", "X-Requested-With", "Content-Type", "Accept", "Authorization"]
// }));

// // ✅ Handle preflight requests for all routes
// // app.options('*', cors());

// // Other Routes
// app.use('/api/payments', paymentRoutes);


// // Test route
// app.get('/api/test-route', (req, res) => {
//   res.send('Test route is working!');
// });

// app.get('/api/simple-test', (req, res) => {
//   res.send('Simple test route is working!');
// });

// const PORT = process.env.PORT || 3000;

// // Add a basic error handling middleware
// app.use((err, req, res, next) => {
//   console.error('Unhandled error:', err.stack);
//   res.status(500).send('Something broke!');
// });

//     // Start server
//     app.listen(PORT, () => {
//       console.log(`✅ Server running on port ${PORT}`);
//       console.log(`Application accessible at http://localhost:${PORT}`);
//     });


// // Graceful shutdown
// process.on('unhandledRejection', (err) => {
//   console.error(`❌ Unhandled Rejection: ${err.message}`);
//   process.exit(1);
// });
const express = require('express');
const morgan = require('morgan');
const cors = require('cors');
const cookieParser = require('cookie-parser');

require('dotenv').config({ path: './.env' });
const db = require('./src/config/db'); // Import the database connection
const paymentRoutes = require('./src/routes/paymentRoutes'); // Import payment routes
const userResourceRoutes = require('./src/routes/userResourcesRoutes');

const app = express();

// Routes that need to be defined early (e.g., user resources)
app.use('/api/user-resources', userResourceRoutes);

// Middleware
app.use(cookieParser());
app.use(express.json());
app.use(morgan('dev'));

// ✅ Allowed origins
const allowedOrigins = ['https://nexintelagent.netlify.app', 'http://localhost:5173']; // Add your frontend URLs

// ✅ CORS setup
app.use(cors({
  origin: function(origin, callback) {
    if (!origin) return callback(null, true); // Allow non-browser tools like Postman
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error("Not allowed by CORS"));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Origin", "X-Requested-With", "Content-Type", "Accept", "Authorization"]
}));

// ✅ Handle preflight requests for all routes
// app.options('*', cors());

// Other Routes
app.use('/api/payments', paymentRoutes);


// Test route
app.get('/api/test-route', (req, res) => {
  res.send('Test route is working!');
});

app.get('/api/simple-test', (req, res) => {
  res.send('Simple test route is working!');
});

const PORT = process.env.PORT || 3000;

// Add a basic error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.stack);
  res.status(500).send('Something broke!');
});

    // Start server
    app.listen(PORT, () => {
      console.log(`✅ Server running on port ${PORT}`);
      console.log(`Application accessible at http://localhost:${PORT}`);
    });


// Graceful shutdown
process.on('unhandledRejection', (err) => {
  console.error(`❌ Unhandled Rejection: ${err.message}`);
  process.exit(1);
});
