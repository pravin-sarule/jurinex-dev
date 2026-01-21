# Admin Frontend API Integration Guide

Complete API documentation for admin frontend integration with the AI-Agent service through the gateway.

## Base URL

```
http://localhost:5000/ai-agent/documents
```

All endpoints are accessed through the gateway service.

---

## Admin API Endpoints

### 1. Upload Document

**Endpoint:** `POST /ai-agent/documents/upload`

**Description:** Upload a document for processing. Processing happens asynchronously.

**Request:**
- Method: `POST`
- Content-Type: `multipart/form-data`
- Body:
  - `document` (file): PDF, DOCX, or image file

**Frontend Example:**
```javascript
const uploadDocument = async (file) => {
  const formData = new FormData();
  formData.append('document', file);

  const response = await fetch('http://localhost:5000/ai-agent/documents/upload', {
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
};

// Usage
const fileInput = document.querySelector('input[type="file"]');
fileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (file) {
    try {
      const result = await uploadDocument(file);
      console.log('Uploaded:', result.file_id);
      console.log('Status:', result.status);
    } catch (error) {
      console.error('Upload error:', error.message);
    }
  }
});
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

### 2. Get All Documents

**Endpoint:** `GET /ai-agent/documents/documents`

**Description:** Get a list of **ALL** documents (all statuses: uploaded, processing, processed, error). Returns complete document list for admin dashboard.

**Frontend Example:**
```javascript
const getAllDocuments = async () => {
  const response = await fetch('http://localhost:5000/ai-agent/documents/documents');

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch documents');
  }

  return await response.json();
};

// Usage
const result = await getAllDocuments();
console.log('Total documents:', result.count);
console.log('Status breakdown:', result.status_counts);
console.log('Processed:', result.processed_count);
console.log('Processing:', result.processing_count);
console.log('All documents:', result.documents);
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

**Key Features:**
- Returns **ALL** documents regardless of status
- Includes status breakdown in `status_counts`
- Shows processing progress for each document
- Includes chunks count for processed documents
- Sorted by creation date (newest first)

---

### 3. Get Single Document

**Endpoint:** `GET /ai-agent/documents/:file_id`

**Description:** Get detailed information about a specific document.

**Frontend Example:**
```javascript
const getDocument = async (fileId) => {
  const response = await fetch(`http://localhost:5000/ai-agent/documents/${fileId}`);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch document');
  }

  return await response.json();
};

// Usage
const document = await getDocument('550e8400-e29b-41d4-a716-446655440000');
console.log('Document:', document.document);
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

### 4. Get Processing Status

**Endpoint:** `GET /ai-agent/documents/status/:file_id`

**Description:** Check the processing status of a document.

**Frontend Example:**
```javascript
const getStatus = async (fileId) => {
  const response = await fetch(`http://localhost:5000/ai-agent/documents/status/${fileId}`);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to get status');
  }

  return await response.json();
};

