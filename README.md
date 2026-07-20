# jurinex-dev
I will check the configuration in the frontend .env file to see which ports are mapped to the citation service.

I will search the frontend codebase for the reference to 8002 to see where the citation service URL is set.

I will narrow the search path for 8002 to frontend/src to avoid searching large directories like node_modules.

I will view frontend/src/config/apiConfig.js to see how the citation service URL is defined.

I will search the citation-service directory to see if 8002 is referenced or if port 8001 is standard.

I will view Backend/SERVICES_AND_PORTS.md to check the port assignments for all services and see if port 8002 is already allocated to another service.

I will modify the citation-service .env configuration file to run the API server on port 8002 to match the frontend default configuration of http://localhost:8002.

I will update start-citation-stack.sh to launch the citation service on port 8002 and update the port output summary correspondingly.

I will free up ports 8001 and 8002 to ensure no orphaned uvicorn instances block the citation service.

The issue is a port mismatch:

The React frontend is configured by default to contact the citation service at http://localhost:8002.
The backend citation-service was previously configured to run on port 8001.
I have modified the citation service .env file and the start-citation-stack.sh script to run the citation service on port 8002 instead of 8001. This aligns the service with the frontend's expectations without requiring changes to the frontend code.

To apply this fix, run the following commands in your terminal:

<!-- 1. Stop all current background processes
bash -->


kill $(jobs -p) 2>/dev/null
pkill -f "uvicorn"


<!-- 2. Run the updated script
bash -->


bash start-citation-stack.sh


<!-- 3. Check the logs to verify startup
bash -->



tail -f logs_stack/citation.log






I have everything I need. Two things worth flagging up front: document-service/ is empty — the real document service is agentic-document-service (Python, port 8092), and ChatModel defaults to 5003 (clashes with payment) so you must set PORT=5007.

All commands below are bash, run from the repo root (/home/dell-3/Documents/Jurinex RBAC/jurinex-dev), one service per terminal.

Run commands
Service	Port	Command
Gateway	5000	cd Backend/gateway-service && PORT=5000 npm start
Auth	5001	cd Backend/authservice && PORT=5001 npm start
Payment	5003	cd Backend/payment-service && PORT=5003 npm start
ChatModel	5007	cd Backend/ChatModel && PORT=5007 npm start
Document (agentic)	8092	cd Backend/agentic-document-service && ./venv/bin/python -m uvicorn main:app --host 0.0.0.0 --port 8092 --reload
Citation	8001	cd Backend/citation-service && ./venv/bin/python -m uvicorn main:app --host 0.0.0.0 --port 8001 --reload
Frontend	5173	cd frontend && npm run dev
Copy‑paste (each in its own terminal, from repo root):


# Gateway
cd "Backend/gateway-service" && PORT=5000 npm start
# Auth
cd "Backend/authservice" && PORT=5001 npm start
# Payment
cd "Backend/payment-service" && PORT=5003 npm start
# ChatModel  (MUST set PORT — index.js defaults to 5003 and would clash with payment)
cd "Backend/ChatModel" && PORT=5007 npm start
# Document (agentic-document-service, Python/FastAPI)
cd "Backend/agentic-document-service" && ./venv/bin/python -m uvicorn main:app --host 0.0.0.0 --port 8092 --reload
# Citation (Python/FastAPI) — MUST be 8002: the frontend (apiConfig.js) calls citation on 8002 for localhost.
cd "Backend/citation-service" && ./venv/bin/python -m uvicorn main:app --host 0.0.0.0 --port 8002 --reload
# Frontend (Vite → http://localhost:5173)
cd frontend && npm run dev
Kill commands
Kill one service by its port (fuser, simplest):


fuser -k 5000/tcp   # gateway
fuser -k 5001/tcp   # auth
fuser -k 5003/tcp   # payment
fuser -k 5007/tcp   # chatmodel
fuser -k 8092/tcp   # document
fuser -k 8002/tcp   # citation
fuser -k 5173/tcp   # frontend
Kill all of them at once:


for p in 5000 5001 5003 5007 8092 8002 5173; do fuser -k ${p}/tcp 2>/dev/null; done
Alternative with lsof (if fuser isn't installed — sudo apt install psmisc gets fuser):


lsof -ti:8001 | xargs -r kill -9          # one port
for p in 5000 5001 5003 5007 8092 8002 5173; do lsof -ti:$p | xargs -r kill -9; done   # all
Check what's on a port before/after killing:


lsof -i:8001        # or: ss -ltnp | grep :8001
Kill by process pattern (handy when a port is unknown):


pkill -f "uvicorn main:app"      # both Python services (citation + document)
pkill -f "node src/server.js"    # gateway
pkill -f "vite"                  # frontend
Tip: pkill -f "uvicorn main:app" stops both FastAPI services — kill by port if you only want one.

Two config notes (relevant to the citation work)
ChatModel/payment port clash — ChatModel/index.js has PORT || 5003, same as payment. Always pass PORT=5007, or it silently collides.
Citation → document URL — citation-service/.env sets DOCUMENT_SERVICE_URL=http://localhost:5002, but the document service actually runs on 8092. For citation's case-context fetch to work (the thin-context problem we debugged), set in citation-service/.env:

AGENTIC_DOCUMENT_SERVICE_URL=http://localhost:8092
That field takes priority over DOCUMENT_SERVICE_URL in _fetch_case_context.
Want me to write a start-all.sh (background each with logs to logs_stack/) and a matching stop-all.sh for the kill side?