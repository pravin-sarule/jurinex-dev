# Jurinex Judgement Service — Judgment Library Architecture

*How Indian Kanoon judgments are fetched, mirrored into Elasticsearch, and
served back for free on every later search. `Backend/judgement-service`,
port 8005. Written 2026-09-03 from the live code; every claim below points
at the function that implements it.*

Companion documents: [ARCHITECTURE.md](ARCHITECTURE.md) (pipeline stages
and prompts), [SEARCH_FILTERS.md](SEARCH_FILTERS.md) (court/date filters,
page ledger, Advanced Search popup), [README.md](README.md) (run + API).

---

## 0. The idea in one paragraph

Indian Kanoon (IK) is a paid API: ₹0.50 per search page, ₹0.20 per full
judgment, ₹0.02 per metadata call. The judgement service therefore treats
IK as the **source of truth that is consulted once**, and Elasticsearch
(ES) as the **permanent local library**. Every judgment IK ever serves is
written into ES under IK's own document id, together with a paragraph
index and a memory of which search query returned it. On the next search
run, every query is answered from the library first; IK is called only
when the library cannot verify enough judgments for an issue, and each
such call grows the library. Nothing the model says can add a judgment to
the library or to a result set: only an IK response can.

**Live figures on 2026-09-03** (Elasticsearch 8.19.12):

| Index | Documents |
|---|---|
| `ik_judgments` (one per judgment) | 653 |
| `ik_judgment_paragraphs` (legal chunks) | 37,119 |
| `ik_search_cache` (remembered IK search pages) | 147 |

---

## 1. System context

```
┌─────────────────────────────── Browser (React) ───────────────────────────────┐
│  Citation Research page  (/citation-research)                                 │
│    CitationResearchPanel.jsx  → analyze → pick issues → run search            │
│    CitationReviewResults.jsx  → result cards ("JuriNex" badge = from library)  │
│    AdvancedSearchModal.jsx    → "Indian Kanoon" | "My library (free)" toggle   │
│    services/judgementApi.js   → VITE_APP_JUDGEMENT_SERVICE_URL (:8005)         │
└────────────────────────────────────┬──────────────────────────────────────────┘
                                     │ HTTPS + JWT (auth.py)
┌────────────────────────────────────▼──────────────────────────────────────────┐
│  judgement-service  (FastAPI, api.py)                                          │
│                                                                                │
│   agents.py   issue spotting · query generation · library-first fan-out ·      │
│               embedding rerank · Gemini verifier · scoring · response assembly │
│   tools.py    IndianKanoonClient · ES legal engine · paragraph splitter ·      │
│               query parser · cost tracker · CitationGuardian                   │
│   stores.py   ElasticStore · Cache (Redis/memory) · SessionStore · Qdrant ·    │
│               Postgres (sessions, vault, usage events) · Neo4j (off)           │
│   config.py   every knob (.env)                                                │
└───┬──────────────┬──────────────┬──────────────┬──────────────┬───────────────┘
    │              │              │              │              │
    ▼              ▼              ▼              ▼              ▼
 Indian Kanoon   Elasticsearch   Redis / RAM    Qdrant        Postgres (citationTest)
 api.indiankanoon  3 indices     24h search     768-d doc     judgement_sessions
 .org  (billed)    (permanent    7d doc cache   embeddings    judgement_vault
                   library)      (volatile)     (flywheel)    citation_usage_events
                                                              + Document_DB file_chunks (read-only)
    ▲
    │ Gemini 2.5 Flash (verifier, analysis, classify/extract), gemini-embedding-001,
    │ Gemini 3.1 Pro / Claude (optional) for issue spotting + query generation
```

The service is deployed as a container (`Dockerfile`, `Procfile`: gunicorn
with uvicorn workers; Cloud Run injects `PORT`). Locally:
`.\venv\Scripts\python.exe -m uvicorn api:app --port 8005`.

---

## 2. File map (what lives where)

| Concern | File · symbol |
|---|---|
| ES connection, index creation, all ES reads/writes | `stores.py` · `ElasticStore` (`elastic` singleton) |
| Mirroring a fetched judgment into ES | `tools.py` · `index_judgment_async`, `_store_judgment_and_paragraphs`, `_es_judgment_body` |
| Paragraph chunking + regex metadata | `tools.py` · `split_judgment_paragraphs`, `build_paragraph_rows`, `extract_sections/acts/citations` |
| IK client (search, doc, docmeta) with cache → library → IK ordering | `tools.py` · `IndianKanoonClient` |
| Per-query routing library → IK | `tools.py` · `IndianKanoonClient.fanout_and_fetch` |
| ES legal engine (parse, qualify, paragraph evidence, rank) | `tools.py` · `parse_legal_query`, `es_legal_search`, `es_wire_search`, `es_court_clauses` |
| Library-first round + the 3-verified rule | `agents.py` · `_issue_round`, `_process_issue`, `issue_fanout` |
| Read + verify waves (full-text reads come from ES when present) | `agents.py` · `fetch_and_verify_waves`, `verify_judgments` |
| Session persistence of library flags | `agents.py` · `assemble_response` (`fromLibrary`, `candidateMeta.esMeta`) |
| Library search endpoint for the popup | `api.py` · `local_search`, `_local_engine_search` |
| Report / doc views that read the library | `api.py` · `citation_report`, `advanced_search_doc` |
| Paragraph backfill for judgments indexed before the paragraph layer | `reindex_paragraphs.py` |
| Knobs | `config.py` · `Settings` (ES block, `library_first*`, `es_*`) |
| Frontend | `frontend/src/services/judgementApi.js` (`localSearch`), `components/CitationResearch/*` |

---

