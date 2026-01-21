# AI-Agent Service - API Integration Guide

This document provides integration instructions for other services to call the AI-Agent document processing service.

## Base URL

```
http://localhost:3001  (development)
https://your-ai-agent-service.com  (production)
```

## Authentication

**No authentication required** - This service is designed for backend-to-backend communication. For production, consider:
- Network-level security (VPC, firewall rules)
- Service-to-service authentication tokens in headers
- Rate limiting per service

## Headers

Optional headers for tracking:
```
X-Service-Name: your-service-name  # For request logging
Content-Type: application/json      # For JSON requests
```

## Endpoints

### 1. Upload Document

**Endpoint:** `POST /api/documents/upload`

**Description:** Upload a document file for processing. The processing happens asynchronously.

**Request:**
- Method: `POST`
- Content-Type: `multipart/form-data`
- Body:
  - `document` (file): PDF, DOCX, or image file

**Example (curl):**
```bash
curl -X POST http://localhost:3001/api/documents/upload \
  -F "document=@/path/to/file.pdf" \
  -H "X-Service-Name: admin-service"
```

**Example (Node.js/axios):**
```javascript
const FormData = require('form-data');
const fs = require('fs');
const axios = require('axios');

const formData = new FormData();
formData.append('document', fs.createReadStream('/path/to/file.pdf'));

const response = await axios.post('http://localhost:3001/api/documents/upload', formData, {
  headers: {
    ...formData.getHeaders(),
    'X-Service-Name': 'admin-service'
  },
  maxContentLength: Infinity,
  maxBodyLength: Infinity
});

console.log('File ID:', response.data.file_id);
```

**Response (202 Accepted):**
```json
{
  "message": "Document uploaded and processing initiated.",
  "file_id": "550e8400-e29b-41d4-a716-446655440000",
  "gs_uri": "gs://bucket/path/to/file.pdf"
}
```

**Processing Flow:**
1. File is uploaded and stored in GCS
2. Document metadata is saved to database
3. Processing starts asynchronously:
   - Text extraction (PDF parsing or OCR)
   - Chunking
   - Embedding generation
   - Storage in database
4. Status can be checked via `/api/documents/status/:file_id`

---

### 2. Get Processing Status

**Endpoint:** `GET /api/documents/status/:file_id`

**Description:** Check the processing status of an uploaded document.

**Request:**
- Method: `GET`
- URL Parameter: `file_id` (UUID)

**Example:**
```bash
curl http://localhost:3001/api/documents/status/550e8400-e29b-41d4-a716-446655440000
```

**Response (Processing):**
```json
{
  "document_id": "550e8400-e29b-41d4-a716-446655440000",
  "filename": "document.pdf",
  "status": "processing",
  "processing_progress": 65.5,
  "current_operation": "Generating embeddings for 150 chunks",
  "last_updated": "2024-01-15T10:30:00.000Z"
}
```

**Response (Processed):**
```json
{
  "document_id": "550e8400-e29b-41d4-a716-446655440000",
  "filename": "document.pdf",
  "status": "processed",
  "processing_progress": 100,
  "current_operation": "Completed",
  "chunks": 150,
  "summary": "Document summary text...",
  "last_updated": "2024-01-15T10:35:00.000Z"
}
```

**Status Values:**
- `uploaded`: File uploaded, processing not started
- `processing`: Currently processing
- `batch_processing`: Using Document AI batch processing (for large files)
- `processed`: Successfully processed and ready for chat
- `error`: Processing failed

---

### 3. Chat with Documents

**Endpoint:** `POST /api/documents/chat`

**Description:** Ask questions about documents. Searches across all processed documents or specific files.

**Request:**
- Method: `POST`
- Content-Type: `application/json`
- Body:
```json
{
  "question": "What are the key points in the documents?",
  "file_ids": ["uuid1", "uuid2"],  // Optional: specific files, omit to search all
  "session_id": "conversation-uuid",  // Optional: for conversation context
  "llm_name": "gemini"  // Optional: gemini|gemini-pro-2.5|gemini-3-pro (default: gemini)
}
```

