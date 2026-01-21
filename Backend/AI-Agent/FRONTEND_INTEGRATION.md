# Frontend Integration Guide - AI-Agent Service

This guide shows how to integrate the AI-Agent service into your frontend applications.

## Base URL

```
http://localhost:5000/ai-agent/documents
```

All requests go through the gateway service.

---

## Two User Roles

### 1. Admin (Document Management)
- Upload documents
- Check processing status
- View all documents
- Retry failed processing

### 2. User (Chat with Documents)
- Chat with all uploaded documents
- No document upload needed
- Conversation-based chat

---

## Admin Frontend Integration

### Installation

```bash
# No additional packages needed - uses native Fetch API
```

### Admin Service Class

```javascript
// services/adminDocumentService.js
class AdminDocumentService {
  constructor(baseUrl = 'http://localhost:5000') {
    this.baseUrl = `${baseUrl}/ai-agent/documents`;
  }

  /**
   * Upload a document
   * @param {File} file - File to upload
   * @returns {Promise<Object>} Upload result with file_id
   */
  async uploadDocument(file) {
    const formData = new FormData();
    formData.append('document', file);

    const response = await fetch(`${this.baseUrl}/upload`, {
      method: 'POST',
      body: formData,
      headers: {
        'X-Service-Name': 'admin-frontend'
      }
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Upload failed');
    }

    return await response.json();
  }

  /**
   * Get processing status
   * @param {string} fileId - Document UUID
   * @returns {Promise<Object>} Status information
   */
  async getStatus(fileId) {
    const response = await fetch(`${this.baseUrl}/status/${fileId}`);

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to get status');
    }

    return await response.json();
  }

  /**
   * Get all documents
   * @returns {Promise<Object>} List of all documents
   */
  async getAllDocuments() {
    const response = await fetch(`${this.baseUrl}/documents`);

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to get documents');
    }

    return await response.json();
  }

  /**
   * Get a single document by ID
   * @param {string} fileId - Document UUID
   * @returns {Promise<Object>} Document details
   */
  async getDocument(fileId) {
    const response = await fetch(`${this.baseUrl}/${fileId}`);

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to get document');
    }

    return await response.json();
  }

  /**
   * Wait for document processing to complete
   * @param {string} fileId - Document UUID
   * @param {number} maxWaitSeconds - Maximum wait time (default: 300)
   * @param {number} pollIntervalSeconds - Poll interval (default: 5)
   * @returns {Promise<Object>} Final status
   */
  async waitForProcessing(fileId, maxWaitSeconds = 300, pollIntervalSeconds = 5) {
    const startTime = Date.now();
    const maxWait = maxWaitSeconds * 1000;

    while (Date.now() - startTime < maxWait) {
      const status = await this.getStatus(fileId);

      if (status.status === 'processed') {
        return status;
      }

      if (status.status === 'error') {
        throw new Error(`Processing failed: ${status.error_message || status.current_operation}`);
      }

      await new Promise(resolve => setTimeout(resolve, pollIntervalSeconds * 1000));
    }

    throw new Error('Processing timeout');
  }

  /**
   * Retry processing for a document
   * @param {string} fileId - Document UUID
   * @returns {Promise<Object>} Processing initiation result
   */
  async retryProcessing(fileId) {
    const response = await fetch(`${this.baseUrl}/process`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ file_id: fileId })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to retry processing');
    }

    return await response.json();
  }

  /**
   * Delete a document and all associated data
   * @param {string} fileId - Document UUID
   * @returns {Promise<Object>} Deletion result
   */
  async deleteDocument(fileId) {
    const response = await fetch(`${this.baseUrl}/${fileId}`, {
      method: 'DELETE'
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to delete document');
    }

    return await response.json();
  }
}

export default AdminDocumentService;
```

### React Component Example (Admin)