## 3. Data stores

### 3.1 Elasticsearch — the three indices

All three are created on first connect by `ElasticStore._ensure_index`
(`stores.py`). Connection is lazy, guarded by a lock, and latched: if ES
is down at first use, the library is disabled until the process restarts
(`[stores] Elasticsearch unavailable … disabled until restart`).

**`ik_judgments` — one document per judgment, `_id` = IK `tid`**

| Field | Type | Content |
|---|---|---|
| `tid` | keyword | IK document id (same as `_id`) |
| `title` | text | judgment title, HTML stripped |
| `doc` | text, `index: false` | IK's own judgment HTML, stored verbatim, never searched |
| `text` | text | HTML-stripped full text — **the search field** |
| `docsource` | text + `.kw` | court line, e.g. `Karnataka High Court` |
| `publishdate` | date (`yyyy-MM-dd`, malformed ignored) | decision date |
| `author`, `bench` | text | filled later from `/docmeta` (report view / in-app doc view only); **empty on every stored judgment as of 2026-09-03** — see Appendix A.9 |
| `numcites`, `numcitedby` | integer | IK counts |
| `casesCited`, `citedBy` | object, `enabled: false` | samples `[{title, docId}]`, stored not indexed |
| `fetched_at` | date | **legacy** — present in the live mapping from an earlier version, written by nothing today, empty on every record |

The body is a **pure judgment dataset**: only what IK returned, under IK's
id. Nothing about which user, session or query fetched it
(`_es_judgment_body`).

**`ik_judgment_paragraphs` — the judgment split into legal chunks,
`_id` = `{tid}:{paragraph_no}`**

| Field | Type | Content |
|---|---|---|
| `judgment_id` | keyword | parent `tid` |
| `paragraph_no` | integer | 1-based position |
| `title`, `docsource`, `publishdate`, `bench` | copied from the judgment | for filtering without a join |
| `text` | text (standard analyzer) + `text.english` (stemmed) | the chunk |
| `sections` | keyword[] | regex-extracted, e.g. `482`, `138`, `260A` |
| `acts` | keyword[] | regex-extracted from a fixed list (IPC, CrPC, BNSS, NI Act…) |
| `citations` | keyword[] | regex-extracted, e.g. `(2019) 4 SCC 123`, `AIR 1994 SC 1` |
| `paragraph_type`, `case_number` | keyword | **left empty** — never invented |

**`ik_search_cache` — exact-query memory, `_id` = `sha1(wire):pagenum`**

| Field | Type | Content |
|---|---|---|
| `wire` | keyword | the normalised wire query, directives included |
| `pagenum` | integer | IK page (0-based) |
| `docs` | object, `enabled: false` | stubs `{tid, title, headline, docsource, publishdate, numcitedby}` |
| `saved_at` | date | when remembered |

The cache stores **stubs, not full text**. Full text lives in
`ik_judgments` only for judgments whose `/doc` was actually fetched.

### 3.2 The other stores and their roles

| Store | Role in the library flow | Lifetime |
|---|---|---|
| Redis, or in-process TTL dict when `REDIS_URL` is empty (`stores.Cache`); the current `.env` sets no `REDIS_URL`, so it is the in-memory dict | Hot cache in front of both IK and ES: search pages 24 h, judgment text / doc info / raw HTML / docmeta 7 d | volatile; a restart clears the in-memory variant |
| Qdrant (`stores.QdrantStore`) | 768-d Gemini embeddings of `title + headline`, keyed by docId — the rerank never re-embeds a known judgment | permanent |
| Postgres citationTest (`stores.PostgresStore`) | `judgement_sessions` (result sets, `candidateMeta.esMeta`, `ikQueryPages`), `judgement_vault` (GREEN survivors), `citation_usage_events` (billing rows incl. `library_hit`) | permanent |
| Neo4j | typed citation graph for good-law; disabled (`JUDGEMENT_DISABLE_NEO4J=true`) | — |

Elasticsearch is the only store that holds judgment **text**. It is also
the only durable copy: Redis/memory expire, and IK charges again.

---

## 4. Write path — how a judgment enters the library

Every write is **fire-and-forget** (thread-pool executor) and
**create-only**. An ES outage never slows or fails an IK fetch; a
judgment already present is never rewritten.

### 4.1 Entry points that write

| Trigger | IK call (billed) | What gets written | Code |
|---|---|---|---|
| Any pipeline search query the library could not answer | `POST /search/` ₹0.50 | `ik_search_cache` ← stubs of that page | `IndianKanoonClient.search` → `elastic.search_cache_put` |
| Full text for a top-N candidate (verifier read) | `POST /doc/{id}/?maxcites=20&maxcitedby=20` ₹0.20 | `ik_judgments` ← judgment + `casesCited`/`citedBy` samples; `ik_judgment_paragraphs` ← chunks | `fetch_doc_bundle` → `index_judgment_async` |
| Report view of a surfaced citation | same `/doc` (if not cached) | same | `api.citation_report` → `fetch_doc_bundle` |
| Advanced Search in-app document view | `POST /doc/{id}/?maxcites=50&maxcitedby=50` | same, from the raw-HTML path | `fetch_doc_raw` → `index_judgment_async` |
| Bench / author lookup | `POST /docmeta/{id}/` ₹0.02 | partial update `author`, `bench` on `ik_judgments` | `fetch_doc_meta` → `elastic.update_judgment` |
| Operator backfill | none | `ik_judgment_paragraphs` for judgments indexed before the paragraph layer | `reindex_paragraphs.py` |

Advanced Search **result pages** from IK (`search_raw`) are cached in
Redis/memory only; they are not written to `ik_search_cache`.

