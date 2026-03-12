# Citation Service — Agents Documentation

> Auto-generated documentation for the JuriNex **citation-service** multi-agent pipeline.
> Covers agent architecture, LLM prompt mapping, database configuration, API endpoints, and dataflow.

---

## 1. Overview

The **citation-service** is a Python/FastAPI multi-agent system that performs legal citation discovery, verification, and reporting for Indian court judgments. It orchestrates multiple specialized agents in a pipeline:

```
User Query → KeywordExtractor → Watchdog → Fetcher → Clerk → Librarian → Auditor → ReportBuilder → Citation Report
```

The system now supports **dynamic prompt loading** from database tables:
- `Draft_DB.public.agent_prompts` → agent prompts, model references, temperature
- `Document_DB.public.llm_models` → LLM model definitions

**Prompt resolution precedence:**
1. 🟢 **Database** — prompt loaded from `Draft_DB.agent_prompts`
2. 🔵 **File** — prompt loaded from local file (e.g. `instructions/citation.txt`)
3. 🟡 **Default** — hardcoded in-code prompt

---

## 2. Agent Architecture

### 2.1 All Agents Summary

| # | Agent | Class/Function | File | Uses LLM? | Model | Pipeline Role |
|---|-------|---------------|------|-----------|-------|---------------|
| 1 | **KeywordExtractor** | `KeywordExtractorAgent` (inner class) | `agents/root_agent.py` | ✅ Yes | Claude | Generates structured search queries from case context |
| 2 | **Watchdog** | `WatchdogAgent` | `agents/watchdog.py` | ❌ No | — | Multi-source search (local DB, Indian Kanoon API, Google) |
| 3 | **Fetcher** | `FetcherAgent` | `agents/fetcher.py` | ❌ No | — | Downloads full judgment text from URLs |
| 4 | **Clerk** | `ClerkAgent` (via `_gemini_extract`) | `agents/clerk.py` | ✅ Yes | Gemini | Extracts 10 structured citation data points |
| 5 | **Librarian** | `LibrarianAgent` | `agents/librarian.py` | ❌ No | — | Validates/deduplicates citations via regex + heuristics |
| 6 | **Auditor** | `AuditorAgent` | `agents/auditor.py` | ❌ No | — | Verification scoring + quality checks |
| 7 | **ReportBuilder** | `ReportBuilderAgent` (via `_enrich_with_gemini`) | `report_builder.py` | ✅ Yes | Gemini | Builds final report; enriches blank fields via LLM |
| 8 | **CitationAgent** | `run_citation_agent()` | `citation_agent.py` | ✅ Yes | Gemini | Legacy fallback agent for simple citation generation |
| 9 | **TreatmentExtractor** | `extract_subsequent_treatment_llm()` | `subsequent_treatment_extractor.py` | ✅ Yes | Gemini | Extracts subsequent treatment (followed/distinguished/overruled) |
| 10 | **LegalCitationAgent** | `LegalCitationAgent` | `agents/legal_citation_agent.py` | ❌ No | — | CRUD operations for citation blacklists |

### 2.2 Orchestration

| Component | File | Role |
|-----------|------|------|
| **CitationRootAgent** | `agents/root_agent.py` | Main orchestrator — runs KeywordExtractor, then delegates to wrapped agents in sequence |
| **BaseAgent** | `agents/base_agent.py` | Abstract base class with `_gemini()` and `_claude()` helper methods |
| **Pipeline** | `pipeline.py` | Entry point — creates `CitationRootAgent`, manages run lifecycle |

---

## 3. LLM Agents (Require DB Prompts)

These agents make direct LLM API calls and are targets for dynamic prompt loading.

---

### 3.1 ClerkAgent

| Property | Value |
|----------|-------|
| **File** | `agents/clerk.py` |
| **Function** | `_gemini_extract()` |
| **LLM** | Gemini (direct `genai.Client` call) |
| **DB Prompt Key** | `Clerk` |
| **agent_type** | `citation` |
| **Default Temperature** | `0.1` |
| **Default Max Tokens** | `1536` |
| **Purpose** | Extract ALL 10 mandatory citation data points from full judgment text |