```jsx
// components/DocumentUploader.jsx
import React, { useState } from 'react';
import AdminDocumentService from '../services/adminDocumentService';

const DocumentUploader = () => {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);

  const adminService = new AdminDocumentService();

  const handleFileChange = (e) => {
    setFile(e.target.files[0]);
  };

  const handleUpload = async () => {
    if (!file) return;

    setUploading(true);
    setUploadStatus(null);
    setProcessing(false);
    setProgress(0);

    try {
      // Upload document
      const uploadResult = await adminService.uploadDocument(file);
      setUploadStatus({
        fileId: uploadResult.file_id,
        status: 'uploaded',
        message: 'Document uploaded, processing started...'
      });

      // Wait for processing
      setProcessing(true);
      const processed = await adminService.waitForProcessing(uploadResult.file_id);

      setUploadStatus({
        ...uploadResult,
        status: 'processed',
        message: 'Processing complete!',
        chunks: processed.chunks
      });
      setProgress(100);

    } catch (error) {
      setUploadStatus({
        status: 'error',
        message: error.message
      });
    } finally {
      setUploading(false);
      setProcessing(false);
    }
  };

  return (
    <div className="document-uploader">
      <h2>Upload Document</h2>
      
      <input
        type="file"
        accept=".pdf,.docx,.doc,image/*"
        onChange={handleFileChange}
        disabled={uploading || processing}
      />

      {file && (
        <div>
          <p>Selected: {file.name}</p>
          <button
            onClick={handleUpload}
            disabled={uploading || processing}
          >
            {uploading ? 'Uploading...' : processing ? 'Processing...' : 'Upload'}
          </button>
        </div>
      )}

      {uploadStatus && (
        <div className={`status status-${uploadStatus.status}`}>
          <p>{uploadStatus.message}</p>
          {uploadStatus.status === 'processing' && (
            <div>
              <progress value={progress} max={100} />
              <p>{progress}%</p>
            </div>
          )}
          {uploadStatus.chunks && (
            <p>Processed {uploadStatus.chunks} chunks</p>
          )}
        </div>
      )}
    </div>
  );
};

export default DocumentUploader;
```

---

## User Frontend Integration (Chat)

### User Chat Service Class

```javascript
// services/userChatService.js
class UserChatService {
  constructor(baseUrl = 'http://localhost:5000') {
    this.baseUrl = `${baseUrl}/ai-agent/documents`;
    this.sessionId = this.getOrCreateSessionId();
  }

  /**
   * Get or create session ID for conversation context
   * @returns {string} Session UUID
   */
  getOrCreateSessionId() {
    let sessionId = localStorage.getItem('chat_session_id');
    if (!sessionId) {
      sessionId = crypto.randomUUID();
      localStorage.setItem('chat_session_id', sessionId);
    }
    return sessionId;
  }

  /**
   * Chat with all documents
   * @param {string} question - User question
   * @param {string[]} fileIds - Optional: specific file IDs, null = all documents
   * @returns {Promise<Object>} Chat response
   */
  async chat(question, fileIds = null) {
    const body = {
      question: question.trim(),
      session_id: this.sessionId
    };

    // Only add file_ids if specified
    if (fileIds && Array.isArray(fileIds) && fileIds.length > 0) {
      body.file_ids = fileIds;
    }

    const response = await fetch(`${this.baseUrl}/chat`, {
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

  /**
   * Reset conversation session
   */
  resetSession() {
    localStorage.removeItem('chat_session_id');
    this.sessionId = this.getOrCreateSessionId();
  }
}

export default UserChatService;
```

### React Component Example (User Chat)