### 4.2 Full judgment → `ik_judgments` + paragraphs

```
IK /doc/{tid}/ response
   │  {title, doc (HTML), docsource, publishdate, numcites, numcitedby,
   │   cites[] / citedby[]  (only present because maxcites/maxcitedby were sent)}
   ▼
fetch_doc_bundle (tools.py)
   ├─ full_text = strip_html(doc), whitespace collapsed
   ├─ cache.set  ik:doc:{tid}      (7 d)      ← Redis/memory
   ├─ cache.set  ik:docinfo2:{tid} (7 d)
   └─ index_judgment_async(tid, data, full_text, extra={casesCited, citedBy})
         │  runs in a worker thread; the request never waits
         ▼
      _store_judgment_and_paragraphs
         ├─ body = _es_judgment_body(...)          # tid,title,doc,text,docsource,
         │                                          # publishdate,numcites,numcitedby (+extra)
         ├─ elastic.index_judgment(tid, body)      # op_type=create
         │      409 version_conflict → already in the library → STOP (no churn)
         └─ if newly created:
                rows = build_paragraph_rows(tid, body)
                elastic.index_paragraphs(tid, rows) # bulk, _op_type=create, _id=tid:n
```

Only a **new** judgment gets its paragraphs built, so the two indices stay
in lock-step and a re-fetch (cache expired, another user, another session)
costs nothing in ES.

### 4.3 Paragraph chunking (`split_judgment_paragraphs`)

Deterministic, no model involved:

1. Split on blank lines when the text has them; otherwise on numbered
   paragraph starts (`12. The petitioner…`); otherwise treat the text as
   one block.
2. Blocks longer than 2,500 chars are cut at the last sentence boundary
   after 200 chars, repeatedly.
3. Blocks shorter than 200 chars (or the next block shorter than 100) are
   merged forward so every chunk carries context.
4. At most 400 chunks per judgment.

Each chunk row copies the judgment's `title/docsource/publishdate/bench`
and gets `sections`, `acts`, `citations` from regexes over that chunk
only (`extract_sections`, `extract_acts`, `extract_citations`).
`paragraph_type` and `case_number` are deliberately left empty: the
ranking treats an unknown type as neutral (0.5) rather than rewarding an
invented label.

### 4.4 Search page → `ik_search_cache`

```
IndianKanoonClient.search(query, pagenum)
   ├─ norm = normalize_ws(query)            # lower-cased, whitespace-collapsed wire
   ├─ Redis/memory  ik:search:{sha1(norm)}:{pagenum}  → hit? return (cached, free)
   ├─ POST /search/  formInput=query pagenum=N maxpages=1   (₹0.50, exactly one page)
   ├─ cache.set_json (24 h)
   └─ if docs: elastic.search_cache_put(norm, pagenum, stubs)   # thread, never raises
```

The key is the **full wire string** — phrases, `doctypes:`, `fromdate:`,
`todate:` included. Changing the court boxes or dates therefore produces a
new key, exactly as it produces a new IK search.

### 4.5 Idempotency rules

- `ik_judgments`: `op_type=create`; a 409 is treated as "already there".
  The library never overwrites a judgment, even if IK later edits it.
- `ik_judgment_paragraphs`: deterministic ids `{tid}:{n}` + create-only
  bulk; re-running `reindex_paragraphs.py` adds only what is missing.
- `ik_search_cache`: plain index (upsert) under `sha1(wire):pagenum`; a
  page re-bought after the 24 h Redis expiry simply refreshes the stubs.
- `update_judgment` (author/bench) is a partial `doc` merge; a missing
  judgment is silently skipped.

### 4.6 Backfill

```powershell
.\venv\Scripts\python.exe reindex_paragraphs.py
```

Walks `ik_judgments` with `search_after` (25 per page, sorted by `tid`),
builds chunks for each, bulk-creates them, refreshes the paragraph index
and prints totals. Safe to run any time.

---

## 5. Read path — how the library is used next time

There are four readers. All go through `tools.py` helpers that return
empty/None when `LIBRARY_FIRST=false` or ES is unavailable, so the
pipeline degrades to plain IK without code changes.

### 5.1 Research pipeline: the library-first round

`POST /api/v1/search/{sessionId}/run` → `run_issue_search` →
`issue_fanout` (all issues concurrently) → `_process_issue` per issue.

```
_process_issue(issue)
   │
   ├─ round 1 = _issue_round(use_library=True)     ← PURE ES ROUND, IK /search never called
   │      fanout_and_fetch(library_only=True)
   │         for each display query on the card (max 8):
   │            wire = build_ik_query(query)         # phrases quoted, doctypes:/dates appended
   │            (1) es_search_cache_get(wire)        # exact-query memory → stubs IK once returned
   │            (2) else es_wire_search(wire)        # full-text legal engine, strict mode
   │            (3) else → []                        # unsatisfied queries fetch NOTHING here
   │         merge → dedupe by tid → court-scope guard → Candidate(from_library=True, es_meta)
   │      rerank (Gemini embeddings, Qdrant cache) → top IK_FULL_DOC_TOP_N (12) by title-deduped rank
   │      fetch_and_verify_waves → fetch_doc_text → ES text when present (free)
   │      verifier (Gemini Flash) → enforce_verifier_rules → score → bands → surfaced
   │
   ├─ if round 1 came from the library AND surfaced < LIBRARY_FIRST_MIN (3):
   │      round 2 = _issue_round(use_library=False, exclude=round-1 docIds)
   │         fanout_and_fetch → IK /search per query (page ledger advances), ₹0.50 each
   │         new top-N → IK /doc (₹0.20 each) → index_judgment_async → LIBRARY GROWS
   │      results = round 1 + round 2 (deduped), candidate pool = both rounds
   │
   └─ else: round 1 is the answer — zero IK searches for this issue
```

