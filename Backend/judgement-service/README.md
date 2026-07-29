# Jurinex Judgement Service

Agent-orchestrated Indian case-law retrieval (Google ADK + FastAPI), port **8005**.

A lawyer submits a case (document upload or typed summary). The service:

1. **Document Context Service** — ADK `SequentialAgent` (classify → extract) turns raw
   input into structured `CaseContext`, with a deterministic **anti-invention guard**
   (sections/statutes in extracted facts must exist in the source) and a completeness
   check that asks for clarification instead of guessing.
2. **Issue split** (Stage 1, Gemini, temp 0.25) — distinct legal issues, one per body of law.
3. Per issue, concurrently (**issue_fanout**): **keyword extraction** across four axes
   (doctrinal/statutory/factual/outcome) → **Indian Kanoon** fan-out fetch (union, dedupe,
   cap 22) → **segment-level re-rank** (Gemini embeddings, Qdrant cache) → precision layers
   (party perspective, authority, good-law lite) → **composite score** with explainable
   per-signal breakdown.
4. **CitationGuardian** — deterministic, non-LLM, runs on EVERY response, no bypass:
   drops any docId not fetched from Indian Kanoon in this request, and any pinpoint not
   literally present in the fetched judgment text. *We never originate a citation.*
5. **Search-within-search** — facet/keyword/semantic refinement of the cached result set
   (reorder/de-emphasise, never delete), with an explicit Indian-Kanoon escape hatch.

## Run

```powershell
cd Backend\judgement-service
.\venv\Scripts\python.exe -m uvicorn api:app --host 0.0.0.0 --port 8005
```

All credentials come from `.env` (see `.env.example`). Redis/Qdrant/Neo4j/Postgres are
optional — the service degrades gracefully when they are absent.

## API

| Endpoint | Purpose |
|---|---|
| `GET /health` | Status, active phase weights, store availability |
| `POST /api/v1/analyze` | `{caseInput:{text,fileRef}}` → sessionId + case context + suggested issues (no IK spend) |
| `POST /api/v1/analyze/case` | `{caseId, text?, userId?}` → analyze one of the user's stored cases: documents pulled from the agentic document service (HTTP, forwarding `Authorization` + `X-User-Id`), per-page chunks from Document_DB `file_chunks`, so issues carry deterministic `file, page N` source refs |
| `POST /api/v1/analyze/upload` | multipart PDF/DOCX + optional note → same as above |
| `POST /api/v1/search/{sessionId}/run` | `{issueIds?, customIssues?}` → precedents grouped by issue |
| `POST /api/v1/search` | one-shot: analyze + split + search (spec Section 11 contract) |
| `POST /api/v1/search/upload` | one-shot, multipart |
| `POST /api/v1/search/{sessionId}/refine` | `{issueId, mode: facet\|keyword\|semantic\|ik_escape, query}` |

The `signals` object on each result is the explainability contract — render one chip
per key; new precision layers appear as new keys, never as schema changes.

## Scoring phases

Weights are **config** (`SCORING_PHASE` + optional `SCORING_WEIGHTS_JSON`), not code.
Phase 1 (now): semantic 70 / keyword 30. Phase 2 adds authority/party once those layers
are trusted; Phase 3 adds good-law/fact once the Neo4j typed citation graph is live.
Good-law is a **gate**: an overruled case is capped + red-flagged regardless of score.

## Tests & evals

```powershell
.\venv\Scripts\python.exe -m pytest -q                      # offline suite (guardian adversarial, scoring, refine…)
.\venv\Scripts\python.exe -m evals.eval_citation_guardian    # offline, adversarial
.\venv\Scripts\python.exe -m evals.eval_issue_split          # live Gemini
.\venv\Scripts\python.exe -m evals.eval_keyword_extract      # live Gemini, 5 runs/fixture
.\venv\Scripts\python.exe -m evals.eval_document_context     # live Gemini
```

## Frontend

The **Citation Research** sidebar module (`/citation-research`) uses
`frontend/src/services/judgementApi.js` → `VITE_APP_JUDGEMENT_SERVICE_URL`
(defaults to `http://localhost:8005` in local dev).
