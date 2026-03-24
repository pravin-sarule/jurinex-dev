# Complete Process Pricing — Citation Report Generation

**Last Updated:** March 2025  
**Scope:** All third-party API costs for generating one citation report, including optional document processing (case file upload).

---

## 1. Service-by-Service Pricing Reference

### 1.1 Indian Kanoon API
| Request Type | Cost (INR/Request) | Source |
|--------------|-------------------|--------|
| Search | 0.50 | [api.indiankanoon.org/pricing](https://api.indiankanoon.org/pricing) |
| Original Document | 0.50 | |
| Document | 0.20 | |
| Document Fragment | 0.05 | |
| Document Metainfo | 0.02 | |

### 1.2 Google Search
| Method | Cost | When Used |
|--------|------|-----------|
| **Gemini Google Grounding** (default) | $35/1K grounded prompts (Gemini 3) or per-prompt (Gemini 2.5) | All models by default |
| **Serper API** | ~$0.001–0.01/search | Only when `WATCHDOG_USE_CLAUDE_SEARCH` or `WATCHDOG_GOOGLE_SEARCH_PROVIDER=serper` |

### 1.3 Google Gemini API
| Model | Input (per 1M tokens) | Output (per 1M tokens) | Used By |
|-------|----------------------|------------------------|---------|
| **gemini-2.0-flash** | $0.10 | $0.40 | Clerk, ReportBuilder |
| **gemini-embedding-001** | $0.15 | — | Document-service only* |

*Citation service uses **dummy embeddings** (no API cost). Real embeddings used when documents are processed in document-service.

### 1.4 Anthropic Claude API
| Model | Input (per 1M tokens) | Output (per 1M tokens) | Used By |
|-------|----------------------|------------------------|---------|
| **Claude Sonnet 4.6** | $3.00 | $15.00 | KeywordExtractor |

### 1.5 Google Document AI
| Processor | Cost | When Used |
|-----------|------|-----------|
| Enterprise OCR | $1.50 / 1,000 pages | Scanned PDFs (document-service) |
| Layout Parser | $10.00 / 1,000 pages | Document structure extraction |
| Not used by citation | — | Citation service does **not** call Document AI |

### 1.6 Infrastructure (Fixed Monthly — Not Per Report)
| Service | Pricing Model |
|---------|---------------|
| **Qdrant** | CPU/memory/storage (usage-based) |
| **Neo4j** | Cloud subscription |
| **Elasticsearch** | Self-hosted / Cloud |
| **PostgreSQL** | Self-hosted / Cloud |
| **GCS** | Storage ~$0.02/GB/mo; origdoc uploads negligible per report |

---

## 2. Citation Report Flow — API Call Map

```
User Query (+ optional case_id)
    │
    ├─► [KeywordExtractor] Claude (if case context) — 1–2 calls
    │
    ├─► [Watchdog] Indian Kanoon Search — 1–10 calls
    │         Google Search (Gemini Grounding by default, or Serper when configured) — 1–10 calls
    │
    ├─► [Fetcher] Per IK candidate (cache miss):
    │         Document (0.20) + Fragment (0.05) + Meta (0.02) + OrigDoc (0.50) = 0.77 INR
    │
    ├─► [Clerk] Gemini — 1 call per ingested doc (~6 docs)
    │         Embedding — DUMMY (no cost)
    │
    ├─► [Auditor] Indian Kanoon Search — 1 per citation (~10)
    │
    └─► [ReportBuilder] Gemini _enrich_with_gemini — 2–4 calls (only when fields blank)
```

---

## 3. Cost Calculation Per Report

### 3.1 Scenario A: Simple Query (No Case File)

| Component | Calls/Units | Unit Cost | Total (INR) | Total (USD) |
|-----------|-------------|-----------|-------------|-------------|
| **Indian Kanoon** | | | | |
| Search (Watchdog) | 1 | 0.50 | 0.50 | — |
| Document (×6, 50% cache) | 3 | 0.20 | 0.60 | — |
| Fragment (×6, 50% cache) | 3 | 0.05 | 0.15 | — |
| Metainfo (×6, 50% cache) | 3 | 0.02 | 0.06 | — |
| OrigDoc (×6, 50% cache) | 3 | 0.50 | 1.50 | — |
| Search (Auditor ×10) | 10 | 0.50 | 5.00 | — |
| **IK Subtotal** | | | **7.81** | — |
| **Google Search** (Grounding) | 1 | ~$0.035 | ~₹3 | ~$0.035 |
| **Gemini (Clerk)** | 6 docs | ~12k in + 0.5k out each | — | ~$0.008 |
| **Gemini (ReportBuilder)** | 3 enrichments | ~25k in + 0.5k out each | — | ~$0.009 |
| **Claude** | 0 | — | 0 | 0 |
| **Total (approx)** | | | **~8.50 INR** | **~$0.12** |

### 3.2 Scenario B: With Case File (10 Keyword Sets)

| Component | Calls/Units | Unit Cost | Total (INR) | Total (USD) |
|-----------|-------------|-----------|-------------|-------------|
| **Indian Kanoon** | | | | |
| Search (Watchdog) | 10 | 0.50 | 5.00 | — |
| Document+Fragment+Meta+OrigDoc (×8) | 8 | 0.77 | 6.16 | — |
| Search (Auditor ×10) | 10 | 0.50 | 5.00 | — |
| **IK Subtotal** | | | **16.16** | — |
| **Google Search** (Grounding) | 10 | ~$0.035 | ~₹30 | ~$0.35 |
| **Gemini (Clerk)** | 8 docs | ~12k in + 0.5k out | — | ~$0.011 |
| **Gemini (ReportBuilder)** | 4 enrichments | ~25k in + 0.5k out | — | ~$0.012 |
| **Claude (KeywordExtractor)** | 1–2 | ~30k in + 0.8k out | — | ~$0.17 |
| **Total (approx)** | | | **~22 INR** | **~$0.35** |

### 3.3 Worst Case (No Cache, Max Calls)

| Component | Est. Cost |
|-----------|-----------|
| Indian Kanoon | ~25 INR |
| Google Search (Grounding) | ~₹30 |
| Gemini | ~$0.05 |
| Claude | ~$0.20 |
| **Total** | **~35 INR / ~$0.50** |

---

## 4. Document Processing (Upstream — Case File Upload)

When a user uploads a case file that is later used for citation:

### 4.1 Document AI (Only for Scanned PDFs)

| Scenario | Pages | Cost (USD) |
|----------|-------|------------|
| Digital-native PDF | 0 | $0 (uses pdf-parse) |
| Scanned PDF (10 pages) | 10 | $0.015 (Enterprise OCR) |
| Scanned PDF (50 pages) | 50 | $0.075 |
| Layout Parser (if used) | 10 | $0.10 |

### 4.2 Embedding (document-service)

| Chunks | Tokens (~500/chunk) | Cost (gemini-embedding-001) |
|--------|---------------------|-----------------------------|
| 20 | 10,000 | $0.0015 |
| 50 | 25,000 | $0.00375 |
| 100 | 50,000 | $0.0075 |

### 4.3 Citation Service Embeddings

The citation service stores **dummy embeddings** (`[0.0] * 768`) in Qdrant. No embedding API is called during citation report generation.

---

## 5. Summary Table — Cost Per Report

| Scenario | Indian Kanoon | Google Search | Gemini | Claude | Doc AI | Embedding | **Total (INR)** | **Total (USD)** |
|----------|---------------|---------------|--------|--------|--------|-----------|-----------------|-----------------|
| Simple query | 7.81 | ~₹3 (Grounding) | ~₹1.50 | 0 | 0 | 0 | **~12** | **~0.18** |
| Case file | 16.16 | ~₹30 (Grounding) | ~₹2.00 | ~₹14 | 0 | 0 | **~35** | **~0.50** |
| + Doc upload (scanned 20 pg) | — | — | — | — | ~₹13 | ~₹0.15 | — | **+0.16** |

*Exchange rate: 1 USD ≈ 85 INR*

---

## 6. Cost Optimization Tips

1. **Indian Kanoon cache** — `ik_document_assets` caches responses (24h TTL). Repeat reports on same judgments ≈ 0 INR for those docs.
2. **Disable OrigDoc** — Set `fetch_origdoc=False` to save 0.50 INR per doc (~3 INR per report).
3. **Keyword sets** — Fewer keyword sets = fewer IK Searches + Google Search calls.
4. **Document AI** — Use pdf-parse for digital-native PDFs; only use Document AI for scanned docs.
5. **Claude** — Keyword extraction only runs when case context exists. Simple query = no Claude cost.
6. **Serper fallback** — Use `WATCHDOG_GOOGLE_SEARCH_PROVIDER=serper` only when needed (e.g. Claude-only mode). Default Google Grounding uses Gemini.

---

## 7. Services NOT Used by Citation

- **Document AI** — Citation does not call it. Used only in document-service for PDF OCR.
- **Real embeddings** — Citation uses dummy vectors. Real embeddings used at document upload.
- **OpenAI** — Not used in citation flow.
