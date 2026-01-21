# Quick Start Guide - AI-Agent Service

## For Service Integrators

If you're integrating this service from another backend service, follow these steps:

### 1. Base URL Configuration

Set the AI-Agent service URL in your service's environment:

```env
AI_AGENT_BASE_URL=http://localhost:3001  # or your production URL
```

### 2. Install HTTP Client (if needed)

If using Node.js:
```bash
npm install axios form-data
```

### 3. Basic Usage

#### Upload and Process a Document

```javascript
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');

async function uploadAndProcess(filePath) {
  // Upload
  const formData = new FormData();
  formData.append('document', fs.createReadStream(filePath));
  
  const uploadRes = await axios.post(
    `${process.env.AI_AGENT_BASE_URL}/api/documents/upload`,
    formData,
    { headers: formData.getHeaders() }
  );
  
  const fileId = uploadRes.data.file_id;
  console.log('File ID:', fileId);
  
  // Poll for status
  let status;
  do {
    await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5s
    const statusRes = await axios.get(
      `${process.env.AI_AGENT_BASE_URL}/api/documents/status/${fileId}`
    );
    status = statusRes.data;
    console.log(`Status: ${status.status} (${status.processing_progress}%)`);
  } while (status.status === 'processing' || status.status === 'batch_processing');
  
  if (status.status === 'processed') {
    console.log('✅ Ready for chat!');
    return fileId;
  } else {
    throw new Error('Processing failed');
  }
}
```

#### Chat with Documents

```javascript
async function askQuestion(question, fileIds = null) {
  const response = await axios.post(
    `${process.env.AI_AGENT_BASE_URL}/api/documents/chat`,
    {
      question: question,
      file_ids: fileIds,  // null = search all documents
      llm_name: 'gemini'  // optional
    }
  );
  
  return response.data.answer;
}

// Example usage
const answer = await askQuestion("What are the main points?", [fileId1, fileId2]);
console.log('Answer:', answer);
```

## Endpoint Summary

| Endpoint | Method | Purpose | Response Time |
|----------|--------|---------|---------------|
| `/api/documents/upload` | POST | Upload & start processing | Immediate (202) |
| `/api/documents/status/:file_id` | GET | Check processing status | Immediate |
| `/api/documents/chat` | POST | Ask questions | 2-10 seconds |
| `/api/documents/documents` | GET | List all documents | Immediate |
| `/api/documents/process` | POST | Retry processing | Immediate (202) |
| `/health` | GET | Health check | Immediate |

## Response Format

All endpoints return JSON with:
```json
{
  "success": true/false,
  "data": {...},      // Success data
  "error": "...",     // Error message (if failed)
  "details": "..."    // Additional error details
}
```

## Error Codes

- `400`: Bad Request (validation errors)
- `404`: Not Found (file not found)
- `500`: Internal Server Error
- `202`: Accepted (async processing started)

## Production Considerations

1. **Network Security**: Place service behind firewall/VPC
2. **Rate Limiting**: Implement rate limiting per service
3. **Monitoring**: Monitor `/health` endpoint
4. **Error Handling**: Always handle async processing failures
5. **Timeout**: Set appropriate timeouts for HTTP requests

For complete API documentation, see [API_INTEGRATION.md](./API_INTEGRATION.md)
