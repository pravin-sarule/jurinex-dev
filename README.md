# JuriNex

JuriNex is a legal-AI platform. Instead of one giant program, it's built as many small
programs — called **microservices** — that each do one job and talk to each other over the
network. One handles login, one handles documents, one handles chat, and so on. A **frontend**
(the website you see in your browser) talks to these services to make the app work.

This README is about **running the app on your own laptop for development** — what each
service is, what port it runs on, and the exact command to start it.

> **If something here disagrees with the code, trust the code.** The scripts
> [`start-citation-stack.sh`](start-citation-stack.sh) (starts everything) and
> [`frontend/src/config/apiConfig.js`](frontend/src/config/apiConfig.js) (decides which port
> the frontend calls for each service) are the real source of truth. The older
> [`Backend/SERVICES_AND_PORTS.md`](Backend/SERVICES_AND_PORTS.md) describes an earlier version
> of the backend and lists some ports that are no longer correct.

---

## Contents

1. [The big picture](#the-big-picture) — a diagram of how it all fits together
2. [The 6 services you need for local development](#the-6-services-you-need-for-local-development)
3. [Prerequisites](#prerequisites)
4. [Quick start — one command](#quick-start--one-command)
5. [Starting each core service by hand](#starting-each-core-service-by-hand)
6. [Stopping services](#stopping-services)
7. [Every other service in `Backend/`](#every-other-service-in-backend) — full list + start commands
8. [Ports & config gotchas](#ports--config-gotchas)
9. [Frontend configuration](#frontend-configuration)

---

## The big picture

You don't need to run every service to develop the app. Most day-to-day work only needs
**six** services plus the frontend — that's the "core stack" the quick-start script launches.
The frontend talks to four of them **directly**, and reaches the rest **through the Gateway**,
which acts like a receptionist that forwards requests to the right place.

```
┌───────────────────────────────────────────────────────────────────────┐
│                         YOUR WEB BROWSER                                │
└──────────────────────────────────┬──────────────────────────────────────┘
                                    │  http://localhost:5173
                                    ▼
                       ╔═════════════════════════╗
                       ║   FRONTEND (React)        ║   :5173
                       ║   Vite dev server          ║
                       ╚═══╤═════╤═════╤═════╤═════╝
                           │     │     │     │
             ┌─────────────┘     │     │     └──────────────┐
             │           ┌───────┘     └───────┐             │
             ▼           ▼                     ▼             ▼
      ┌───────────┐ ┌───────────┐       ┌───────────┐ ┌───────────┐
      │  Auth      │ │ Document  │       │  Chat      │ │ Citation   │
      │  :5001     │ │  :8092    │       │  :8096     │ │  :8002     │
      │  (Node)    │ │ (Python)  │       │ (Python)   │ │ (Python)   │
      └───────────┘ └───────────┘       └───────────┘ └───────────┘

  The frontend ALSO talks to the Gateway, for file uploads/proxying and
  for reaching the Payment service:

                       ╔═════════════════════════╗
                       ║   GATEWAY (Node)          ║   :5000
                       ╚═══════════╤═══════════════╝
                                   │
                                   ▼
                            ┌───────────┐
                            │  Payment   │   :5003
                            │  (Node)    │
                            └───────────┘
```

The Gateway can also forward to several **extra, optional** services (drafting, support
tickets, Zoho integration, etc.) — those aren't started by the quick-start script. See
[Every other service in `Backend/`](#every-other-service-in-backend) for the full map and
their start commands.

---

## The 6 services you need for local development

| Service    | Directory                          | Language          | Port   | What it does                             |
| ---------- | ----------------------------------- | ----------------- | ------ | ------------------------------------------ |
| Gateway    | `Backend/gateway-service`           | Node.js           | `5000` | Reverse proxy — forwards requests onward   |
| Auth       | `Backend/authservice`               | Node.js           | `5001` | Login / accounts                           |
| Payment    | `Backend/payment-service`           | Node.js           | `5003` | Billing / payments                         |
| Document   | `Backend/agentic-document-service`  | Python / FastAPI  | `8092` | Documents, OCR, file uploads, drafting     |
| Chat       | `Backend/agentic-chat-service`      | Python / FastAPI  | `8096` | The AI chat backend                        |
| Citation   | `Backend/citation-service`          | Python / FastAPI  | `8002` | Looks up case-law citations                |
| Frontend   | `frontend`                          | React 19 + Vite 7 | `5173` | The website itself                         |

---

## Prerequisites

- **Node.js** — needed for the gateway, auth, payment services, and the frontend. Before first
  run, install each service's dependencies: `npm install` inside that service's folder (and
  inside `frontend/`).
- **Python 3.12** — needed for the FastAPI services (Document, Chat, Citation, and several of
  the "extra" services below). Each Python service has its own **virtual environment** (a
  private folder of installed packages, usually named `venv` or `.venv`) — this keeps one
  service's packages from clashing with another's.
  - A `venv` folder already exists on disk for `agentic-document-service` and
    `citation-service` in this workspace, so the commands below use it directly
    (`./venv/bin/python`). **Note:** these `venv` folders are listed in `.gitignore`, so a
    *fresh* clone of this repo won't have them — if `./venv` is missing, create one:
    ```bash
    cd "Backend/<service-name>"
    python3.12 -m venv venv
    ./venv/bin/pip install -r requirements.txt
    ```
  - Or skip all of this and use the [one-command quick start](#quick-start--one-command),
    which sets up/activates each service's virtual environment for you.
- All commands in this README are **bash**, run from the repo root:
  `/home/dell-3/Documents/Jurinex RBAC/jurinex-dev`.

---

## Quick start — one command

This single command starts the whole core stack (all 6 backend services + the frontend) as
background processes, writing each one's output to a log file in `./logs_stack/`:

```bash
bash start-citation-stack.sh
```

It brings up: auth `5001`, gateway `5000`, payment `5003`, document `8092`, chat `8096`,
citation `8002`, and the frontend (Vite — usually `5173`, check `logs_stack/frontend.log` for
the actual port it picked). To watch a service start up in real time, "tail" its log file:

```bash
tail -f logs_stack/citation.log
```

---

## Starting each core service by hand

Prefer to run things one at a time (e.g. one per terminal tab), or need to restart just one
service? Use these commands, run from the repo root:

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

# Citation (Python/FastAPI) → :8002   (the frontend expects citation on 8002)
cd "Backend/citation-service" && ./venv/bin/python -m uvicorn main:app --host 0.0.0.0 --port 8002 --reload

# Frontend (Vite → http://localhost:5173)
cd frontend && npm run dev
```

> **Always type the `--port` explicitly** for the Python services. `citation-service` has no
> built-in default port anywhere — if you leave `--port` off, it won't bind where the frontend
> expects. `agentic-document-service` is worse: its `.env` file sets `PORT=5002`, a *different*
> wrong port, which would apply if you forgot `--port` — see
> [Ports & config gotchas](#ports--config-gotchas).

---

## Stopping services

Kill one service by its port. (Needs the `fuser` command — install with
`sudo apt install psmisc` if you don't have it.)

```bash
fuser -k 5000/tcp   # gateway
fuser -k 5001/tcp   # auth
fuser -k 5003/tcp   # payment
fuser -k 8092/tcp   # document
fuser -k 8096/tcp   # chat
fuser -k 8002/tcp   # citation
fuser -k 5173/tcp   # frontend
```

Kill the whole core stack in one go:

```bash
for p in 5000 5001 5003 8092 8096 8002 5173; do fuser -k ${p}/tcp 2>/dev/null; done
```

Don't have `fuser`? Use `lsof` instead:

```bash
lsof -ti:8002 | xargs -r kill -9                                                      # one port
for p in 5000 5001 5003 8092 8096 8002 5173; do lsof -ti:$p | xargs -r kill -9; done   # all
```

Check what's running on a port, before or after killing it:

```bash
lsof -i:8002        # or:  ss -ltnp | grep :8002
```

Kill by matching the process name — handy when you don't know the port:

```bash
pkill -f "uvicorn main:app"   # stops EVERY FastAPI service at once (document + chat + citation
                               # + any of the extra Python services below that are running)
pkill -f "vite"               # frontend
```

---

## Every other service in `Backend/`

`Backend/` holds more than the six core services — drafting tools, a support-ticket system, a
Zoho integration, translation, and a few directories that turn out to be empty shells. None of
these are started by the quick-start script; start them yourself only if you're working on that
specific feature.

### Reached through the Gateway (Node.js support services)

These are proxied by the Gateway service — the frontend never talks to them directly, it calls
the Gateway, which forwards the request on.

| Service            | Directory                       | Port   | Start command                                                     | Needs                    |
| ------------------- | -------------------------------- | ------ | -------------------------------------------------------------------- | ------------------------- |
| Draft Service       | `Backend/draft-service`          | `4000` | `cd "Backend/draft-service" && npm install && npm start`             | A reachable Postgres DB   |
| Support Service     | `Backend/support-service`        | `5004` | `cd "Backend/support-service" && npm install && npm start`           | Postgres DB, Gmail creds (`.env` is pre-filled) |
| Zoho / Drafting proxy | `Backend/zoho-service`         | `5006` | `cd "Backend/zoho-service" && npm install && PORT=5006 npm start`    | ⚠️ see gotcha below — its own code default (5005) collides with `drafting-service`; always pass `PORT=5006` |
| Template Analyzer Agent | `Backend/Template Analyzer Agent` | `5017` | `cd "Backend/Template Analyzer Agent" && python3.12 -m venv venv && ./venv/bin/pip install -r requirements.txt && ./venv/bin/uvicorn src.app:app --host 0.0.0.0 --port 5017 --reload` | Postgres DB + Gemini/Anthropic API keys (`.env` is pre-filled) |

### Cloud-hosted by default (optional to run locally)

In production, the frontend talks to these on a deployed Cloud Run URL. There's no automatic
"use my laptop instead" — you have to tell the frontend to do that (see
[Frontend configuration](#frontend-configuration)). Run them locally only if you're actively
working on that feature.

| Service            | Directory                     | Language           | Port   | Start command                                                                          | Needs                    |
| ------------------- | ------------------------------- | ------------------- | ------ | ------------------------------------------------------------------------------------------ | ------------------------- |
| Agent Draft Service | `Backend/agent-draft-service`  | Python / FastAPI    | `8000` | `cd "Backend/agent-draft-service" && python3.12 -m venv venv && ./venv/bin/pip install -r requirements.txt && ./venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000 --reload` | Postgres DB, Anthropic + Gemini keys (`.env` pre-filled) |
| AI Chatbot          | `Backend/ai-chatbot`           | Python / FastAPI    | `8095` | `cd "Backend/ai-chatbot" && python3.12 -m venv venv && ./venv/bin/pip install -r requirements.txt && ./venv/bin/python main.py` | No `.env` shipped — you'll need to create one |
| Chat Draft Backend  | `Backend/chat-draft-backend`   | Node.js             | `8010` | `cd "Backend/chat-draft-backend" && npm install && npm start`                             | Calls Agent Draft (`:8000`) and Template Analyzer (`:5017`) internally |
| Citation Testing    | `Backend/citation-testing`     | Python / FastAPI    | `8003` | `cd "Backend/citation-testing" && python3.12 -m venv venv && ./venv/bin/pip install -r requirements.txt && ./venv/bin/python main.py` | `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `SERPER_API_KEY` (none shipped); calls Document service on `:8092` |
| Drafting Service    | `Backend/drafting-service`     | Node.js             | `5005` | `cd "Backend/drafting-service" && npm install && PORT=5005 npm start`                     | ⚠️ Google Docs/service-account credentials; see port gotcha below |
| Translation Service | `Backend/Translation-service`  | Node.js             | `3000` | `cd "Backend/Translation-service" && npm install && PORT=3000 npm start`                  | Real GCP credentials (Document AI) — see its own `ENV_SETUP.md` |
| Visual Service      | `Backend/Visual-Service`       | Python / **Flask**  | `8081` | `cd "Backend/Visual-Service" && pip install -r requirements.txt && PORT=8081 python main.py` | No `.env` shipped; **don't** use its `start.sh` — it calls a file that doesn't exist |

### Not runnable — empty / stub directories

These exist in `Backend/` but have no real application code. Leave them alone.

| Directory                       | Why it's not runnable                                                          |
| --------------------------------- | ---------------------------------------------------------------------------------- |
| `Backend/document-service`       | Only a `.env` file and a couple of unused helper files — no `package.json`, no entry point. The **real** document service is `agentic-document-service` (`:8092`). |
| `Backend/citation-service-v1`    | Only an empty virtual-environment folder — no application code at all.             |

### Legacy chat service

The current chat feature goes through `agentic-chat-service` (`:8096`). The **old** Node.js
chat service, `Backend/ChatModel`, still exists but isn't part of the normal stack. If you do
need to run it, always set its port explicitly:

```bash
cd "Backend/ChatModel" && PORT=5007 npm start   # → :5007
```

Two traps if you forget `PORT=5007`: its code falls back to `5003` (clashing with
payment-service), and its checked-in `.env` sets `PORT=8080` (clashing with an old, unused
document-service port).

A Windows launcher for the older service set exists at `Backend/run-all-backends.ps1`.

---

## Ports & config gotchas

A handful of ports don't do what you'd guess from reading the code in isolation — each of these
was found by actually tracing the code, not by assumption.

**Citation runs on `8002`, not `8001`.**
The frontend calls citation at `http://localhost:8002` for local dev
(`frontend/src/config/apiConfig.js:128`). The citation service has **no** built-in default port,
so it comes entirely from the command you run it with — always pass `--port 8002`. If you see
`8001` mentioned in `Backend/SERVICES_AND_PORTS.md`, that's outdated.

**`agentic-document-service`'s `.env` has a `PORT=5002` trap.**
That value only takes effect if you start it with `python main.py` directly. The command in
this README passes `--port 8092` on the command line, which wins over the `.env` value — so
**always start it with `--port 8092`** (or via `start-citation-stack.sh`).

**Three port collisions exist between what a service's own code defaults to and what other
config files assume:**
1. `citation-testing` really does default to `8003` — that part's correct. But
   `frontend/src/config/apiConfig.js`'s `DRAFTING_SERVICE_URL` *also* defaults to `8003`, even
   though `drafting-service`'s own code actually defaults to `5005`. If you run both
   `citation-testing` and `drafting-service` locally without fixing this, don't expect the
   frontend to reach the right one on `8003` for drafting features.
2. `drafting-service` and `zoho-service` **both** default to `5005` in their own code. The
   Gateway's config resolves this by giving zoho-service `5006` instead — which is why the
   command above uses `PORT=5006 npm start` for it, the same pattern as the ChatModel gotcha.
3. Template Analyzer Agent's real port is `5017` (confirmed by its own code, its `.env`, and the
   Gateway's config) — but if you trace through `frontend/src/config/apiConfig.js`'s fallback
   logic for `TEMPLATE_ANALYZER_API_BASE`, it actually resolves to `localhost:8002`, the *same*
   port as citation-service, not `5017`. The `5017` written in that file's code never actually
   gets used because of how the fallback function works.

**The Gateway's own `.env` has a stale override for drafting.**
`gateway-service/.env` sets `DRAFTING_SERVICE_URL=http://localhost:8000`, with the correct
value (`5005`) sitting right above it, commented out. If you need the Gateway to correctly reach
a locally-running `drafting-service`, fix this line to `http://localhost:5005`.

**The committed-looking `venv` folders aren't actually tracked by git.**
`agentic-document-service/venv` and `citation-service/venv` exist on disk right now in this
workspace, so the run commands above work as-is. But `.gitignore` excludes `venv/` and `.venv/`
everywhere in the repo — so a **fresh clone** of this repository won't have them, and you'll
need to create them yourself (see [Prerequisites](#prerequisites)).

**`Backend/document-service/` is empty — don't confuse it with the real thing.**
It has no `package.json` and no entry file, so it can't be started. The real document service is
`agentic-document-service` (Python, `:8092`).

**`Backend/SERVICES_AND_PORTS.md` describes an older version of the backend.**
It doesn't know about `agentic-document-service` (`8092`), `agentic-chat-service` (`8096`), or
most of the extra services in this README, and it lists citation on the wrong port (`8001`). It
is still correct for the older Node services it does cover (gateway `5000`, auth `5001`, payment
`5003`, ChatModel `5007`) — but prefer this README for anything else.

---

## Frontend configuration

The frontend decides which URL to call for each backend in
`frontend/src/config/apiConfig.js`. When you're running on `localhost` / `127.0.0.1`, it
**automatically** falls back to the local ports above — no environment variables needed — for
Auth (`5001`), Document (`8092`), Chat (`8096`), and Citation (`8002`).

A few services do **not** have an automatic local fallback — by default they always point at a
deployed Cloud Run URL, even when you're developing locally. To use your own local copy of one
of these instead, add the matching variable to `frontend/.env`:

| Service               | Environment variable                     | Set it to (if running locally) |
| ----------------------- | ------------------------------------------ | ---------------------------------- |
| Gateway                | `VITE_APP_GATEWAY_URL` (or `VITE_APP_API_URL`) | `http://localhost:5000`        |
| Payment                | `VITE_APP_PAYMENT_SERVICE_URL`             | your local payment service URL     |
| Visual Service         | `VITE_APP_VISUAL_SERVICE_URL`              | `http://localhost:8081`            |
| AI Chatbot             | `VITE_APP_AI_CHATBOT_URL`                  | `http://localhost:8095`            |
| Agent Draft Service    | `VITE_APP_AGENT_DRAFT_TEMPLATE_URL`        | `http://localhost:8000`            |
| Chat Draft Backend     | `VITE_APP_CHAT_DRAFT_BACKEND_URL`          | `http://localhost:8010`            |

Firebase authentication needs the six `VITE_FIREBASE_*` variables set in `frontend/.env`. Every
variable the frontend reads must start with `VITE_` — that's a Vite requirement, anything
without that prefix is invisible to the browser code.
