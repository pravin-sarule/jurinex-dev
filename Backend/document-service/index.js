const express = require('express');
const morgan = require('morgan');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const multer = require('multer');
require('dotenv').config({ path: './.env' });

const documentRoutes = require('./routes/documentRoutes');
const chatRoutes = require('./routes/chatRoutes');
const secretManagerRoutes = require('./routes/secretManagerRoutes');
const fileRoutes = require('./routes/fileRoutes');
const contentRoutes = require('./routes/contentRoutes');
const mindmapRoutes = require('./routes/mindmapRoutes');
const multimodalRagRoutes = require('./routes/multimodalRagRoutes');
const googleDriveRoutes = require('./routes/googleDriveRoutes');
const { initializeCaseAssignmentsSchema } = require('./utils/caseAssignmentsDb');

const { warmQueue } = require('./queues/embeddingQueue');
const { startEmbeddingWorker } = require('./workers/embeddingWorker');

const app = express();

app.use(cookieParser());
app.use(express.json());
if (process.env.NODE_ENV !== 'test') {
    app.use(morgan('dev'));
}

const allowedOrigins = [
    'http://localhost:5173',
    'https://jurinex-production.netlify.app',
    'https://microservicefrontend.netlify.app',
    'https://jurinex-dev.netlify.app',
    'https://ailearn.co.in',
    'https://www.ailearn.co.in',
];

app.use(cors({
    origin: function (origin, callback) {
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

app.use('/api/doc', documentRoutes);
app.use('/api/doc', chatRoutes);
app.use('/api/doc', secretManagerRoutes);
app.use('/api/files', fileRoutes);
app.use('/api/files', googleDriveRoutes);
app.use('/api/content', contentRoutes);
app.use('/api/mindmap', mindmapRoutes);
app.use('/api/multimodal-rag', multimodalRagRoutes);

app.get('/api/test-route', (req, res) => {
    res.send('✅ Test route is working!');
});

// LLM Models endpoint — used by agent-draft-service to resolve model IDs to names
const pool = require('./config/db');
app.get('/api/llm-models', async (req, res) => {
    try {
        const result = await pool.query('SELECT id, name FROM llm_models ORDER BY id');
        return res.json({ success: true, models: result.rows });
    } catch (err) {
        console.error('/api/llm-models error:', err.message);
        return res.status(500).json({ success: false, models: [], error: err.message });
    }
});

function errorHandler(err, req, res, next) {
    console.error(err.stack);

    if (err instanceof multer.MulterError) {
        console.error('[DocumentService][MulterError]', {
            code: err.code,
            field: err.field,
            message: err.message,
            method: req.method,
            url: req.originalUrl,
        });

        if (err.code === 'LIMIT_UNEXPECTED_FILE') {
            return res.status(400).send({
                status: 'error',
                message: 'Too many files selected. You can upload up to 50 files at a time.',
                code: err.code,
                field: err.field || null,
            });
        }

        return res.status(400).send({
            status: 'error',
            message: err.message || 'File upload failed.',
            code: err.code,
            field: err.field || null,
        });
    }

    const statusCode = err.statusCode || 500; 
    res.status(statusCode).send({
        status: 'error',
        message: err.message || 'Internal Server Error'
    });
}
app.use(errorHandler);

initializeCaseAssignmentsSchema();

const PORT = process.env.PORT || 8080;

const server = app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
});

if (process.env.EMBEDDING_WORKER_DISABLED !== 'true') {
    warmQueue();
    startEmbeddingWorker();
}

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