Decision rule, verbatim from `_process_issue` (`agents.py`): an issue
whose library round **verified** at least `library_first_min` usable
judgments never touches Indian Kanoon; fewer than that, including an
empty library round, triggers exactly one IK round. "Verified" means it
passed the Gemini verifier plus the deterministic kill gates and landed in
GREEN/YELLOW — not merely "the library returned hits".

Consequences worth knowing:

- **Search calls**: a library round makes no `/search/` call at all.
- **Doc calls**: a library round can still bill `/doc` for a candidate
  that came from `ik_search_cache` as a stub whose full text was never
  fetched (see 5.3). That fetch then mirrors the judgment, so it happens
  once per judgment, ever.
- **Early stop and the library threshold agree**: the verifier's wave
  early-stop floor is `max(VERIFIER_EARLY_STOP_RESULTS, LIBRARY_FIRST_MIN)`
  (`fetch_and_verify_waves`), so an easy issue never stops early and then
  pays for an IK top-up because it "looked thin".
- **No ES paging**: the library always returns its best matches for a
  query (page 0). Repeat runs re-serve them; only IK-routed queries walk
  the `ikQueryPages` ledger. This replaced an earlier design where ES
  pages advanced per run and leap-frogged the library's depth.
- **Closed world still holds**: `CitationGuardian` checks every surfaced
  docId against the request's fetched pool, which contains both rounds'
  candidates (library and IK alike), and every pinpoint against the text
  that was read.

### 5.2 The ES legal engine (`es_legal_search`)

Used by `es_wire_search` (pipeline, strict mode) and `/api/v1/local-search`
(popup, auto/strict/flexible).

**Parse** (`parse_legal_query`) — IK-style grammar:

| Input | Becomes |
|---|---|
| `"civil dispute given criminal colour"` | required phrase |
| `(2019) 4 SCC 123`, `AIR 1994 SC 1`, `2019 SCC OnLine Del 1` | citation → treated as a phrase |
| `Section 482` (unquoted) | phrase, and `482` into `sections` |
| remaining bare words | terms |

Smart quotes are normalised to ASCII first (`normalize_quotes`); legal
terms keep their case (`squash_ws`, never the lower-casing `normalize_ws`).

**Step 1 — qualify judgments** on `ik_judgments`, size `ES_CANDIDATE_LIMIT`
(30):

- *strict* (pipeline default): `bool.must` of one `match_phrase` per
  phrase/citation — **every** phrase must be present — plus an `operator:
  and` match of the bare terms. Never OR.
- *flexible* (popup natural-language): `should` of phrase matches
  (boost 3) plus a `multi_match` over `text`, `text.english`, `title^2`
  with `minimum_should_match: 60%`.
- Filters: `doctypes:` → `docsource` clauses via `es_court_clauses`
  (`supremecourt` → "Supreme Court", `highcourts` → "High Court", a state
  token → "High Court" AND that state; tribunal tokens have no docsource
  pattern and are skipped); `fromdate:/todate:` → `publishdate` range.

**Step 2 — paragraph evidence** on `ik_judgment_paragraphs`, filtered to
the qualified `judgment_id`s, `size = min(400, 30 × 12)`. Each phrase is a
**named query** `ph:i`, so every hit reports which phrases it matched
(`matched_queries`) and returns one highlight fragment.

**Rank** per judgment, weights from `ES_RANK_WEIGHTS_JSON` over these
defaults (`config.ES_RANK_WEIGHT_DEFAULTS`):

```
finalScore = 0.40 · bm25        (judgment _score / max _score in this result set)
           + 0.30 · proximity   (1 / (1 + smallest paragraph span covering all phrases); 0 if never covered)
           + 0.15 · coverage    (share of phrases found; forced 1.0 in strict mode)
           + 0.10 · section     (1 if a query section number appears in evidence `sections`, 0.5 if the query names none)
           + 0.05 · para_type   (best ES_PARA_TYPE_VALUE among evidence paragraphs; 0.5 when unknown)
```

Three phrases inside one paragraph therefore beat the same three phrases
scattered across a 200-page judgment. Ties break on `tid` so ordering is
identical run to run. Each hit comes back IK-doc-shaped (`tid`, `title`,
`docsource`, `publishdate`, `numcitedby`, `headline` = top two fragments)
plus explainability (`esScore`, `finalScore`, `matchedPhrases`,
`matchedParagraphs`). `es_wire_search` trims to `FINAL_RESULT_LIMIT` (10)
before the candidates enter rerank/verification. `ES_MIN_SCORE` (default
0) is only a usability floor; four good library results are used as-is,
never topped up to ten from IK.

### 5.3 Full-text reads served from the library

`fetch_doc_bundle(doc_id)` (verifier reads, report view) and
`fetch_doc_raw(doc_id)` (in-app document view) look in this order:

1. Redis/memory (`ik:doc:*`, `ik:docinfo2:*`, `ik:docraw:*`, 7 d) — free.
2. `elastic.get_judgment(doc_id)` — free; counted as a **library hit**
   (`_library_count`) and re-warmed into the cache. The raw path uses the
   stored `doc` HTML, so the in-app viewer of a collected judgment renders
   IK's own formatting without an IK call.
3. IK `/doc/` — billed; result mirrored into ES (section 4.2).

So the second time any judgment is verified, reported on, or opened, in
any session, by any user, it costs nothing.

### 5.4 Advanced Search popup — "My library (free)"