**Default Prompt** (`_DEFAULT_CLERK_PROMPT`):
```
You are a specialized legal document analyzer for Indian Court Judgments.
Extract ALL 10 mandatory citation points from the judgment. Read the FULL text provided — ratio and key holdings often appear in the middle or end.
Fix OCR errors (e.g. '1PC' → 'IPC'). Do NOT leave any point empty if the information appears anywhere in the text.
Use "Further research needed" ONLY when the information is genuinely absent from the document.

Return ONLY a single valid JSON object. No explanation.

10 Required Points (exact keys) — extract from the complete judgment:
{
  "caseName": "...",
  "primaryCitation": "...",
  "alternateCitations": [...],
  "court": "...",
  "coram": "...",
  "benchType": "...",
  "dateOfJudgment": "...",
  "statutes": [...],
  "ratio": "...",
  "excerptPara": "...",
  "excerptText": "...",
  "subsequentTreatment": { "followed": [...], "distinguished": [...], "overruled": [...] },
  "verificationStatus": "...",
  "officialSourceUrl": "..."
}

Context Title: {title}
Original Query: {query}
Complete judgment text: {excerpt}
```

**Template variables:** `{title}`, `{query}`, `{excerpt}`

---

### 3.2 ReportBuilder (Enrichment)

| Property | Value |
|----------|-------|
| **File** | `report_builder.py` |
| **Function** | `_enrich_with_gemini()` |
| **LLM** | Gemini (direct `genai.Client` call) |
| **DB Prompt Key** | `ReportBuilder` |
| **agent_type** | `citation` |
| **Default Temperature** | `0.1` |
| **Default Max Tokens** | `1024` |
| **Purpose** | Fill blank/placeholder citation fields from raw judgment text |

**Default Prompt** (`_DEFAULT_REPORT_ENRICHMENT_PROMPT`):
```
You are a legal data extraction expert for Indian court judgments.
Extract ALL 10 mandatory citation points from the FULL judgment text below.
...
(Same 10-point JSON structure as Clerk, with keys:
caseName, primaryCitation, alternateCitations, court, coram, benchType,
dateOfJudgment, statutes, ratio, excerptPara, excerptText,
subsequentTreatment, verificationStatus, officialSourceUrl)

Case title: {title}
Query context: {query}
Full judgment text: {raw}
```

**Template variables:** `{title}`, `{query}`, `{raw}`

---

### 3.3 KeywordExtractor (Primary)

| Property | Value |
|----------|-------|
| **File** | `agents/root_agent.py` |
| **Class** | `KeywordExtractorAgent` (inner class of `CitationRootAgent`) |
| **LLM** | Claude (via `self._claude()` — BaseAgent pathway) |
| **DB Prompt Key** | `KeywordExtractor` |
| **agent_type** | `citation` |
| **Default Temperature** | `0.2` |
| **Default Max Tokens** | `800` |
| **Purpose** | Generate 10 structured 3-layer search queries for legal research |

**Default Prompt:**
```
You are a senior Indian legal research assistant using a multi-search engine.
Consider ALL of the attached case context below.

Task: Generate EXACTLY {target} high-quality search query strings.
Each query must combine three layers:
  Layer 1: Legal section/statute
  Layer 2: Doctrine/fact pattern
  Layer 3: Court + time hint

User query: {base_query}
Case context: {case_context}

Output: EXACTLY {target} lines. One query per line.
```

**Template variables:** `{target}`, `{base_query}`, `{case_context}`

---

### 3.4 KeywordExtractor (Fallback)

| Property | Value |
|----------|-------|
| **DB Prompt Key** | `KeywordExtractorFallback` |
| **agent_type** | `citation` |
| **Default Temperature** | `0.2` |
| **Default Max Tokens** | `200` |
| **Purpose** | Shorter fallback when primary keyword generation returns empty |

**Default Prompt:**
```
You are a legal research assistant. Given the user's query and case file excerpts,
produce 5–10 short Indian legal search keywords/phrases (comma-separated).
Focus on statutes, doctrines, and fact patterns. No explanation.

User query: {base_query}
Case context: {case_context}
Keywords:
```

