# AI-Agent Service - API Endpoints Documentation

## Base URL (Gateway)

```
http://localhost:5000/ai-agent/documents
```

All endpoints should be accessed through the gateway service.

---

## Admin Endpoints (Document Management)

These endpoints are for **admins** to upload and manage documents.

### 1. Upload Document

**Endpoint:** `POST /ai-agent/documents/upload`

**Description:** Upload a document for processing. The processing happens asynchronously.

**Request:**
- Method: `POST`
- Content-Type: `multipart/form-data`
- Body:
  - `document` (file): PDF, DOCX, or image file

**Example (JavaScript/Frontend):**
```javascript
const formData = new FormData();
formData.append('document', file); // file from input element

const response = await fetch('http://localhost:5000/ai-agent/documents/upload', {
  method: 'POST',
  body: formData,
  headers: {
    'X-Service-Name': 'admin-frontend'
  }
});

const data = await response.json();
console.log('File ID:', data.file_id);
```

**Example (cURL):**
```bash
curl -X POST http://localhost:5000/ai-agent/documents/upload \
  -F "document=@/path/to/file.pdf" \
  -H "X-Service-Name: admin-frontend"
```

**Response (202 Accepted):**
```json
{
  "success": true,
  "message": "Document uploaded and processing initiated.",
  "file_id": "550e8400-e29b-41d4-a716-446655440000",
  "gs_uri": "gs://bucket/path/to/file.pdf",
  "status": "processing",
  "status_check_url": "/ai-agent/documents/status/550e8400-e29b-41d4-a716-446655440000"
}
```

---

### 2. Check Processing Status

**Endpoint:** `GET /ai-agent/documents/status/:file_id`

**Description:** Check the processing status of an uploaded document.

**Request:**
- Method: `GET`
- URL Parameter: `file_id` (UUID)

**Example (JavaScript/Frontend):**
```javascript
const fileId = '550e8400-e29b-41d4-a716-446655440000';

const response = await fetch(`http://localhost:5000/ai-agent/documents/status/${fileId}`);
const data = await response.json();

console.log('Status:', data.status);
console.log('Progress:', data.processing_progress);
```

**Example (cURL):**
```bash
curl http://localhost:5000/ai-agent/documents/status/550e8400-e29b-41d4-a716-446655440000
```

**Response (Processing):**
```json
{
  "success": true,
  "document_id": "550e8400-e29b-41d4-a716-446655440000",
  "filename": "document.pdf",
  "status": "processing",
  "processing_progress": 65.5,
  "current_operation": "Generating embeddings for 150 chunks",
  "last_updated": "2024-01-15T10:30:00.000Z",
  "ready_for_chat": false
}
```

**Response (Completed):**
```json
{
  "success": true,
  "document_id": "550e8400-e29b-41d4-a716-446655440000",
  "filename": "document.pdf",
  "status": "processed",
  "processing_progress": 100,
  "current_operation": "Completed",
  "chunks": 150,
  "summary": "Document summary text...",
  "last_updated": "2024-01-15T10:35:00.000Z",
  "ready_for_chat": true
}
```

**Status Values:**
- `uploaded`: File uploaded, processing not started
- `processing`: Currently processing
- `batch_processing`: Using Document AI batch processing
- `processed`: Successfully processed and ready for chat
- `error`: Processing failed

---

### 3. Get Single Document

**Endpoint:** `GET /ai-agent/documents/:file_id`

**Description:** Get detailed information about a specific document.

**Request:**
- Method: `GET`
- URL Parameter: `file_id` (UUID)

**Example (JavaScript/Frontend):**
```javascript
const fileId = '550e8400-e29b-41d4-a716-446655440000';

const response = await fetch(`http://localhost:5000/ai-agent/documents/${fileId}`);
const data = await response.json();