`AdvancedSearchModal.jsx` keeps a `source` state (`'ik'` | `'local'`);
the local choice calls `judgementApi.localSearch` →
`POST /api/v1/local-search` with the same `AdvancedSearchRequest` as the
IK path. Server side (`api.local_search`):

- keyword-only criteria → `_local_engine_search`: parse → mode `auto`
  (strict when the query has phrases/citations, else flexible) →
  `es_legal_search` → sort (relevance / most recent / least recent) →
  10 per page from the ranked list;
- field criteria (`title:`, `cite:`, `author:`, `bench:`) → a direct bool
  query on `ik_judgments` via `elastic.search_judgments`, highlights on
  `text` as the headline, ES `from/size` paging.

The response shape is identical to `/advanced-search` plus
`source: "local_library"`, `fromLibrary: true` on every row and a zero
`cost` block; the popup shows a green "From your library — free" badge and
the rail/pagination stay on the chosen source. ES down → HTTP 503 with a
hint to search Indian Kanoon instead.

### 5.5 Result cards and the session

`assemble_response` copies `Candidate.from_library` to
`ResultItem.fromLibrary` (rendered as the small "JuriNex" badge in
`CitationReviewResults.jsx`) and stores `es_meta` under
`session.issues[].candidateMeta[docId].esMeta` in Postgres for search-
quality debugging. Nothing else about the library is user-facing.

---

## 6. End-to-end: first search vs the next one

**First time a query family is researched** (library empty for it):

```
run #1  issue "Civil dispute given criminal colour", 4 anchor queries
  round 1 (ES)  : 4 × es_search_cache_get → miss; 4 × es_wire_search → 0 hits  → 0 verified
  round 2 (IK)  : 4 × /search (₹2.00) → 30-candidate pool → rerank → top 12
                  12 × /doc (₹2.40) → verifier → 5 GREEN/YELLOW
  library after : +12 judgments, +~680 paragraphs (≈57 per judgment today), +4 remembered search pages
```

**Next time** (same user or anyone else, same or similar issue):

```
run #2  same or overlapping queries
  round 1 (ES)  : exact-query memory returns the 4 remembered pages (stubs)
                  or the engine returns strict phrase matches from 653 judgments
                  full texts read from ES (free) → verifier → ≥3 verified
  round 2       : SKIPPED — Indian Kanoon never consulted for this issue
  bill          : ₹0.00 to Indian Kanoon; only Gemini verifier tokens
```

**Thin library** (a new doctrine, or a court scope the library has not
seen): round 1 verifies 0–2 → one IK round tops it up, excluding what the
library already gave, and the new judgments are mirrored. The library
converges toward the firm's actual practice areas.

---

## 7. Cost accounting

The per-request tracker (`ik_cost_start`, ContextVar so concurrent runs
never mix) counts three kinds of retrieval:

| Row in the `[cost]` console table | Meaning | Billing row in `citation_usage_events` |
|---|---|---|
| `Search` / `Document` / `Document Metainfo` | billed IK calls at `IK_RATES_INR` | `provider=indian_kanoon`, `operation=search|doc|docmeta` |
| `Cache hits (free)` | Redis/memory hits | `operation=cache_hit`, `cache_method=response_cache` |
| `Local library (free)` | queries answered by ES + full texts read from ES | `provider=elastic`, `service=judgement_library`, `operation=library_hit`, `cache_method=local_library` |

`fanout_and_fetch` logs one line per issue —
`[library] queries served: N from LOCAL DATASET (free), M via INDIAN KANOON (billed)` —
and the run ends with `SESSION TOTAL so far`. The DB pricing trigger owns
`cost_inr`; the service reports usage and its own `producer_cost_inr`.

---

## 8. Configuration (`config.py`, read from `.env`)

| Env / setting | Default | Effect |
|---|---|---|
| `ELASTICSEARCH_URL` (+ `ELASTICSEARCH_USERNAME`, `ELASTICSEARCH_PASSWORD`) | unset → library off | ES endpoint. Note: this service reads `ELASTICSEARCH_URL`; the `ELASTIC_URL` / `ELASTIC_USER` keys also present in the shared `.env` belong to the older `citation-service` (port 8001), which keeps its own index named `judgments`. The two services never read or write each other's indices. |
| `ELASTIC_VERIFY_CERTS` | false | TLS verification |
| `ELASTIC_REQUEST_TIMEOUT` | 3 s | per-request timeout; ES is on the hot path so it stays short |
| `elastic_index` / `elastic_paragraph_index` / `elastic_search_cache_index` | `ik_judgments` / `ik_judgment_paragraphs` / `ik_search_cache` | index names |
| `LIBRARY_FIRST` | true | master switch for every library read (writes always happen when ES is up) |
| `LIBRARY_FIRST_MIN` | 3 | verified judgments a library round must yield to skip IK |
| `ES_CANDIDATE_LIMIT` | 30 | judgments qualified in step 1 |
| `FINAL_RESULT_LIMIT` | 10 | ranked library hits handed to rerank/verification per query |
| `ES_MIN_SCORE` | 0 | BM25 floor for "usable" |
| `ES_RANK_WEIGHTS_JSON` | `{}` | partial overrides of the five rank weights |
| `IK_FULL_DOC_TOP_N` | 10 in code, **12** in the current `.env` | how many candidates get full text (ES or `/doc`) |
| `VERIFIER_EARLY_STOP_RESULTS` / `VERIFIER_WAVE_SIZE` | 5 / 6 | wave early-stop; floor raised to `LIBRARY_FIRST_MIN` |
| `IK_DOCTYPES` | `supremecourt,highcourts,tribunals` | default court filter riding on every wire query (and therefore on every cache key) |
| `REDIS_URL`, `QDRANT_URL`, `CITATION_DB_URL` | optional | hot cache, embedding cache, durable sessions/usage |

