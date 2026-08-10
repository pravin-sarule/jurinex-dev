# JuriNex — Architecture

JuriNex is an AI-assisted legal platform for Indian practice: case and document
management, AI chat over case files, legal drafting, citation / judgement
research against Indian Kanoon, billing and team management. It is a React
single-page app backed by ~20 microservices (a mix of Node/Express and Python
FastAPI), Google Cloud storage/AI, and PostgreSQL.

Deeper references: [`Backend/SERVICES_AND_PORTS.md`](Backend/SERVICES_AND_PORTS.md)
(run commands, gateway proxy map), [`RBAC_documentation.md`](RBAC_documentation.md),
[`docs/`](docs/) (billing + citation usage analyses).

---

## High-level shape

```
┌────────────────────────────────────────────────────────────────────┐
│  React SPA (frontend/, Vite + Tailwind v4)                         │
│  auth token in localStorage · apiConfig.js resolves every service  │
│  URL (VITE_* env override → localhost default → Cloud Run URL)     │
└───────┬───────────────────────────────┬────────────────────────────┘
        │ via gateway (5000)            │ direct (FastAPI services)
        ▼                               ▼
  Node services                   Python services
  auth · document · payment ·     agentic-document (8092) · agentic-chat (8096)
  drafting/zoho/draft · chat      judgement (8005) · citation (8001/8002) ·
                                  citation-v1 (8004) · citation-testing (8003) ·
                                  agent-draft (8000) · template-analyzer · visual
        │                               │
        ▼                               ▼
  PostgreSQL · Google Cloud Storage · Redis · Qdrant (optional) · Neo4j (optional)
        +
  External AI/legal APIs: Google Gemini (google-genai + ADK), Anthropic Claude,
  Google Document AI (OCR), Indian Kanoon API, DeepSeek (free tier), Serper
```

Two integration styles coexist:

- **Gateway-proxied** (older Node stack): the SPA calls `gateway-service`
  (port 5000) which proxies `/api/auth`, `/api/chat`, `/payments`, `/drafting`,
  `/visual`, … to the Node services.
- **Direct** (newer Python stack): the SPA calls FastAPI services directly on
  their own ports/URLs (agentic-document, agentic-chat, judgement, citation,
  agent-draft, template analyzer). `frontend/src/config/apiConfig.js` is the
  single source of truth for these URLs.

---

## Service catalog

Ports are the local-dev defaults; production runs on Cloud Run
(`https://<service>-120280829617.asia-south1.run.app`, region `asia-south1`).

| Service | Tech | Port | Purpose |
|---|---|---|---|
| `frontend` | React 19 + Vite + Tailwind v4 | 5173 | The SPA (all UI) |
| `gateway-service` | Node | 5000 | Reverse proxy for the Node stack |
| `authservice` | Node | 5001 | Login/signup, **signs HS256 JWTs** (`JWT_SECRET`), device sessions (3-device limit, `sid` claim) |
| `document-service` | Node | 8080 | Legacy files/chat backend behind the gateway |
| `payment-service` | Node | 5003 | Plans, token quotas, billing; central free-tier signal in its token-check |
| `Translation-service` | Node | 3000 | Document translation |
| `zoho-service` / `drafting-service` / `draft-service` | Node | 5006 / 5005 / 4000 | Zoho, Google Docs, and MS Word drafting integrations |
| `ChatModel` | Node | 5007 | Standalone chat model backend (optional) |
| `agent-draft-service` | Python FastAPI | 8000 | Template-based AI drafting (DOCX ingestion, `ai_drafting_instruction` contract) |
| `citation-service` | Python FastAPI | 8001 (frontend default 8002) | Citation lookups + reports; ADK Tier-3 web agent |
| `citation-testing` | Python FastAPI | 8003 | Gemini-Grounding vs Claude-Serper comparison harness |
| `citation-service-v1` | Python FastAPI | 8004 | ADK + Claude + Serper citation pipeline |
| `judgement-service` | Python FastAPI + Google ADK | **8005** | **Citation Research**: issues/grounds → verified Indian Kanoon precedents (see pipeline below) |
| `agentic-document-service` | Python FastAPI | **8092** | Case/document pipeline: signed-URL GCS upload, Document AI OCR, chunking, embeddings, case autofill (`/api/files/...`) |
| `ai-chatbot` | Python | 8095 | AI chatbot (port reserved — do not reuse) |
| `agentic-chat-service` | Python FastAPI | **8096** | Document chat + Drafting Mode (structured template analysis, section-by-section SSE drafts) |
| `Visual-Service` | Python Flask | 8081 | Mind maps / visuals |
| `Template Analyzer Agent` | Python FastAPI | 5017 | Template structure analysis (1 structured-output Gemini call + verbatim section slicing) |
| `support-service` | — | 5004 | Gateway placeholder (not in repo) |