**Template variables:** `{base_query}`, `{case_context}`

---

### 3.5 CitationAgent (Legacy Fallback)

| Property | Value |
|----------|-------|
| **File** | `citation_agent.py` |
| **Function** | `run_citation_agent()` |
| **LLM** | Gemini (direct `genai.Client` call, uses `system_instruction`) |
| **DB Prompt Key** | `CitationAgent` |
| **agent_type** | `citation` |
| **Default Temperature** | `0.3` |
| **Default Max Tokens** | `4096` |
| **Prompt Fallback** | DB → `instructions/citation.txt` → empty string |
| **Purpose** | Legacy single-shot citation generation when pipeline is bypassed |

**File-based prompt** (`instructions/citation.txt`):
```
You are a legal citation assistant. Generate citations following these rules:
1. Only cite real, verifiable judgments.
2. Prefer Indian law sources (SCC, AIR, etc.)
...
(14-line system instruction)
```

> This is the **only agent** with 3-state fallback: 🟢 DATABASE → 🔵 FILE → 🟡 DEFAULT (empty)

---

### 3.6 TreatmentExtractor

| Property | Value |
|----------|-------|
| **File** | `subsequent_treatment_extractor.py` |
| **Function** | `extract_subsequent_treatment_llm()` |
| **LLM** | Gemini (direct `genai.Client` call) |
| **DB Prompt Key** | `TreatmentExtractor` |
| **agent_type** | `citation` |
| **Default Temperature** | `0.0` |
| **Default Max Tokens** | `1200` |
| **Purpose** | Extract subsequent treatment references (followed, distinguished, overruled, reversed, relied_on, applied, cited, referred, approved, disapproved) |

**Default Prompt:**
```
You are a senior Indian legal researcher analysing a court judgment.
Extract ALL "Subsequent Treatment" references from the text below.

Find cases where THIS judgment was:
  • FOLLOWED / DISTINGUISHED / OVERRULED / REVERSED

Also find cases that THIS judgment itself:
  • RELIED ON / APPLIED / CITED / REFERRED TO / APPROVED / DISAPPROVED

Return JSON with keys: followed, distinguished, overruled, reversed,
relied_on, applied, cited, referred, approved, disapproved

Each entry: {"case_name": "...", "year": "...", "citation": "..."}

{case_title_line}
JUDGMENT TEXT: {focused}
```

**Template variables:** `{case_title_line}`, `{focused}`

---

## 4. Non-LLM Agents

These agents do **NOT** use any LLM API calls. Verified via `grep` — zero occurrences of `gemini`, `claude`, `genai`, `generate_content`, `_gemini`, `_claude`, or `prompt =` in their source files.

| Agent | File | Why No LLM |
|-------|------|------------|
| **Watchdog** | `agents/watchdog.py` | Pure search orchestration — calls local DB (PostgreSQL/Elasticsearch), Indian Kanoon API, and Google Serper API |
| **Fetcher** | `agents/fetcher.py` | Pure HTTP client — downloads judgment HTML/text from URLs |
| **Librarian** | `agents/librarian.py` | Regex-based validation — deduplicates, normalizes citations, checks format |
| **Auditor** | `agents/auditor.py` | Heuristic scoring — performs API-based verification, calculates confidence scores |
| **LegalCitationAgent** | `agents/legal_citation_agent.py` | Pure DB CRUD — manages citation blacklists in PostgreSQL |

> **No DB prompt rows are needed for these agents.** They should be skipped entirely in the `agent_prompts` table.

---

## 5. Database Prompt Configuration

### 5.1 How Prompts Are Loaded

```
resolve_prompt(name, agent_type, default_prompt, default_model, ...)
                │
                ├──→ Check in-process cache (TTL = 60s)
                │       ├── Hit → return cached PromptConfig
                │       └── Miss ↓
                │
                ├──→ Query Draft_DB.agent_prompts
                │       WHERE name = <name> AND agent_type = <agent_type>
                │       ORDER BY updated_at DESC LIMIT 1
                │       ├── Row found + prompt non-empty → source = "database" 🟢
                │       ├── Row found but prompt blank → try file fallback
                │       └── Row not found → try file fallback
                │
                ├──→ File fallback (if file_path provided)
                │       ├── File exists + content non-empty → source = "file" 🔵
                │       └── No file → use default prompt
                │
                └──→ Default (in-code) prompt → source = "default" 🟡
```