`GET /health` reports `stores.elastic: true|false` alongside the other
stores — the first thing to check when result cards stop showing the
"JuriNex" badge.

---

## 9. Failure modes and degradation

| Situation | Behaviour |
|---|---|
| ES unreachable at first use | warning once, `_failed` latch; every read returns empty/None and every write is skipped **until restart**; pipeline runs IK-only |
| ES write fails mid-request | logged, request unaffected (worker thread) |
| Redis absent | in-process TTL dict (5,000 keys, per process) — ES remains the durable memory |
| IK token rejected (401/403) | `ik_client.auth_failed` → library rounds still work; an all-empty run returns HTTP 502 naming the token, never a silent "0 results" |
| Library round verifies < 3 | one IK round; if IK also finds nothing, honest empty (no automatic query reformulation) |
| Embedding backend down | lexical TF-cosine rerank; the semantic floor adapts to the pool's own scale |
| Qdrant absent | embeddings recomputed each run (paid), library unaffected |

---

## 10. Invariants and gotchas

1. **A judgment enters ES only from an IK `/doc` response.** No model
   output, no user upload, no cached stub ever creates a judgment
   document.
2. **Same id everywhere.** ES `_id` = IK `tid` = the docId on result cards
   = `https://indiankanoon.org/doc/{tid}/`. A library hit and an IK hit
   for the same judgment merge as one candidate.
3. **Create-only.** The library never rewrites a judgment; `author`/`bench`
   are the only fields updated after creation.
4. **Stubs ≠ texts.** `ik_search_cache` remembers what IK listed;
   `ik_judgments` holds what was actually downloaded. A listed-but-never-
   downloaded judgment still costs one `/doc` the first time it reaches
   the top-N.
5. **Strict means all phrases.** In the pipeline, a library hit must
   contain every quoted phrase of the query; there is no OR fallback.
   Badly formed queries (unquoted multi-word doctrines) therefore miss the
   library and fall through to IK — the query-format guard in query
   generation exists for this reason.
6. **`normalize_ws` lower-cases.** Use it for cache keys only; use
   `squash_ws` for anything displayed or phrase-matched (`Section 482`,
   `(2019) 4 SCC 123`).
7. **Court scope is enforced twice.** IK's `doctypes:` and the ES
   `docsource` clauses filter at fetch time; `scope_allows_court` drops
   anything else before it is read, verified or shown — for library and IK
   candidates alike.
8. **The paragraph layer must exist for ranking to be meaningful.** A
   judgment with no chunks scores proximity 0; run `reindex_paragraphs.py`
   after any bulk import or if the paragraph index is recreated.
9. **`_es_query_from_wire` is a legacy translator** kept in `tools.py`;
   the live path is `parse_legal_query` → `es_legal_search`.

---

## 11. Operating the library

```powershell
# run locally
cd Backend\judgement-service
.\venv\Scripts\python.exe -m uvicorn api:app --port 8005

# health incl. ES availability
curl http://localhost:8005/health

# backfill paragraphs (idempotent)
.\venv\Scripts\python.exe reindex_paragraphs.py

# inspect counts (read-only, uses the service's own client + .env)
.\venv\Scripts\python.exe -c "from stores import elastic; from config import get_settings as g; c=elastic._get(); s=g(); print({i: c.count(index=i)['count'] for i in (s.elastic_index, s.elastic_paragraph_index, s.elastic_search_cache_index)})"

# offline tests covering this document
.\venv\Scripts\python.exe -m pytest -q tests\test_library_first.py tests\test_legal_search_engine.py tests\test_ik_client.py tests\test_court_scope.py tests\test_issue_retry.py
```

`tests/test_library_first.py` pins the routing rules (library hits never
call IK; repeat runs keep serving the library; the 3-verified fallback);
`tests/test_legal_search_engine.py` pins the parser, strict/flexible
qualification and the proximity ranking. Both run without ES, IK or
Gemini.

---

## Appendix A — Exact stored record formats

Real records read from the live cluster on 2026-09-03 (long strings
truncated, marked `…`). Nothing here is a paraphrase of the code; it is
what `GET ik_judgments/_doc/186813347` returns.

### A.1 What Indian Kanoon sends: `POST https://api.indiankanoon.org/doc/{tid}/`

Called by `fetch_doc_bundle` with `maxcites=20&maxcitedby=20` (pipeline
reads, report view) and by `fetch_doc_raw` with `maxcites=50&maxcitedby=50`
(in-app document view). Without those two parameters IK omits the cite
lists entirely. The keys the service reads:

```jsonc
{
  "tid": 186813347,                       // numeric in IK's payload
  "title": "Mr Umar Farooq vs The State Of Karnataka on 22 October, 2024",
  "doc": "<h2 class=\"doc_title\">Mr Umar Farooq vs …</h2>\n\n<h3 class=\"doc_author\">Author: <a href=\"/search/?formInput=authorid:m-nagaprasanna\">M.Nagaprasanna</a></h3>\n\n<h3 class=\"doc_bench\">Bench: …</h3> … <pre>… judgment body …</pre>",
  "docsource": "Karnataka High Court",
  "publishdate": "2024-10-22",
  "numcites": 23,
  "numcitedby": 0,
  "cites":   [ { "tid": 1436241, "title": "Section 420 in The Indian Penal Code, 1860" }, … ],   // older responses: "citeList"
  "citedby": [ { "tid": …, "title": "…" }, … ]                                                    // older responses: "citedbyList"
  // any other keys IK adds (e.g. divtype, courtcopy) are ignored and NOT stored
}
```

