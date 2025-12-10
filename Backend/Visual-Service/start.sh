#!/bin/bash

# Visual Service Startup Script

echo "🚀 Starting Visual Service..."

# Navigate to service directory
cd "$(dirname "$0")"

# Check if virtual environment exists
if [ ! -d "venv" ]; then
    echo "📦 Creating virtual environment..."
    python3 -m venv venv
fi

# Activate virtual environment
echo "🔧 Activating virtual environment..."
source venv/bin/activate

# Check if dependencies are installed
if ! python -c "import flask" 2>/dev/null; then
    echo "📥 Installing dependencies..."
    pip install -r requirements.txt
fi

# Check if .env file exists
if [ ! -f ".env" ]; then
    echo "⚠️  Warning: .env file not found!"
    echo "Please create .env file with required environment variables."
    echo "See ENV_SETUP.md for details."
    exit 1
fi

# Check required environment variables
source .env
if [ -z "$GEMINI_API_KEY" ] || [ "$GEMINI_API_KEY" = "your_gemini_api_key_here" ]; then
    echo "⚠️  Warning: GEMINI_API_KEY not configured in .env"
fi

if [ -z "$JWT_SECRET" ] || [ "$JWT_SECRET" = "your_jwt_secret_key_here" ]; then
    echo "⚠️  Warning: JWT_SECRET not configured in .env"
fi

# Start the service
echo "✅ Starting Visual Service on port ${PORT:-8081}..."
python app.py