// Usage - Poll for status
const checkStatus = async (fileId) => {
  const status = await getStatus(fileId);
  console.log('Status:', status.status);
  console.log('Progress:', status.processing_progress);
  console.log('Operation:', status.current_operation);
  return status;
};
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
  "summary": "Document summary...",
  "ready_for_chat": true
}
```

---

### 5. Delete Document

**Endpoint:** `DELETE /ai-agent/documents/:file_id`

**Description:** Delete a document and all associated data (chunks, vectors, chats).

**Frontend Example:**
```javascript
const deleteDocument = async (fileId) => {
  const response = await fetch(`http://localhost:5000/ai-agent/documents/${fileId}`, {
    method: 'DELETE'
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to delete document');
  }

  return await response.json();
};

// Usage with confirmation
const handleDelete = async (fileId, filename) => {
  if (!confirm(`Are you sure you want to delete "${filename}"?`)) {
    return;
  }

  try {
    const result = await deleteDocument(fileId);
    console.log('Deleted:', result.deleted);
    alert('Document deleted successfully!');
    // Refresh document list
    loadDocuments();
  } catch (error) {
    alert('Failed to delete: ' + error.message);
  }
};
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

---

### 6. Retry Processing

**Endpoint:** `POST /ai-agent/documents/process`

**Description:** Retry processing for a failed document.

**Frontend Example:**
```javascript
const retryProcessing = async (fileId) => {
  const response = await fetch('http://localhost:5000/ai-agent/documents/process', {
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
};
```

**Response:**
```json
{
  "success": true,
  "message": "Document processing initiated.",
  "file_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "processing"
}
```

---

## Complete Admin Service Class

```javascript
// services/adminDocumentService.js
class AdminDocumentService {
  constructor(gatewayUrl = 'http://localhost:5000') {
    this.baseUrl = `${gatewayUrl}/ai-agent/documents`;
  }

  /**
   * Upload a document
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
   * Get all documents
   */
  async getAllDocuments() {
    const response = await fetch(`${this.baseUrl}/documents`);

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to fetch documents');
    }

    return await response.json();
  }

  /**
   * Get a single document by ID
   */
  async getDocument(fileId) {
    const response = await fetch(`${this.baseUrl}/${fileId}`);

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to fetch document');
    }

    return await response.json();
  }

  /**
   * Get processing status
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
   * Delete a document
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

  /**
   * Retry processing
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
   * Wait for processing to complete
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
}

export default AdminDocumentService;
```

---

## React Component Example

```jsx
// components/DocumentManager.jsx
import React, { useState, useEffect } from 'react';
import AdminDocumentService from '../services/adminDocumentService';

const DocumentManager = () => {
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);

  const adminService = new AdminDocumentService();

  // Load all documents
  const loadDocuments = async () => {
    setLoading(true);
    try {
      const result = await adminService.getAllDocuments();
      setDocuments(result.documents);
    } catch (error) {
      console.error('Failed to load documents:', error);
      alert('Failed to load documents: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDocuments();
  }, []);

  // Handle file upload
  const handleUpload = async () => {
    if (!selectedFile) return;

    setUploading(true);
    try {
      const result = await adminService.uploadDocument(selectedFile);
      alert(`Document uploaded! File ID: ${result.file_id}`);
      setSelectedFile(null);
      
      // Refresh list
      await loadDocuments();
      
      // Optionally wait for processing
      // await adminService.waitForProcessing(result.file_id);
    } catch (error) {
      alert('Upload failed: ' + error.message);
    } finally {
      setUploading(false);
    }
  };

  // Handle delete
  const handleDelete = async (fileId, filename) => {
    if (!confirm(`Delete "${filename}"? This will delete all associated data.`)) {
      return;
    }

    try {
      const result = await adminService.deleteDocument(fileId);
      alert(`Deleted: ${result.deleted.chunks} chunks, ${result.deleted.vectors} vectors`);
      await loadDocuments();
    } catch (error) {
      alert('Delete failed: ' + error.message);
    }
  };

  // Handle retry processing
  const handleRetry = async (fileId) => {
    try {
      await adminService.retryProcessing(fileId);
      alert('Processing restarted');
      await loadDocuments();
    } catch (error) {
      alert('Retry failed: ' + error.message);
    }
  };

  return (
    <div className="document-manager">
      <h2>Document Management</h2>

      {/* Upload Section */}
      <div className="upload-section">
        <input
          type="file"
          accept=".pdf,.docx,.doc,image/*"
          onChange={(e) => setSelectedFile(e.target.files[0])}
          disabled={uploading}
        />
        <button onClick={handleUpload} disabled={uploading || !selectedFile}>
          {uploading ? 'Uploading...' : 'Upload Document'}
        </button>
      </div>

      {/* Documents List */}
      <div className="documents-list">
        <h3>Documents ({documents.length})</h3>
        
        {loading ? (
          <p>Loading...</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Filename</th>
                <th>Status</th>
                <th>Progress</th>
                <th>Chunks</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {documents.map((doc) => (
                <tr key={doc.id}>
                  <td>{doc.originalname}</td>
                  <td>
                    <span className={`status status-${doc.status}`}>
                      {doc.status}
                    </span>
                  </td>
                  <td>
                    {doc.processing_progress}%
                    {doc.status === 'processing' && (
                      <button onClick={() => adminService.getStatus(doc.id)}>
                        Refresh
                      </button>
                    )}
                  </td>
                  <td>{doc.chunks_count || 0}</td>
                  <td>{new Date(doc.created_at).toLocaleDateString()}</td>
                  <td>
                    <button onClick={() => adminService.getDocument(doc.id)}>
                      View
                    </button>
                    {doc.status === 'error' && (
                      <button onClick={() => handleRetry(doc.id)}>
                        Retry
                      </button>
                    )}
                    <button
                      onClick={() => handleDelete(doc.id, doc.originalname)}
                      className="delete-btn"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default DocumentManager;
```

---

## API Endpoints Summary

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/ai-agent/documents/upload` | Upload document |
| `GET` | `/ai-agent/documents/documents` | Get all documents |
| `GET` | `/ai-agent/documents/:file_id` | Get single document |
| `GET` | `/ai-agent/documents/status/:file_id` | Get processing status |
| `DELETE` | `/ai-agent/documents/:file_id` | Delete document |
| `POST` | `/ai-agent/documents/process` | Retry processing |

---

## Error Handling

All endpoints return consistent error format:

```json
{
  "success": false,
  "error": "Error message",
  "details": "Additional details"
}
```

**Example Error Handling:**
```javascript
try {
  const result = await adminService.uploadDocument(file);
} catch (error) {
  if (error.message.includes('No file')) {
    // Handle no file error
  } else if (error.message.includes('unavailable')) {
    // Handle service unavailable
  } else {
    // Handle generic error
  }
}
```

---

## Environment Configuration

Set the gateway URL in your frontend:

```env
REACT_APP_GATEWAY_URL=http://localhost:5000
```

Then use in your service:

```javascript
const GATEWAY_URL = process.env.REACT_APP_GATEWAY_URL || 'http://localhost:5000';
const adminService = new AdminDocumentService(GATEWAY_URL);
```

---

## Complete Workflow Example

```javascript
// Complete admin workflow
const adminWorkflow = async () => {
  const adminService = new AdminDocumentService('http://localhost:5000');

  // 1. Upload document
  const file = document.querySelector('input[type="file"]').files[0];
  const uploadResult = await adminService.uploadDocument(file);
  console.log('Uploaded:', uploadResult.file_id);

  // 2. Wait for processing (optional)
  const processed = await adminService.waitForProcessing(uploadResult.file_id);
  console.log('Processing complete:', processed.chunks, 'chunks');

  // 3. Get all documents
  const allDocs = await adminService.getAllDocuments();
  console.log('Total documents:', allDocs.count);

  // 4. Get specific document
  const doc = await adminService.getDocument(uploadResult.file_id);
  console.log('Document details:', doc.document);

  // 5. Delete document (if needed)
  // const deleted = await adminService.deleteDocument(uploadResult.file_id);
  // console.log('Deleted:', deleted.deleted);
};
```

---

## Quick Reference

**Base URL:** `http://localhost:5000/ai-agent/documents`

**All Routes:**
- `POST /upload` - Upload document
- `GET /documents` - List all documents
- `GET /:file_id` - Get single document
- `GET /status/:file_id` - Get status
- `DELETE /:file_id` - Delete document
- `POST /process` - Retry processing