**Example:**
```bash
curl -X POST http://localhost:3001/api/documents/chat \
  -H "Content-Type: application/json" \
  -H "X-Service-Name: admin-service" \
  -d '{
    "question": "Summarize the main findings",
    "file_ids": ["550e8400-e29b-41d4-a716-446655440000"],
    "llm_name": "gemini"
  }'
```

**Example (Node.js):**
```javascript
const axios = require('axios');

const response = await axios.post('http://localhost:3001/api/documents/chat', {
  question: "What are the key points in all documents?",
  // file_ids: ["uuid1", "uuid2"],  // Optional - omit to search all files
  session_id: "my-conversation-id",  // Optional
  llm_name: "gemini"  // Optional
}, {
  headers: {
    'Content-Type': 'application/json',
    'X-Service-Name': 'admin-service'
  }
});

console.log('Answer:', response.data.answer);
console.log('Files used:', response.data.files_used);
console.log('Chunks used:', response.data.chunks_used);
```

**Response:**
```json
{
  "success": true,
  "session_id": "550e8400-e29b-41d4-a716-446655440000",
  "message_id": "660e8400-e29b-41d4-a716-446655440001",
  "answer": "Based on the documents, the key points are...",
  "response": "Based on the documents, the key points are...",
  "history": [
    {
      "id": "660e8400-e29b-41d4-a716-446655440001",
      "file_ids": ["550e8400-e29b-41d4-a716-446655440000"],
      "session_id": "550e8400-e29b-41d4-a716-446655440000",
      "question": "What are the key points?",
      "answer": "Based on the documents...",
      "used_chunk_ids": ["uuid1", "uuid2"],
      "timestamp": "2024-01-15T10:40:00.000Z"
    }
  ],
  "used_chunk_ids": ["uuid1", "uuid2"],
  "chunks_used": 15,
  "files_used": 2,
  "timestamp": "2024-01-15T10:40:00.000Z"
}
```

**Important Notes:**
- If `file_ids` is omitted or empty, searches **ALL** processed documents
- Uses vector similarity search to find relevant chunks across all specified files
- Returns top 15 most relevant chunks by default
- Maintains conversation context via `session_id`

---

### 4. Get All Documents

**Endpoint:** `GET /api/documents/documents`

**Description:** List all processed documents in the system.

**Request:**
- Method: `GET`

**Example:**
```bash
curl http://localhost:3001/api/documents/documents
```

**Response:**
```json
{
  "success": true,
  "documents": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "originalname": "document1.pdf",
      "status": "processed",
      "processing_progress": 100,
      "mimetype": "application/pdf",
      "size": 1024000,
      "created_at": "2024-01-15T10:00:00.000Z",
      "processed_at": "2024-01-15T10:35:00.000Z"
    }
  ],
  "count": 1
}
```

---

### 5. Process Existing Document

**Endpoint:** `POST /api/documents/process`

**Description:** Trigger processing for an already uploaded document (if processing failed or needs to be retried).

**Request:**
- Method: `POST`
- Content-Type: `application/json`
- Body:
```json
{
  "file_id": "550e8400-e29b-41d4-a716-446655440000"
}
```

**Example:**
```bash
curl -X POST http://localhost:3001/api/documents/process \
  -H "Content-Type: application/json" \
  -d '{
    "file_id": "550e8400-e29b-41d4-a716-446655440000"
  }'
```

**Response (202 Accepted):**
```json
{
  "success": true,
  "message": "Document processing initiated.",
  "file_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "processing"
}
```

**Error Responses:**
```json
{
  "success": false,
  "error": "Document is already processed.",
  "file_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "processed"
}
```

---

## Complete Integration Example

### Admin Service Uploading and Chatting with Documents

