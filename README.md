# JuriNex

JuriNex is a legal-AI platform. Instead of one giant program, it's built as many small
programs — called **microservices** — that each do one job and talk to each other over the
network. One handles login, one handles documents, one handles chat, and so on. A **frontend**
(the website you see in your browser) talks to these services to make the app work.

This README is about **running the app on your own laptop for development** — what each
service is, what port it runs on, and the exact command to start it.

> **If something here disagrees with the code, trust the code.**
> [`frontend/src/config/apiConfig.js`](frontend/src/config/apiConfig.js) decides which port the
> frontend calls for each service, and is the real source of truth for ports. The older
> [`Backend/SERVICES_AND_PORTS.md`](Backend/SERVICES_AND_PORTS.md) describes an earlier version
> of the backend and lists some ports that are no longer correct.

> **Primary dev environment: Windows + PowerShell.** Commands below are given for PowerShell
> first, with the bash/Linux equivalent alongside where they differ. Paths in this repo contain
> a space (`Jurinex code`), so **always quote directory paths**.

---

## Contents

1. [The big picture](#the-big-picture) — a diagram of how it all fits together
2. [The services you need for local development](#the-services-you-need-for-local-development)
3. [Prerequisites](#prerequisites)
4. [Starting each core service by hand](#starting-each-core-service-by-hand)
5. [Stopping services](#stopping-services)
6. [LLM providers & model selection](#llm-providers--model-selection)
7. [Every other service in `Backend/`](#every-other-service-in-backend) — full list + start commands
8. [Ports & config gotchas](#ports--config-gotchas)
9. [Frontend configuration](#frontend-configuration)

---

## The big picture

You don't need to run every service to develop the app. Most day-to-day work only needs
**six** services plus the frontend. The frontend talks to several of them **directly**, and
reaches the rest **through the Gateway**, which acts like a receptionist that forwards requests
to the right place.

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

  The frontend ALSO auto-detects these two on localhost (no env var needed):

      ┌──────────────────┐   ┌──────────────────┐
      │ Citation v1 :8004│   │ Judgement  :8005 │
      └──────────────────┘   └──────────────────┘

  ...and talks to the Gateway for file uploads/proxying and the Payment service:

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
tickets, Zoho integration, etc.). See
[Every other service in `Backend/`](#every-other-service-in-backend) for the full map and
their start commands.

---

## The services you need for local development

| Service    | Directory                          | Language          | Port   | What it does                             |
| ---------- | ----------------------------------- | ----------------- | ------ | ------------------------------------------ |
| Gateway    | `Backend/gateway-service`           | Node.js           | `5000` | Reverse proxy — forwards requests onward   |
| Auth       | `Backend/authservice`               | Node.js           | `5001` | Login / accounts                           |
| Payment    | `Backend/payment-service`           | Node.js           | `5003` | Billing / payments, token & quota tracking |
| Document   | `Backend/agentic-document-service`  | Python / FastAPI  | `8092` | Documents, OCR, file uploads, RAG chat, drafting |
| Chat       | `Backend/agentic-chat-service`      | Python / FastAPI  | `8096` | The AI chat backend                        |
| Citation   | `Backend/citation-service`          | Python / FastAPI  | `8002` | Looks up case-law citations                |
| Frontend   | `frontend`                          | React 19 + Vite 7 | `5173` | The website itself                         |

**Also auto-detected on localhost.** These two have an automatic local fallback in
`apiConfig.js` exactly like the six above — if you're running them, the frontend finds them with
no configuration. If you're *not* running them, the related UI simply fails to reach a backend.

| Service       | Directory                    | Language         | Port   | What it does                                     |
| ------------- | ---------------------------- | ---------------- | ------ | ------------------------------------------------ |
| Judgement     | `Backend/judgement-service`  | Python / FastAPI | `8005` | ADK legal search — issues → Indian Kanoon precedents |
| Citation v1   | *(not in this repo)*         | Python / FastAPI | `8004` | Google ADK + Claude + Serper citation pipeline    |

> ⚠️ `Backend/citation-service-v1/` **no longer exists in this repository**, but the frontend
> still falls back to `http://localhost:8004` for it. Anything depending on Citation v1 will
> fail locally unless you point `VITE_APP_CITATION_V1_SERVICE_URL` at a deployed instance.

---

## Prerequisites

- **Node.js** — needed for the gateway, auth, payment services, and the frontend. Before first
  run, install each service's dependencies: `npm install` inside that service's folder (and
  inside `frontend/`).

- **Python** — needed for the FastAPI services. **Python 3.14.2 is what currently runs the
  document service on this machine**, via the global `python` on `PATH`.

  > **Note on Python 3.14:** the document service deliberately **skips mounting the Google ADK
  > runtime** on 3.14 (`Skipping Google ADK runtime mount on Python 3.14 because the current
  > google-adk/grpc stack is not stable on this interpreter yet`). Everything else works. If you
  > need the ADK runtime, run that service on Python 3.12 instead.

- **Virtual environments are NOT reliably present.** Each Python service is *supposed* to have
  its own venv, but on this workspace right now only one exists:

  | Service                      | venv on disk           | State                                    |
  | ---------------------------- | ---------------------- | ---------------------------------------- |
  | `agentic-document-service`   | `.venv` (Python 3.12.10) | ⚠️ **broken** — see below                |
  | `agentic-chat-service`       | none                   | create one, or use global Python          |
  | `citation-service`           | none                   | create one, or use global Python          |

  > ⚠️ **`agentic-document-service/.venv` is currently broken.** It has pydantic `2.13.4`
  > installed against pydantic-core `2.41.4`, but that pydantic requires `2.46.4`, so *any*
  > import fails with `SystemError: The installed pydantic-core version ... is incompatible`.
  > This means [`Backend/agentic-document-service/start.ps1`](Backend/agentic-document-service/start.ps1),
  > which uses `.venv\Scripts\uvicorn.exe`, **will not start the service.** Either use the global
  > Python (see the run command below), or repair the venv:
  > ```powershell
  > .\.venv\Scripts\pip install pydantic-core==2.46.4
  > ```

  To create a venv from scratch for a service that has none:

  ```powershell
  # PowerShell (Windows)
  cd "Backend/<service-name>"
  python -m venv .venv
  .\.venv\Scripts\pip install -r requirements.txt
  ```
  ```bash
  # bash (Linux/macOS)
  cd "Backend/<service-name>"
  python3.12 -m venv .venv
  ./.venv/bin/pip install -r requirements.txt
  ```

  Note the Windows layout is `.venv\Scripts\python.exe`, **not** `venv/bin/python`.

- Commands in this README are run **from the repo root**:
  `C:\Users\ADMIN\Documents\Jurinex code\jurinex-dev`.

> **There is no one-command quick-start script.** Earlier versions of this README pointed at
> `start-citation-stack.sh`; that file is not present in the repo (and is not tracked by git).
> Start services individually using the commands below — one per terminal tab.

---

## Starting each core service by hand

Run each from the repo root, ideally one per terminal tab.

```powershell
# PowerShell (Windows)

# Gateway (Node) → :5000
cd "Backend/gateway-service"; $env:PORT=5000; npm start

# Auth (Node) → :5001
cd "Backend/authservice"; $env:PORT=5001; npm start

# Payment (Node) → :5003
cd "Backend/payment-service"; $env:PORT=5003; npm start

# Document — agentic-document-service (Python/FastAPI) → :8092
# Uses the GLOBAL python because .venv is currently broken (see Prerequisites).
cd "Backend/agentic-document-service"; python -m uvicorn main:app --host 0.0.0.0 --port 8092 --reload

# Chat — agentic-chat-service (Python/FastAPI) → :8096
cd "Backend/agentic-chat-service"; python -m uvicorn main:app --host 0.0.0.0 --port 8096 --reload

# Citation (Python/FastAPI) → :8002   (the frontend expects citation on 8002)
cd "Backend/citation-service"; python -m uvicorn main:app --host 0.0.0.0 --port 8002 --reload

# Judgement (Python/FastAPI) → :8005
cd "Backend/judgement-service"; python -m uvicorn api:app --host 0.0.0.0 --port 8005 --reload

# Frontend (Vite → http://localhost:5173)
cd frontend; npm run dev
```

```bash
# bash (Linux/macOS) — same thing, Unix venv layout
cd "Backend/gateway-service" && PORT=5000 npm start
cd "Backend/authservice"     && PORT=5001 npm start
cd "Backend/payment-service" && PORT=5003 npm start
cd "Backend/agentic-document-service" && ./.venv/bin/python -m uvicorn main:app --host 0.0.0.0 --port 8092 --reload
cd "Backend/agentic-chat-service"     && ./.venv/bin/python -m uvicorn main:app --host 0.0.0.0 --port 8096 --reload
cd "Backend/citation-service"         && ./.venv/bin/python -m uvicorn main:app --host 0.0.0.0 --port 8002 --reload
cd "Backend/judgement-service"        && ./.venv/bin/python -m uvicorn api:app  --host 0.0.0.0 --port 8005 --reload
cd frontend && npm run dev
```

Note the document and chat services use `main:app`, but **judgement-service uses `api:app`** —
its entry point is `api.py`, not `main.py`.

> **Always type the `--port` explicitly** for the Python services. `citation-service` has no
> built-in default port anywhere — if you leave `--port` off, it won't bind where the frontend
> expects. `agentic-document-service` is worse: its `.env` file sets `PORT=8092` now, but a
> stale value there would silently apply if you started it with `python main.py` instead — see
> [Ports & config gotchas](#ports--config-gotchas).

---

## Stopping services

```powershell
# PowerShell — kill whatever holds one port
Get-NetTCPConnection -LocalPort 8092 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }

# Kill the whole core stack
foreach ($p in 5000,5001,5003,8092,8096,8002,8005,5173) {
  Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue |
    ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
}

# See what's on a port before killing it
Get-NetTCPConnection -LocalPort 8092 -State Listen | Select-Object LocalPort, OwningProcess

# Kill every FastAPI service at once, by process name
Get-Process python -ErrorAction SilentlyContinue | Stop-Process -Force
```

```bash
# bash (Linux/macOS)
fuser -k 8092/tcp                                   # one port
for p in 5000 5001 5003 8092 8096 8002 8005 5173; do fuser -k ${p}/tcp 2>/dev/null; done
lsof -ti:8002 | xargs -r kill -9                    # no fuser? use lsof
lsof -i:8002                                        # check what's running
pkill -f "uvicorn main:app"                         # every FastAPI service at once
pkill -f "vite"                                     # frontend
```

---

## LLM providers & model selection

The document service (`:8092`) powers the project/case RAG chat. **Which model answers is chosen
by an admin in the Super Admin portal** under *LLM Management → Summarization Chat*, which writes
to the `public.summarization_chat_config` table. The service reads that table per request.

**Routing is by model name, not by the "LLM Provider" text field.** The provider is detected from
the model id's prefix in `_detect_provider()`
([`app/services/adapters/document_ai.py`](Backend/agentic-document-service/app/services/adapters/document_ai.py)):

| Model name starts with | Provider routed to | API key (`.env`)     |
| ---------------------- | ------------------ | -------------------- |
| `gemini` / `gemma`     | Google             | `GEMINI_API_KEY` / `GEMMA_API_KEY` |
| `claude`               | Anthropic          | `ANTHROPIC_API_KEY`  |
| `deepseek`             | DeepSeek           | `DEEPSEEK_API_KEY`   |
| `kimi` / `moonshot`    | Moonshot AI        | `KIMI_API_KEY`       |
| *(anything else)*      | Google (fallback)  | `GEMINI_API_KEY`     |

> Adding a new provider means updating **both** `_detect_provider()` **and**
> [`llm_models_catalog.py`](Backend/agentic-document-service/app/services/llm_models_catalog.py).
> The catalog silently rewrites any unrecognised model name back to Gemini, so an admin's
> selection would otherwise never take effect.

### Kimi (Moonshot AI)

Models available on the current key — verified against `GET /v1/models`:

| Model                      | Context     | Notes                                        |
| -------------------------- | ----------- | -------------------------------------------- |
| `kimi-k3`                  | 1,048,576   | Strongest; dynamic tools; think efforts low/high/max |
| `kimi-k2.6`                | 262,144     | General-purpose                               |
| `kimi-k2.7-code`           | 262,144     | Code-oriented; **cannot disable thinking**    |
| `kimi-k2.7-code-highspeed` | 262,144     | Faster code variant                           |

All are reasoning models, accept image + video input, and support streaming and JSON mode.
`kimi-k2.5`, `kimi-latest` and the legacy `moonshot-v1-*` ids are **not** available on this key.

**Moonshot rejects any temperature except one fixed value**, and which value is legal depends on
thinking mode — so the admin panel's *Model Temperature* field is intentionally ignored for Kimi
models (forwarding it would 400 every request):

- thinking **on** → temperature must be `1.0`
- thinking **off** → temperature must be `0.6`, sent together with `thinking: {"type":"disabled"}`

Kimi bills its hidden chain-of-thought as **output tokens** even though it's never displayed.
These `.env` knobs control that cost and are re-read on **every request** — they override the
`thinking_mode` flag in `agent_prompts`:

| Variable                      | Default                      | What it does                                            |
| ----------------------------- | ---------------------------- | ------------------------------------------------------- |
| `KIMI_API_KEY`                | —                            | Moonshot API key (required)                              |
| `KIMI_MODEL`                  | `kimi-k2.6`                  | Used only when the UI sends the bare label `kimi`        |
| `KIMI_BASE_URL`               | `https://api.moonshot.ai/v1` | Use `api.moonshot.cn` only with a mainland-China key      |
| `KIMI_THINKING_ENABLED`       | `false`                      | Master switch for the reasoning pass                      |
| `KIMI_THINKING_BUDGET_TOKENS` | `500`                        | Caps reasoning tokens whenever thinking is on             |
| `KIMI_REASONING_EFFORT`       | *(blank)*                    | `low` / `high` / `max` for `kimi-k3`; blank = not sent    |
| `KIMI_STREAM_TABULAR`         | `true`                       | Stream tables live; `false` withholds them until complete |

Measured impact of thinking on a one-line answer: **32 output tokens / 2.5s** with thinking off,
versus **2,660 tokens / 71s** with it on and uncapped.

`kimi-k2.7-code` refuses `thinking: disabled` outright; the adapter detects that specific error
and transparently retries with `budget_tokens` instead, so it stays cheap without special-casing.

### Free-tier override

⚠️ `FREE_TIER_DEEPSEEK_ENABLED=true` in the document service's `.env` **forces every user on a
₹0-price plan onto DeepSeek**, ignoring the admin's model selection entirely. If a model you
picked in the admin panel appears to have no effect, check the test account's plan first.

---

## Every other service in `Backend/`

`Backend/` holds more than the core services — drafting tools, a support-ticket system, a
Zoho integration, translation, and a directory that turns out to be an empty shell. Start these
yourself only if you're working on that specific feature.

### Reached through the Gateway (Node.js support services)

These are proxied by the Gateway service — the frontend never talks to them directly, it calls
the Gateway, which forwards the request on.

| Service            | Directory                       | Port   | Start command                                                     | Needs                    |
| ------------------- | -------------------------------- | ------ | -------------------------------------------------------------------- | ------------------------- |
| Draft Service       | `Backend/draft-service`          | `4000` | `cd "Backend/draft-service" && npm install && npm start`             | A reachable Postgres DB   |
| Support Service     | `Backend/support-service`        | `5004` | `cd "Backend/support-service" && npm install && npm start`           | Postgres DB, Gmail creds (`.env` is pre-filled) |
| Zoho / Drafting proxy | `Backend/zoho-service`         | `5006` | `cd "Backend/zoho-service" && npm install && PORT=5006 npm start`    | ⚠️ see gotcha below — its own code default (5005) collides with `drafting-service`; always pass `PORT=5006` |
| Template Analyzer Agent | `Backend/Template Analyzer Agent` | `5017` | `cd "Backend/Template Analyzer Agent" && python -m venv .venv && .\.venv\Scripts\pip install -r requirements.txt && .\.venv\Scripts\uvicorn src.app:app --host 0.0.0.0 --port 5017 --reload` | Postgres DB + Gemini/Anthropic API keys (`.env` is pre-filled) |

### Cloud-hosted by default (optional to run locally)

In production, the frontend talks to these on a deployed Cloud Run URL. There's no automatic
"use my laptop instead" — you have to tell the frontend to do that (see
[Frontend configuration](#frontend-configuration)). Run them locally only if you're actively
working on that feature.

| Service            | Directory                     | Language           | Port   | Needs                    |
| ------------------- | ------------------------------- | ------------------- | ------ | ------------------------- |
| Agent Draft Service | `Backend/agent-draft-service`  | Python / FastAPI    | `8000` | Postgres DB, Anthropic + Gemini keys (`.env` pre-filled) |
| AI Chatbot          | `Backend/ai-chatbot`           | Python / FastAPI    | `8095` | No `.env` shipped — you'll need to create one |
| Chat Draft Backend  | `Backend/chat-draft-backend`   | Node.js             | `8010` | Calls Agent Draft (`:8000`) and Template Analyzer (`:5017`) internally |
| Citation Testing    | `Backend/citation-testing`     | Python / FastAPI    | `8003` | `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `SERPER_API_KEY` (none shipped); calls Document service on `:8092`. Has its own `start.ps1`. |
| Drafting Service    | `Backend/drafting-service`     | Node.js             | `5005` | ⚠️ Google Docs/service-account credentials; see port gotcha below |
| Translation Service | `Backend/Translation-service`  | Node.js             | `3000` | Real GCP credentials (Document AI) — see its own `ENV_SETUP.md` |
| Visual Service      | `Backend/Visual-Service`       | Python / **Flask**  | `8081` | No `.env` shipped; **don't** use its `start.sh` — it calls a file that doesn't exist |

Start these with the same pattern as the core services (`npm install && PORT=<port> npm start`
for Node, `python -m uvicorn main:app --port <port>` for FastAPI).

### Not runnable — empty / stub directory

| Directory                       | Why it's not runnable                                                          |
| --------------------------------- | ---------------------------------------------------------------------------------- |
| `Backend/document-service`       | Only a `.env` file and a couple of unused helper files — no `package.json`, no entry point. The **real** document service is `agentic-document-service` (`:8092`). |

### Legacy chat service

The current chat feature goes through `agentic-chat-service` (`:8096`). The **old** Node.js
chat service, `Backend/ChatModel`, still exists but isn't part of the normal stack. If you do
need to run it, always set its port explicitly:

```powershell
cd "Backend/ChatModel"; $env:PORT=5007; npm start   # → :5007
```

Two traps if you forget `PORT=5007`: its code falls back to `5003` (clashing with
payment-service), and its checked-in `.env` sets `PORT=8080` (clashing with an old, unused
document-service port).

A Windows launcher for the older service set exists at `Backend/run-all-backends.ps1`.

---

## Ports & config gotchas

A handful of ports don't do what you'd guess from reading the code in isolation.

**Citation runs on `8002`, not `8001`.**
The frontend calls citation at `http://localhost:8002` for local dev. The citation service has
**no** built-in default port, so it comes entirely from the command you run it with — always
pass `--port 8002`. If you see `8001` mentioned in `Backend/SERVICES_AND_PORTS.md`, that's
outdated.

**Judgement service uses `api:app`, not `main:app`.**
Its entry point is `api.py`. Using `main:app` will fail to start it.

**Citation v1 (`:8004`) has no code in this repo.**
`apiConfig.js` still falls back to `http://localhost:8004`, but `Backend/citation-service-v1/`
has been removed. Point `VITE_APP_CITATION_V1_SERVICE_URL` at a deployed instance if you need it.

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

**Virtual-environment folders are not tracked by git.**
`.gitignore` excludes `venv/` and `.venv/` everywhere, so a fresh clone has none of them. See
[Prerequisites](#prerequisites) — and note that the one venv that *does* exist here
(`agentic-document-service/.venv`) is currently broken.

**`__pycache__` / `.pyc` files are no longer tracked.**
36 compiled `.pyc` files were committed before `__pycache__/` was added to `.gitignore`, which
made every `git pull` conflict on binary bytecode. They have been untracked (`git rm --cached`);
the files remain on disk and Python regenerates them. If you pull a commit where they vanish
from git, that's expected and harmless.

**`Backend/document-service/` is empty — don't confuse it with the real thing.**
It has no `package.json` and no entry file, so it can't be started. The real document service is
`agentic-document-service` (Python, `:8092`).

**`Backend/SERVICES_AND_PORTS.md` describes an older version of the backend.**
It doesn't know about `agentic-document-service` (`8092`), `agentic-chat-service` (`8096`),
`judgement-service` (`8005`), or most of the extra services in this README, and it lists citation
on the wrong port (`8001`). It is still correct for the older Node services it does cover
(gateway `5000`, auth `5001`, payment `5003`, ChatModel `5007`) — but prefer this README for
anything else.

---

## Frontend configuration

The frontend decides which URL to call for each backend in
`frontend/src/config/apiConfig.js`. When you're running on `localhost` / `127.0.0.1`, it
**automatically** falls back to the local ports above — no environment variables needed — for
Auth (`5001`), Payment (`5003`), Document (`8092`), Chat (`8096`), Citation (`8002`),
Citation v1 (`8004`) and Judgement (`8005`).

A few services do **not** have an automatic local fallback — by default they always point at a
deployed Cloud Run URL, even when you're developing locally. To use your own local copy of one
of these instead, add the matching variable to `frontend/.env`:

| Service               | Environment variable                     | Set it to (if running locally) |
| ----------------------- | ------------------------------------------ | ---------------------------------- |
| Gateway                | `VITE_APP_GATEWAY_URL` (or `VITE_APP_API_URL`) | `http://localhost:5000`        |
| Visual Service         | `VITE_APP_VISUAL_SERVICE_URL`              | `http://localhost:8081`            |
| AI Chatbot             | `VITE_APP_AI_CHATBOT_URL`                  | `http://localhost:8095`            |
| Agent Draft Service    | `VITE_APP_AGENT_DRAFT_TEMPLATE_URL`        | `http://localhost:8000`            |
| Chat Draft Backend     | `VITE_APP_CHAT_DRAFT_BACKEND_URL`          | `http://localhost:8010`            |
| Citation v1            | `VITE_APP_CITATION_V1_SERVICE_URL`         | *(no local code — use a deployed URL)* |
| Judgement              | `VITE_APP_JUDGEMENT_SERVICE_URL`           | `http://localhost:8005`            |

Firebase authentication needs the six `VITE_FIREBASE_*` variables set in `frontend/.env`. Every
variable the frontend reads must start with `VITE_` — that's a Vite requirement, anything
without that prefix is invisible to the browser code.
