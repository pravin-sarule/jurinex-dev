# Service Integration Guide

## Overview

The AI-Agent service provides document processing and AI chat capabilities that other services can call. It's designed for **backend-to-backend communication** without authentication requirements.

## Service Architecture

```
┌─────────────────┐
│  Admin Service  │
│  (or any other) │
└────────┬────────┘
         │ HTTP/REST API
         │ (No Auth)
         ▼
┌─────────────────┐
│  AI-Agent       │
│  Service        │
│  :3001          │
└────────┬────────┘
         │
    ┌────┴────┐
    │         │
    ▼         ▼
┌────────┐ ┌──────────┐
│  DB    │ │   GCS    │
│Postgres│ │  Storage │
└────────┘ └──────────┘
```

## Endpoints for Other Services

### 1. Document Upload
**POST** `/api/documents/upload`

Other services call this when they need to process a document.

**Request:**
- Content-Type: `multipart/form-data`
- Body: `document` (file)

**Response (202 Accepted):**
```json
{
  "success": true,
  "message": "Document uploaded and processing initiated.",
  "file_id": "uuid",
  "gs_uri": "gs://bucket/path",
  "status": "processing",
  "status_check_url": "/api/documents/status/{file_id}"
}
```

**Processing Happens Asynchronously:**
- Text extraction
- Chunking
- Embedding generation
- Storage

### 2. Check Processing Status
**GET** `/api/documents/status/:file_id`

Other services poll this to check if processing is complete.

**Response (Processing):**
```json
{
  "success": true,
  "document_id": "uuid",
  "status": "processing",
  "processing_progress": 65.5,
  "current_operation": "Generating embeddings...",
  "ready_for_chat": false
}
```

**Response (Completed):**
```json
{
  "success": true,
  "document_id": "uuid",
  "status": "processed",
  "processing_progress": 100,
  "chunks": 150,
  "ready_for_chat": true
}
```

### 3. Chat with Documents
**POST** `/api/documents/chat`

Other services call this to ask questions about documents.

**Request:**
```json
{
  "question": "What are the key points?",
  "file_ids": ["uuid1", "uuid2"],  // Optional: omit to search all
  "session_id": "uuid",             // Optional: for context
  "llm_name": "gemini"              // Optional
}
```

**Response:**
```json
{
  "success": true,
  "session_id": "uuid",
  "answer": "Based on the documents...",
  "chunks_used": 15,
  "files_used": 2,
  "used_chunk_ids": ["uuid1", "uuid2"]
}
```

**Key Feature:**
- If `file_ids` is omitted or empty, searches **ALL** processed documents
- Uses vector similarity search across all specified files
- Returns most relevant chunks from all files

## Integration Example (Admin Service)

### Scenario: Admin service uploads PDFs and asks questions

```javascript
// admin-service/controllers/documentController.js
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');

const AI_AGENT_URL = process.env.AI_AGENT_URL || 'http://localhost:3001';

class AIDocumentService {
  async uploadDocument(filePath, filename) {
    const formData = new FormData();
    formData.append('document', fs.createReadStream(filePath), filename);

    const response = await axios.post(
      `${AI_AGENT_URL}/api/documents/upload`,
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
      const response = await axios.get(
        `${AI_AGENT_URL}/api/documents/status/${fileId}`,
        { headers: { 'X-Service-Name': 'admin-service' } }
      );

      const status = response.data;

      if (status.status === 'processed') {
        return status;
      }

      if (status.status === 'error') {
        throw new Error(`Processing failed: ${status.error_message}`);
      }

      await new Promise(resolve => setTimeout(resolve, 5000));
    }

    throw new Error('Processing timeout');
  }

  async askQuestion(question, fileIds = null) {
    const body = { question };
    if (fileIds) body.file_ids = fileIds;

    const response = await axios.post(
      `${AI_AGENT_URL}/api/documents/chat`,
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
}

// Usage in admin service
exports.processAdminDocument = async (req, res) => {
  const aiService = new AIDocumentService();

  try {
    // Upload to AI-Agent service
    const uploadResult = await aiService.uploadDocument(
      req.file.path,
      req.file.originalname
    );

    // Wait for processing (optional - can also poll later)
    const processed = await aiService.waitForProcessing(uploadResult.file_id);

    // Now document is ready for chat
    res.json({
      success: true,
      file_id: uploadResult.file_id,
      chunks: processed.chunks,
      ready_for_chat: true
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.chatWithDocuments = async (req, res) => {
  const aiService = new AIDocumentService();

  try {
    const { question, file_ids } = req.body;

    // Call AI-Agent service chat endpoint
    const result = await aiService.askQuestion(question, file_ids);

    res.json({
      success: true,
      answer: result.answer,
      files_used: result.files_used,
      chunks_used: result.chunks_used
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
```

## Multi-File Search Feature

When `file_ids` is **not provided**, the chat endpoint searches **ALL** processed documents:

```javascript
// Search across ALL documents
const result = await axios.post(`${AI_AGENT_URL}/api/documents/chat`, {
  question: "What are common themes across all documents?"
});

// Search specific documents
const result2 = await axios.post(`${AI_AGENT_URL}/api/documents/chat`, {
  question: "Compare these two documents",
  file_ids: ["uuid1", "uuid2"]
});
```

## Workflow

1. **Upload Phase:**
   ```
   Admin Service → POST /api/documents/upload → AI-Agent
   Response: { file_id, status: "processing" }
   ```

2. **Processing Phase:**
   ```
   Admin Service → GET /api/documents/status/{file_id} → AI-Agent
   Response: { status: "processing", progress: 65% }
   
   (Poll every 5-10 seconds)
   
   Admin Service → GET /api/documents/status/{file_id} → AI-Agent
   Response: { status: "processed", ready_for_chat: true }
   ```

3. **Chat Phase:**
   ```
   Admin Service → POST /api/documents/chat → AI-Agent
   Request: { question: "...", file_ids: [...] }
   Response: { answer: "...", chunks_used: 15, files_used: 2 }
   ```

## Error Handling

All endpoints return consistent error format:

```json
{
  "success": false,
  "error": "Error message",
  "details": "Additional details",
  "suggestion": "Helpful suggestion (if available)"
}
```

## Health Check

Other services should monitor the AI-Agent service health:

```javascript
async function checkAIAgentHealth() {
  try {
    const response = await axios.get(`${AI_AGENT_URL}/health`);
    return response.data.status === 'ok';
  } catch (error) {
    return false;
  }
}
```

## Best Practices

1. **Async Processing**: Don't wait for processing - poll status endpoint
2. **Error Handling**: Always handle errors and retries
3. **File IDs**: Store `file_id` from upload response
4. **Timeouts**: Set appropriate HTTP timeouts (30-60s for chat)
5. **Logging**: Use `X-Service-Name` header for request tracking
6. **Rate Limiting**: Be mindful of rate limits in production

## Configuration

### Option 1: Via Gateway (Recommended)

Set gateway URL in your service:
```env
GATEWAY_URL=http://localhost:5000  # or production gateway URL
```

Use gateway endpoints:
```
http://gateway-url/ai-agent/documents/*
```

See **[Gateway Integration Guide](../gateway-service/AI_AGENT_INTEGRATION.md)** for details.

### Option 2: Direct Access

Set AI-Agent service URL directly:
```env
AI_AGENT_SERVICE_URL=http://localhost:3001  # or production URL
```

Use direct endpoints:
```
http://ai-agent-url:3001/api/documents/*
```

## Full Example

See `examples/integration-example.js` for complete working example.
