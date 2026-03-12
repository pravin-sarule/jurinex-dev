# JuriNex Citation Service — Agent Details

This document describes **every agent** in the citation pipeline: **goal**, **inputs**, **how it works**, **outputs**, and **how it completes its goal**.

---

## Pipeline Overview

The **Citation Root Agent** runs sub-agents in this order:

1. **Keyword Extractor** — (optional) turns case context + query into search keyword sets  
2. **Watchdog** — finds candidate judgments from Local DB → Indian Kanoon → Google  
3. **Fetcher** — downloads full document content for IK and Google candidates  
4. **Clerk** — extracts structured fields (Gemini), chunks, embeds, stores in PG/ES/Qdrant/Neo4j  
5. **Librarian** — validates format, year, court, content quality; tags area-of-law  
6. **Auditor** — cross-verifies (Local DB + Indian Kanoon), hallucination checks; approves or quarantines  
7. **Report Builder** — builds final `report_format` (citations array) and saves the report  

Shared context is passed via **AgentContext** (query, user_id, case_id, judgement_ids, metadata). Each agent returns **AgentResult** (success, error, data).

---

## 1. Keyword Extractor Agent

**File:** `agents/root_agent.py` (class `KeywordExtractorAgent`)

### Goal

Produce **search keyword sets** so Watchdog can run multiple targeted searches (Local DB, Indian Kanoon, Google). When the user provides **case file context**, the agent turns that context + the user query into up to **10 legal search queries** (statute + doctrine + court/year). When there is **no case context**, it simply passes the user query through.

### Inputs

- **Context:** `context.query`, `context.metadata["case_file_context"]` (list of `{ name, snippet/content }`), optional `context.metadata["run_id"]`
- **Config:** `TARGET_CITATION_POINTS = 10` (number of keyword sets to generate)

### How It Works

1. **No case context**  
   - Sets `context.metadata["search_query"] = context.query` and `context.metadata["keyword_sets"] = [query]`.  
   - Returns immediately (no LLM call).

2. **With case context**  
   - Builds a single text from up to 20 case files (name + snippet up to 8,000 chars each).  
   - Calls **Claude** (via `_claude`) with a structured prompt that asks for **exactly 10** search query strings, each combining:
     - **Layer 1:** Legal section/statute (e.g. Section 302 IPC, Article 21).  
     - **Layer 2:** Doctrine/fact pattern (e.g. last seen theory, anticipatory bail).  
     - **Layer 3:** Court + time (e.g. Supreme Court 2023).  
   - Rules: Indian Kanoon–compatible phrases, no operators, no bullets, one query per line, &lt; 140 chars each.  
   - Parses the response line-by-line into `keyword_sets` (capped at 10, each at 400 chars).  
   - If parsing yields nothing, fallback: one augmented query from Claude (user query + short keyword phrase).  
   - Sets `context.metadata["keyword_sets"]` and `context.metadata["search_query"]` = first keyword set.

3. **Logging**  
   - Writes to `agent_logs` (run_id, agent name, message, metadata) when available.

### Outputs

- **Context:** `metadata["search_query"]`, `metadata["keyword_sets"]`, optionally `metadata["keyword_extraction_chunks_used"]`, `metadata["keyword_extraction_embeddings_used"]`
- **AgentResult.data:** `search_query`, `augmented` (bool), `keyword_sets_count`, `chunks_used_for_keywords`, `embeddings_used`, `message`

### How It Achieves Its Goal

By using **case documents + user query** to generate **multiple focused search strings** (statute + doctrine + court), Watchdog gets better coverage and more relevant judgments than a single free-text query. The three-layer structure and character limits keep queries compatible with Indian Kanoon and local search.

---

## 2. Watchdog Agent

**File:** `agents/watchdog.py` — `run_watchdog()`

### Goal

Find **candidate judgments** from three sources in order: **Local DB** → **Indian Kanoon API** → **Google (Serper)**, then return a merged, deduplicated set: local judgement IDs (ready for the report) and IK/Google candidates (for Fetcher + Clerk).

### Inputs

