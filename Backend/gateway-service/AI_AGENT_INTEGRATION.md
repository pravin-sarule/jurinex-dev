# AI-Agent Service Integration with Gateway

This document describes how the AI-Agent service is integrated with the gateway-service.

## Overview

The AI-Agent service is accessible through the gateway-service at the following base path:

```
http://gateway-service-url/ai-agent/documents
```

## Gateway Route Configuration

### Route Pattern
- **Gateway Path**: `/ai-agent/documents/*`
- **Target Service**: `http://localhost:3001/api/documents/*`
- **Proxy File**: `src/routes/aiAgentProxy.js`

### Environment Variable

Add the following to your `.env` file:

```env
AI_AGENT_SERVICE_URL=http://localhost:3001
```

If not set, defaults to `http://localhost:3001`.

## API Endpoints Through Gateway

### Base URL
```
http://localhost:5000/ai-agent/documents
```

### Available Endpoints

1. **Upload Document**
   ```
   POST /ai-agent/documents/upload
   ```

2. **Get Processing Status**
   ```
   GET /ai-agent/documents/status/:file_id
   ```

3. **Chat with Documents**
   ```
   POST /ai-agent/documents/chat
   ```

4. **Get All Documents**
   ```
   GET /ai-agent/documents/documents
   ```

5. **Process Existing Document**
   ```
   POST /ai-agent/documents/process
   ```

6. **Health Check**
   ```
   GET /ai-agent/health
   ```

## Example Usage

### Upload Document via Gateway

```javascript
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');

const GATEWAY_URL = 'http://localhost:5000'; // Gateway URL

async function uploadViaGateway(filePath) {
  const formData = new FormData();
  formData.append('document', fs.createReadStream(filePath));
  
  const response = await axios.post(
    `${GATEWAY_URL}/ai-agent/documents/upload`,
    formData,
    {
      headers: {
        ...formData.getHeaders(),
        'X-Service-Name': 'admin-service' // Optional: identify calling service
      },
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    }
  );
  
  return response.data;
}
```

### Chat with Documents via Gateway

```javascript
async function chatViaGateway(question, fileIds = null) {
  const response = await axios.post(
    `${GATEWAY_URL}/ai-agent/documents/chat`,
    {
      question: question,
      file_ids: fileIds, // Optional: omit to search all documents
      llm_name: 'gemini' // Optional
    },
    {
      headers: {
        'Content-Type': 'application/json',
        'X-Service-Name': 'admin-service' // Optional
      }
    }
  );
  
  return response.data;
}
```

### Check Status via Gateway

```javascript
async function checkStatusViaGateway(fileId) {
  const response = await axios.get(
    `${GATEWAY_URL}/ai-agent/documents/status/${fileId}`
  );
  
  return response.data;
}
```

## Key Features

### 1. No Authentication Required
The AI-Agent proxy does **NOT** require authentication middleware, as it's designed for backend-to-backend communication. This is different from other proxies like `chatProxy` which require JWT authentication.

### 2. Service Name Tracking
The gateway forwards the `X-Service-Name` header to track which service is making the request. This is useful for logging and monitoring.

### 3. Extended Timeout
The proxy has a **5-minute timeout** (300000ms) to accommodate long-running document processing operations.

### 4. Error Handling
If the AI-Agent service is unavailable, the gateway returns a 502 Bad Gateway error with details.

## Direct vs Gateway Access

### Direct Access (Development/Internal)
```
http://localhost:3001/api/documents/upload
```

### Through Gateway (Production/Recommended)
```
http://gateway-url/ai-agent/documents/upload
```

## Benefits of Gateway Access

1. **Single Entry Point**: All services accessed through one URL
2. **Request Logging**: Centralized logging of all requests
3. **Load Balancing**: Can add load balancing in the future
4. **Service Discovery**: Easier to manage service URLs
5. **Monitoring**: Centralized monitoring and health checks

## Configuration

### Gateway Configuration
The AI-Agent proxy is mounted in `src/app.js`:

```javascript
const aiAgentProxy = require("./routes/aiAgentProxy");
app.use(aiAgentProxy); // AI-Agent Service proxy
```

### AI-Agent Service
The AI-Agent service should be running on:
- **Port**: 3001 (default)
- **URL**: Set via `AI_AGENT_SERVICE_URL` environment variable

## Testing

### Test via Gateway

```bash
# Health check
curl http://localhost:5000/ai-agent/health

# Upload document
curl -X POST http://localhost:5000/ai-agent/documents/upload \
  -F "document=@/path/to/file.pdf"

# Chat
curl -X POST http://localhost:5000/ai-agent/documents/chat \
  -H "Content-Type: application/json" \
  -d '{"question": "Summarize all documents"}'
```

## Troubleshooting

### Service Unavailable (502)
- Check if AI-Agent service is running on port 3001
- Verify `AI_AGENT_SERVICE_URL` in gateway `.env`
- Check AI-Agent service logs

### Timeout Errors
- Document processing can take 1-5 minutes for large files
- Gateway timeout is set to 5 minutes
- Consider polling status endpoint instead of waiting

### Path Not Found (404)
- Ensure gateway path starts with `/ai-agent/documents`
- Verify proxy is mounted in `app.js`