---

## Identity & security

- **authservice** signs **HS256 JWTs** with the shared `JWT_SECRET`; the payload
  carries the numeric user id as `id` (older tokens `userId`), plus
  `user_uuid`, `email`, and a `sid` device-session claim.
- The SPA stores the token in `localStorage` (`token`, with legacy fallbacks)
  and sends `Authorization: Bearer <token>` plus `X-User-Id` on every call
  (`getAuthHeader()` per service client, `getUserIdForDrafting()` in apiConfig).
- **Python services verify the JWT** with PyJWT and the same secret
  (`agent-draft-service/services/jwt_auth.py`, `judgement-service/auth.py`,
  `citation-service/main.py`, `agentic-chat-service/app/core/auth.py`).
  House rule (see `judgement-service/auth.py`): a **valid token is the identity
  of record**; when verification is available, the spoofable `X-User-Id`
  header/body ids are never trusted on their own — they remain only as a
  dev/offline fallback when `JWT_SECRET` is absent.
- Cloud Run note: `.env` files are dockerignored — every secret (including
  `JWT_SECRET`) must be set as env vars on the deployed service.
- RBAC for firm accounts is documented in `RBAC_documentation.md`
  (FIRM_ADMIN vs members; member scoping in citation reports).

---

## Data stores

| Store | Used by | Notes |
|---|---|---|
| PostgreSQL `citationTest` | judgement-service, citation services | `judgement_sessions` (JSONB session write-through incl. results/reports/statuses, `user_id` scoped), `judgement_vault`; pooled psycopg2 with dead-connection retry + TCP keepalives |
| PostgreSQL `Document_DB` | agentic-document-service, agent-draft | `user_files`, `file_chunks` (content + page refs), OCR extractions |
| Payment / auth DBs | payment-service, authservice | plans, quotas, device sessions |
| Google Cloud Storage | agentic-document-service | raw documents (browser PUTs via signed URLs), extracted text |
| Redis | judgement/citation | cache layer (falls back to in-memory) |
| Qdrant | judgement-service | embedding cache (optional; degrades gracefully) |
| Neo4j | judgement-service | optional graph store (off by default) |

---

## Key pipelines

### 1. Case creation & document processing (agentic-document-service, 8092)

`Create New Case` wizard (frontend `pages/CreateCase/`) → per file:
`generate-upload-url` → browser PUT to GCS → `complete-upload` enqueues one
processing job per document. Workers run Document AI OCR (v2.1 processor,
concurrency-gated), chunk + embed, and LLM-autofill the case form (first-wins
merge across documents). Wizard state persists to sessionStorage so refreshes
mid-flow never lose processed documents; it is cleared on successful creation.
Parallelism knobs live in `app/core/config.py` (document workers, queue
workers, OCR workers, DocAI request semaphore).

### 2. Citation Research (judgement-service, 8005)

The flagship research pipeline (frontend `components/CitationResearch/`):

1. **Analyze** (`/api/v1/analyze[/case|/case/fresh|/upload]`) — pulls case
   documents (from 8092) or uploads; Claude (Opus, Gemini fallback) extracts
   **pleaded grounds + spotted legal issues** ("combined" mode; "fresh" mode
   builds proposed grounds from a stated objective), generates per-issue
   Indian Kanoon queries (simple keyword or opt-in Boolean style — IK wire
   operators are `ANDD/ORR/NOTT`).
