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
    # raises mid-run. Raised 14 -> 30 so the fact-grounded precision/recall/SC/court/
    # opponent queries for a multi-issue case all run instead of being starved (R4).
    max_ik_search_calls: int = _int("CITATION_V2_MAX_IK_SEARCH_CALLS", 30)
    # Per-run search budget scales with issue count: effective = min(ceiling, base +
    # per_issue * n_issues). 1 issue=9, 2=16, 3=23, 4=30, 5=30 (capped). Used by the
    # round-robin allocator in retrieve_candidates (relevance over cost — Rs20 is not a cap).
    ik_search_base_budget: int = _int("CITATION_V2_IK_SEARCH_BASE_BUDGET", 2)
    ik_search_per_issue_budget: int = _int("CITATION_V2_IK_SEARCH_PER_ISSUE_BUDGET", 7)
    # Opponent (adverse-authority) queries always get this many guaranteed execution
    # slots so the Adverse bundle is never fully starved under a multi-issue load.
    max_opponent_search_calls: int = _int("CITATION_V2_MAX_OPPONENT_SEARCH_CALLS", 2)
    # Soft budget: non-protected queries (priority >= 3 — SC/court/opponent/fallback) stop
    # here. Protected doctrine + strict queries (priority <= 2) may run up to the hard cap
    # above so the most legally critical queries are never starved (FAILURE 1).
    ik_search_soft_budget: int = _int("CITATION_V2_IK_SEARCH_SOFT_BUDGET", 10)
    max_ik_fragment_calls: int = _int("CITATION_V2_MAX_IK_FRAGMENT_CALLS", 28)
    max_ik_meta_calls: int = _int("CITATION_V2_MAX_IK_META_CALLS", 28)
    max_ik_full_doc_calls: int = _int("CITATION_V2_MAX_IK_FULL_DOC_CALLS", 10)
    max_ai_calls: int = _int("CITATION_V2_MAX_AI_CALLS", 3)  # AI issue extraction + final judge (+headroom)
    max_total_estimated_cost: float = _float("CITATION_V2_MAX_COST_INR", 45.0)
    # Raised 180 -> 600: the wider net + paging + embedding reranker make a thorough run
    # take 150-250s; at 180s the runtime cap fired DURING fetch_full_documents, so every
    # full-doc fetch was rejected (BudgetExceeded) and the report collapsed to 0. This is
    # the hard wall-clock ceiling — relevance over speed.
    max_runtime_seconds: int = _int("CITATION_V2_MAX_RUNTIME_SECONDS", 600)
    # Phase 3 — wider net. Page each search and lift the per-query doc cap so a recall
    # query surfaces more candidates; the embedding reranker (below) then culls the pool
    # to the strongest BEFORE any paid fragment/full-doc spend. Deeper paging is free
    # (one budget unit per search regardless of pages).
    max_raw_candidates: int = _int("CITATION_V2_MAX_RAW_CANDIDATES", 220)
    ik_search_maxpages: int = _int("CITATION_V2_IK_SEARCH_MAXPAGES", 2)
    per_query_doc_cap: int = _int("CITATION_V2_PER_QUERY_DOC_CAP", 40)
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
    rerank_top_k: int = _int("CITATION_V2_RERANK_TOP_K", 14)
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