console.log('Document:', data.document);
```

**Example (cURL):**
```bash
curl http://localhost:5000/ai-agent/documents/550e8400-e29b-41d4-a716-446655440000
```

**Response:**
```json
{
  "success": true,
  "document": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "originalname": "document.pdf",
    "status": "processed",
    "processing_progress": 100,
    "current_operation": "Completed",
    "mimetype": "application/pdf",
    "size": 1024000,
    "gcs_path": "gs://bucket/path/to/file.pdf",
    "folder_path": "uploads/uuid-folder",
    "summary": "Document summary text...",
    "chunks_count": 150,
    "created_at": "2024-01-15T10:00:00.000Z",
    "updated_at": "2024-01-15T10:35:00.000Z",
    "processed_at": "2024-01-15T10:35:00.000Z",
    "ready_for_chat": true
  }
}
```

---

### 4. Get All Documents

**Endpoint:** `GET /ai-agent/documents/documents`

**Description:** Get a list of **ALL** documents (all statuses: uploaded, processing, processed, error). Useful for admin dashboard.

**Request:**
- Method: `GET`

**Example (JavaScript/Frontend):**
```javascript
const response = await fetch('http://localhost:5000/ai-agent/documents/documents');
const data = await response.json();

console.log('Total documents:', data.count);
console.log('Processed:', data.processed_count);
console.log('Processing:', data.processing_count);
console.log('Documents:', data.documents);
```

**Example (cURL):**
```bash
curl http://localhost:5000/ai-agent/documents/documents
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
      "current_operation": "Completed",
      "mimetype": "application/pdf",
      "size": 1024000,
      "created_at": "2024-01-15T10:00:00.000Z",
      "updated_at": "2024-01-15T10:35:00.000Z",
      "processed_at": "2024-01-15T10:35:00.000Z",
      "summary": "Document summary...",
      "chunks_count": 150,
      "ready_for_chat": true
    },
    {
      "id": "660e8400-e29b-41d4-a716-446655440001",
      "originalname": "document2.pdf",
      "status": "processing",
      "processing_progress": 65.5,
      "current_operation": "Generating embeddings...",
      "ready_for_chat": false
    },
    {
      "id": "770e8400-e29b-41d4-a716-446655440002",
      "originalname": "document3.pdf",
      "status": "uploaded",
      "processing_progress": 0,
      "current_operation": "Pending",
      "ready_for_chat": false
    },
    {
      "id": "880e8400-e29b-41d4-a716-446655440003",
      "originalname": "document4.pdf",
      "status": "error",
      "processing_progress": 0,
      "current_operation": "Processing failed: Error message",
      "ready_for_chat": false
    }
  ],
  "count": 4,
  "status_counts": {
    "uploaded": 1,
    "processing": 1,
    "batch_processing": 0,
    "processed": 1,
    "error": 1
  },
  "processed_count": 1,
  "processing_count": 1
}
```

**Note:** This endpoint returns **ALL** documents regardless of status, including:
- `uploaded` - Just uploaded, not yet processing
- `processing` - Currently being processed
- `batch_processing` - Using Document AI batch processing
- `processed` - Successfully processed and ready for chat
- `error` - Processing failed

---

### 5. Retry Processing

**Endpoint:** `POST /ai-agent/documents/process`

**Description:** Retry processing for an existing uploaded document (if processing failed).

**Request:**
- Method: `POST`
- Content-Type: `application/json`
- Body:
```json
{
  "file_id": "550e8400-e29b-41d4-a716-446655440000"
}
```

**Example (JavaScript/Frontend):**
```javascript
const response = await fetch('http://localhost:5000/ai-agent/documents/process', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    file_id: '550e8400-e29b-41d4-a716-446655440000'
  })
});

const data = await response.json();
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

---

### 5. Delete Document

**Endpoint:** `DELETE /ai-agent/documents/:file_id`

**Description:** Delete a document and all associated data (chunks, embeddings, chat history). This performs a cascade deletion.

**Request:**
- Method: `DELETE`
- URL Parameter: `file_id` (UUID)

**Example (JavaScript/Frontend):**
```javascript
const fileId = '550e8400-e29b-41d4-a716-446655440000';

const response = await fetch(`http://localhost:5000/ai-agent/documents/${fileId}`, {
  method: 'DELETE'
});