2. **Pick** — the user selects grounds/issues, curates per-issue queries
   (checkbox contract: exactly what is ticked runs), adds custom issues
   (enriched server-side to full parity).
3. **Search** (`/api/v1/search/{sid}/run`) — per-issue IK fan-out (anchor
   queries at 2× weight, forum-HC re-run, exclusion-aware retry), full-text
   fetch, **PROMPT-3 per-judgment verifier** (kill gates: outcome, decisional
   lens, statutory shelf, relief head, sub-doctrine trigger, parasitic
   citations; deterministic score recompute), bench-wise ordering with the
   client's forum High Court ranked first, and the deterministic
   **CitationGuardian** (every cited docId must exist in the fetch pool —
   nothing invented).
4. **Review** — citation cards with side badges (supports/contra/interim) and
   judge "% on point"; per-citation **Report** (grounded analysis, judgment
   summary, adversarial preparation, good-law web check) and full **Document**
   text. Sessions, reports and approve/reject decisions write through to
   Postgres and reopen from the Recents rail.

### 3. Document chat & Drafting Mode (agentic-chat-service, 8096)

Case-scoped AI chat over processed documents (live UI: `ChatInterface.jsx`),
with repetition guards and recovery caching; Drafting Mode runs a structured
template analysis then streams section-by-section drafts over SSE.

### 4. Drafting (agent-draft-service 8000, Template Analyzer 5017)

Template ingestion (DOCX), template structure analysis, and AI drafting with
per-user template libraries.

### 5. Plans & free tier (payment-service)

The token-check endpoint centrally signals free-plan users; AI services route
free-tier traffic to DeepSeek via per-service adapters while enforcing the
free-plan DB limits.

---

## Frontend structure (frontend/)

- `src/config/apiConfig.js` — every service URL (env override → localhost →
  Cloud Run) + `getUserIdForDrafting()`.
- `src/services/*.js` — one client per backend (`judgementApi`, `documentApi`,
  …); each attaches the Bearer token + `X-User-Id`.
- `src/pages/` + `src/components/` — feature modules (CreateCase wizard,
  CitationResearch, chat, settings…). Layout chain: `MainLayout` → sidebar +
  `MainContent` (the **single scroll container** — feature pages use bounded
  `h-full` layouts with their own internal scroll panes).
- **Appearance system** (`src/utils/fontPrefs.js`): a site-wide font picker
  injects a `body * { font-family !important }` override, and a text-size
  preference sets `--jnx-text-scale`; reading surfaces (chat, citation pages)
  size text as `calc(px * var(--jnx-text-scale, 1))`.
- Theme: light slate + brand teal `#21C1B6`; the redesigned research pages use
  the mock palette (ink `#0F1B21`, teal `#3FC8B4`/`#0E8371`, mint `#E9F9F5`).
  Red/amber/green appear only as semantic status colours.

---

## Operational notes

- **Local run**: `Backend/run-all-backends.ps1` or the per-service commands in
  `SERVICES_AND_PORTS.md`. Python services run from their own venvs
  (e.g. judgement: `.\venv\Scripts\python.exe -m uvicorn api:app --port 8005`) —
  a service accidentally started with the system Python runs stale code.
- **Health checks**: FastAPI services expose `/health` with capability flags
  (e.g. judgement: `ikTokenRejected`, `jwtVerification`, `relevanceJudge`) —
  check these before debugging "no results" symptoms.
- **Cloud Run**: Dockerfiles follow the citation-service pattern
  (python-slim + gunicorn UvicornWorker bound to the injected `$PORT`);
  `.env` is dockerignored, so all config must be service env vars. Long
  searches need a raised request timeout (`gcloud run services update
  judgement-service --timeout=3600`).
- **Prompts load at import** — after editing Python prompt/config code,
  restart the service; compare process start time vs file mtime when a change
  "doesn't apply".
