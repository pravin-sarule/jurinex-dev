const express = require('express');
const morgan = require('morgan');
const cors = require('cors');
const cookieParser = require('cookie-parser');

require('dotenv').config({ path: './.env' });
const db = require('./src/config/db');
const paymentRoutes = require('./src/routes/paymentRoutes');
const userResourceRoutes = require('./src/routes/userResourcesRoutes');

const app = express();

app.use(cookieParser());
app.use(express.json());
app.use(morgan('dev'));

// Routes must be after body parsing middleware
app.use('/api/user-resources', userResourceRoutes);

const allowedOrigins = ['https://nexintelagent.netlify.app', 'http://localhost:5173'];

app.use(cors({
  origin: function(origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error("Not allowed by CORS"));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Origin", "X-Requested-With", "Content-Type", "Accept", "Authorization"]
}));

app.use('/api/payments', paymentRoutes);

app.get('/api/test-route', (req, res) => {
  res.send('Test route is working!');
});

app.get('/api/simple-test', (req, res) => {
  res.send('Simple test route is working!');
});

const PORT = process.env.PORT || process.env.PAYMENT_SERVICE_PORT || 5003;

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.stack);
  res.status(500).send('Something broke!');
});

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`Application accessible at http://localhost:${PORT}`);
});

process.on('unhandledRejection', (err) => {
  console.error(`❌ Unhandled Rejection: ${err.message}`);
  process.exit(1);
});