Note that IK's `cites` list mixes case law and statute-section pages
(`Section 420 in The Indian Penal Code, 1860` is a statute page with its
own `tid`); the service stores them as given.

### A.2 IK field → stored field

| IK `/doc` key | Stored as (`ik_judgments`) | Transformation (`tools._es_judgment_body`, `fetch_doc_bundle`) |
|---|---|---|
| `tid` (int) | `tid` (keyword) and the ES `_id` | `str(doc_id)` |
| `title` | `title` | `strip_html(...)`, trimmed; `None` if empty |
| `doc` | `doc` | **verbatim** IK HTML, untouched; not indexed |
| `doc` | `text` | `strip_html(doc)` (tags → spaces) then runs of spaces/tabs collapsed to one space; newlines kept |
| `docsource` | `docsource` | `strip_html`, trimmed |
| `publishdate` | `publishdate` | string as given (`yyyy-MM-dd`); malformed values are kept in `_source` but not indexed (`ignore_malformed`) |
| `numcites`, `numcitedby` | same | `int(x or 0)` |
| `cites` / `citeList` | `casesCited` | `[{"title": strip_html(title), "docId": str(tid)}]`, entries without a title dropped, capped at 20 (bundle path) or 50 (raw path) |
| `citedby` / `citedbyList` | `citedBy` | same shape and caps |
| — | `author`, `bench` | not from `/doc`; merged later from `/docmeta` by `fetch_doc_meta` → `elastic.update_judgment` |
| — | *(no fetched_at, no user, no session, no query)* | the record is a pure judgment dataset |

Keys whose value is `None` are dropped before indexing, so a judgment with
no title simply has no `title` field.

### A.3 The stored judgment document (`ik_judgments`)

```jsonc
// GET ik_judgments/_doc/186813347
{
  "_index": "ik_judgments",
  "_id": "186813347",
  "_source": {
    "tid": "186813347",
    "title": "Mr Umar Farooq vs The State Of Karnataka on 22 October, 2024",
    "doc": "<h2 class=\"doc_title\">Mr Umar Farooq vs The State Of Karnataka on 22 October, 2024</h2>\n\n<h3 class=\"doc_author\">Author: <a href=\"/search/?formInput=authorid:m-nagaprasanna\">M.Nagaprasanna</a></h3>\n\n<h3 class=\"doc_bench\">… [66,597 chars]",
    "text": " Mr Umar Farooq vs The State Of Karnataka on 22 October, 2024 \n\n Author: M.Nagaprasanna \n\n Bench: M.Nagaprasanna \n\n -1-\n NC: 2024:KHC:42404\n CRL.P No. 7274 of 2024\n\n\n\n\n IN THE HIGH COURT OF KARNATAKA AT BENGALURU\n\n DATED … [43,704 chars]",
    "docsource": "Karnataka High Court",
    "publishdate": "2024-10-22",
    "numcites": 23,
    "numcitedby": 0,
    "casesCited": [
      { "title": "Section 420 in The Indian Penal Code, 1860", "docId": "1436241" },
      { "title": "Section 415 in The Indian Penal Code, 1860", "docId": "1306824" },
      { "title": "Section 120B in The Indian Penal Code, 1860", "docId": "1897847" },
      … 13 entries
    ],
    "citedBy": []
    // "author" / "bench" appear only after a /docmeta enrichment (none so far)
  }
}
```

Live mapping of this index (field → type): `tid` keyword · `title` text ·
`doc` text/`index:false` · `text` text · `docsource` text + `.kw` keyword ·
`publishdate` date · `author` text · `bench` text · `numcites` integer ·
`numcitedby` integer · `casesCited` object/`enabled:false` · `citedBy`
object/`enabled:false` · `fetched_at` date (legacy, unused).

### A.4 The paragraph documents (`ik_judgment_paragraphs`)

One record per chunk, `_id` = `{tid}:{paragraph_no}`. The judgment above
produced 60 chunks. Built by `build_paragraph_rows` from the stored
`text`, never from the HTML.

```jsonc
// GET ik_judgment_paragraphs/_doc/186813347:2
{
  "_id": "186813347:2",
  "_source": {
    "judgment_id": "186813347",
    "paragraph_no": 2,
    "title": "Mr Umar Farooq vs The State Of Karnataka on 22 October, 2024",
    "docsource": "Karnataka High Court",
    "publishdate": "2024-10-22",
    "text": "1. MR. UMAR FAROOQ\n S/O MR. THOKUR IDINABBA\n AGED ABOUT 51 YEARS, PROPRIETOR OF\n M/S. IOBITCODE INTERACTIVE, …"
    // "bench"      — copied from the judgment when present (absent here)
    // "sections"   — e.g. ["482", "420"]   regex hits inside THIS chunk; omitted when none
    // "acts"       — e.g. ["IPC", "CrPC"]  regex hits inside THIS chunk; omitted when none
    // "citations"  — e.g. ["(2019) 4 SCC 123"]; omitted when none
    // "paragraph_type", "case_number" — never written (unknown, not invented)
  }
}
```

Empty strings, empty lists and `None` are stripped before the bulk
create, which is why a chunk with no section reference has no `sections`
key at all.

### A.5 The remembered search page (`ik_search_cache`)

One record per (wire query, IK page). Written by
`IndianKanoonClient.search` after every **billed** `/search/` call that
returned at least one document.