- **Arguments:** `query`, `max_local=10`, `max_ik=10`, `max_google=5`, optional `keyword_sets` (list of query strings), optional `run_id`
- **Context (from root):** `metadata["search_query"]`, `metadata["keyword_sets"]` (from Keyword Extractor)

### How It Works

1. **Resolve queries**  
   - If `keyword_sets` is provided, use them; else use a single-element list `[query]`.  
   - Primary query = first element (used for local search).

2. **Local DB search**  
   - Calls `judgement_search_local(primary_query, limit=max_local)` (Elasticsearch or PostgreSQL full-text).  
   - Each row is tagged `_source: "local"`.  
   - Returns list of judgement records (id, title, primary_citation, court, ratio, source, etc.).  
   - **all_judgement_ids** = list of `row["id"]` from local results.

3. **Indian Kanoon search (per query)**  
   - For each query in the list: POST `https://api.indiankanoon.org/search/?formInput=...&pagenum=0` with `INDIAN_KANOON_API_TOKEN`.  
   - Parses `docs` / `results` into list of `{ external_id (tid), title, snippet, docsource, _source: "indian_kanoon" }`.  
   - Limit per query: `max_ik // len(queries)` when multiple queries.  
   - Deduplicates by `external_id` in `seen_ik`.

4. **Google search (Serper)**  
   - **CHECK 4:** If Indian Kanoon returns **0** for a query, that query is sent to Google as fallback.  
   - If IK returned results, Google is still run for the same query (to get more candidates).  
   - Builds search string: `query + " Indian law judgement Supreme Court High Court site:indiankanoon.org OR ..."`.  
   - POST to `https://google.serper.dev/search` with `SERPER_API_KEY`.  
   - Maps `organic` results to `{ title, link, snippet, _source: "google" }`.  
   - Deduplicates by `link` in `seen_google`.  
   - Limit per query: `max_google // len(queries)` when multiple queries.

5. **Aggregate and log**  
   - `candidates_ik` = values of `seen_ik`; `candidates_google` = values of `seen_google`.  
   - Builds `search_keywords_by_route`: which keywords were used for local, indian_kanoon, google (for report metadata).  
   - Writes progress to `agent_logs` when `run_id` is set.

### Outputs

- **Return dict:**  
  - `local` — list of local judgement rows  
  - `candidates_ik` — list of IK candidates (need fetch + clerk)  
  - `candidates_google` — list of Google candidates (need fetch + clerk)  
  - `all_judgement_ids` — IDs from local DB to include in the report  
  - `search_keywords_by_route` — `{ "local": [...], "indian_kanoon": [...], "google": [...] }`  
- **On error:** `error` key and empty lists.

### How It Achieves Its Goal

By running **three routes** (local → IK → Google) and optionally **multiple keyword sets**, Watchdog maximizes the chance of finding relevant judgments. Local results are used as-is; IK and Google results are passed to Fetcher/Clerk for full-doc retrieval and ingestion. Fallback to Google when IK returns nothing ensures some candidates even for niche queries.

---

## 3. Fetcher Agent

**File:** `agents/fetcher.py` — `fetch_ik_candidates()`, `fetch_google_candidates()`

### Goal

Download **full document content** for every Indian Kanoon and Google candidate so the Clerk can extract structured citation data. Only documents with enough text (≥ 500 chars after stripping HTML) are kept.

### Inputs

- **From context:** `metadata["candidates_ik"]`, `metadata["candidates_google"]` (from Watchdog), optional `run_id`
- **Constants:** `MIN_JUDGMENT_CHARS = 500`

### How It Works

**Indian Kanoon**

1. For each candidate, read `external_id` (tid).  
2. POST `https://api.indiankanoon.org/doc/{tid}/` with IK token; parse JSON.  
3. Take `doc` (HTML); strip tags to get `raw_content`.  
4. If `len(raw_content) < MIN_JUDGMENT_CHARS`, skip (log warning).  
5. Otherwise append to output: `{ external_id, title, doc_html, raw_content (capped 500k), docsource, source: "indian_kanoon" }`.  
6. Log each fetch/skip to `agent_logs`.

**Google**

