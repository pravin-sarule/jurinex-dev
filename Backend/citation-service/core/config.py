from __future__ import annotations

import os
from pathlib import Path
from dataclasses import dataclass
try:
    from dotenv import load_dotenv
except ImportError:
    def load_dotenv(*_args, **_kwargs):
        return False

load_dotenv(Path(__file__).resolve().parents[1] / ".env")


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


def _float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


@dataclass(frozen=True)
class Settings:
    pipeline_version: str = os.environ.get("CITATION_PIPELINE_VERSION", "v2").lower()
    # HARD ceiling for IK searches per run — also the BudgetTracker limit, so it MUST be
    # >= the largest effective per-run budget (base + per_issue * issues), or consume()
    # raises mid-run.
    max_ik_search_calls: int = _int("CITATION_V2_MAX_IK_SEARCH_CALLS", 20)
    # Per-run search budget scales with issue count: effective = min(ceiling, base +
    # per_issue * n_issues). With base=2, per_issue=6: 1 issue=8, 2=14, 3=20, capped 20.
    # Tightened 12 -> 6: queries are now RERANKED best-first (statute/doctrine score highest,
    # recall lowest), so only the top ~20 are worth running — citations come from the
    # high-relevance queries; the low-quality tail (broad recall, redundant outcomes) added IK
    # cost + latency for ~0 new citations. The reranker guarantees the BEST survive the cap.
    ik_search_base_budget: int = _int("CITATION_V2_IK_SEARCH_BASE_BUDGET", 2)
    ik_search_per_issue_budget: int = _int("CITATION_V2_IK_SEARCH_PER_ISSUE_BUDGET", 6)
    # Opponent (adverse-authority) queries always get this many guaranteed execution
    # slots so the Adverse bundle is never fully starved under a multi-issue load.
    max_opponent_search_calls: int = _int("CITATION_V2_MAX_OPPONENT_SEARCH_CALLS", 2)
    # Soft budget: non-protected queries (priority >= 3 — SC/court/opponent/fallback) stop
    # here. Protected doctrine + strict queries (priority <= 2) may run up to the hard cap
    # above so the most legally critical queries are never starved (FAILURE 1).
    ik_search_soft_budget: int = _int("CITATION_V2_IK_SEARCH_SOFT_BUDGET", 10)
    max_ik_fragment_calls: int = _int("CITATION_V2_MAX_IK_FRAGMENT_CALLS", 32)
    max_ik_meta_calls: int = _int("CITATION_V2_MAX_IK_META_CALLS", 32)
    # Up to this many judged candidates → the report can show up to this many citations
    # (across all buckets). 15 -> 20: the AI judge now evaluates ALL full-doc'd candidates
    # (final_ai_judge dropped its hardcoded [:7] throttle), so this is the real ceiling on
    # how many citations a rich case can surface before the relevance gate trims to the
    # genuinely on-point ones (relevance over cost).
    max_ik_full_doc_calls: int = _int("CITATION_V2_MAX_IK_FULL_DOC_CALLS", 20)
    # Per-bucket caps on how many citations the final report shows.
    max_recommended_citations: int = _int("CITATION_V2_MAX_RECOMMENDED_CITATIONS", 10)
    max_adverse_citations: int = _int("CITATION_V2_MAX_ADVERSE_CITATIONS", 5)
    max_caution_citations: int = _int("CITATION_V2_MAX_CAUTION_CITATIONS", 5)
    max_ai_calls: int = _int("CITATION_V2_MAX_AI_CALLS", 3)  # AI issue extraction + final judge (+headroom)
    max_total_estimated_cost: float = _float("CITATION_V2_MAX_COST_INR", 45.0)
    # Raised 180 -> 600: the wider net + paging + embedding reranker make a thorough run
    # take 150-250s; at 180s the runtime cap fired DURING fetch_full_documents, so every
    # full-doc fetch was rejected (BudgetExceeded) and the report collapsed to 0. This is
    # the hard wall-clock ceiling — relevance over speed.
    max_runtime_seconds: int = _int("CITATION_V2_MAX_RUNTIME_SECONDS", 600)
    # Phase 3 — wider net. Page each search so a query fills the per-query doc cap; the
    # embedding reranker (below) then culls the pool to the strongest BEFORE any paid
    # fragment/full-doc spend.
    max_raw_candidates: int = _int("CITATION_V2_MAX_RAW_CANDIDATES", 260)
    # maxpages & per_query_doc_cap are TWINNED: IK bills per RETURNED page (~Rs0.5/page) and
    # per_query_doc_cap truncates the docs kept per query, so any page beyond what fills the
    # cap is paid-for-then-discarded. The efficient setting is maxpages just large enough to
    # fill the cap (~10 results/page): cap 50 ≈ 5 pages, so maxpages 6 gives margin without
    # waste. Cranking maxpages to its 1000 ceiling would only burn money (cap still truncates).
    ik_search_maxpages: int = _int("CITATION_V2_IK_SEARCH_MAXPAGES", 6)
    per_query_doc_cap: int = _int("CITATION_V2_PER_QUERY_DOC_CAP", 50)
    # Tier 1 (B / P3) — co-retrieve the named local High Court AND the Supreme Court in ONE
    # search via comma-separated IK doctypes (e.g. "bombay,supremecourt"), so binding apex
    # precedent and the controlling HC line land in the SAME ranked result set. Still one
    # search = one ik_search budget unit (strictly safer than emitting N court queries).
    # Set CITATION_V2_MULTI_COURT_DOCTYPES=false to revert to single-court doctypes.
    multi_court_doctypes: bool = os.environ.get("CITATION_V2_MULTI_COURT_DOCTYPES", "true").lower() == "true"
    # Stage wall-clock ceiling (B2): stop waiting on a hung IK fan-out after this many seconds
    # and proceed with whatever returned. Must sit ABOVE the per-call HTTP timeout so a slow-
    # but-valid search completes — raised 30 -> 95 to match the 90s per-search read timeout
    # (a slow query is waited on, not clipped). Queries run concurrently, so this is the
    # worst-case stage time only when a single straggler is slow.
    ik_retrieve_deadline_seconds: int = _int("CITATION_V2_IK_RETRIEVE_DEADLINE", 95)
    ik_enrich_deadline_seconds: int = _int("CITATION_V2_IK_ENRICH_DEADLINE", 40)
    enable_final_ai_judge: bool = os.environ.get("CITATION_V2_ENABLE_FINAL_AI_JUDGE", "true").lower() == "true"
    # Outcome-aware adverse detection (disposition service).
    enable_disposition_check: bool = os.environ.get("CITATION_V2_ENABLE_DISPOSITION_CHECK", "true").lower() == "true"
    max_disposition_ai_calls: int = _int("CITATION_V2_MAX_DISPOSITION_AI_CALLS", 8)
    # Cheap metadata/doctrine pre-screen before fragment enrichment.
    enable_cheap_prescreen: bool = os.environ.get("CITATION_V2_ENABLE_CHEAP_PRESCREEN", "true").lower() == "true"
    prescreen_max_age_years: int = _int("CITATION_V2_PRESCREEN_MAX_AGE_YEARS", 15)
    # Opposition bundle (counter-argument hints for adverse authority).
    enable_opposition_bundle: bool = os.environ.get("CITATION_V2_ENABLE_OPPOSITION_BUNDLE", "true").lower() == "true"
    # Arithmetic reranking within client/opponent bundles.
    enable_rerank: bool = os.environ.get("CITATION_V2_ENABLE_RERANK", "true").lower() == "true"
    # Phase 3 — embedding reranker STAGE (distinct from the arithmetic bundle rerank
    # above). Embeds the wider candidate pool against a fact-grounded issue vector and
    # keeps the top-K (>= min/issue) before paid enrichment. Falls back to priority order
    # if embeddings are unavailable, so it never crashes a run.
    enable_rerank_stage: bool = os.environ.get("CITATION_V2_ENABLE_RERANK_STAGE", "true").lower() == "true"
    # 20 -> 30: enrich_fragments loses ~30-40% (candidates missing IK fragment/meta), so a
    # top_k of 20 left only ~12 to shortlist/judge. 30 keeps ~18-20 through enrichment so the
    # judge + buckets can actually reach 10-15 citations when the on-point cases exist.
    rerank_top_k: int = _int("CITATION_V2_RERANK_TOP_K", 30)
    rerank_min_per_issue: int = _int("CITATION_V2_RERANK_MIN_PER_ISSUE", 3)
    # Cap how many candidates the reranker EMBEDS (highest query_priority first). Embedding
    # 150+ candidates was the slowest stage (~87s) and blew the runtime budget; 100 keeps
    # the rerank fast while still ranking the best of the wider net.
    rerank_pool_cap: int = _int("CITATION_V2_RERANK_POOL_CAP", 100)
    # Richer query builder caps (per legal issue). 9 leaves room for 2-3 precision +
    # 2 landmark + strict + SC + court + opponent queries to coexist (FAILURE 2). The
    # execution budget (max_ik_search_calls) is the real cost ceiling.
    max_queries_per_issue: int = _int("CITATION_V2_MAX_QUERIES_PER_ISSUE", 12)
    min_queries_per_issue: int = _int("CITATION_V2_MIN_QUERIES_PER_ISSUE", 3)
    min_doctrine_coverage: int = _int("CITATION_V2_MIN_DOCTRINE_COVERAGE", 2)
    # Represented-side auto-correction (FAILURE 3): when ON, a high-confidence
    # petitioner-side writ document can correct a wrong "respondent" perspective.
    # Set false to always trust the frontend-provided perspective verbatim.
    enable_perspective_autocorrect: bool = os.environ.get("CITATION_V2_ENABLE_PERSPECTIVE_AUTOCORRECT", "true").lower() == "true"
    # Per-citation usage-analysis memo (500-600 words, category-aware) + relevance gate.
    # One batched Gemini call after classification; the relevance verdict cleans the
    # Recommended bucket (NOT_RELEVANT dropped, PARTIALLY_RELEVANT demoted to Caution).
    enable_usage_analysis: bool = os.environ.get("CITATION_V2_ENABLE_USAGE_ANALYSIS", "true").lower() == "true"
    enable_relevance_gate: bool = os.environ.get("CITATION_V2_ENABLE_RELEVANCE_GATE", "true").lower() == "true"
    usage_analysis_max_tokens: int = _int("CITATION_V2_USAGE_ANALYSIS_MAX_TOKENS", 6000)
    # How much of the uploaded case text the pipeline keeps ("Context chars" in the
    # Pipeline Data Flow) and how much the AI reads when extracting issues. Read here
    # (after load_dotenv ran above) so the .env values always apply — reading these as
    # module-level os.environ constants in other files silently fell back to 60000 when
    # that module imported before this one.
    max_context_chars: int = _int("CITATION_V2_MAX_CONTEXT_CHARS", 60000)
    issue_extract_chars: int = _int("CITATION_V2_ISSUE_EXTRACT_CHARS", 60000)
    issue_max_output_tokens: int = _int("CITATION_V2_ISSUE_MAX_TOKENS", 8192)


settings = Settings()