### 5.2 Model Resolution

```
model_ids from agent_prompts row
        │
        ├──→ Parse safely (_parse_model_ids handles array / JSON / text / int formats)
        │
        ├──→ Query Document_DB.llm_models WHERE id = ANY(ids) AND is_active = true
        │       ├── Active models found → use first model name
        │       └── No active models → fallback to env GEMINI_MODEL / CLAUDE_MODEL
        │
        └──→ DB unreachable → fallback to env variable model
```

### 5.3 Prompt Key Reference

| DB `name` | DB `agent_type` | Agent | Model |
|-----------|-----------------|-------|-------|
| `Clerk` | `citation` | ClerkAgent | Gemini |
| `ReportBuilder` | `citation` | ReportBuilder | Gemini |
| `KeywordExtractor` | `citation` | KeywordExtractorAgent | Claude |
| `KeywordExtractorFallback` | `citation` | KeywordExtractorAgent (fallback) | Claude |
| `CitationAgent` | `citation` | Legacy citation agent | Gemini |
| `TreatmentExtractor` | `citation` | Subsequent treatment extractor | Gemini |

---

## 6. SQL Setup Examples

### 6.1 Insert Prompt Rows

```sql
-- Clerk: structured extraction from judgments (Gemini)
INSERT INTO public.agent_prompts (name, agent_type, prompt, model_ids, temperature)
VALUES ('Clerk', 'citation',
  'You are a specialized legal document analyzer for Indian Court Judgments.
Extract ALL 10 mandatory citation points from the judgment...
(paste full prompt with {title}, {query}, {excerpt} placeholders)',
  '{1}', 0.1);

-- ReportBuilder: enrich blank citation fields (Gemini)
INSERT INTO public.agent_prompts (name, agent_type, prompt, model_ids, temperature)
VALUES ('ReportBuilder', 'citation',
  'You are a legal data extraction expert for Indian court judgments.
Extract ALL 10 mandatory citation points from the FULL judgment text...
(paste full prompt with {title}, {query}, {raw} placeholders)',
  '{1}', 0.1);

-- KeywordExtractor: generate search queries (Claude)
INSERT INTO public.agent_prompts (name, agent_type, prompt, model_ids, temperature)
VALUES ('KeywordExtractor', 'citation',
  'You are a senior Indian legal research assistant...
Task: Generate EXACTLY {target} high-quality search query strings...
(paste full prompt with {target}, {base_query}, {case_context} placeholders)',
  '{4}', 0.2);

-- KeywordExtractorFallback: shorter fallback keywords (Claude)
INSERT INTO public.agent_prompts (name, agent_type, prompt, model_ids, temperature)
VALUES ('KeywordExtractorFallback', 'citation',
  'You are a legal research assistant...produce 5-10 short keywords...
(paste full prompt with {base_query}, {case_context} placeholders)',
  '{4}', 0.2);

-- CitationAgent: legacy fallback system instruction (Gemini)
INSERT INTO public.agent_prompts (name, agent_type, prompt, model_ids, temperature)
VALUES ('CitationAgent', 'citation',
  'You are a legal citation assistant. Generate citations following these rules...
(paste full system instruction)',
  '{1}', 0.3);

-- TreatmentExtractor: subsequent treatment from judgments (Gemini)
INSERT INTO public.agent_prompts (name, agent_type, prompt, model_ids, temperature)
VALUES ('TreatmentExtractor', 'citation',
  'You are a senior Indian legal researcher analysing a court judgment...
Extract ALL Subsequent Treatment references...
(paste full prompt with {case_title_line}, {focused} placeholders)',
  '{1}', 0.0);
```

### 6.2 Recommended Uniqueness Constraint

```sql
-- Enforce one prompt per (name, agent_type) pair
ALTER TABLE public.agent_prompts
ADD CONSTRAINT uq_agent_prompts_name_type UNIQUE (name, agent_type);
```

