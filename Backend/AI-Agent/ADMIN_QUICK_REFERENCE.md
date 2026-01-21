# Admin Frontend - Quick Reference

## Gateway Base URL

```
http://localhost:5000/ai-agent/documents
```

---

## All Admin Endpoints

### 1. Upload Document
```javascript
POST http://localhost:5000/ai-agent/documents/upload
Content-Type: multipart/form-data
Body: { document: File }
```

### 2. Get All Documents
```javascript
GET http://localhost:5000/ai-agent/documents/documents
```

### 3. Get Single Document
```javascript
GET http://localhost:5000/ai-agent/documents/:file_id
```

### 4. Get Processing Status
```javascript
GET http://localhost:5000/ai-agent/documents/status/:file_id
```

### 5. Delete Document
```javascript
DELETE http://localhost:5000/ai-agent/documents/:file_id
```

### 6. Retry Processing
```javascript
POST http://localhost:5000/ai-agent/documents/process
Body: { file_id: "uuid" }
```

---

## Quick Copy-Paste Code

### Upload Document
```javascript
const formData = new FormData();
formData.append('document', file);

fetch('http://localhost:5000/ai-agent/documents/upload', {
  method: 'POST',
  body: formData
})
  .then(res => res.json())
  .then(data => console.log('Uploaded:', data.file_id));
```

### Get All Documents
```javascript
fetch('http://localhost:5000/ai-agent/documents/documents')
  .then(res => res.json())
  .then(data => console.log('Documents:', data.documents));
```

### Get Single Document
```javascript
fetch(`http://localhost:5000/ai-agent/documents/${fileId}`)
  .then(res => res.json())
  .then(data => console.log('Document:', data.document));
```

### Delete Document
```javascript
fetch(`http://localhost:5000/ai-agent/documents/${fileId}`, {
  method: 'DELETE'
})
  .then(res => res.json())
  .then(data => console.log('Deleted:', data.deleted));
```

---

## Complete Admin Service

```javascript
class AdminDocumentService {
  constructor() {
    this.baseUrl = 'http://localhost:5000/ai-agent/documents';
  }

  async upload(file) {
    const formData = new FormData();
    formData.append('document', file);
    const res = await fetch(`${this.baseUrl}/upload`, {
      method: 'POST',
      body: formData
    });
    return res.json();
  }

  async getAll() {
    const res = await fetch(`${this.baseUrl}/documents`);
    return res.json();
  }

  async getOne(fileId) {
    const res = await fetch(`${this.baseUrl}/${fileId}`);
    return res.json();
  }

  async getStatus(fileId) {
    const res = await fetch(`${this.baseUrl}/status/${fileId}`);
    return res.json();
  }

  async delete(fileId) {
    const res = await fetch(`${this.baseUrl}/${fileId}`, {
      method: 'DELETE'
    });
    return res.json();
  }

  async retry(fileId) {
    const res = await fetch(`${this.baseUrl}/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_id: fileId })
    });
    return res.json();
  }
}
```

---

See **[ADMIN_FRONTEND_API.md](./ADMIN_FRONTEND_API.md)** for complete documentation.