```javascript
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');

const AI_AGENT_BASE_URL = process.env.AI_AGENT_BASE_URL || 'http://localhost:3001';

class DocumentService {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
  }

  async uploadDocument(filePath) {
    const formData = new FormData();
    formData.append('document', fs.createReadStream(filePath));

    const response = await axios.post(
      `${this.baseUrl}/api/documents/upload`,
      formData,
      {
        headers: {
          ...formData.getHeaders(),
          'X-Service-Name': 'admin-service'
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity
      }
    );

    return response.data;
  }

  async waitForProcessing(fileId, maxWaitSeconds = 300) {
    const startTime = Date.now();
    const maxWait = maxWaitSeconds * 1000;

    while (Date.now() - startTime < maxWait) {
      const status = await this.getStatus(fileId);
      
      if (status.status === 'processed') {
        return status;
      }
      
      if (status.status === 'error') {
        throw new Error(`Processing failed: ${status.current_operation}`);
      }

      await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
    }

    throw new Error('Processing timeout');
  }

  async getStatus(fileId) {
    const response = await axios.get(
      `${this.baseUrl}/api/documents/status/${fileId}`,
      {
        headers: { 'X-Service-Name': 'admin-service' }
      }
    );
    return response.data;
  }

  async chat(question, fileIds = null, sessionId = null) {
    const body = { question };
    if (fileIds) body.file_ids = fileIds;
    if (sessionId) body.session_id = sessionId;

    const response = await axios.post(
      `${this.baseUrl}/api/documents/chat`,
      body,
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Service-Name': 'admin-service'
        }
      }
    );

    return response.data;
  }

  async getAllDocuments() {
    const response = await axios.get(
      `${this.baseUrl}/api/documents/documents`,
      {
        headers: { 'X-Service-Name': 'admin-service' }
      }
    );
    return response.data;
  }
}

// Usage Example
async function main() {
  const docService = new DocumentService(AI_AGENT_BASE_URL);

  try {
    // 1. Upload a document
    console.log('Uploading document...');
    const uploadResult = await docService.uploadDocument('/path/to/document.pdf');
    console.log('Uploaded:', uploadResult.file_id);

    // 2. Wait for processing
    console.log('Waiting for processing...');
    const processed = await docService.waitForProcessing(uploadResult.file_id);
    console.log('Processing complete:', processed.chunks, 'chunks');

    // 3. Chat with the document
    console.log('Asking question...');
    const chatResult = await docService.chat(
      "What is the main topic of this document?",
      [uploadResult.file_id]
    );
    console.log('Answer:', chatResult.answer);

    // 4. Chat with all documents
    const allDocsChat = await docService.chat(
      "Summarize all documents"
    );
    console.log('Answer from all docs:', allDocsChat.answer);

  } catch (error) {
    console.error('Error:', error.message);
  }
}
```

---

## Error Handling

All endpoints return standard error responses:

**400 Bad Request:**
```json
{
  "success": false,
  "error": "Validation error message",
  "details": "Additional error details"
}
```

**404 Not Found:**
```json
{
  "success": false,
  "error": "File not found."
}
```

**500 Internal Server Error:**
```json
{
  "success": false,
  "error": "Failed to process request.",
  "details": "Error details",
  "timestamp": "2024-01-15T10:40:00.000Z",
  "path": "/api/documents/chat"
}
```

---

## Best Practices

1. **Async Processing**: Document upload returns immediately. Poll `/status` endpoint to check completion.
2. **File IDs**: Store `file_id` from upload response for later reference.
3. **Session Management**: Use consistent `session_id` for conversation continuity.
4. **Error Handling**: Always check response status and handle errors gracefully.
5. **File Limits**: Respect file size limits (100MB default).
6. **Rate Limiting**: Be mindful of API rate limits in production.

---

## Health Check

**Endpoint:** `GET /health`

**Response:**
```json
{
  "status": "ok",
  "service": "ai-agent",
  "version": "1.0.0",
  "timestamp": "2024-01-15T10:40:00.000Z"
}
```

---

## API Documentation

**Endpoint:** `GET /api/docs`

Returns full API documentation in JSON format.