---

## 7. Pipeline Dataflow

```
User Query (POST /citation/report or POST /citation/report/start)
     │
     ▼
┌──────────────────────────────────────────────────────┐
│  🚀 pipeline.py → run_pipeline()                    │
│  Creates run_id, logs to DB, starts rich console     │
└──────────┬───────────────────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────────────────┐
│  🏗️  CitationRootAgent.run(context)                 │
│  Orchestrates all sub-agents in sequence             │
└──────────┬───────────────────────────────────────────┘
           │
     ┌─────┴─────┐
     ▼           │
┌─ 🔑 KeywordExtractor ───────────────────────────────┐
│  📥 Input: query + case_file_context (chunks/embeds) │
│  🤖 LLM: Claude (resolved via DB or default)        │
│  📤 Output: keyword_sets[] (10 search queries)       │
│  ⏱️  ~2–4s                                           │
└──────────┬───────────────────────────────────────────┘
           ▼
┌─ 🐕 Watchdog ───────────────────────────────────────┐
│  📥 Input: keyword_sets[]                            │
│  🔍 Searches: Local DB → Indian Kanoon → Google      │
│  📤 Output: raw_candidates[] (URLs + metadata)       │
│  ⏱️  ~2–5s                                           │
└──────────┬───────────────────────────────────────────┘
           ▼
┌─ 📥 Fetcher ────────────────────────────────────────┐
│  📥 Input: raw_candidates[] with URLs                │
│  🌐 HTTP: Downloads full judgment text               │
│  📤 Output: fetched_judgments[] (with full_text)     │
│  ⏱️  ~3–8s                                           │
└──────────┬───────────────────────────────────────────┘
           ▼
┌─ 📋 Clerk ──────────────────────────────────────────┐
│  📥 Input: fetched_judgments[] (raw text)             │
│  🤖 LLM: Gemini (resolved via DB or default)        │
│  📤 Output: structured_citations[] (10 data points)  │
│  ⏱️  ~5–12s (parallel Gemini calls)                  │
└──────────┬───────────────────────────────────────────┘
           ▼
┌─ 📚 Librarian ──────────────────────────────────────┐
│  📥 Input: structured_citations[]                    │
│  📏 Rules: Dedup, normalize, validate format         │
│  📤 Output: validated_citations[]                    │
│  ⏱️  ~0.1s                                           │
└──────────┬───────────────────────────────────────────┘
           ▼
┌─ 🔍 Auditor ────────────────────────────────────────┐
│  📥 Input: validated_citations[]                     │
│  📏 Rules: Confidence scoring, API-based checks      │
│  📤 Output: scored_citations[] (with confidence)     │
│  ⏱️  ~0.5–2s                                         │
└──────────┬───────────────────────────────────────────┘
           ▼
┌─ 📊 ReportBuilder ──────────────────────────────────┐
│  📥 Input: scored_citations[]                        │
│  🤖 LLM: Gemini (enriches blank fields)             │
│  📤 Output: final report (stored in DB)              │
│  ⏱️  ~3–6s                                           │
└──────────┬───────────────────────────────────────────┘
           ▼
    Final Response (report_id, report_format, status)
```

**Total pipeline time:** ~15–40 seconds depending on network and number of judgments.

---

## 8. File Structure