1. For each candidate, read `link`.  
2. GET the URL with a browser User-Agent; decode body (UTF-8).  
3. If response is PDF (by Content-Type or URL), store placeholder: `"[PDF content not extracted...]"` (still need min length for inclusion).  
4. If `len(content) < MIN_JUDGMENT_CHARS`, skip.  
5. Otherwise append: `{ link, title, snippet, raw_content (capped 300k), source: "google" }`.  
6. Log each fetch/skip to `agent_logs`.

Root agent runs IK and Google fetch **in parallel** (ThreadPoolExecutor, 2 workers).

### Outputs

- **Context:** `metadata["fetched_ik"]`, `metadata["fetched_go"]` — lists of doc objects with `raw_content` (and `doc_html` for IK).  
- **AgentResult.data:** `ik_fetched`, `google_fetched`, `errors` (list of error messages if any).

### How It Achieves Its Goal

By fetching **full HTML/page content** and enforcing a **minimum length**, the Fetcher ensures the Clerk only processes real judgment text. Skipping tiny or failed responses avoids polluting the DB with stubs. Parallel fetch keeps latency reasonable.

---

## 4. Clerk Agent

**File:** `agents/clerk.py` — `clerk_ingest_ik()`, `clerk_ingest_google()`

### Goal

Turn **raw judgment text** (from Fetcher) into **structured judgment records** and store them in **PostgreSQL, Elasticsearch, Qdrant, and Neo4j** with a single **canonical_id** per judgment. All **10 citation points** (case name, citation, court, coram, date, statutes, ratio, excerpt, subsequent treatment, verification status) are extracted via **Gemini** so the report is never empty where the document has data.

### Inputs

- **From context:** `metadata["fetched_ik"]`, `metadata["fetched_go"]`, `context.query`, `context.case_id`, optional `run_id`
- **Config:** `EXTRACT_TEXT_LENGTH = 40000`, `CHUNK_SIZE = 1200`, `CHUNK_OVERLAP = 200`

### How It Works

For **each** doc in `fetched_ik` or `fetched_go`:

1. **Raw text**  
   - Use `raw_content` or `doc_html` (IK) or `raw_content`/`content`/`snippet` (Google).  
   - Run through `_html_to_text()` to strip script/style and tags, normalize newlines.

2. **Gemini extraction (CHECK 6)**  
   - Send up to `EXTRACT_TEXT_LENGTH` chars to **Gemini 2.0 Flash** with a prompt that demands **one JSON** with exactly: caseName, primaryCitation, alternateCitations, court, coram, benchType, dateOfJudgment, statutes, ratio, excerptPara, excerptText, subsequentTreatment (followed/distinguished/overruled), verificationStatus, officialSourceUrl.  
   - If the first run returns **empty ratio and empty primaryCitation**, call Gemini **once more** (retry).  
   - `_merge_extraction()` fills missing fields with placeholders (e.g. "Further research needed", "—") so the report always has 10 points.

3. **Chunking**  
   - `_chunk_text(raw_text, CHUNK_SIZE, CHUNK_OVERLAP)` → list of text chunks.  
   - Build `paragraphs`: `[{ paragraph_id, text }]` for ES/storage.

4. **Build raw_data**  
   - Map Gemini + doc metadata to: case_name, court_code, court_name, judgment_date, year, bench_size, bench_type, summary_text/holding_text (ratio), full_text, paragraphs, judges (from coram), statutes, primary_citation, alternate_citations, excerpt_para, excerpt_text, subsequent_treatment, verification_status, official_source_url, source_type ("indian_kanoon" or "google"), source_url, case_id.

5. **Multi-DB ingest (LegalCitationAgent)**  
   - Call `LegalCitationAgent.ingest_judgment(raw_data)`.  
   - **LegalCitationAgent** (in `legal_citation_agent.py`):  
     - Generates **canonical_id** (e.g. from case_name + court_code + year hash, or `ik_{tid}` for IK docs).  
     - **CHECK 7:** If judgment already exists in PG (`_check_pg_exists(canonical_id)`), returns `status: "skipped"` and does **not** overwrite.  
     - Inserts/updates **PostgreSQL** (judgments table), **Elasticsearch** (judgments index), **Qdrant** (legal_embeddings; optional dummy embedding), **Neo4j** (Case nodes, CITES edges if citations extracted).  
   - If `ingest_judgment` returns `status == "storage_failed"`, Clerk **retries once**.  
   - On `status in ("success", "skipped")` and presence of `canonical_id`, append that id to `new_ids`.