const data = await response.json();
console.log('Deleted:', data.deleted);
```

**Example (cURL):**
```bash
curl -X DELETE http://localhost:5000/ai-agent/documents/550e8400-e29b-41d4-a716-446655440000
```

**Response:**
```json
{
  "success": true,
  "message": "Document and all associated data deleted successfully.",
  "file_id": "550e8400-e29b-41d4-a716-446655440000",
  "filename": "document.pdf",
  "deleted": {
    "document": 1,
    "chunks": 150,
    "vectors": 150,
    "chats": 5
  }
}
```

**What Gets Deleted:**
- ✅ Document record from `agent_documents`
- ✅ All chunks from `agent_file_chunks`
- ✅ All vector embeddings from `agent_chunk_vectors`
- ✅ All chat history referencing this document from `agent_file_chats`

**Note:** The file in Google Cloud Storage is NOT deleted by default. Uncomment the GCS deletion code in the controller if you want to delete files from storage as well.

---

### 5. Delete Document

**Endpoint:** `DELETE /ai-agent/documents/:file_id`

**Description:** Delete a document and all associated data (chunks, embeddings, chat history). This performs a cascade deletion.

**Request:**
- Method: `DELETE`
- URL Parameter: `file_id` (UUID)

**Example (JavaScript/Frontend):**
```javascript
const fileId = '550e8400-e29b-41d4-a716-446655440000';

const response = await fetch(`http://localhost:5000/ai-agent/documents/${fileId}`, {
  method: 'DELETE'
});

const data = await response.json();
console.log('Deleted:', data.deleted);
```

**Example (cURL):**
```bash
curl -X DELETE http://localhost:5000/ai-agent/documents/550e8400-e29b-41d4-a716-446655440000
```

**Response:**
```json
{
  "success": true,
  "message": "Document and all associated data deleted successfully.",
  "file_id": "550e8400-e29b-41d4-a716-446655440000",
  "filename": "document.pdf",
  "deleted": {
    "document": 1,
    "chunks": 150,
    "vectors": 150,
    "chats": 5
  }
}
```

**What Gets Deleted:**
- ✅ Document record from `agent_documents`
- ✅ All chunks from `agent_file_chunks`
- ✅ All vector embeddings from `agent_chunk_vectors`
- ✅ All chat history referencing this document from `agent_file_chats`

**Note:** The file in Google Cloud Storage is NOT deleted by default. Uncomment the GCS deletion code in the controller if you want to delete files from storage as well.

---

**Description:** Retry processing for an existing uploaded document (if processing failed).

**Request:**
- Method: `POST`
- Content-Type: `application/json`
- Body:
```json
{
  "file_id": "550e8400-e29b-41d4-a716-446655440000"
}
```

**Example (JavaScript/Frontend):**
```javascript
const response = await fetch('http://localhost:5000/ai-agent/documents/process', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    file_id: '550e8400-e29b-41d4-a716-446655440000'
  })
});

const data = await response.json();
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

---

## User Chat Endpoints (AI Assistant)

These endpoints are for **users** to chat with documents that were uploaded by admins. Users do NOT need to upload documents.

### 1. Chat with All Documents

**Endpoint:** `POST /ai-agent/documents/chat`

**Description:** Ask questions about all processed documents. Searches across all admin-uploaded documents.

**Request:**
- Method: `POST`
- Content-Type: `application/json`
- Body:
```json
{
  "question": "What are the key points in all documents?",
  "session_id": "user-session-uuid",  // Optional: for conversation context
  "llm_name": "gemini"                 // Optional: defaults to gemini
}
```

**Example (JavaScript/Frontend):**
```javascript
// User chat - no document upload needed
const question = "What are the main topics discussed in the documents?";

const response = await fetch('http://localhost:5000/ai-agent/documents/chat', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    question: question,
    session_id: localStorage.getItem('chat_session_id') || null // Optional
  })
});

const data = await response.json();
console.log('Answer:', data.answer);
console.log('Files used:', data.files_used);
```