```
citation-service/
├── main.py                              # FastAPI app — all API endpoints
├── pipeline.py                          # Pipeline entry point + rich logging  [MODIFIED]
├── citation_agent.py                    # Legacy fallback LLM agent           [MODIFIED]
├── report_builder.py                    # ReportBuilder + Gemini enrichment   [MODIFIED]
├── subsequent_treatment_extractor.py    # Treatment extraction (regex + LLM)  [MODIFIED]
├── claude_proxy.py                      # Claude API proxy
├── requirements.txt                     # Dependencies (+ rich, httpx)        [MODIFIED]
├── .env                                 # Environment variables (+ DRAFT_DB_URL) [MODIFIED]
│
├── agents/
│   ├── __init__.py
│   ├── base_agent.py                    # Abstract base with _gemini(), _claude()
│   ├── root_agent.py                    # CitationRootAgent orchestrator      [MODIFIED]
│   ├── clerk.py                         # ClerkAgent — Gemini extraction      [MODIFIED]
│   ├── watchdog.py                      # WatchdogAgent — multi-source search
│   ├── fetcher.py                       # FetcherAgent — HTTP fetch
│   ├── librarian.py                     # LibrarianAgent — validation
│   ├── auditor.py                       # AuditorAgent — scoring
│   └── legal_citation_agent.py          # LegalCitationAgent — DB CRUD
│
├── db/
│   ├── connections.py                   # DB connections + pooling             [MODIFIED]
│   ├── client.py                        # DB query functions
│   └── schema.sql                       # PostgreSQL schema (citation_db)
│
├── utils/                               # [NEW DIRECTORY]
│   ├── __init__.py                      # [NEW]
│   ├── prompt_resolver.py              # [NEW] Dynamic prompt resolution
│   └── rich_logger.py                  # [NEW] Rich console logging
│
└── instructions/
    └── citation.txt                     # Legacy system prompt for CitationAgent
```

---

## 9. Prompt Resolver System

### File: `utils/prompt_resolver.py`

**Key components:**

| Component | Description |
|-----------|-------------|
| `PromptConfig` | Dataclass holding resolved `prompt`, `model_name`, `temperature`, `max_tokens`, `source`, `warnings` |
| `resolve_prompt()` | Main entry point — DB → file → default with caching |
| `_fetch_prompt_from_db()` | Queries `Draft_DB.agent_prompts` using pooled connection |
| `_resolve_model_names()` | Queries `Document_DB.llm_models` for active model names |
| `_parse_model_ids()` | Safely parses `model_ids` from any format (array, JSON, text, int) |
| TTL Cache | In-process cache with 60-second TTL — avoids DB roundtrips within a pipeline run |

**Usage in agent files:**

```python
from utils.prompt_resolver import resolve_prompt

pc = resolve_prompt(
    name="Clerk",
    agent_type="citation",
    default_prompt=_DEFAULT_CLERK_PROMPT,
    default_model=os.environ.get("GEMINI_MODEL", "gemini-2.0-flash"),
    default_temperature=0.1,
    default_max_tokens=1536,
)

# For direct Gemini callers:
prompt = pc.prompt.format(title=title, query=query, excerpt=excerpt)
model = pc.model_name
config = GenerateContentConfig(temperature=pc.temperature, max_output_tokens=pc.max_tokens)
```

**Important:** 4 of 5 LLM agents are **direct Gemini callers** — they construct their own `genai.Client()` and apply the resolved config directly. Only KeywordExtractor uses `self._claude()` through BaseAgent.

---

## 10. Rich Logging

### File: `utils/rich_logger.py`

**Prompt source indicators:**

| Label | Meaning |
|-------|---------|
| 🟢 `DATABASE` | Prompt loaded from `Draft_DB.agent_prompts` |
| 🔵 `FILE` | Prompt loaded from file (e.g. `instructions/citation.txt`) |
| 🟡 `DEFAULT` | Using hardcoded in-code prompt |
| 🔴 `ERROR` | DB connection failed, fell back to default |

**Console output example:**

```
┌──────────────────────────────────────────────────────┐
│  🚀 CITATION PIPELINE STARTED                       │
│  Query: "Section 302 IPC murder circumstantial..."   │
│  User: user_123 | Case: case_456                     │
└──────────────────────────────────────────────────────┘

┌─ 📋 Clerk ──────────────────────────────────────────┐
│  Prompt Key:  Clerk                                  │
│  Source:      DATABASE 🟢                            │
│  Model:      gemini-2.0-flash                        │
│  Config:     temp=0.1 | max_tokens=1536              │
└──────────────────────────────────────────────────────┘
  └─ 📋 Clerk done (8.2s) — 10 judgments extracted

┌─ 🔑 KeywordExtractor ───────────────────────────────┐
│  Prompt Key:  KeywordExtractor                       │
│  Source:      DEFAULT 🟡 ⚠️                          │
│  Model:      claude-sonnet-4-20250514                 │
│  Config:     temp=0.2 | max_tokens=800               │
│  ⚠️ Warning:  No DB row for KeywordExtractor/citation│
└──────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────┐
│  ✅ PIPELINE COMPLETED — 10 citations (28.3s)       │
└──────────────────────────────────────────────────────┘
```

