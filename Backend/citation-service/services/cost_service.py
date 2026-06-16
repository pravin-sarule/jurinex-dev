from __future__ import annotations

import logging
from datetime import datetime, timezone

logger = logging.getLogger("citation.audit")


def pre_run_cost_estimate() -> dict:
    """
    Worst-case Indian Kanoon cost for one run, derived from the configured per-op
    call caps × the per-call INR rates. Returned to the client when a run starts so
    the user sees the ceiling up front (actual cost is almost always lower).
    """
    from core.config import settings
    from utils.pricing import IK_DOCUMENT_INR, IK_FRAGMENT_INR, IK_META_INR, IK_SEARCH_INR

    def _line(max_calls: int, rate_inr: float) -> dict:
        return {
            "max_calls": int(max_calls),
            "rate_inr": round(float(rate_inr), 4),
            "max_cost_inr": round(int(max_calls) * float(rate_inr), 2),
        }

    breakdown = {
        "search": _line(settings.max_ik_search_calls, IK_SEARCH_INR),
        "fragment": _line(settings.max_ik_fragment_calls, IK_FRAGMENT_INR),
        "metadata": _line(settings.max_ik_meta_calls, IK_META_INR),
        "full_document": _line(settings.max_ik_full_doc_calls, IK_DOCUMENT_INR),
    }
    total = round(sum(line["max_cost_inr"] for line in breakdown.values()), 2)
    return {
        "indian_kanoon_max_inr": total,
        "breakdown": breakdown,
        "note": "Actual cost will be lower. AI model costs additional.",
    }


def pricing_rates() -> dict:
    """Per-unit prices (INR) for every model/API, so the UI can show tokens × rate = cost."""
    import os
    from utils.pricing import (
        CLAUDE_INPUT_PER_1M_INR, CLAUDE_OUTPUT_PER_1M_INR, GEMINI_EMBED_PER_1M_INR,
        GEMINI_INPUT_PER_1M_INR, GEMINI_OUTPUT_PER_1M_INR, INR_PER_USD,
        IK_DOCUMENT_INR, IK_FRAGMENT_INR, IK_META_INR, IK_ORIG_DOC_INR, IK_SEARCH_INR,
    )
    return {
        "inr_per_usd": INR_PER_USD,
        "gemini": {
            "model": os.environ.get("CITATION_V2_GEMINI_MODEL") or os.environ.get("GEMINI_MODEL", "gemini-3.5-flash"),
            "input_per_1m_inr": round(GEMINI_INPUT_PER_1M_INR, 4),
            "output_per_1m_inr": round(GEMINI_OUTPUT_PER_1M_INR, 4),
        },
        "gemini_embedding": {
            "model": "models/gemini-embedding-001",
            "input_per_1m_inr": round(GEMINI_EMBED_PER_1M_INR, 4),
        },
        "claude": {
            "input_per_1m_inr": round(CLAUDE_INPUT_PER_1M_INR, 4),
            "output_per_1m_inr": round(CLAUDE_OUTPUT_PER_1M_INR, 4),
        },
        "indian_kanoon_per_call_inr": {
            "search": IK_SEARCH_INR, "document": IK_DOCUMENT_INR, "fragment": IK_FRAGMENT_INR,
            "meta": IK_META_INR, "orig_doc": IK_ORIG_DOC_INR,
        },
    }


def record_ik_call(
    run_id: str,
    user_id: str,
    operation: str,
    endpoint: str = "",
    candidate_doc_id: str = "",
    issue_id: str = "",
    success: bool = True,
) -> None:
    from utils.pricing import IK_DOCUMENT_INR, IK_FRAGMENT_INR, IK_META_INR, IK_SEARCH_INR
    from utils.usage_tracker import record

    cost = {
        "search": IK_SEARCH_INR,
        "fragment": IK_FRAGMENT_INR,
        "meta": IK_META_INR,
        "document": IK_DOCUMENT_INR,
    }.get(operation, 0.0)
    metadata = {
        "run_id": run_id,
        "provider": "indian_kanoon",
        "operation_type": operation,
        "endpoint": endpoint,
        "input_tokens": 0,
        "output_tokens": 0,
        "estimated_cost": cost,
        "actual_cost": cost,
        "candidate_doc_id": candidate_doc_id,
        "issue_id": issue_id,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "success": success,
    }
    record(run_id, user_id, "indian_kanoon", operation, quantity=1, unit="calls", cost_inr=cost, metadata=metadata)
    logger.info("Provider cost recorded", extra={"details": metadata})