6. **Context update**  
   - All `new_ids` from IK and Google are merged into `context.judgement_ids` (root adds them after Clerk run).

### Outputs

- **Context:** `context.judgement_ids` extended with new canonical_ids from ingested docs.  
- **AgentResult.data:** `ik_ingested`, `google_ingested`, `total_ingested`, `errors`.

### How It Achieves Its Goal

By using **Gemini** on a large slice of text, the Clerk extracts all 10 citation points in one shot and fills placeholders only when the document truly lacks data. **Chunking** supports full-text and semantic search. **Multi-DB ingest** with **canonical_id** and **no overwrite** (CHECK 7) keeps one source of truth and avoids duplicate or corrupted records.

---

## 5. Librarian Agent

**File:** `agents/librarian.py` — `run_librarian()`

### Goal

**Validate and enrich** every citation that will be considered for the report. Ensure citation format, year, court, and content quality are acceptable, tag **area-of-law**, and classify each judgment as **validated**, **validated_with_warnings**, **flagged**, or **rejected**. Only validated and flagged IDs go to the Auditor; rejected ones are dropped from the pipeline.

### Inputs

- **Argument:** `judgement_ids` (list of canonical_ids) — from `context.judgement_ids` after Watchdog + Clerk.
- **Per-judgment data:** from DB via `judgement_get(jid)` (title, primary_citation, court, ratio, raw_content, source).

### How It Works

For **each** `jid` in `judgement_ids`:

1. **Load judgment**  
   - `judgement_get(jid)`. If missing, mark **rejected**, reason `not_in_db`.

2. **Check 1 — Citation format**  
   - Run `_detect_citation_format(primary_citation)` against regex patterns for: SCC, AIR, SCR, SCC_SUPP, JT, MANU, WRIT, CRIMINAL_APPEAL, CIVIL_APPEAL, AWC, SLP.  
   - If matched → enrich with `citation_format`.  
   - If citation present but no pattern → warning `unrecognised_citation_format`.  
   - If missing/empty → issue `missing_citation`.

3. **Check 2 — Year plausibility**  
   - Extract years from citation or title with regex `(1[89]\d{2}|20[012]\d)`; take first ≤ current year.  
   - If found → enrich with `detected_year`.  
   - Else → warning `year_undetectable`.

4. **Check 3 — Court recognition**  
   - `_validate_court(court)`: court string must contain one of a fixed set of tokens (supreme court, high court, state names, NCLAT, etc., or "web" for Google).  
   - If not recognized → warning `unknown_court`.

5. **Check 4 — Content quality**  
   - `content_len = len(raw_content)`.  
   - ≥ 500 chars → OK.  
   - 100–499 → warning `thin_content`.  
   - &lt; 100 → issue `empty_content`.

6. **Check 5 — Area-of-law**  
   - If DB already has `area`, keep it.  
   - Else `_detect_area(title + ratio)`: keyword match against predefined areas (constitutional, criminal, civil, corporate, taxation, family, environmental, labour, IP, arbitration, administrative).  
   - Store in `enrichments["area_of_law"]`.

7. **Status decision**  
   - **Rejected:** both `missing_citation` and `empty_content`.  
   - **Flagged:** any other issue, or ≥ 3 warnings.  
   - **Validated with warnings:** 1–2 warnings, no critical issues.  
   - **Validated:** no issues, no warnings.

8. **Persist**  
   - `judgement_update_validation(jid, librarian_status, librarian_warnings, librarian_issues, area)`.

9. **Details**  
   - Store per jid: `source`, `status`, `warnings`, `issues`, `enrichments`.

### Outputs

