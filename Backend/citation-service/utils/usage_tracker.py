"""
Usage tracking for third-party services in the citation pipeline.
Costs are computed in INR from utils.pricing (driven by .env); cost_usd is derived for reference.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, Optional

from db.client import usage_record_insert

from utils.auth_user_lookup import resolve_user_display_and_username
from utils.pricing import (
    CLAUDE_INPUT_PER_1M_INR,
    CLAUDE_OUTPUT_PER_1M_INR,
    DOCUMENT_AI_PER_1000_PAGES_INR,
    GEMINI_GROUNDING_PER_CALL_INR,
    GEMINI_INPUT_PER_1M_INR,
    GEMINI_OUTPUT_PER_1M_INR,
    IK_DOCUMENT_INR,
    IK_FRAGMENT_INR,
    IK_META_INR,
    IK_ORIG_DOC_INR,
    IK_SEARCH_INR,
    SERPER_PER_SEARCH_INR,
    inr_to_usd,
)

logger = logging.getLogger(__name__)


def _log_shared_token_pool(
    user_id: str,
    model: str | None,
    tokens_in: int,
    tokens_out: int,
    endpoint: str,
) -> None:
    """Mirror LLM token usage into payment DB llm_usage_logs (shared across all services)."""
    uid = str(user_id or "").strip()
    if not uid or uid.lower() == "anonymous":
        return
    if tokens_in <= 0 and tokens_out <= 0:
        return
    try:
        from services.quota_guard import log_llm_usage

        log_llm_usage(
            user_id=uid,
            model_name=(model or "unknown").strip() or "unknown",
            input_tokens=max(0, int(tokens_in)),
            output_tokens=max(0, int(tokens_out)),
            endpoint=endpoint,
        )
    except Exception as exc:
        logger.debug("[usage_tracker] shared pool log skipped: %s", exc)


def record(
    run_id: Optional[str],
    user_id: str,
    service: str,
    operation: str,
    quantity: int = 1,
    unit: str = "calls",
    cost_inr: float = 0,
    cost_usd: float = 0,
    metadata: Optional[Dict[str, Any]] = None,
) -> None:
    """Insert a usage record into citation_service_usage. Prefer passing cost_inr; cost_usd optional."""
    if cost_inr and not cost_usd:
        cost_usd = inr_to_usd(cost_inr)
    uid = user_id or "anonymous"
    display_name, username = resolve_user_display_and_username(uid)
    meta: Dict[str, Any] = dict(metadata) if metadata else {}
    if display_name and "userDisplayName" not in meta:
        meta["userDisplayName"] = display_name
    if username and "username" not in meta:
        meta["username"] = username
    usage_record_insert(
        run_id=run_id,
        user_id=uid,
        service=service,
        operation=operation or "",
        quantity=quantity,
        unit=unit,
        cost_inr=cost_inr,
        cost_usd=cost_usd,
        metadata=meta if meta else None,
        user_display_name=display_name or None,
        username=username or None,
    )


def record_ik(
    run_id: Optional[str],
    user_id: str,
    operation: str,
    count: int = 1,
    cost_inr: Optional[float] = None,
) -> None:
    """Record Indian Kanoon usage. operation: search, document, fragment, meta, orig_doc."""
    if cost_inr is None:
        costs = {
            "search": IK_SEARCH_INR,
            "document": IK_DOCUMENT_INR,
            "fragment": IK_FRAGMENT_INR,
            "meta": IK_META_INR,
            "orig_doc": IK_ORIG_DOC_INR,
        }
        cost_inr = costs.get(operation.lower(), IK_SEARCH_INR) * count
    record(
        run_id=run_id,
        user_id=user_id or "anonymous",
        service="indian_kanoon",
        operation=operation,
        quantity=count,
        unit="calls",
        cost_inr=cost_inr,
        cost_usd=inr_to_usd(cost_inr),
        metadata=None,
    )


def record_gemini(
    run_id: Optional[str],
    user_id: str,
    operation: str,
    tokens_in: int = 0,
    tokens_out: int = 0,
    model: Optional[str] = None,
    is_grounding: bool = False,
) -> None:
    """Record Gemini usage. Token costs from INR per 1M; grounding from INR per call."""
    if is_grounding:
        cost_inr = GEMINI_GROUNDING_PER_CALL_INR
        record(
            run_id=run_id,
            user_id=user_id or "anonymous",
            service="gemini",
            operation=operation or "grounding",
            quantity=1,
            unit="calls",
            cost_inr=cost_inr,
            cost_usd=inr_to_usd(cost_inr),
            metadata={"model": model, "grounding": True},
        )
        return
    cost_in = (tokens_in / 1_000_000) * GEMINI_INPUT_PER_1M_INR
    cost_out = (tokens_out / 1_000_000) * GEMINI_OUTPUT_PER_1M_INR
    cost_inr = cost_in + cost_out
    uid = user_id or "anonymous"
    record(
        run_id=run_id,
        user_id=uid,
        service="gemini",
        operation=operation or "generate",
        quantity=tokens_in + tokens_out,
        unit="tokens",
        cost_inr=cost_inr,
        cost_usd=inr_to_usd(cost_inr),
        metadata={"model": model, "tokens_in": tokens_in, "tokens_out": tokens_out},
    )
    _log_shared_token_pool(uid, model, tokens_in, tokens_out, f"citation:{operation or 'generate'}")


def record_claude(
    run_id: Optional[str],
    user_id: str,
    operation: str,
    tokens_in: int = 0,
    tokens_out: int = 0,
    model: Optional[str] = None,
) -> None:
    """Record Claude usage from token counts (INR per 1M from .env)."""
    cost_in = (tokens_in / 1_000_000) * CLAUDE_INPUT_PER_1M_INR
    cost_out = (tokens_out / 1_000_000) * CLAUDE_OUTPUT_PER_1M_INR
    cost_inr = cost_in + cost_out
    uid = user_id or "anonymous"
    record(
        run_id=run_id,
        user_id=uid,
        service="claude",
        operation=operation or "generate",
        quantity=tokens_in + tokens_out,
        unit="tokens",
        cost_inr=cost_inr,
        cost_usd=inr_to_usd(cost_inr),
        metadata={"model": model, "tokens_in": tokens_in, "tokens_out": tokens_out},
    )
    _log_shared_token_pool(uid, model, tokens_in, tokens_out, f"citation:{operation or 'generate'}")


def record_serper(
    run_id: Optional[str],
    user_id: str,
    searches: int = 1,
) -> None:
    """Record Serper API usage (INR per search from .env)."""
    cost_inr = SERPER_PER_SEARCH_INR * searches
    record(
        run_id=run_id,
        user_id=user_id or "anonymous",
        service="serper",
        operation="search",
        quantity=searches,
        unit="calls",
        cost_inr=cost_inr,
        cost_usd=inr_to_usd(cost_inr),
        metadata=None,
    )


def record_document_ai(
    run_id: Optional[str],
    user_id: str,
    operation: str,
    pages: int = 1,
) -> None:
    """Record Document AI OCR/layout (INR per 1000 pages from .env)."""
    cost_inr = (pages / 1000.0) * DOCUMENT_AI_PER_1000_PAGES_INR
    record(
        run_id=run_id,
        user_id=user_id or "anonymous",
        service="document_ai",
        operation=operation or "ocr",
        quantity=pages,
        unit="pages",
        cost_inr=cost_inr,
        cost_usd=inr_to_usd(cost_inr),
        metadata={"pages": pages},
    )
