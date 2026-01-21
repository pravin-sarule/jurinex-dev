require('dotenv').config();
const express = require('express');
const cors = require('cors');
const documentRoutes = require('./routes/documentRoutes');

const app = express();
const PORT = process.env.PORT || 3001;

// Enhanced CORS for inter-service communication
const defaultOrigins = [
  'http://localhost:3001',
  'http://localhost:5000', // Gateway service
  'http://localhost:5173', // Frontend (Vite dev server)
  'http://127.0.0.1:3001',
  'http://127.0.0.1:5000',
  'http://127.0.0.1:5173'
];

const corsOptions = {
  origin: process.env.ALLOWED_ORIGINS 
    ? process.env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim())
    : defaultOrigins,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Service-Name'],
  credentials: true,
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// Request logging middleware for inter-service calls
app.use((req, res, next) => {
  const serviceName = req.headers['x-service-name'] || 'unknown';
  const startTime = Date.now();
  
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} | Service: ${serviceName} | IP: ${req.ip}`);
  
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} | Status: ${res.statusCode} | Duration: ${duration}ms`);
  });
  
  next();
});

// API Routes
app.use('/api/documents', documentRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'ai-agent',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// API documentation endpoint
app.get('/api/docs', (req, res) => {
  res.json({
    service: 'AI-Agent Document Processing Service',
    version: '1.0.0',
    description: 'Document processing and AI chat service for inter-service communication',
    endpoints: {
      'POST /api/documents/upload': {
        description: 'Upload and process a document',
        request: {
          type: 'multipart/form-data',
          fields: {
            document: 'File to upload (PDF, DOCX, images)'
          }
        },
        response: {
          file_id: 'UUID of the uploaded document',
          gs_uri: 'Google Cloud Storage URI',
          message: 'Processing status message'
        }
      },
      'GET /api/documents/status/:file_id': {
        description: 'Get document processing status',
        response: {
          document_id: 'UUID',
          status: 'uploaded|processing|processed|error',
          processing_progress: '0-100',
          current_operation: 'Current processing step'
        }
      },
      'POST /api/documents/chat': {
        description: 'Chat with documents using AI',
        request: {
          question: 'User question (required)',
          file_ids: 'Array of file UUIDs (optional - searches all if omitted)',
          session_id: 'Session UUID for conversation context (optional)',
          llm_name: 'LLM provider: gemini|gemini-pro-2.5|gemini-3-pro (default: gemini)'
        },
        response: {
          success: true,
          session_id: 'Session UUID',
          answer: 'AI-generated answer',
          chunks_used: 'Number of document chunks used',
          files_used: 'Number of files searched',
          history: 'Conversation history'
        }
      },
      'GET /api/documents/documents': {
        description: 'Get all documents (all statuses: uploaded, processing, processed, error)',
        response: {
          success: true,
          documents: 'Array of all document metadata',
          count: 'Total number of documents',
          status_counts: 'Breakdown by status',
          processed_count: 'Number of processed documents',
          processing_count: 'Number of documents being processed'
        }
      },
      'GET /api/documents/:file_id': {
        description: 'Get a single document by ID with full details',
        response: {
          success: true,
          document: 'Document object with all metadata'
        }
      },
      'POST /api/documents/process': {
        description: 'Trigger document processing for existing uploaded file',
        request: {
          file_id: 'UUID of the document to process'
        }
      },
      'DELETE /api/documents/:file_id': {
        description: 'Delete document and all associated data (chunks, vectors, chats)',
        response: {
          success: true,
          deleted: {
            document: 1,
            chunks: 'Number of chunks deleted',
            vectors: 'Number of vectors deleted',
            chats: 'Number of chat records deleted'
          }
        }
      },
      'DELETE /api/documents/session/:session_id': {
        description: 'Delete a user session and all its chat history (auto-deletes after 5 minutes inactivity)',
        response: {
          success: true,
          message: 'Session deleted successfully',
          deleted_chats: 'Number of chat records deleted',
          session_id: 'UUID of deleted session'
        }
      }
    }
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(`[Error] ${req.method} ${req.path}:`, err);
  
  res.status(err.status || 500).json({
    success: false,
    error: err.message || 'Internal server error',
    timestamp: new Date().toISOString(),
    path: req.path
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
    available_endpoints: [
      'POST /api/documents/upload',
      'GET /api/documents/status/:file_id',
      'POST /api/documents/chat',
      'GET /api/documents/documents',
      'GET /api/documents/:file_id',
      'POST /api/documents/process',
      'DELETE /api/documents/:file_id',
      'GET /api/docs',
      'GET /health'
    ]
  });
});

// Initialize session manager for auto-cleanup
require('./services/sessionManager');

app.listen(PORT, () => {
  console.log(`[AI-Agent] Server running on port ${PORT}`);
  console.log(`[AI-Agent] Health check: http://localhost:${PORT}/health`);
  console.log(`[AI-Agent] API docs: http://localhost:${PORT}/api/docs`);
  console.log(`[AI-Agent] Session auto-cleanup: Enabled (5 minutes inactivity)`);
});
