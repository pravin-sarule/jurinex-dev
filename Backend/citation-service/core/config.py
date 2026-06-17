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
    max_ik_search_calls: int = _int("CITATION_V2_MAX_IK_SEARCH_CALLS", 14)
    # Opponent (adverse-authority) queries always get this many guaranteed execution
    # slots so the Adverse bundle is never fully starved under a multi-issue load.
    max_opponent_search_calls: int = _int("CITATION_V2_MAX_OPPONENT_SEARCH_CALLS", 2)
    # Soft budget: non-protected queries (priority >= 3 — SC/court/opponent/fallback) stop
    # here. Protected doctrine + strict queries (priority <= 2) may run up to the hard cap
    # above so the most legally critical queries are never starved (FAILURE 1).
    ik_search_soft_budget: int = _int("CITATION_V2_IK_SEARCH_SOFT_BUDGET", 10)
    max_ik_fragment_calls: int = _int("CITATION_V2_MAX_IK_FRAGMENT_CALLS", 20)
    max_ik_meta_calls: int = _int("CITATION_V2_MAX_IK_META_CALLS", 20)
    max_ik_full_doc_calls: int = _int("CITATION_V2_MAX_IK_FULL_DOC_CALLS", 7)
    max_ai_calls: int = _int("CITATION_V2_MAX_AI_CALLS", 3)  # AI issue extraction + final judge (+headroom)
    max_total_estimated_cost: float = _float("CITATION_V2_MAX_COST_INR", 25.0)
    max_runtime_seconds: int = _int("CITATION_V2_MAX_RUNTIME_SECONDS", 180)
    max_raw_candidates: int = _int("CITATION_V2_MAX_RAW_CANDIDATES", 80)
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
    # Richer query builder caps (per legal issue). 9 leaves room for 2-3 precision +
    # 2 landmark + strict + SC + court + opponent queries to coexist (FAILURE 2). The
    # execution budget (max_ik_search_calls) is the real cost ceiling.
    max_queries_per_issue: int = _int("CITATION_V2_MAX_QUERIES_PER_ISSUE", 9)
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


settings = Settings()