- **Return:** `validated_ids`, `flagged_ids`, `rejected_ids`, `details` (per jid).  
- **Context (set by root):** `metadata["validated_ids"]`, `metadata["flagged_ids"]`, `metadata["rejected_ids"]`, `metadata["librarian_result"]`.

### How It Achieves Its Goal

By applying **format, year, court, and content** checks and **area-of-law** tagging, the Librarian filters out stubs and malformed citations early. **Validated** and **flagged** lists tell the Auditor which IDs to cross-verify; **rejected** IDs are never sent to the user, keeping the pipeline focused on plausible citations.

---

## 6. Auditor Agent

**File:** `agents/auditor.py` — `run_auditor()`

### Goal

**Cross-verify** every citation that passed the Librarian (validated + flagged) and decide **approve** (show to user) or **quarantine** (hide). Only **VERIFIED**, **VERIFIED_WITH_WARNINGS**, and **NEEDS_REVIEW** are approved; **QUARANTINED** citations are excluded from the report and can be sent to the HITL queue. Goal: **zero mistakes** — no unverified citation reaches the user.

### Inputs

- **Arguments:** `validated_ids`, `flagged_ids` (optional), `verify_online=True`.  
- **From DB:** full judgment row via `judgement_get(jid)` (title, primary_citation, ratio, source, raw_content).  
- **Config:** `TARGET_CITATION_POINTS = 10` (used by root for retry logic).

### How It Works

For **each** jid in `validated_ids ∪ flagged_ids` (deduplicated, order preserved):

1. **Load judgment**  
   - If not in DB → **QUARANTINED**, reason `not_in_db`.

2. **Check 1 — Local DB integrity**  
   - `_verify_via_local_db(jid)`: has title, has primary_citation (non-placeholder), has raw_content ≥ 500 chars.  
   - Quality score 0–3 → confidence 0, 45, 70, 90.  
   - **Verified** if score ≥ 2.

3. **Check 2 — Indian Kanoon cross-check** (if `verify_online` and token set)  
   - If jid starts with `ik_`, extract tid and call `_ik_verify_by_tid(tid, title, token)`: fetch IK doc by id, compare title (Jaccard similarity). If sim ≥ 0.40 → verified, confidence from sim.  
   - Else call `_ik_verify_by_search(citation or title, title, token)`: search IK, compare first result title. If sim ≥ 0.35 → verified.  
   - Result: `verified`, `method`, `confidence`, `notes`.

4. **Check 3 — Hallucination flags**  
   - `_hallucination_flags(title, citation, ratio)` detects:  
     - **future_year_in_citation** — year in citation &gt; current year.  
     - **suspiciously_simple_citation** — e.g. "(20XX) 1 SCC 1".  
     - **placeholder_citation** — citation is "—", "n/a", "null", etc.  
     - **ratio_too_short** — ratio &lt; 40 chars.  
     - **non_case_title** — title doesn’t look like a case name (no "v.", "vs", "versus", or legal keywords).

5. **Final verdict**  
   - **Trust baseline by source:** local 80, indian_kanoon 75, google 50.  
   - **Critical hallucination** (future year or placeholder) → **QUARANTINED**, confidence 0.  
   - Else if **any_verified** (local or IK) and **no** hallucination flags → **VERIFIED**, confidence = max(trust_base, max_conf).  
   - Else if any_verified but **has** flags → **VERIFIED_WITH_WARNINGS**, confidence reduced.  
   - Else if **flagged** (by Librarian) and **not** any_verified → **QUARANTINED**.  
   - Else if max_conf ≥ 45 → **NEEDS_REVIEW** (approved but yellow in UI).  
   - Else → **QUARANTINED**.

6. **Persist**  
   - `judgement_update_validation(jid, audit_status=..., audit_confidence=...)`.

7. **Approve vs quarantine**  
   - **approved_ids** ← jids with status VERIFIED, VERIFIED_WITH_WARNINGS, NEEDS_REVIEW.  
   - **quarantined_ids** ← jids with QUARANTINED.

8. **Audit details**  
   - Per jid: `audit_status`, `final_confidence`, `source`, `local_check`, `ik_check`, `hallucination_flags`, `reason`.

