# Indian Kanoon API — how queries run, how calls are made, and what each case costs

Scope: the **judgement-service (8005) Citation Research pipeline**. Every fact
below is taken from `Backend/judgement-service/tools.py` (the
`IndianKanoonClient`) and `agents.py` (the fan-out), and the rupee rates from
`Backend/citation-service/utils/pricing.py`. Verified 2026-08-10.

---

## 1. The HTTP layer

All calls go to `https://api.indiankanoon.org` as **POST** requests with
`Authorization: Token <INDIAN_KANOON_TOKEN>`:

| Endpoint | What it returns | Rate | Cache |
|---|---|---|---|
| `POST /search/?formInput=<query>&pagenum=0` | top ~10 results (title, headline snippet, court, date, docId) | **₹0.50** | 24 h |
| `POST /doc/{id}/?maxcites=20&maxcitedby=20` | the FULL judgment text + cases-cited / cited-by lists | **₹0.20** | 7 days |
| `POST /docmeta/{id}/` | bench, author, publish date | **₹0.02** | 7 days |

Plumbing details that matter:

- One shared keep-alive `httpx.AsyncClient` (no TLS handshake per call).
- Global concurrency semaphore `IK_MAX_CONCURRENCY=24`.
- 429/5xx are retried with backoff inside the call; 401/403 sets the
  `auth_failed` flag (surfaced as `ikTokenRejected` on `/health` — check this
  FIRST whenever "0 judgments" appears platform-wide).
- Only **page 0** of search results is ever fetched — no pagination.
- Cache = Redis when `REDIS_URL` is set, else in-process memory
  (`/health.stores.cache` currently says `memory`, so every service restart
  re-bills warm documents).

---

## 2. How a query becomes the wire request

Indian Kanoon has its own query language; the service compiles to it in
`tools.build_ik_query` / `to_ik_operators`:

| You write | IK receives | IK semantics |
|---|---|---|
| `"leave to defend"` | `"leave to defend"` | exact phrase |
| `deposit withdrawal security` | unchanged | ALL words, **anywhere** in the document (implicit AND) |
| `AND / OR / NOT` | `ANDD / ORR / NOTT` | IK's doubled, case-sensitive operators |
| `( … )` | stripped | parentheses are undocumented — implicit ANDD degrades gracefully |
| — | `doctypes:supremecourt,highcourts,tribunals` appended | court filter (env `IK_DOCTYPES`); forum re-runs use e.g. `doctypes:bombay` |

Real example from the production log (2026-08-10):

```
POST /search/?formInput="Collector of Stamps" "preliminary objection"
     "jurisdiction" doctypes:supremecourt,highcourts,tribunals&pagenum=0
POST /search/?formInput="Collector of Stamps" "preliminary objection"
     "jurisdiction" doctypes:bombay&pagenum=0          ← forum re-run
```

The cards show the exact wire string (`ANDD/ORR` conversion happens at
generation time), so what you tick is byte-for-byte what gets billed.

---

## 3. Anatomy of one issue's search (`fanout_and_fetch`)

For each selected ground/issue, queries are assembled in four classes:

| Class | How many | Hit weight | Results taken | Skipped when you curate? |
|---|---|---|---|---|
| Anchor queries (the 4 shown on the card, or your ticked/typed ones) | ≤ 4 | 2.0 | 15 | never — these ARE your curation |
| Forum-HC re-run of each anchor (`doctypes:bombay` …) | ≤ 4 | 2.5 | 15 | runs for curated queries too |
| Contra queries (adverse line of authority) | ≤ 2 | 1.0 | 10 | **yes** |
| Axis terms (doctrinal/statutory/factual/outcome words) | ~12–16 | 1.0 | 10 | **yes** |

Then, with **zero further IK calls**:

- results are merged and deduped by docId; each hit scores
  `weight × (10 − rank)`; documents matching more distinct queries rank first;
- the pool is capped at 30 (`IK_CANDIDATE_CAP`);
- Gemini embeddings rerank the pool against the issue.

Finally the **top 12 candidates** (`IK_FULL_DOC_TOP_N=12`, after title-dedupe
— IK indexes one judgment under several docIds) each get one `/doc` fetch.
This is non-negotiable by design: the verifier must read the actual judgment
(outcome evidence must be a verbatim substring; the statutory-shelf gate needs
the provision literally present; the CitationGuardian only permits citations
from fetched documents).

