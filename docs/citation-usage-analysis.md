# Citation Usage Analysis + Relevance Gate

Per-citation "how to use this judgment" memo (≈500–600 words, category-aware) plus a
report-time relevance gate that keeps the **Recommended** bucket genuinely relevant.

- **Audience:** engineers working on the JuriNex V2 citation pipeline.
- **Status:** shipped 2026-06-17. Design spec: `docs/superpowers/specs/2026-06-17-citation-usage-analysis-design.md`.

## What it does

After classification, one batched `gemini-3.5-flash` call writes, for every shown
citation at once:

- a **relevance verdict** — `RELEVANT` / `PARTIALLY_RELEVANT` / `NOT_RELEVANT` (+ reason),
- a one-line **verdict** (bottom line for the lawyer),
- **4 category-aware sections** (~120–150 words each):

| Recommended | Adverse | Caution |
|---|---|---|
| Why this judgment helps you | Why the opposite side will cite this | Why it is borderline |
| The argument it supports & how to deploy it | The proposition it sets against you | The limited way it can help |
| Factual fit with your case | How to distinguish it on the facts | Factual/legal gaps |
| When not to rely on it / risks | Fallback — how to blunt its impact | How to use it carefully |

The verdict then drives the **relevance gate**:

- `NOT_RELEVANT` → dropped from the report (moved to `context.rejected`, logged).
- `PARTIALLY_RELEVANT` in Recommended → demoted to Caution (still visible).
- `RELEVANT` / unscored → kept in place.

Net result: **Recommended contains only relevant cases.**

## Where it runs

Pipeline order (`pipeline/orchestrator.py`):

```
… → final_ai_judge → classify_results → generate_usage_analysis → build_report
```

`pipeline/stages/generate_usage_analysis.py` calls the service over
`supporting + adverse + caution`, applies the gate, and returns the cleaned
`(supporting, adverse, caution)` to `build_report`.

## Configuration

| Env var | Default | Meaning |
|---|---|---|
| `CITATION_V2_ENABLE_USAGE_ANALYSIS` | `true` | Master switch for the memo + gate stage. |
| `CITATION_V2_ENABLE_RELEVANCE_GATE` | `true` | If false, memos are written but buckets are not pruned. |
| `CITATION_V2_USAGE_ANALYSIS_MAX_TOKENS` | `6000` | Max output tokens for the batched call. |

Model resolves from `CITATION_V2_JUDGE_MODEL` → `CITATION_V2_GEMINI_MODEL` → `GEMINI_MODEL`
→ `gemini-3.5-flash`. The call registers through the existing `usage_tracker.record_gemini`
under op `citation_v2_usage_analysis`, and consumes the dedicated budget op `ai_analysis`
(uncapped by `max_ai_calls`, like `ai_disposition`/`ai_opposition`). BudgetTracker,
usage_tracker, and the cost UI are unchanged.

## Data contract

`models/citation_models.py` → `Candidate`:

| Field | Type | Notes |
|---|---|---|
| `usage_analysis` | `list[{heading, body}]` | up to 4 sections |
| `usage_verdict` | `str` | one-line bottom line |
| `relevance_verdict` | `str` | `RELEVANT` / `PARTIALLY_RELEVANT` / `NOT_RELEVANT` / `""` |
| `relevance_reason` | `str` | short reason |

These are emitted verbatim (snake_case) by `services/report_service.py::citation_to_dict`,
so they appear on every citation in `report_format.citations` / `recommended_citations` /
`adverse_citations` / `use_with_caution`, and persist into Shared reports.

Diagnostics gain `relevance_filtered_count` (`pipeline_diagnostics`).

## Frontend

`frontend/src/components/CitationReport/RedesignedCitationReportDoc.jsx`, Report tab —
a **"How to use this authority"** section above "Legal Analysis & Ratio": a relevance
badge (green/amber/red), the verdict line, then the titled section blocks. Renders only
when `usage_analysis` is present; otherwise hidden.

## Logging

- `[USAGE_ANALYSIS] wrote memos for N/M citation(s) via <model>`
- `[JURINEX][<run>][RELEVANCE_GATE] recommended A->B | demoted_to_caution=D | dropped(NOT_RELEVANT)=X`
- `[JURINEX][<run>][RELEVANCE_GATE] DROP <title> reason=<reason>` (per dropped citation)

## Failure modes

| Condition | Behaviour |
|---|---|
| Gemini client unavailable | Service returns 0, memos empty, gate is a no-op; run completes. |
| `ai_analysis` budget exceeded | Same — skipped with a warning, no exception. |
| Malformed / partial JSON | `loads_lenient` parses what it can; missing rows leave that citation's memo empty. |
| Stage raises unexpectedly | Caught in the stage; original buckets pass through unchanged. |

The feature is strictly additive: with it disabled or failing, the pipeline behaves exactly
as before.

## Tests

`Backend/citation-service/tests/unit/test_usage_analysis_gate.py` — category mapping, the
gate (drops `NOT_RELEVANT`, demotes `PARTIALLY_RELEVANT`-recommended to Caution, keeps
`RELEVANT`), gate/feature disable switches, and graceful skip when the Gemini client is
absent. Run: `venv/bin/python -m pytest tests/unit/ -q`.
