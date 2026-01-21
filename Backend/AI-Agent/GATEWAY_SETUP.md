# Gateway Service Integration - Quick Setup

## ✅ Integration Complete

The AI-Agent service is now integrated with the gateway-service. All requests should go through the gateway.

## Gateway Configuration

### Environment Variable

Add to `Backend/gateway-service/.env`:

```env
AI_AGENT_SERVICE_URL=http://localhost:3001
```

### Gateway Routes

- **Base Path**: `/ai-agent/documents`
- **Health Check**: `/ai-agent/health`
- **Target Service**: `http://localhost:3001/api/documents`

## Usage

### Via Gateway (Recommended)

```javascript
const GATEWAY_URL = 'http://localhost:5000'; // Gateway URL

// Upload document
POST ${GATEWAY_URL}/ai-agent/documents/upload

// Check status
GET ${GATEWAY_URL}/ai-agent/documents/status/:file_id

// Chat with documents
POST ${GATEWAY_URL}/ai-agent/documents/chat

// Get all documents
GET ${GATEWAY_URL}/ai-agent/documents/documents

// Process existing document
POST ${GATEWAY_URL}/ai-agent/documents/process

// Health check
GET ${GATEWAY_URL}/ai-agent/health
```

### Direct Access (Development Only)

```javascript
const AI_AGENT_URL = 'http://localhost:3001'; // Direct AI-Agent URL

// Use /api/documents prefix
POST ${AI_AGENT_URL}/api/documents/upload
```

## Example: Upload via Gateway

```javascript
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:5000';

async function uploadDocument(filePath) {
  const formData = new FormData();
  formData.append('document', fs.createReadStream(filePath));
  
  const response = await axios.post(
    `${GATEWAY_URL}/ai-agent/documents/upload`,
    formData,
    {
      headers: {
        ...formData.getHeaders(),
        'X-Service-Name': 'admin-service' // Optional
      },
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    }
  );
  
  return response.data;
}
```

## Features

- ✅ **No Authentication Required**: Backend-to-backend communication
- ✅ **Service Tracking**: X-Service-Name header forwarded
- ✅ **Extended Timeout**: 5 minutes for document processing
- ✅ **Error Handling**: Proper 502 responses if service unavailable
- ✅ **Health Check**: Available at `/ai-agent/health`

## Files Created/Modified

1. ✅ `Backend/gateway-service/src/routes/aiAgentProxy.js` - Proxy route
2. ✅ `Backend/gateway-service/src/app.js` - Mounted proxy
3. ✅ `Backend/gateway-service/AI_AGENT_INTEGRATION.md` - Detailed docs

## Testing

```bash
# Test health check via gateway
curl http://localhost:5000/ai-agent/health

# Test upload via gateway
curl -X POST http://localhost:5000/ai-agent/documents/upload \
  -F "document=@/path/to/file.pdf"

# Test chat via gateway
curl -X POST http://localhost:5000/ai-agent/documents/chat \
  -H "Content-Type: application/json" \
  -d '{"question": "Summarize all documents"}'
```

## Next Steps

1. **Add Environment Variable**: Add `AI_AGENT_SERVICE_URL` to gateway `.env`
2. **Restart Gateway**: Restart gateway-service to load new proxy
3. **Update Other Services**: Update other services to use gateway URL instead of direct AI-Agent URL

## Benefits

- ✅ Single entry point for all services
- ✅ Centralized logging and monitoring
- ✅ Easier service discovery
- ✅ Better error handling
- ✅ Can add load balancing in future
