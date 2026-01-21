# Admin Frontend - Complete API Routes

## Gateway Base URL

```
http://localhost:5000/ai-agent/documents
```

---

## All Admin Routes

### 1. Upload Document
```
POST http://localhost:5000/ai-agent/documents/upload
```

**Request:**
- Method: `POST`
- Content-Type: `multipart/form-data`
- Body: `document` (file)

**Response:**
```json
{
  "success": true,
  "file_id": "uuid",
  "status": "processing"
}
```

---

### 2. Get All Documents
```
GET http://localhost:5000/ai-agent/documents/documents
```

**Description:** Returns **ALL** documents (all statuses: uploaded, processing, processed, error)

**Response:**
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
      "chunks_count": 150,
      "ready_for_chat": true,
      ...
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

### 3. Get Single Document
```
GET http://localhost:5000/ai-agent/documents/:file_id
```

**Response:**
```json
{
  "success": true,
  "document": {
    "id": "uuid",
    "originalname": "file.pdf",
    "status": "processed",
    "chunks_count": 150,
    "summary": "...",
    ...
  }
}
```

---

### 4. Get Processing Status
```
GET http://localhost:5000/ai-agent/documents/status/:file_id
```

**Response:**
```json
{
  "success": true,
  "status": "processing",
  "processing_progress": 65.5,
  "current_operation": "..."
}
```

---

### 5. Delete Document
```
DELETE http://localhost:5000/ai-agent/documents/:file_id
```

**Response:**
```json
{
  "success": true,
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
```
POST http://localhost:5000/ai-agent/documents/process
```

**Request:**
```json
{
  "file_id": "uuid"
}
```

**Response:**
```json
{
  "success": true,
  "status": "processing"
}
```

---

## Frontend Integration

### Complete Admin Service

```javascript
const GATEWAY_URL = 'http://localhost:5000';
const BASE_URL = `${GATEWAY_URL}/ai-agent/documents`;

// Upload
const uploadDocument = async (file) => {
  const formData = new FormData();
  formData.append('document', file);
  
  const res = await fetch(`${BASE_URL}/upload`, {
    method: 'POST',
    body: formData
  });
  return res.json();
};

// Get All
const getAllDocuments = async () => {
  const res = await fetch(`${BASE_URL}/documents`);
  return res.json();
};

// Get One
const getDocument = async (fileId) => {
  const res = await fetch(`${BASE_URL}/${fileId}`);
  return res.json();
};

// Get Status
const getStatus = async (fileId) => {
  const res = await fetch(`${BASE_URL}/status/${fileId}`);
  return res.json();
};

// Delete
const deleteDocument = async (fileId) => {
  const res = await fetch(`${BASE_URL}/${fileId}`, {
    method: 'DELETE'
  });
  return res.json();
};

// Retry
const retryProcessing = async (fileId) => {
  const res = await fetch(`${BASE_URL}/process`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file_id: fileId })
  });
  return res.json();
};
```

---

## Usage Example

```javascript
// 1. Upload
const uploadResult = await uploadDocument(file);
console.log('File ID:', uploadResult.file_id);

// 2. Get All
const allDocs = await getAllDocuments();
console.log('Total:', allDocs.count);

// 3. Get One
const doc = await getDocument(uploadResult.file_id);
console.log('Document:', doc.document);

// 4. Check Status
const status = await getStatus(uploadResult.file_id);
console.log('Status:', status.status);

// 5. Delete
const deleted = await deleteDocument(uploadResult.file_id);
console.log('Deleted:', deleted.deleted);

// 6. Retry (if failed)
await retryProcessing(uploadResult.file_id);
```

---

See **[ADMIN_FRONTEND_API.md](./ADMIN_FRONTEND_API.md)** for detailed documentation.
