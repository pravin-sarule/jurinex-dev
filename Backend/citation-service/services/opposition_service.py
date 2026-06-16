"""
Opposition bundle (PART 6).

After classification the results split into a client bundle (SUPPORTING authority)
and an opponent bundle (ADVERSE authority — judgments that went the other way).
For the opponent bundle we run ONE batched gemini-3.5-flash call that, for every
adverse judgment at once, writes a single sentence on how the client's lawyer could
distinguish it. The call is registered through usage_tracker so it appears in the
run cost breakdown.
"""

from __future__ import annotations

import logging
import os

from core.budgets import BudgetTracker
from core.exceptions import BudgetExceeded
from models.citation_models import Candidate

logger = logging.getLogger(__name__)


def annotate_counter_arguments(
    adverse: list[Candidate], perspective: str, run_id: str, user_id: str, budget: BudgetTracker,
) -> int:
    """Set candidate.counter_argument_hint for each adverse judgment. Returns count annotated."""
    items = [c for c in (adverse or []) if c]
    if not items:
        return 0

    from integrations.gemini._jsonsafe import loads_lenient
    from integrations.gemini.client import get_client
    from utils.usage_tracker import record_gemini

    client = get_client()
    if not client:
        return 0
    try:
        budget.consume("ai_opposition", estimated_cost=1.0)
    except BudgetExceeded:
        logger.warning("[OPPOSITION] budget exhausted; skipping counter-argument hints")
        return 0

    compact = [{
        "doc_id": c.doc_id,
        "title": c.title[:160],
        "disposition": c.disposition or "UNKNOWN",
        "operative_quote": (c.operative_quote or "")[:200],
        "ratio": (c.reason or "")[:200],
    } for c in items]

    prompt = (
        f"You advise the {perspective}. The judgments below are ADVERSE (they went against "
        f"the {perspective}). For EACH, write ONE specific sentence on how the "
        f"{perspective}'s lawyer could distinguish or limit it (on facts, doctrine, or the "
        "nature of the tender stage). Be concrete, not generic.\n"
        'Return ONLY JSON: {"items": [{"doc_id": "...", "counter_argument": "..."}]}\n\n'
        f"Adverse judgments: {compact}"
    )
    model = (os.environ.get("CITATION_V2_JUDGE_MODEL")
             or os.environ.get("CITATION_V2_GEMINI_MODEL")
             or os.environ.get("GEMINI_MODEL", "gemini-3.5-flash"))
    try:
        resp = client.models.generate_content(
            model=model, contents=prompt,
            config={
                "temperature": 0,
                "max_output_tokens": int(os.environ.get("CITATION_V2_OPPOSITION_MAX_TOKENS", "2048")),
                "response_mime_type": "application/json",
                "thinking_config": {"thinking_budget": 0},
            },
        )
        usage = getattr(resp, "usage_metadata", None)
        record_gemini(
            run_id, user_id, "citation_v2_opposition_bundle",
            int(getattr(usage, "prompt_token_count", 0) or 0),
            int(getattr(usage, "candidates_token_count", 0) or 0),
            model=model,
        )
        data = loads_lenient(str(getattr(resp, "text", "") or ""))
    except Exception:
        logger.exception("[OPPOSITION] counter-argument generation failed")
        return 0

    rows = data.get("items", []) if isinstance(data, dict) else (data if isinstance(data, list) else [])
    hints = {str(r.get("doc_id")): str(r.get("counter_argument") or "").strip()
             for r in rows if isinstance(r, dict)}
    annotated = 0
    for c in items:
        hint = hints.get(c.doc_id)
        if hint:
            c.counter_argument_hint = hint[:500]
            annotated += 1
    logger.info("[OPPOSITION] annotated %d/%d adverse judgment(s) with counter-arguments",
                annotated, len(items))
    return annotated