**Example (cURL):**
```bash
curl -X POST http://localhost:5000/ai-agent/documents/chat \
  -H "Content-Type: application/json" \
  -d '{
    "question": "Summarize all the key points",
    "session_id": "user-session-123"
  }'
```

**Response:**
```json
{
  "success": true,
  "session_id": "user-session-uuid",
  "message_id": "message-uuid",
  "answer": "Based on the documents, the key points are:\n\n1. Point one...\n2. Point two...",
  "response": "Based on the documents, the key points are:\n\n1. Point one...\n2. Point two...",
  "history": [
    {
      "id": "message-uuid",
      "file_ids": ["file-id-1", "file-id-2"],
      "session_id": "user-session-uuid",
      "question": "What are the key points?",
      "answer": "Based on the documents...",
      "used_chunk_ids": ["chunk-id-1", "chunk-id-2"],
      "timestamp": "2024-01-15T10:40:00.000Z"
    }
  ],
  "used_chunk_ids": ["chunk-id-1", "chunk-id-2"],
  "chunks_used": 15,
  "files_used": 2,
  "timestamp": "2024-01-15T10:40:00.000Z"
}
```

**Important Notes:**
- **No file_ids needed**: Omit `file_ids` to search ALL processed documents
- **Session Context**: Use `session_id` to maintain conversation context
- **Automatic Search**: The service automatically searches across all admin-uploaded documents

---

### 2. Chat with Specific Documents

**Endpoint:** `POST /ai-agent/documents/chat`

**Description:** Ask questions about specific documents (if you want to restrict to certain files).

**Request:**
- Method: `POST`
- Content-Type: `application/json`
- Body:
```json
{
  "question": "Compare these two documents",
  "file_ids": ["uuid1", "uuid2"],  // Optional: specific files
  "session_id": "user-session-uuid",  // Optional: for context
  "llm_name": "gemini"                 // Optional
}
```

**Example (JavaScript/Frontend):**
```javascript
// Chat with specific documents
const response = await fetch('http://localhost:5000/ai-agent/documents/chat', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    question: "What are the differences between document1 and document2?",
    file_ids: ["file-id-1", "file-id-2"], // Optional: omit to search all
    session_id: localStorage.getItem('chat_session_id')
  })
});

const data = await response.json();
console.log('Answer:', data.answer);
```

**Response:** Same as above

---

## Health Check

**Endpoint:** `GET /ai-agent/health`

**Description:** Check if the AI-Agent service is running.

**Example:**
```bash
curl http://localhost:5000/ai-agent/health
```

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

## Complete Frontend Integration Examples

### Admin Frontend (Document Upload)

```javascript
// Admin service for uploading documents
class AdminDocumentService {
  constructor(gatewayUrl = 'http://localhost:5000') {
    this.gatewayUrl = gatewayUrl;
  }

  async uploadDocument(file) {
    const formData = new FormData();
    formData.append('document', file);

    const response = await fetch(`${this.gatewayUrl}/ai-agent/documents/upload`, {
      method: 'POST',
      body: formData,
      headers: {
        'X-Service-Name': 'admin-frontend'
      }
    });

    if (!response.ok) {
      throw new Error('Upload failed');
    }

    return await response.json();
  }

  async getStatus(fileId) {
    const response = await fetch(`${this.gatewayUrl}/ai-agent/documents/status/${fileId}`);
    return await response.json();
  }

  async getAllDocuments() {
    const response = await fetch(`${this.gatewayUrl}/ai-agent/documents/documents`);
    return await response.json();
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
        throw new Error(`Processing failed: ${status.error_message}`);
      }

      await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
    }

    throw new Error('Processing timeout');
  }
}

// Usage in Admin Frontend
const adminService = new AdminDocumentService();

// Upload file
const handleFileUpload = async (file) => {
  try {
    const result = await adminService.uploadDocument(file);
    console.log('Uploaded:', result.file_id);

    // Wait for processing
    const processed = await adminService.waitForProcessing(result.file_id);
    console.log('Processing complete:', processed.chunks, 'chunks');
  } catch (error) {
    console.error('Error:', error.message);
  }
};
```

