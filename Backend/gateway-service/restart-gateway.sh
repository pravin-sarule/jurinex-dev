#!/bin/bash

# Script to restart the Gateway Service
# This ensures the latest code changes are loaded

echo "🔄 Restarting Gateway Service..."

# Find and kill the gateway process
GATEWAY_PID=$(lsof -ti :5000 2>/dev/null || netstat -tlnp 2>/dev/null | grep :5000 | awk '{print $7}' | cut -d'/' -f1 | head -1)

if [ -n "$GATEWAY_PID" ]; then
  echo "📌 Found gateway process: $GATEWAY_PID"
  echo "🛑 Stopping gateway service..."
  kill $GATEWAY_PID
  sleep 2
  
  # Force kill if still running
  if kill -0 $GATEWAY_PID 2>/dev/null; then
    echo "⚠️  Process still running, force killing..."
    kill -9 $GATEWAY_PID
    sleep 1
  fi
  echo "✅ Gateway service stopped"
else
  echo "ℹ️  No gateway process found on port 5000"
fi

# Wait a moment
sleep 1

# Start the gateway service
echo "🚀 Starting gateway service..."
cd "$(dirname "$0")"
npm start

