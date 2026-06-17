# Citation Usage Analysis + Relevance Gate — Design

Date: 2026-06-17
Status: Approved (brainstorming gate passed)

## Goal

In the citation report, every shown citation gets a **500–600 word, category-aware
"how to use this judgment" memo**, and the same pass **cleans the Recommended bucket so
it contains only genuinely relevant cases**. North star: relevance — an irrelevant
citation is useless regardless of cost (cost is a side-effect, not a hard cap).

## Behaviour

Each memo has a **relevance verdict** + a one-line **verdict** + **4 category-aware
sections** (~130 words each):

| Recommended | Adverse | Caution |
|---|---|---|
| Why this judgment helps you | Why the opposite side will cite this | Why it is borderline |
| The argument it supports + how to deploy it | The proposition it sets against you | The limited way it can help |
| Factual fit with your case | How to distinguish it on facts | Factual/legal gaps |
| When NOT to rely on it / risks | Fallback — how to blunt its impact | How to use it carefully |

Relevance verdict ∈ `RELEVANT | PARTIALLY_RELEVANT | NOT_RELEVANT` (+ short reason).
For `NOT_RELEVANT` the memo states plainly that the case does not support the matter.

## Relevance gate (cleans the buckets)

Applied after analysis, gated by `enable_relevance_gate` (default on), conservative + logged:

- `RELEVANT` → stays in its bucket.
- `PARTIALLY_RELEVANT` in **Recommended** → demoted to **Caution** (visible, flagged).
- `NOT_RELEVANT` → dropped from the report (counted as `relevance_filtered`, logged;
  never silently — `[JURINEX][..][RELEVANCE_GATE]`).
- Adverse/Caution keep `PARTIALLY_RELEVANT`; both drop `NOT_RELEVANT`.

Result: **Recommended = only RELEVANT cases.**

## Architecture

Generation: **eager + batched + persisted** (one Gemini call per run for all ≤7
shortlisted), so the memo is instantly visible and travels in Shared/static reports.

### Backend (Python/FastAPI)
1. `models/citation_models.py`: `Candidate.usage_analysis: list[dict]` (`{heading, body}`),
   `usage_verdict: str`, `relevance_verdict: str`, `relevance_reason: str`.
2. `services/analysis_service.py` → `generate_usage_analyses(candidates, issues, perspective,
   case_context, run_id, user_id, budget)`: ONE batched Gemini call; lenient JSON parse;
   returns `{doc_id: {relevance, reason, verdict, sections[]}}`; attaches to candidates.
   Dedicated budget op `ai_analysis` (same pattern as `ai_disposition`); records via existing
   `usage_tracker.record_gemini`. Graceful: any failure → leave fields empty, never raise.
3. `integrations/gemini/prompts.py` → `usage_analysis_prompt(...)`.
4. `pipeline/stages/generate_usage_analysis.py`: runs the service over
   `supporting+adverse+caution`, then applies the relevance gate and returns the cleaned
   `(supporting, adverse, caution)`.
5. `pipeline/orchestrator.py`: insert stage between `classify_results` and `build_report`;
   feed cleaned lists to `build_report`.
6. `services/report_service.py`: `citation_to_dict` emits the new fields; diagnostics get
   `relevance_filtered_count`.
7. `core/config.py` + `.env`: `enable_usage_analysis` (default true), `enable_relevance_gate`
   (default true), `usage_analysis_max_tokens`.

### Frontend (React/Vite)
8. `RedesignedCitationReportDoc.jsx` Report tab: new **"How to use this authority"** section
   below "Legal Analysis & Ratio" — titled blocks + a relevance badge
   (RELEVANT green / PARTIAL amber / NOT_RELEVANT red). Renders only when present; static text.
   Card list: a small relevance badge; muted style for non-RELEVANT.

## Constraints
- Do NOT touch BudgetTracker internals, usage_tracker, cost-display UI, or Claude wiring.
- All AI calls register through existing `usage_tracker`.
- Confirmed stack unchanged (Gemini 3.5-flash, Indian Kanoon, PostgreSQL/Qdrant, React/Vite).

## Failure handling
Gemini failure or over-budget → memo fields empty, relevance gate becomes a no-op (keep
existing classification), run completes normally. Lenient JSON parsing.

## Testing
- Unit: prompt builder shape; lenient parser → sections per doc_id; service graceful-skip on
  failure; relevance gate demotes PARTIAL-recommended→caution and drops NOT_RELEVANT;
  `report_service` includes fields.
- Frontend: section renders when present, hidden when absent; badge maps verdict→colour.

## Out of scope (separate task if wanted)
Upstream scoring/classification changes. This feature gates relevance at report time using
the most informed signal (full judgment + case read by the judge model).