**Falls back to standard `logging`** if `rich` is not installed — pipeline never crashes due to logging.

---

## 11. API Endpoints

### Core Pipeline

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/health` | Service health check |
| `GET` | `/` | Service info page |
| `POST` | `/citation/report` | Run citation pipeline (synchronous) — returns full report |
| `POST` | `/citation/report/start` | Start pipeline in background — returns `run_id` for polling |
| `GET` | `/citation/runs/{run_id}/status` | Poll for pipeline completion |
| `GET` | `/citation/runs/{run_id}/logs` | Get agent logs for a pipeline run |

### Reports

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/citation/reports` | List user's reports (optional `case_id` filter) |
| `GET` | `/citation/reports/{report_id}` | Get one report with full `report_format` |
| `DELETE` | `/citation/reports/{report_id}` | Delete a report |
| `GET` | `/citation/reports/team` | Team shared reports |
| `POST` | `/citation/reports/{report_id}/share` | Share report with firm members |
| `GET` | `/citation/reports/{report_id}/shares` | Get shared_with list |

### HITL (Human-in-the-Loop)

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/citation/hitl/queue` | List pending HITL tickets |
| `POST` | `/citation/hitl/approve` | Approve/reject HITL items |
| `POST` | `/citation/hitl/{ticket_id}/notify` | Register for notification on HITL resolution |

### Judgments & Search

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/citation/judgements/search` | Full-text search across indexed judgments |
| `GET` | `/citation/judgements/{canonical_id}/full-text` | Get complete judgment text |
| `GET` | `/citation/cases/{canonical_id}/graph` | Citation graph from Neo4j |