---

### User Frontend (Chat with Documents)

```javascript
// User service for chatting with documents
class UserChatService {
  constructor(gatewayUrl = 'http://localhost:5000') {
    this.gatewayUrl = gatewayUrl;
    this.sessionId = this.getOrCreateSessionId();
  }

  getOrCreateSessionId() {
    let sessionId = localStorage.getItem('chat_session_id');
    if (!sessionId) {
      sessionId = crypto.randomUUID();
      localStorage.setItem('chat_session_id', sessionId);
    }
    return sessionId;
  }

  async chat(question, fileIds = null) {
    const body = { question, session_id: this.sessionId };
    if (fileIds && fileIds.length > 0) {
      body.file_ids = fileIds;
    }

    const response = await fetch(`${this.gatewayUrl}/ai-agent/documents/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Chat failed');
    }

    return await response.json();
  }
}

// Usage in User Frontend
const chatService = new UserChatService();

// Chat with all documents
const handleUserQuestion = async (question) => {
  try {
    const result = await chatService.chat(question);
    console.log('Answer:', result.answer);
    console.log('Files used:', result.files_used);
    console.log('Chunks used:', result.chunks_used);
    return result;
  } catch (error) {
    console.error('Chat error:', error.message);
    throw error;
  }
};

// React Component Example
function ChatComponent() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSend = async () => {
    if (!input.trim()) return;

    // Add user message
    setMessages(prev => [...prev, { role: 'user', content: input }]);
    setLoading(true);

    try {
      const result = await chatService.chat(input);
      
      // Add AI response
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: result.answer,
        filesUsed: result.files_used,
        chunksUsed: result.chunks_used
      }]);
      
      setInput('');
    } catch (error) {
      setMessages(prev => [...prev, {
        role: 'error',
        content: error.message
      }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div className="messages">
        {messages.map((msg, idx) => (
          <div key={idx} className={msg.role}>
            {msg.content}
            {msg.filesUsed && (
              <small>Used {msg.filesUsed} files, {msg.chunksUsed} chunks</small>
            )}
          </div>
        ))}
      </div>
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyPress={(e) => e.key === 'Enter' && handleSend()}
        disabled={loading}
        placeholder="Ask a question about the documents..."
      />
      <button onClick={handleSend} disabled={loading || !input.trim()}>
        {loading ? 'Sending...' : 'Send'}
      </button>
    </div>
  );
}
```

---

## Error Responses

All endpoints return consistent error format:

**400 Bad Request:**
```json
{
  "success": false,
  "error": "Validation error message",
  "details": "Additional error details",
  "suggestion": "Helpful suggestion (if available)"
}
```

**404 Not Found:**
```json
{
  "success": false,
  "error": "File not found."
}
```

**502 Bad Gateway:**
```json
{
  "success": false,
  "error": "AI-Agent Service is unavailable",
  "message": "Error details"
}
```

**500 Internal Server Error:**
```json
{
  "success": false,
  "error": "Internal server error",
  "details": "Error details",
  "timestamp": "2024-01-15T10:40:00.000Z"
}
```

---

## Summary

### Admin Workflow
1. **Upload Document**: `POST /ai-agent/documents/upload`
2. **Check Status**: `GET /ai-agent/documents/status/:file_id` (poll until `processed`)
3. **List Documents**: `GET /ai-agent/documents/documents`

### User Workflow (No Upload Needed)
1. **Chat with Documents**: `POST /ai-agent/documents/chat`
   - Automatically searches ALL processed documents
   - Uses `session_id` for conversation context
   - No `file_ids` needed (searches all by default)

### Key Points
- ✅ **Gateway Base URL**: `http://localhost:5000/ai-agent/documents`
- ✅ **Admin uploads documents**: Users don't need to upload
- ✅ **Users chat with all documents**: No file selection needed
- ✅ **Session-based chat**: Maintains conversation context
- ✅ **Multi-file search**: Automatically searches across all documents
