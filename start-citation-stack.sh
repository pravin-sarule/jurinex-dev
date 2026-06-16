#!/bin/bash

# Configuration
LOG_DIR="$(pwd)/logs_stack"
mkdir -p "$LOG_DIR"

echo "=========================================================="
echo "Starting JuriNex Citation Stack (Frontend & Backend)"
echo "=========================================================="
echo "Logs will be written to: $LOG_DIR"
echo ""

# Function to run a node service
run_node_service() {
    local name=$1
    local path=$2
    local port=$3
    echo "[Node] Starting $name on port $port..."
    cd "$path" || return
    PORT=$port npm start > "$LOG_DIR/$name.log" 2>&1 &
    cd - > /dev/null || return
}

# Function to run a python service
run_python_service() {
    local name=$1
    local path=$2
    local port=$3
    echo "[Python] Starting $name on port $port..."
    cd "$path" || return
    
    # Detect virtual env
    if [ -d "venv" ]; then
        source venv/bin/activate
    elif [ -d ".venv" ]; then
        source .venv/bin/activate
    fi
    
    python -m uvicorn main:app --host 0.0.0.0 --port "$port" > "$LOG_DIR/$name.log" 2>&1 &
    
    # Deactivate venv if active
    if type deactivate >/dev/null 2>&1; then
        deactivate
    fi
    cd - > /dev/null || return
}

# 1. Start Backend Services
run_node_service "auth" "./Backend/authservice" 5001
run_node_service "gateway" "./Backend/gateway-service" 5000
run_node_service "billing" "./Backend/payment-service" 5003

run_python_service "document" "./Backend/agentic-document-service" 8092
run_python_service "chat" "./Backend/agentic-chat-service" 8096
run_python_service "citation" "./Backend/citation-service" 8002

# 2. Start Frontend Service
echo "[Frontend] Starting React/Vite App..."
cd frontend || exit
npm run dev -- --host > "$LOG_DIR/frontend.log" 2>&1 &
cd - > /dev/null || exit

echo ""
echo "----------------------------------------------------------"
echo "All services started in the background."
echo "Use 'jobs' to see active tasks, or 'kill %1' etc. to stop."
echo "To check live logs, run:"
echo "  tail -f $LOG_DIR/*.log"
echo "----------------------------------------------------------"
echo "Ports Summary:"
echo "  - Gateway:  5000"
echo "  - Auth:     5001"
echo "  - Billing:  5003"
echo "  - Document: 8092"
echo "  - Chat:     8096"
echo "  - Citation: 8002"
echo "  - Frontend: (check output of npm run dev in $LOG_DIR/frontend.log)"
echo "=========================================================="