```jsx
// components/ChatInterface.jsx
import React, { useState, useRef, useEffect } from 'react';
import UserChatService from '../services/userChatService';

const ChatInterface = () => {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef(null);

  const chatService = new UserChatService();

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || loading) return;

    const question = input.trim();
    setInput('');

    // Add user message
    const userMessage = {
      id: Date.now(),
      role: 'user',
      content: question,
      timestamp: new Date().toISOString()
    };
    setMessages(prev => [...prev, userMessage]);
    setLoading(true);

    try {
      // Get AI response
      const result = await chatService.chat(question);

      // Add AI response
      const aiMessage = {
        id: result.message_id,
        role: 'assistant',
        content: result.answer,
        filesUsed: result.files_used,
        chunksUsed: result.chunks_used,
        timestamp: result.timestamp
      };
      setMessages(prev => [...prev, aiMessage]);

    } catch (error) {
      // Add error message
      const errorMessage = {
        id: Date.now(),
        role: 'error',
        content: error.message,
        timestamp: new Date().toISOString()
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="chat-interface">
      <div className="chat-header">
        <h2>AI Assistant</h2>
        <p>Ask questions about uploaded documents</p>
      </div>

      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="empty-state">
            <p>👋 Hello! I can answer questions about the uploaded documents.</p>
            <p>Try asking:</p>
            <ul>
              <li>"What are the key points?"</li>
              <li>"Summarize the documents"</li>
              <li>"What are the main topics?"</li>
            </ul>
          </div>
        )}

        {messages.map((message) => (
          <div key={message.id} className={`message message-${message.role}`}>
            <div className="message-content">
              {message.role === 'user' && <strong>You:</strong>}
              {message.role === 'assistant' && <strong>AI:</strong>}
              {message.role === 'error' && <strong>Error:</strong>}
              <p>{message.content}</p>
            </div>
            {message.filesUsed && (
              <small className="message-meta">
                Used {message.filesUsed} files, {message.chunksUsed} chunks
              </small>
            )}
            <small className="message-time">
              {new Date(message.timestamp).toLocaleTimeString()}
            </small>
          </div>
        ))}

        {loading && (
          <div className="message message-loading">
            <div className="typing-indicator">
              <span></span>
              <span></span>
              <span></span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className="chat-input">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder="Ask a question about the documents..."
          rows={3}
          disabled={loading}
        />
        <button
          onClick={handleSend}
          disabled={loading || !input.trim()}
        >
          {loading ? 'Sending...' : 'Send'}
        </button>
      </div>
    </div>
  );
};

export default ChatInterface;
```

---

## Complete Example Setup

### Project Structure

```
frontend/
├── src/
│   ├── services/
│   │   ├── adminDocumentService.js
│   │   └── userChatService.js
│   ├── components/
│   │   ├── DocumentUploader.jsx
│   │   └── ChatInterface.jsx
│   └── App.jsx
```

### App.jsx Example

```jsx
// App.jsx
import React from 'react';
import DocumentUploader from './components/DocumentUploader';
import ChatInterface from './components/ChatInterface';

function App() {
  const [isAdmin, setIsAdmin] = useState(false);

  return (
    <div className="app">
      <nav>
        <button onClick={() => setIsAdmin(!isAdmin)}>
          {isAdmin ? 'Switch to User Mode' : 'Switch to Admin Mode'}
        </button>
      </nav>

      <main>
        {isAdmin ? (
          <DocumentUploader />
        ) : (
          <ChatInterface />
        )}
      </main>
    </div>
  );
}

export default App;
```

---

## Environment Variables

Create a `.env` file in your frontend project:

```env
REACT_APP_GATEWAY_URL=http://localhost:5000
```

Then use in your services:

```javascript
const baseUrl = process.env.REACT_APP_GATEWAY_URL || 'http://localhost:5000';
```

---

## Error Handling

```javascript
try {
  const result = await chatService.chat(question);
  // Handle success
} catch (error) {
  if (error.message.includes('No processed documents')) {
    // Show message: "No documents available yet"
  } else if (error.message.includes('unavailable')) {
    // Show message: "Service temporarily unavailable"
  } else {
    // Show generic error
  }
}
```

---

## Key Points for Frontend Developers

1. ✅ **Gateway URL**: Always use `http://localhost:5000/ai-agent/documents`
2. ✅ **Admin Uploads**: Only admins upload documents
3. ✅ **Users Chat**: Users only chat, no upload needed
4. ✅ **Session Management**: Use `localStorage` for session ID
5. ✅ **No Authentication**: Service is public (gateway-level security)
6. ✅ **Multi-file Search**: Automatically searches all documents
7. ✅ **Polling**: Use `waitForProcessing` for upload status
8. ✅ **Error Handling**: Always handle errors gracefully

---

## Testing

### Test Admin Upload

```javascript
const adminService = new AdminDocumentService();
const file = document.querySelector('input[type="file"]').files[0];

const result = await adminService.uploadDocument(file);
console.log('Uploaded:', result.file_id);
```

### Test User Chat

```javascript
const chatService = new UserChatService();

const result = await chatService.chat("What are the main topics?");
console.log('Answer:', result.answer);
console.log('Files:', result.files_used);
```

---

For more details, see [API_ENDPOINTS.md](./API_ENDPOINTS.md)