### Outputs

- **Return:** `approved_ids`, `quarantined_ids`, `audit_details`, `approved_count`, `missing_count`, `failed_point_ids` (quarantined).  
- **Context (set by root):** `metadata["audit_details"]`, `metadata["approved_ids"]`, `metadata["quarantined_ids"]`; **context.judgement_ids** is **replaced** with `approved_ids`.

### How It Achieves Its Goal

By combining **local DB integrity**, **Indian Kanoon cross-check**, and **hallucination detection**, the Auditor ensures only citations that exist and match an authoritative source (or at least pass a confidence bar) are approved. **QUARANTINED** items are never shown in the main report; they can be queued for HITL so the system stays safe while still collecting candidates for human review.

---

## 7. Report Builder Agent

**File:** `agents/root_agent.py` (class `ReportBuilderAgent`); report content built in `report_builder.py` — `build_report_from_judgements()`.

### Goal

Turn the **approved judgement IDs** into the **final citation report** in the format the frontend expects: `report_format = { citations[], generatedAt, sourceBreakdown, searchKeywords, ... }`. Each citation has all 10 points (case name, citation, court, coram, date, statutes, ratio, excerpt, treatment, verification status, source, etc.). Fill any blank fields using **Gemini enrichment**. Save the report to the DB and set **report_id** in context.

### Inputs

- **From context:** `context.judgement_ids` (approved only), `context.query`, `context.user_id`, `context.case_id`, `metadata["audit_details"]`, `metadata["keyword_sets"]`, `metadata["search_keywords_by_route"]`, optional `run_id`.

### How It Works

1. **Load judgements**  
   - For each jid in `judgement_ids`, `judgement_get(jid)`.

2. **Gemini enrichment (per judgment)**  
   - In `report_builder._enrich_with_gemini(j, query)`: if any of the 10 points are blank or placeholder ("—", "Further research needed", etc.), send a large slice of full text (e.g. 25k chars) to **Gemini** with a prompt that asks for a single JSON with all 10 points.  
   - Overwrite only **empty** or placeholder fields in `j` (never overwrite with "not found" for case name).  
   - Runs in parallel (thread pool) for speed.

3. **Map to citation object**  
   - `_judgement_to_citation(j, index, query, audit_info)` builds one frontend-style citation:  
     - **Three-layer verification:** existence (L1), metadata (L2), proposition alignment (L3) with court-tier thresholds → **verificationStatus** (GREEN/YELLOW/RED/PENDING/STALE).  
     - **Failure reason** for RED/PENDING (overruled, hallucination flags, L1/L3 fail, low score).  
     - **Subsequent treatment:** from DB + `subsequent_treatment_extractor` (regex + LLM on full text) → followed/distinguished/overruled lists.  
     - **Priority score** for HITL (court tier, recency, query volume, confidence).  
     - **Source label** (Local DB, Indian Kanoon, Google Search) and **fetchedFrom** text.  
   - All 10 citation points (caseName, primaryCitation, court, coram, dateOfJudgment, statutes, ratio, excerpt, treatment, verification, URLs, etc.) are set; placeholders used only when data is truly missing.

4. **Sort and pad**  
   - Sort citations by data completeness and confidence.  
   - Pad up to **TARGET_CITATION_POINTS** (10) with placeholder citations ("Further research needed") so the report always has 10 slots.  
   - Renumber `id` (cit-001, cit-002, …).

5. **Build report_format**  
   - `citations`, `generatedAt`, `sourceBreakdown`, `totalPoints`, `searchKeywords`, `searchKeywordsByRoute`, `searchQuery`, `reportNote`, `textReport` (optional markdown).

6. **Save report**  
   - `report_insert(report_id, user_id, query, report_format, status="completed", case_id, run_id, citations_approved_count)`.

7. **Context**  
   - `context.metadata["report_id"]` = new UUID.

### Outputs

- **AgentResult.data:** `report_id`, `report_format`, `citation_count`.  
- **DB:** one row in `citation_reports` with the same `report_format` the frontend uses.

### How It Achieves Its Goal

