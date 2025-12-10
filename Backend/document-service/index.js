






// const express = require('express');
// const morgan = require('morgan');
// const cors = require('cors');
// const cookieParser = require('cookie-parser');
// require('dotenv').config({ path: './.env' });

// // Routes
// const documentRoutes = require('./routes/documentRoutes');
// const chatRoutes = require('./routes/chatRoutes');
// const secretManagerRoutes = require('./routes/secretManagerRoutes');
// const fileRoutes = require('./routes/fileRoutes');
// const contentRoutes = require('./routes/contentRoutes');

// const { warmQueue } = require('./queues/embeddingQueue');
// const { startEmbeddingWorker } = require('./workers/embeddingWorker');

// const app = express();

// // Middleware
// app.use(cookieParser());
// app.use(express.json());
// app.use(morgan('dev'));

// const allowedOrigins = [
//   'http://localhost:5173',
//   'https://nexintelagent.netlify.app',
//   'https://microservicefrontend.netlify.app'
// ];

// app.use(cors({
//   origin: function (origin, callback) {
//     // Allow requests with no origin (like Postman or same-server requests)
//     if (!origin) return callback(null, true);
//     if (allowedOrigins.includes(origin)) {
//       return callback(null, true);
//     }
//     return callback(new Error('Not allowed by CORS'));
//   },
//   methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
//   credentials: true,
//   allowedHeaders: [
//     'Origin',
//     'X-Requested-With',
//     'Content-Type',
//     'Accept',
//     'Authorization',
//     'x-user-id'
//   ]
// }));

// // Routes
// app.use('/api/doc', documentRoutes);
// app.use('/api/doc', chatRoutes);
// app.use('/api/doc', secretManagerRoutes);
// app.use('/api/files', fileRoutes);
// app.use('/api/content', contentRoutes);

// // Test route
// app.get('/api/test-route', (req, res) => {
//   res.send('✅ Test route is working!');
// });

// // Use the PORT provided by Cloud Run, default to 8080
// const PORT = process.env.PORT || 8080;

// app.listen(PORT, () => {
//   console.log(`✅ Server running on port ${PORT}`);
// });

// if (process.env.EMBEDDING_WORKER_DISABLED !== 'true') {
//   warmQueue();
//   startEmbeddingWorker();
// }

// // Graceful shutdown
// process.on('unhandledRejection', (err) => {
//   console.error(`❌ Unhandled Rejection: ${err.message}`);
//   process.exit(1);
// });
















// const express = require('express');
// const morgan = require('morgan');
// const cors = require('cors');
// const cookieParser = require('cookie-parser');
// require('dotenv').config({ path: './.env' });

// // Routes
// const documentRoutes = require('./routes/documentRoutes');
// const chatRoutes = require('./routes/chatRoutes');
// const secretManagerRoutes = require('./routes/secretManagerRoutes');
// const fileRoutes = require('./routes/fileRoutes');
// const contentRoutes = require('./routes/contentRoutes');

// const { warmQueue } = require('./queues/embeddingQueue');
// const { startEmbeddingWorker } = require('./workers/embeddingWorker');

// const app = express();

// // Middleware
// app.use(cookieParser());
// app.use(express.json());
// app.use(morgan('dev'));

// const allowedOrigins = [
//   'http://localhost:5173',
//   'https://jurinex-production.netlify.app',
//   'https://microservicefrontend.netlify.app'
// ];

// app.use(cors({
//   origin: function (origin, callback) {
//     // Allow requests with no origin (like Postman or same-server requests)
//     if (!origin) return callback(null, true);
//     if (allowedOrigins.includes(origin)) {
//       return callback(null, true);
//     }
//     return callback(new Error('Not allowed by CORS'));
//   },
//   methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
//   credentials: true,
//   allowedHeaders: [
//     'Origin',
//     'X-Requested-With',
//     'Content-Type',
//     'Accept',
//     'Authorization',
//     'x-user-id'
//   ]
// }));

// // Routes
// app.use('/api/doc', documentRoutes);
// app.use('/api/doc', chatRoutes);
// app.use('/api/doc', secretManagerRoutes);
// app.use('/api/files', fileRoutes);
// app.use('/api/content', contentRoutes);

// // Test route
// app.get('/api/test-route', (req, res) => {
//   res.send('✅ Test route is working!');
// });

// // Use the PORT provided by Cloud Run, default to 8080
// const PORT = process.env.PORT || 8080;

// app.listen(PORT, () => {
//   console.log(`✅ Server running on port ${PORT}`);
// });

// if (process.env.EMBEDDING_WORKER_DISABLED !== 'true') {
//   warmQueue();
//   startEmbeddingWorker();
// }

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

// Routes
const documentRoutes = require('./routes/documentRoutes');
const chatRoutes = require('./routes/chatRoutes');
const secretManagerRoutes = require('./routes/secretManagerRoutes');
const fileRoutes = require('./routes/fileRoutes');
const contentRoutes = require('./routes/contentRoutes');

const { warmQueue } = require('./queues/embeddingQueue');
const { startEmbeddingWorker } = require('./workers/embeddingWorker');

const app = express();

// --- Middleware ---
app.use(cookieParser());
app.use(express.json());
// Log HTTP requests only when not in test environments
if (process.env.NODE_ENV !== 'test') {
    app.use(morgan('dev'));
}

const allowedOrigins = [
    'http://localhost:5173',
    'https://jurinex-production.netlify.app',
    'https://microservicefrontend.netlify.app'
];

app.use(cors({
    origin: function (origin, callback) {
        // Allow requests with no origin (like Postman or same-server requests)
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin)) {
            return callback(null, true);
        }
        return callback(new Error(`CORS: Origin ${origin} Not Allowed`));
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true,
    allowedHeaders: [
        'Origin',
        'X-Requested-With',
        'Content-Type',
        'Accept',
        'Authorization',
        'x-user-id'
    ]
}));

// --- Routes ---
app.use('/api/doc', documentRoutes);
app.use('/api/doc', chatRoutes);
app.use('/api/doc', secretManagerRoutes);
app.use('/api/files', fileRoutes);
app.use('/api/content', contentRoutes);

// Test route
app.get('/api/test-route', (req, res) => {
    res.send('✅ Test route is working!');
});

// --- General Error Handling Middleware (Best Practice) ---
function errorHandler(err, req, res, next) {
    console.error(err.stack); // Log the error stack for server-side debugging
    // Set a default status code if not already set (e.g., from a custom error class)
    const statusCode = err.statusCode || 500; 
    res.status(statusCode).send({
        status: 'error',
        message: err.message || 'Internal Server Error'
    });
}
app.use(errorHandler);


// --- Server Start ---
const PORT = process.env.PORT || 8080;

const server = app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
});

// --- Worker Setup ---
if (process.env.EMBEDDING_WORKER_DISABLED !== 'true') {
    warmQueue();
    startEmbeddingWorker();
}

// --- Graceful Shutdown (Enhanced) ---
process.on('unhandledRejection', (err) => {
    console.error(`❌ Unhandled Rejection: ${err.message}`);
    // Close the server and exit the process
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

















