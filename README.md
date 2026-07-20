# JuriNex

Legal-AI platform. Polyglot microservices backend (Node.js + Python/FastAPI) behind an API
gateway, with a React/Vite frontend. This README covers **local development** — the services,
their ports, and how to start and stop them.

> **Source of truth for the running stack** is [`start-citation-stack.sh`](start-citation-stack.sh)
> (the agentic stack launcher) and the frontend's [`frontend/src/config/apiConfig.js`](frontend/src/config/apiConfig.js)
> (which decides the `localhost` port for each backend). The older
> [`Backend/SERVICES_AND_PORTS.md`](Backend/SERVICES_AND_PORTS.md) documents the **legacy Node
> stack** and lists some ports that no longer apply (e.g. citation `8001`, document `8080/5002`) —
> prefer the values below.

---

## Stack at a glance

These are the services the current stack runs locally, and the port the **frontend expects each on**:

| Service    | Directory                          | Language          | Port   | Purpose                                  |
| ---------- | ---------------------------------- | ----------------- | ------ | ---------------------------------------- |
| Gateway    | `Backend/gateway-service`          | Node.js           | `5000` | API gateway / reverse proxy              |
| Auth       | `Backend/authservice`              | Node.js           | `5001` | Authentication                           |
| Payment    | `Backend/payment-service`          | Node.js           | `5003` | Billing / payments                       |
| Document   | `Backend/agentic-document-service` | Python / FastAPI  | `8092` | Documents, OCR, files, drafting          |
| Chat       | `Backend/agentic-chat-service`     | Python / FastAPI  | `8096` | Chat backend (frontend's chat target)    |
| Citation   | `Backend/citation-service`         | Python / FastAPI  | `8002` | Case-law citation retrieval              |
| Frontend   | `frontend`                         | React 19 + Vite 7 | `5173` | Web app (Vite dev server)                |

See [Ports & config gotchas](#ports--config-gotchas) below for the sharp edges (citation `8002`,
the ChatModel port override, and the `agentic-document-service` `.env` trap). The legacy Node
**ChatModel** service is documented under [Other / legacy services](#other--legacy-services).

---

## Prerequisites

- **Node.js** (for the gateway, auth, payment, and ChatModel services) — run `npm install` in each
  Node service directory and in `frontend/` before first launch.
- **Python 3.12** for the FastAPI services. Both `agentic-document-service` and `citation-service`
  ship a committed virtualenv at `./venv` (built with Python 3.12.3); the run commands below use it
  directly. If a `./venv` is missing, create one and `pip install -r requirements.txt`, or just use
  the [one-command quick start](#quick-start-one-command), which activates each service's venv for you.
- All commands below are **bash**, run from the repo root
  (`/home/dell-3/Documents/Jurinex RBAC/jurinex-dev`).

---

## Quick start (one command)

The launcher starts the whole backend + frontend, backgrounding each process with logs in
`./logs_stack/`:

```bash
bash start-citation-stack.sh
```

It brings up: auth `5001`, gateway `5000`, payment `5003`, document `8092`, chat `8096`,
citation `8002`, and the frontend (Vite, default `5173` — check `logs_stack/frontend.log` for the
actual port). Tail a log to watch startup:

```bash
tail -f logs_stack/citation.log
```

---

## Run services manually

One service per terminal, from the repo root:

```bash
# Gateway (Node) → :5000
cd "Backend/gateway-service" && PORT=5000 npm start

# Auth (Node) → :5001
cd "Backend/authservice" && PORT=5001 npm start

# Payment (Node) → :5003
cd "Backend/payment-service" && PORT=5003 npm start

# Document — agentic-document-service (Python/FastAPI) → :8092
cd "Backend/agentic-document-service" && ./venv/bin/python -m uvicorn main:app --host 0.0.0.0 --port 8092 --reload

# Chat — agentic-chat-service (Python/FastAPI) → :8096
cd "Backend/agentic-chat-service" && ./venv/bin/python -m uvicorn main:app --host 0.0.0.0 --port 8096 --reload

# Citation (Python/FastAPI) → :8002   (the frontend calls citation on 8002 for localhost)
cd "Backend/citation-service" && ./venv/bin/python -m uvicorn main:app --host 0.0.0.0 --port 8002 --reload

# Frontend (Vite → http://localhost:5173)
cd frontend && npm run dev
```

> **Always pass the explicit `--port`** on the Python services. `citation-service` has no default
> port anywhere in code or `.env`, and `agentic-document-service` has a `PORT=5002` line in its
> `.env` that would bind the wrong port if the CLI flag is omitted (see gotchas below).

---

## Stop / kill services

Kill one service by its port (`fuser` — install with `sudo apt install psmisc` if missing):

```bash
fuser -k 5000/tcp   # gateway
fuser -k 5001/tcp   # auth
fuser -k 5003/tcp   # payment
fuser -k 8092/tcp   # document
fuser -k 8096/tcp   # chat
fuser -k 8002/tcp   # citation
fuser -k 5173/tcp   # frontend
```

Kill the whole stack at once:

```bash
for p in 5000 5001 5003 8092 8096 8002 5173; do fuser -k ${p}/tcp 2>/dev/null; done
```

Alternative with `lsof` (if `fuser` isn't available):

```bash
lsof -ti:8002 | xargs -r kill -9                                              # one port
for p in 5000 5001 5003 8092 8096 8002 5173; do lsof -ti:$p | xargs -r kill -9; done   # all
```

Check what's on a port before/after killing:

```bash
lsof -i:8002        # or:  ss -ltnp | grep :8002
```

Kill by process pattern (handy when the port is unknown):

```bash
pkill -f "uvicorn main:app"   # ALL FastAPI services (document + chat + citation)
pkill -f "vite"               # frontend
```

> `pkill -f "uvicorn main:app"` stops **every** FastAPI service at once — kill by port if you only
> want one.

---

## Ports & config gotchas

**Citation runs on `8002`, not `8001`.**
The React frontend calls citation at `http://localhost:8002` for local dev hosts
(`frontend/src/config/apiConfig.js:128`). The citation service defines **no** default port in code
or `.env`, so the port comes entirely from the run command — you must pass `--port 8002`. Any `8001`
you see in `Backend/SERVICES_AND_PORTS.md` or older notes is stale.

**`agentic-document-service` `.env` has a `PORT=5002` trap.**
Its settings read a `PORT` alias, and `.env` sets `PORT=5002`. That value only takes effect if you
launch via `python main.py` (which binds `settings.port`). The documented uvicorn command passes
`--port 8092` on the CLI, which overrides the `.env` — so **always launch with `--port 8092`** (or
via `start-citation-stack.sh`). The frontend expects the document service on `8092`
(`apiConfig.js:101`).

**Citation → document URL is already correct.**
`citation-service/.env` sets both `AGENTIC_DOCUMENT_SERVICE_URL` and `DOCUMENT_SERVICE_URL` to
`http://localhost:8092`, and the case-context fetch (`main.py:_fetch_case_context`) prefers
`AGENTIC_DOCUMENT_SERVICE_URL` first, then `DOCUMENT_SERVICE_URL`, then `GATEWAY_URL`, then a
`localhost:8092` default. No change needed — just make sure the document service is actually up on
`8092`.

**`Backend/document-service/` is empty.**
It contains only a `.env` and `node_modules` — no `package.json`, no entry file. It is **not**
runnable. The real document service is `agentic-document-service` (Python, `8092`). Ignore the stale
`PORT=5002` in that empty directory's `.env`.

**`SERVICES_AND_PORTS.md` is the legacy map.**
It predates the agentic stack (no `agentic-document-service` `8092`, no `agentic-chat-service`
`8096`, citation listed as `8001`). It's still accurate for the legacy Node services
(gateway `5000`, auth `5001`, payment `5003`, ChatModel `5007`) but use the table at the top of this
file for the current runtime.

---

## Other / legacy services

**ChatModel (Node) — `Backend/ChatModel`.**
The current chat path goes through `agentic-chat-service` (`8096`), so ChatModel is not part of the
default stack. If you do run it, set the port **explicitly**:

```bash
cd "Backend/ChatModel" && PORT=5007 npm start   # → :5007
```

Two traps: its code default is `PORT || 5003`, which **clashes with payment-service**; and its
checked-in `.env` sets `PORT=8080`, which collides with the legacy document port. The repo's own
port map assigns ChatModel `5007` (`Backend/SERVICES_AND_PORTS.md:51`) — so always pass `PORT=5007`
rather than trusting the shipped `.env`.

`Backend/` also contains many other services not part of the local dev stack
(`agent-draft-service`, `drafting-service`, `Translation-service`, `Visual-Service`,
`Template Analyzer Agent`, `citation-service-v1`, `zoho-service`, `support-service`, `ai-chatbot`,
and more). A Windows launcher for the legacy set exists at `Backend/run-all-backends.ps1`.

---

## Frontend configuration

The frontend resolves each backend URL in `frontend/src/config/apiConfig.js`. On a `localhost` /
`127.0.0.1` host it falls back to the local ports above **without any env vars** for auth (`5001`),
document (`8092`), chat (`8096`), and citation (`8002`). A few services have **no** localhost
fallback and default to their deployed Cloud Run URLs unless overridden in `frontend/.env`:

- **Gateway** — set `VITE_APP_GATEWAY_URL` (or `VITE_APP_API_URL`) to `http://localhost:5000`.
- **Payment** — set `VITE_APP_PAYMENT_SERVICE_URL` to point at a local payment service.

Firebase auth requires the six `VITE_FIREBASE_*` vars in `frontend/.env`. All frontend env vars must
be `VITE_`-prefixed to be exposed to the client.