**Retry rule:** if a round yields zero usable results after verification, a
fresh query set is generated and the full fan-out runs once more
(`exclude=` the already-tried docIds — nothing is re-billed for the same doc).
Still empty → honest empty, never filler.

---

## 4. Call-count and cost per case (scenarios)

Rates: search ₹0.50 · document ₹0.20 · docmeta ₹0.02.

### Scenario A — 1 issue, 1 curated query (your minimal case)
```
searches:  1 (your query) + 1 (forum re-run)            =  2  → ₹1.00
documents: top 12 of the pool                            = 12  → ₹2.40
TOTAL: 14 calls → ₹3.40
```

### Scenario B — 1 issue, all 4 card queries ticked
```
searches:  4 anchors + 4 forum re-runs                   =  8  → ₹4.00
documents: 12                                            = 12  → ₹2.40
TOTAL: 20 calls → ₹6.40
```

### Scenario C — 1 issue, uncurated (default full fan-out)
```
searches:  4 anchors + 4 forum + 2 contra + ~12 axis     ≈ 22  → ₹11.00
documents: 12                                            = 12  → ₹2.40
TOTAL: ~34 calls → ₹13.40
```

### Scenario D — empty round triggers the reformulation retry
```
Scenario C twice (new queries, old docIds excluded)      ≈ 68  → ~₹26.80
```

### Scenario E — full research run
```
 5 issues uncurated:  ~170 calls → ~₹67
12 issues (the cap):  ~408 calls → ~₹161
Analyze step:         0 IK calls (LLM-only) → ₹0
```

### Scenario F — opening a report (VIEW on a citation)
```
first view:   /docmeta only (the /doc is already cached from the search)
              = 1 call → ₹0.02
re-opening:   0 calls → ₹0.00  (report content cached in the session too)
cold cache:   /doc + /docmeta = 2 calls → ₹0.22
all 24 citations of a run, warm: → ₹0.48
```

**Rule of thumb: the search is ~95% of the bill; reports are noise.** Within
an uncurated search, the ~12 axis-term queries alone are ₹6.00/issue — so
curating queries on the picking step cuts an issue from ₹13.40 to ₹3.40.

---

## 5. Worked example, end to end

Ground: *"Jurisdiction of the Collector of Stamps"* with one ticked query
`"Collector of Stamps" "preliminary objection" "jurisdiction"` on a
Maharashtra case (forum = Bombay HC):

1. `/search/` with the query + `doctypes:supremecourt,highcourts,tribunals`
   → 10 results ......................................... ₹0.50
2. `/search/` same query + `doctypes:bombay` → own-HC results enter the pool
   at 2.5× weight ....................................... ₹0.50
3. Pool of ≤30 deduped candidates → embeddings rerank (Gemini, not IK)
4. `/doc/{id}` for the top 12 → full texts ............... 12 × ₹0.20 = ₹2.40
5. Verifier (Gemini, not IK) kills look-alikes: any judgment whose text never
   contains a statutory anchor of the issue, wrong decisional lens, wrong
   relief head, wrong trigger, or unverifiable outcome → rejected
6. Survivors surface with bands/sides; Bombay HC ranked first
7. You open one report → `/docmeta/{id}` ................. ₹0.02

**Total: ₹3.42 for the whole journey.** Re-running the identical query within
24 h costs ₹0 in searches; re-fetching those documents within 7 days costs ₹0
— *provided the process didn't restart* (set `REDIS_URL` to make the cache
survive restarts and be shared across Cloud Run instances).

---

## 6. Known gaps

- **No spend metering/cap in judgement-service** — citation-service has a
  `BudgetTracker` (`CITATION_V2_MAX_COST_INR=25`); the Citation Research
  pipeline records nothing and caps nothing. A 12-issue run with retries can
  reach ~₹300 silently.
- **In-memory cache** — every restart forfeits the 24h/7d caches (see above).
- Unused IK features that could cut costs further: `/docfragment` (₹0.05)
  instead of full `/doc` for shallow checks, `fromdate/todate`, `title:`,
  `cite:`, `maxpages`.