### Other

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/claude` | Claude API proxy |
| `GET` | `/citation/firm-members` | List firm members for sharing |
| `GET` | `/citation/analytics/enterprise` | Enterprise usage analytics (FIRM_ADMIN only) |

---

## 12. Deployment Notes

### Required Environment Variables

| Variable | Database | Purpose |
|----------|----------|---------|
| `DRAFT_DB_URL` | Draft_DB | Dynamic prompt loading from `agent_prompts` |
| `DOC_DB_URL` | Document_DB | LLM model resolution from `llm_models` |
| `CITATION_DB_URL` | citation_db | Citation pipeline data (runs, reports, logs) |
| `GOOGLE_API_KEY` / `GEMINI_API_KEY` | — | Gemini API access |
| `GEMINI_MODEL` | — | Default Gemini model (fallback: `gemini-2.0-flash`) |
| `CLAUDE_MODEL` | — | Default Claude model |
| `JWT_SECRET` | — | JWT token verification |
| `SERPER_API_KEY` | — | Google Serper search API |

### Connection Pooling

Database connections for prompt resolution use `ThreadedConnectionPool` (min=1, max=3):
- `get_draft_db_conn()` / `release_draft_db_conn()` — Draft_DB pool
- `get_doc_db_conn()` / `release_doc_db_conn()` — Document_DB pool

### Dependencies Added

- `rich` — structured console logging (optional, graceful fallback)
- `httpx` — async HTTP client

---

## 13. Future Improvements

| Feature | Description |
|---------|-------------|
| **Prompt Versioning** | Track prompt versions with `version` column; allow rollback to previous prompts |
| **Prompt Rollback** | Version history per (name, agent_type); one-click revert from admin panel |
| **A/B Prompt Testing** | Route % of traffic to experimental prompts; compare citation quality metrics |
| **Prompt Playground** | Admin UI to edit/test prompts with sample inputs before deploying |
| **Cache Invalidation API** | Endpoint to force-clear prompt cache (currently relies on 60s TTL) |
| **Per-Agent Metrics** | Track prompt source distribution, LLM latency, token usage per agent |
| **Multi-LLM Routing** | Route different agents to different models based on cost/quality tradeoffs |















===============================================================================================
===============================================================================================
Yes — your agents.md is correct, and it clearly identifies which backend agent names must be used in the database. I verified the agent mapping and prompt keys from the document you uploaded. 

agents

Below is the exact list of database prompt keys you must insert, matching the backend code.

Agents That Use Database Prompts

Only these 6 agents use LLMs and therefore require prompts in the database. 

agents

Agent	Backend Class / Function	DB name	agent_type	Model
ClerkAgent	_gemini_extract()	Clerk	citation	Gemini
ReportBuilderAgent	_enrich_with_gemini()	ReportBuilder	citation	Gemini
KeywordExtractorAgent	KeywordExtractorAgent	KeywordExtractor	citation	Claude
KeywordExtractorAgent (fallback)	fallback branch	KeywordExtractorFallback	citation	Claude
CitationAgent (legacy fallback)	run_citation_agent()	CitationAgent	citation	Gemini
TreatmentExtractor	extract_subsequent_treatment_llm()	TreatmentExtractor	citation	Gemini

These names must match exactly when inserting prompts into Draft_DB.public.agent_prompts. 

agents

Agents That DO NOT Need Database Prompts

These agents do not use LLMs, so you should not insert prompts for them.

Agent	Reason
WatchdogAgent	API + DB search only
FetcherAgent	HTTP download only
LibrarianAgent	Regex validation
AuditorAgent	heuristic scoring
LegalCitationAgent	DB CRUD

These agents never call Gemini or Claude, so prompts are unnecessary. 

agents

SQL Insert Queries for Prompts

Below are the correct insert queries.

Clerk Prompt
INSERT INTO public.agent_prompts
(name, agent_type, prompt, model_ids, temperature)
VALUES
(
'Clerk',
'citation',
'You are a specialized legal document analyzer for Indian Court Judgments. Extract all mandatory citation fields from the judgment text and return valid JSON.',
'{1}',
0.1
);
ReportBuilder Prompt
INSERT INTO public.agent_prompts
(name, agent_type, prompt, model_ids, temperature)
VALUES
(
'ReportBuilder',
'citation',
'You are a legal data extraction expert. Fill missing citation fields using the provided judgment text and return the structured JSON.',
'{1}',
0.1
);
KeywordExtractor Prompt
INSERT INTO public.agent_prompts
(name, agent_type, prompt, model_ids, temperature)
VALUES
(
'KeywordExtractor',
'citation',
'You are an Indian legal research assistant. Generate exactly 10 structured search queries combining statute, doctrine, and court/time hints.',
'{4}',
0.2
);
KeywordExtractor Fallback Prompt
INSERT INTO public.agent_prompts
(name, agent_type, prompt, model_ids, temperature)
VALUES
(
'KeywordExtractorFallback',
'citation',
'Generate 5 to 10 short legal search keywords or phrases from the user query and case context.',
'{4}',
0.2
);
CitationAgent Prompt
INSERT INTO public.agent_prompts
(name, agent_type, prompt, model_ids, temperature)
VALUES
(
'CitationAgent',
'citation',
'You are a legal citation assistant. Generate real, verifiable Indian case citations relevant to the query.',
'{1}',
0.3
);
TreatmentExtractor Prompt
INSERT INTO public.agent_prompts
(name, agent_type, prompt, model_ids, temperature)
VALUES
(
'TreatmentExtractor',
'citation',
'Extract all subsequent treatment references such as followed, distinguished, overruled, or cited cases from the judgment.',
'{1}',
0.0
);
Recommended Database Constraint

To prevent duplicate prompts:

ALTER TABLE public.agent_prompts
ADD CONSTRAINT uq_agent_prompts_name_type
UNIQUE (name, agent_type);

This ensures one prompt per agent.

Final Correct Prompt Keys

These are the exact values the backend expects:

Clerk
ReportBuilder
KeywordExtractor
KeywordExtractorFallback
CitationAgent
TreatmentExtractor

All must use:

agent_type = citation
Important Note

If no DB row exists, the backend will automatically use the default prompts defined in the code, so inserting rows will not break the pipeline. 

agents

If you want, I can also give you a single SQL script that inserts all prompts at once, which is useful for setting up the database in one command.