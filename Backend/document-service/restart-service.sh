#!/bin/bash

# Restart Document Service Script
# This script restarts the document-service to apply the embedding API changes

echo "🔄 Restarting Document Service..."
echo "================================"

# Find the document-service process
PID=$(ps aux | grep "node index.js" | grep document-service | grep -v grep | awk '{print $2}')

if [ -z "$PID" ]; then
    echo "❌ Document service is not running"
    echo "Starting document service..."
    cd /media/dell-2/d3aa004a-6211-442e-bc45-3e38dae3762b/home/admin3620/Desktop/JuriProduct_dev/jurinex-dev/Backend/document-service
    npm start &
    echo "✅ Document service started"
else
    echo "📍 Found document-service process: PID $PID"
    echo "🛑 Stopping process..."
    kill -9 $PID
    sleep 2
    
    echo "🚀 Starting document service..."
    cd /media/dell-2/d3aa004a-6211-442e-bc45-3e38dae3762b/home/admin3620/Desktop/JuriProduct_dev/jurinex-dev/Backend/document-service
    npm start &
    
    echo "✅ Document service restarted successfully"
fi

echo ""
echo "📋 Check the logs for:"
echo "   [EmbeddingService] Initialized with model: gemini-embedding-001"
echo "   [EmbeddingService] Output dimensionality: 768"
echo ""
echo "🧪 Test with:"
echo "   curl -X POST http://localhost:5002/api/documents/upload \\"
echo "     -H \"Authorization: Bearer YOUR_TOKEN\" \\"
echo "     -F \"document=@/path/to/test.pdf\""
