# AI Agent Service

A backend service for document processing and AI-powered chat with multiple documents. This service handles document uploads, text extraction, chunking, embedding generation, and multi-file document queries.

## 🎯 Purpose

This service is designed to be **shared with other services** for document processing capabilities. Other services (like admin services) can call these endpoints to:
- Upload and process documents
- Chat with documents using AI
- Search across multiple documents simultaneously

## Features

- **Document Upload & Processing**: Upload PDFs and other documents for processing
- **Multi-File Chat**: Ask questions across multiple processed documents simultaneously  
- **Vector Search**: Semantic search across all document chunks
- **No Authentication**: Designed for backend-to-backend communication (internal service)
- **Inter-Service Ready**: Optimized for other services to call these endpoints

## Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Set Up Database
```bash
# Run migration to create tables
psql -U your_user -d your_database -f migrations/001_create_agent_tables.sql
```

### 3. Configure Environment
Create a `.env` file with:
```env
DATABASE_URL=postgresql://user:password@localhost:5432/database
GEMINI_API_KEY=your-gemini-api-key
GCS_INPUT_BUCKET_NAME=your-input-bucket
GCS_OUTPUT_BUCKET_NAME=your-output-bucket
GCLOUD_PROJECT_ID=your-project-id
DOCUMENT_AI_PROCESSOR_ID=your-processor-id
PORT=3001
```

### 4. Start Service
```bash
npm start
# or for development with auto-reload
npm run dev
```

The service will be available at `http://localhost:3001`

## Access via Gateway (Recommended)

The AI-Agent service is integrated with the gateway-service. Use the gateway as the base URL:

**Gateway Base URL:** `http://gateway-url/ai-agent/documents`

**Example:**
```javascript
// Through Gateway (Recommended)
const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:5000';

const response = await axios.post(
  `${GATEWAY_URL}/ai-agent/documents/upload`,
  formData,
  { headers: formData.getHeaders() }
);
```

See **[Gateway Integration Guide](../gateway-service/AI_AGENT_INTEGRATION.md)** for details.

## Direct Access (Development)

For direct access without gateway:

**Base URL:** `http://ai-agent-url:3001/api/documents`

See **[API_INTEGRATION.md](./API_INTEGRATION.md)** for detailed integration instructions and examples.

**Quick Integration:**
```javascript
// Direct access (Development/Internal)
const AI_AGENT_URL = process.env.AI_AGENT_SERVICE_URL || 'http://localhost:3001';

// 1. Upload document
const formData = new FormData();
formData.append('document', fs.createReadStream('/path/to/file.pdf'));

const uploadRes = await axios.post(
  `${AI_AGENT_URL}/api/documents/upload`,
  formData,
  { headers: formData.getHeaders() }
);

const fileId = uploadRes.data.file_id;

// 2. Check status
const statusRes = await axios.get(
  `${AI_AGENT_URL}/api/documents/status/${fileId}`
);

// 3. Chat with documents
const chatRes = await axios.post(
  `${AI_AGENT_URL}/api/documents/chat`,
  {
    question: "Summarize all documents",
    file_ids: [fileId] // or omit to search all
  }
);
```


## API Documentation

### 📚 Complete Endpoint Documentation

See **[API_ENDPOINTS.md](./API_ENDPOINTS.md)** for complete endpoint documentation with:
- **Admin endpoints**: Document upload and management
- **User chat endpoints**: Chat with documents (no upload needed)
- **Gateway base URL**: `http://localhost:5000/ai-agent/documents`
- **Code examples**: JavaScript/Frontend examples
- **Error handling**: Error response formats

### 🎨 Frontend Integration Guide

See **[FRONTEND_INTEGRATION.md](./FRONTEND_INTEGRATION.md)** for:
- React component examples
- Service classes for admin and user
- Complete integration examples
- Error handling patterns

### Quick API Reference

**Admin Endpoints (via Gateway):**
- `POST /ai-agent/documents/upload` - Upload document
- `GET /ai-agent/documents/documents` - List all documents
- `GET /ai-agent/documents/:file_id` - Get single document details
- `GET /ai-agent/documents/status/:file_id` - Check processing status
- `DELETE /ai-agent/documents/:file_id` - Delete document and all associated data
- `POST /ai-agent/documents/process` - Retry processing

**User Chat Endpoints (via Gateway):**
- `POST /ai-agent/documents/chat` - Chat with all documents
  - No `file_ids` needed - searches all automatically
  - Uses `session_id` for conversation context
  - Users don't need to upload documents

## Database Tables

- `agent_documents`: Stores document metadata
- `agent_file_chunks`: Stores document chunks
- `agent_chunk_vectors`: Stores vector embeddings for semantic search
- `agent_file_chats`: Stores chat history

## Architecture

1. **Upload**: Documents are uploaded and stored in GCS
2. **Processing**: 
   - Text extraction (PDF parsing or Document AI OCR)
   - Chunking using LangChain
   - Embedding generation using Gemini
   - Storage in PostgreSQL with pgvector
3. **Chat**:
   - Question embedding generation
   - Vector similarity search across all files
   - Context assembly from relevant chunks
   - LLM response generation
