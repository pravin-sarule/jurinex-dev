"""Stage 4 — Adversarial Verification Pass (report-only).

A SEPARATE Gemini call after drafting: the finished draft + the source
material (fact inventory, Stage-2 verified field ledger, source-document
extracts) go to an adversarial reviewer that lists every draft sentence with
no direct source support. The output is a discrepancy report ATTACHED to the
draft in the review packet — it never modifies the draft. This is what the
human legal reviewer reads first.
"""
from __future__ import annotations

import logging
from typing import Any, Optional

logger = logging.getLogger(__name__)

_DRAFT_CAP = 80_000
_DIGEST_CAP = 40_000
_SOURCES_CAP = 60_000
_LEDGER_CAP = 20_000


async def run_discrepancy_review(
    draft_text: str,
    facts_digest: str,
    verified_fields_block: str,
    source_docs_text: str,
    model: str,
    usage_sink: Optional[dict[str, int]] = None,
    timeout_s: float = 90.0,
):
    """Returns a ``DiscrepancyReport`` or None when every model attempt fails.

    temperature 0, structured output (``response_schema``) — the report is a
    findings list, never prose, and never a rewritten draft.
    """
    import asyncio

    from google.genai import types as gt

    from app.services.drafting_prompts import DISCREPANCY_REVIEW_PROMPT
    from app.services.drafting_schemas import DiscrepancyReport
    from app.services.drafting_service import (
        _add_usage,
        _gemini_models,
        _get_client,
        _usage_from_response,
    )

    if not (draft_text or "").strip():
        return None

    def _cap(text: str, limit: int, label: str) -> str:
        text = text or ""
        if len(text) <= limit:
            return text
        return text[:limit] + f"\n…[{label} truncated for review]"

    source_blocks: list[str] = []
    if facts_digest:
        source_blocks.append(
            "FACT INVENTORY:\n<<<FACTS\n"
            + _cap(facts_digest, _DIGEST_CAP, "inventory") + "\nFACTS>>>"
        )
    if verified_fields_block:
        source_blocks.append(
            "VERIFIED FIELD LEDGER (Stage-2, machine-checked citations):\n"
            "<<<LEDGER\n" + _cap(verified_fields_block, _LEDGER_CAP, "ledger")
            + "\nLEDGER>>>"
        )
    if source_docs_text:
        source_blocks.append(
            "SOURCE DOCUMENT EXTRACTS:\n<<<SOURCES\n"
            + _cap(source_docs_text, _SOURCES_CAP, "sources") + "\nSOURCES>>>"
        )
    if not source_blocks:
        return None

    contents = [gt.Content(role="user", parts=[gt.Part(text=(
        "SOURCE MATERIAL:\n\n" + "\n\n".join(source_blocks) + "\n\n"
        "DRAFT:\n<<<DRAFT\n" + _cap(draft_text, _DRAFT_CAP, "draft")
        + "\nDRAFT>>>\n\n"
        "Review the draft against the source material now. Return COMPLETE "
        "valid JSON only — do not fix the draft."
    ))])]
    config = gt.GenerateContentConfig(
        system_instruction=DISCREPANCY_REVIEW_PROMPT,
        temperature=0.0,
        max_output_tokens=8192,
        response_mime_type="application/json",
        response_schema=DiscrepancyReport,
    )

    client = _get_client()
    loop = asyncio.get_event_loop()

    async def _one(mm: str):
        return await loop.run_in_executor(
            None,
            lambda: client.models.generate_content(
                model=mm, contents=contents, config=config
            ),
        )

    for m in _gemini_models(model)[:2]:
        try:
            resp = await asyncio.wait_for(_one(m), timeout=timeout_s)
            _add_usage(usage_sink, _usage_from_response(resp))
            parsed = getattr(resp, "parsed", None)
            if isinstance(parsed, DiscrepancyReport):
                return parsed
            return DiscrepancyReport.model_validate_json(resp.text or "")
        except asyncio.TimeoutError:
            logger.warning("Discrepancy review model %s timed out after %.0fs", m, timeout_s)
        except Exception as exc:
            logger.warning("Discrepancy review model %s failed: %s", m, exc)
    return None
