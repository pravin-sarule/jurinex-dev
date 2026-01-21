# Admin Frontend API - Complete Summary

## Gateway Base URL

```
http://localhost:5000/ai-agent/documents
```

---

## All Admin Endpoints

### 1. Upload Document
```
POST http://localhost:5000/ai-agent/documents/upload
Content-Type: multipart/form-data
Body: { document: File }
```

### 2. Get All Documents ⭐
```
GET http://localhost:5000/ai-agent/documents/documents
```
**Returns ALL documents** (uploaded, processing, processed, error)

### 3. Get Single Document
```
GET http://localhost:5000/ai-agent/documents/:file_id
```

### 4. Get Processing Status
```
GET http://localhost:5000/ai-agent/documents/status/:file_id
```

### 5. Delete Document
```
DELETE http://localhost:5000/ai-agent/documents/:file_id
```

### 6. Retry Processing
```
POST http://localhost:5000/ai-agent/documents/process
Body: { file_id: "uuid" }
```

---

## Complete Admin Service (Copy-Paste Ready)

```javascript
// services/adminDocumentService.js
class AdminDocumentService {
  constructor(gatewayUrl = 'http://localhost:5000') {
    this.baseUrl = `${gatewayUrl}/ai-agent/documents`;
  }

  // 1. Upload Document
  async upload(file) {
    const formData = new FormData();
    formData.append('document', file);
    const res = await fetch(`${this.baseUrl}/upload`, {
      method: 'POST',
      body: formData
    });
    if (!res.ok) throw new Error((await res.json()).error);
    return res.json();
  }

  // 2. Get All Documents (ALL statuses)
  async getAll() {
    const res = await fetch(`${this.baseUrl}/documents`);
    if (!res.ok) throw new Error((await res.json()).error);
    return res.json();
  }

  // 3. Get Single Document
  async getOne(fileId) {
    const res = await fetch(`${this.baseUrl}/${fileId}`);
    if (!res.ok) throw new Error((await res.json()).error);
    return res.json();
  }

  // 4. Get Status
  async getStatus(fileId) {
    const res = await fetch(`${this.baseUrl}/status/${fileId}`);
    if (!res.ok) throw new Error((await res.json()).error);
    return res.json();
  }

  // 5. Delete Document
  async delete(fileId) {
    const res = await fetch(`${this.baseUrl}/${fileId}`, {
      method: 'DELETE'
    });
    if (!res.ok) throw new Error((await res.json()).error);
    return res.json();
  }

  // 6. Retry Processing
  async retry(fileId) {
    const res = await fetch(`${this.baseUrl}/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_id: fileId })
    });
    if (!res.ok) throw new Error((await res.json()).error);
    return res.json();
  }
}

export default AdminDocumentService;
```

---

## Usage Examples

### Upload Document
```javascript
const admin = new AdminDocumentService();

const file = document.querySelector('input[type="file"]').files[0];
const result = await admin.upload(file);
console.log('Uploaded:', result.file_id);
```

### Get All Documents
```javascript
const admin = new AdminDocumentService();

const result = await admin.getAll();
console.log('Total:', result.count);
console.log('Status breakdown:', result.status_counts);
console.log('All documents:', result.documents);

// Filter by status
const processed = result.documents.filter(d => d.status === 'processed');
const processing = result.documents.filter(d => d.status === 'processing');
const errors = result.documents.filter(d => d.status === 'error');
```

### Get Single Document
```javascript
const admin = new AdminDocumentService();

const result = await admin.getOne('file-id-here');
console.log('Document:', result.document);
console.log('Chunks:', result.document.chunks_count);
```

### Delete Document
```javascript
const admin = new AdminDocumentService();

const result = await admin.delete('file-id-here');
console.log('Deleted:', result.deleted);
// { document: 1, chunks: 150, vectors: 150, chats: 5 }
```

---

## Response Formats

### Get All Documents Response
```json
{
  "success": true,
  "documents": [
    {
      "id": "uuid",
      "originalname": "file.pdf",
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
    }
  ],
  "count": 10,
  "status_counts": {
    "uploaded": 1,
    "processing": 1,
    "batch_processing": 0,
    "processed": 8,
    "error": 0
  },
  "processed_count": 8,
  "processing_count": 1
}
```

---

## Quick Reference Table

| Action | Method | Endpoint | Description |
|--------|--------|----------|-------------|
| Upload | POST | `/upload` | Upload document |
| Get All | GET | `/documents` | Get ALL documents (all statuses) |
| Get One | GET | `/:file_id` | Get single document |
| Get Status | GET | `/status/:file_id` | Get processing status |
| Delete | DELETE | `/:file_id` | Delete document |
| Retry | POST | `/process` | Retry processing |

---

## Frontend Integration Checklist

- [ ] Set gateway URL: `http://localhost:5000`
- [ ] Use base path: `/ai-agent/documents`
- [ ] Implement upload with FormData
- [ ] Implement getAll to fetch all documents
- [ ] Implement getOne to fetch single document
- [ ] Implement delete with confirmation
- [ ] Handle all status types (uploaded, processing, processed, error)
- [ ] Display status breakdown from `status_counts`
- [ ] Show processing progress for each document
- [ ] Handle errors gracefully

---

See **[ADMIN_FRONTEND_API.md](./ADMIN_FRONTEND_API.md)** for detailed documentation.