By **loading only approved judgements**, **enriching blanks with Gemini**, and **mapping** each to a full 10-point citation with **three-layer status** and **subsequent treatment**, the Report Builder delivers a consistent, user-ready report. **Padding to 10** and **placeholder citations** keep the UI layout stable and make “gaps” explicit. Saving with **report_id** and **run_id** links the report to the pipeline run and allows listing/filtering by user and case.

---

## 8. Citation Root Agent (Orchestrator)

**File:** `agents/root_agent.py` — `CitationRootAgent`

### Goal

Run the **full citation pipeline** in the correct order, pass **shared context** between agents, handle **retries** (Auditor approval count below target), **HITL** (quarantined citations), and **fallback** (no judgements at all). Produce either a **completed** report or a **pending_hitl** report with a clear message.

### How It Works (Summary)

1. **Manifest check**  
   - After Keyword Extractor, build manifest (search_query, case_text, keyword_sets). If empty → abort with error.

2. **Watchdog**  
   - Run once; get local IDs + IK/Google candidates.

3. **Fetcher + Clerk**  
   - Run only if there are IK or Google candidates. Run in parallel (Fetcher then Clerk). Merge new canonical_ids into `context.judgement_ids`.

4. **No judgements**  
   - If after Watchdog (+ Clerk) there are still no judgement_ids → **fallback**: run legacy `run_citation_agent`; create report with **empty citations** and **status pending_hitl** and message that web citations are under review (do **not** show raw web/AI citations).

5. **Librarian**  
   - Run once on all judgement_ids.

6. **Auditor (with retry)**  
   - Run Auditor. If **approved_count < TARGET_CITATION_POINTS** (10), retry up to 2 times: run Watchdog again (more queries) → Fetcher → Clerk → merge new IDs → Librarian → Auditor again.  
   - Then: if **no approved** and **no quarantined** → fallback (same as step 4).  
   - If **quarantined_ids** present: build report from **approved only**; set status **pending_hitl**; push each quarantined citation to **hitl_queue**; save report with `pendingMessage` and `pendingHITLCount`; **return** (no Report Builder run for “all approved” path).  
   - If only **approved_ids**: run **Report Builder**; save report **completed**; update **pipeline_run** with report_id and counts.

7. **Logging**  
   - Each sub-agent call is wrapped in `_delegate()`: log to agent_logs, run agent, log result or error.

### How It Achieves Its Goal

By **sequencing** agents and **sharing context** (judgement_ids, metadata), the Root Agent ensures Watchdog → Fetcher → Clerk → Librarian → Auditor → Report Builder (or HITL path) run in the right order. **Retries** improve the chance of reaching 10 citation points. **Quarantine + HITL** keeps unverified citations out of the main report while still recording them for human review. **Fallback** handles the case where no judgements are found at all without ever exposing unverified web/AI citations to the user.

---

## Summary Table

| Agent              | Goal                                           | Main input              | Main output                         |
|--------------------|------------------------------------------------|-------------------------|-------------------------------------|
| Keyword Extractor  | Generate search keyword sets from case + query | query, case_file_context| search_query, keyword_sets          |
| Watchdog           | Find candidates (local, IK, Google)            | query, keyword_sets     | all_judgement_ids, candidates_ik/go |
| Fetcher            | Get full document content                      | candidates_ik, _google  | fetched_ik, fetched_go              |
| Clerk              | Extract + store in PG/ES/Qdrant/Neo4j           | fetched_ik, _go, query  | new canonical_ids                   |
| Librarian          | Validate format/year/court/content; tag area    | judgement_ids           | validated_ids, flagged_ids, rejected_ids |
| Auditor            | Cross-verify; approve or quarantine             | validated_ids, flagged_ids | approved_ids, quarantined_ids, audit_details |
| Report Builder     | Build report_format and save report            | approved_ids, audit_details | report_id, report_format            |
| Root               | Orchestrate pipeline; retry; HITL; fallback    | query, user_id, case_id, case_file_context | report_id, report_format, status   |

All agents log to **agent_logs** when **run_id** is present, so the frontend can show live progress during a citation run.
