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
    max_ik_search_calls: int = _int("CITATION_V2_MAX_IK_SEARCH_CALLS", 10)
    max_ik_fragment_calls: int = _int("CITATION_V2_MAX_IK_FRAGMENT_CALLS", 20)
    max_ik_meta_calls: int = _int("CITATION_V2_MAX_IK_META_CALLS", 20)
    max_ik_full_doc_calls: int = _int("CITATION_V2_MAX_IK_FULL_DOC_CALLS", 7)
    max_ai_calls: int = _int("CITATION_V2_MAX_AI_CALLS", 3)  # AI issue extraction + final judge (+headroom)
    max_total_estimated_cost: float = _float("CITATION_V2_MAX_COST_INR", 25.0)
    max_runtime_seconds: int = _int("CITATION_V2_MAX_RUNTIME_SECONDS", 180)
    max_raw_candidates: int = _int("CITATION_V2_MAX_RAW_CANDIDATES", 80)
    enable_final_ai_judge: bool = os.environ.get("CITATION_V2_ENABLE_FINAL_AI_JUDGE", "true").lower() == "true"


settings = Settings()
