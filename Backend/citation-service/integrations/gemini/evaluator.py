from __future__ import annotations

import logging
import os

from core.budgets import BudgetTracker
from core.enums import Classification
from integrations.gemini._jsonsafe import loads_lenient
from integrations.gemini.client import get_client
from integrations.gemini.prompts import batch_judge_prompt
from models.citation_models import Candidate
from models.issue_models import IssueCard

logger = logging.getLogger(__name__)


def evaluate_batch(candidates: list[Candidate], issues: list[IssueCard], perspective: str, run_id: str, user_id: str, budget: BudgetTracker) -> list[Candidate]:
    from utils.usage_tracker import record_gemini
    client = get_client()
    if not client or not candidates:
        return candidates
    budget.consume("ai", estimated_cost=5.0)

    def _window(text: str) -> str:
        """Indian judgments put the operative order at the END — send head (facts)
        + tail (holding/order), not just the opening (which was FAILURE 4)."""
        t = text or ""
        if len(t) <= 4500:
            return t
        return t[:1500] + "\n\n[...middle omitted...]\n\n" + t[-3000:]

    compact = [{
        "doc_id": item.doc_id, "title": item.title, "source": item.docsource,
        "fragment": item.fragment[:1200], "full_text": _window(item.full_text),
        "deterministic_classification": item.classification.value,
        # Outcome signals from the disposition stage (judge must respect who actually won).
        "disposition": item.disposition or "UNKNOWN",
        "winning_party": item.winning_party or "UNCLEAR",
        "operative_quote": (item.operative_quote or "")[:300],
    } for item in candidates[:7]]
    prompt = batch_judge_prompt(perspective, [issue.to_dict() for issue in issues], compact)
    model = os.environ.get("CITATION_V2_JUDGE_MODEL") or os.environ.get("CITATION_V2_GEMINI_MODEL") or os.environ.get("GEMINI_MODEL", "gemini-3.5-flash")
    max_tokens = int(os.environ.get("CITATION_V2_JUDGE_MAX_TOKENS", "8192"))
    try:
        logger.debug("Gemini batch judge prompt", extra={"details": {"run_id": run_id, "prompt": prompt[:12000]}})
        response = client.models.generate_content(model=model, contents=prompt, config={
            "temperature": 0,
            "max_output_tokens": max_tokens,
            "response_mime_type": "application/json",
            # Disable "thinking" so output tokens go to the JSON (avoids truncation).
            "thinking_config": {"thinking_budget": 0},
        })
        usage = getattr(response, "usage_metadata", None)
        tokens_in = int(getattr(usage, "prompt_token_count", 0) or 0)
        tokens_out = int(getattr(usage, "candidates_token_count", 0) or 0)
        record_gemini(run_id, user_id, "citation_v2_batch_judge", tokens_in, tokens_out, model=model)
        parsed = loads_lenient(str(getattr(response, "text", "") or ""))
        logger.debug("Gemini batch judge output", extra={"details": {"run_id": run_id, "output": str(getattr(response, "text", ""))[:12000]}})
        # The model may return {"decisions":[...]} or a bare [...] array — handle both.
        rows = parsed if isinstance(parsed, list) else (parsed.get("decisions", []) if isinstance(parsed, dict) else [])
        decisions = {str(row.get("doc_id")): row for row in rows if isinstance(row, dict)}
        allowed = {item.value: item for item in Classification}
        for candidate in candidates:
            decision = decisions.get(candidate.doc_id) or {}
            value = str(decision.get("classification") or "")
            if value in allowed:
                candidate.classification = allowed[value]
                candidate.supports_selected_side = candidate.classification == Classification.SUPPORTING
                candidate.adverse_to_selected_side = candidate.classification == Classification.ADVERSE
            candidate.reason = str(decision.get("reason") or candidate.reason)[:1000]
            candidate.risk_note = str(decision.get("risk_note") or candidate.risk_note)[:1000]
    except Exception:
        logger.exception("Gemini batch judge failed; retaining conservative deterministic decisions")
    return candidates