```jsonc
// _id = sha1(normalised wire) + ":" + pagenum
{
  "_id": "8027ad2c62adb70562a0523eaea5b683e5cc80f6:0",
  "_source": {
    "wire": "\"section 482\" \"audi alteram partem\" \"violation of natural justice\" quash doctypes:supremecourt,highcourts,tribunals",
    "pagenum": 0,
    "saved_at": "2026-08-24T06:50:17Z",
    "docs": [
      {
        "tid": 27098883,                       // int — exactly as IK's search response had it
        "title": "Union Carbide Corporation Etc. Etc vs Union Of India Etc. Etc on 3 October, 1991",
        "headline": " Union Carbide Corporation Etc. Etc vs Union Of India Etc. Etc on 3 October, 1991",
        "docsource": "Supreme Court of India",
        "publishdate": "1991-10-03",
        "numcitedby": 423
      },
      … 10 stubs (one IK page)
    ]
  }
}
```

The `wire` is the query **after** `normalize_ws` (lower-cased,
whitespace-collapsed) and includes every directive. Only these six stub
keys are kept from IK's search hit; `headline` is IK's snippet with its
`<b>` markup still inside (stripped at display time). `docs` is
`enabled: false`, so nothing inside it is searchable — lookups are by
exact `wire` only.

### A.6 The volatile copies written at the same moment (Redis or process memory)

| Key | Value | TTL | Written by |
|---|---|---|---|
| `ik:search:{sha1(norm)}:{pagenum}` | JSON list of IK search hits (full hit objects) | 24 h | `search` |
| `ik:searchraw:{sha1(norm)}:{pagenum}` | IK's whole `/search/` response (`docs`, `found`, `categories`) | 24 h | `search_raw` (Advanced Search) |
| `ik:doc:{tid}` | stripped full text (string) | 7 d | `fetch_doc_bundle` |
| `ik:docinfo2:{tid}` | `{title, publishdate, citesTotal, citedByTotal, casesCitedSample[≤20], citedBySample[≤20]}` | 7 d | `fetch_doc_bundle` |
| `ik:docraw:{tid}` | `{title, html, publishdate, docsource, numcites, numcitedby, casesCited[≤50], citedBy[≤50]}` | 7 d | `fetch_doc_raw` |
| `ik:docmeta:{tid}` | `{title, publishdate, author, bench, docsource, doctype}` (strings only) | 7 d | `fetch_doc_meta` |
| `jsession:{sessionId}` | the whole session payload | `SESSION_TTL_SECONDS` (3600) | `SessionStore` |

These expire; Elasticsearch is the copy that lasts.

### A.7 What lands in Postgres for the same judgment

| Table | Row | When |
|---|---|---|
| `judgement_sessions.payload → issues[].candidateMeta[docId]` | `{title, headline, court, year, numCitedby, esMeta?}` where `esMeta = {esScore, finalScore, matchedPhrases, matchedParagraphs}` for library hits | every run (`assemble_response`) |
| `judgement_sessions.payload → issues[].results[]` | the `ResultItem` (`docId, title, court, year, band, score, fromLibrary, side, outcomeEvidence, …`) | every run |
| `judgement_vault` | `(doc_id, title, court, year, headline, num_citedby, first_seen, last_seen, seen_count)` | GREEN results only, after the response (`api._vault_write`) |
| `citation_usage_events` | one row per `(operation, model)` incl. `provider=elastic, operation=library_hit` | every run / report / advanced search |

None of these hold judgment text; text lives only in `ik_judgments` and
the 7-day cache.

### A.8 Storage sequence, step by step

```
1  IK /doc/{tid}/ responds (JSON above)                       ← billed ₹0.20
2  fetch_doc_bundle: full_text = collapse_spaces(strip_html(doc))
3  cache.set ik:doc:{tid}, ik:docinfo2:{tid}   (7 d)          ← request path
4  index_judgment_async(tid, data, full_text, extra)          ← returns immediately
     └─ loop.run_in_executor(None, _store_judgment_and_paragraphs, tid, body)
5  [worker thread] body = _es_judgment_body(...) + casesCited/citedBy
6  [worker thread] ES PUT ik_judgments/_create/{tid}
       201 created  → continue
       409 conflict → judgment already in the library → STOP (nothing else written)
7  [worker thread] rows = build_paragraph_rows(tid, body)
       split_judgment_paragraphs(text) → ≤400 chunks of ~200–2,500 chars
       per chunk: extract_sections / extract_acts / extract_citations
8  [worker thread] ES _bulk create ik_judgment_paragraphs, _id = tid:n
       (existing ids skipped; raise_on_error=False)
9  log "[library] stored judgment {tid} + N paragraph chunk(s)"
10 (later, only if /docmeta is called for this tid and returns author/bench)
       ES POST ik_judgments/_update/{tid}  {"doc": {"author": …, "bench": …}}
```

No explicit `refresh` is requested; ES's default 1 s refresh makes the new
judgment searchable almost immediately, and `get_judgment` (by id) sees
it at once.

### A.9 Observed coverage on the live library (653 judgments, 2026-09-03)

| Field | Records carrying it | Why |
|---|---|---|
| `doc` (raw HTML) | 200 / 200 sampled | always sent by `/doc`; sizes 2 KB – 3.2 MB |
| `text` | 653 / 653 | always derived |
| `publishdate`, `docsource` | 653 / 653 | always sent |
| `casesCited` | 197 / 200 sampled | empty only when the judgment cites nothing |
| `citedBy` | 85 / 200 sampled | most stored judgments have no citing cases yet |
| `author`, `bench` | 0 / 653 | enrichment runs only on report views and in-app doc views, and no session in the database has a viewed report; on the in-app doc-view path the `/docmeta` update is also issued concurrently with the `/doc` create (`api.advanced_search_doc` gathers both), so it can run before the judgment exists and be silently skipped |
| `fetched_at` | 0 / 653 | legacy mapping only |

Paragraph density today: 37,119 chunks / 653 judgments ≈ 57 per judgment.
