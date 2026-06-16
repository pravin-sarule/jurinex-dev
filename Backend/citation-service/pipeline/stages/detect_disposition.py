"""
Stage: detect_disposition (runs after fetch_full_documents, before final_ai_judge).

Reads the operative order of each shortlisted judgment and, when the outcome is
confident, pre-corrects the SUPPORTING/ADVERSE label so a dismissed-for-petitioner
case is ADVERSE before the AI judge ever sees it. The judge is then told the
disposition, and services.disposition_service.apply_disposition_veto re-asserts it
after the judge (see final_ai_judge).
"""

from __future__ import annotations

import logging

from core.config import settings
from core.enums import Disposition
from pipeline.pipeline_context import PipelineContext
from services.disposition_service import ABSTAIN_FLOOR, apply_override, detect_for_candidate

logger = logging.getLogger(__name__)


def run(context: PipelineContext):
    if not settings.enable_disposition_check:
        return context.shortlisted

    gemini_used = 0
    flips = 0
    for candidate in context.shortlisted:
        if not candidate.full_text:
            continue
        allow_gemini = gemini_used < settings.max_disposition_ai_calls
        res = detect_for_candidate(
            candidate, context.run_id, context.user_id, context.budget,
            allow_gemini=allow_gemini,
        )
        if res.source in ("GEMINI", "COMBINED"):
            gemini_used += 1

        title = (candidate.title or candidate.doc_id)[:50]
        if res.disposition == Disposition.UNKNOWN.value or res.confidence < ABSTAIN_FLOOR:
            logger.warning(
                "[JURINEX][%s][DISPOSITION] %s outcome_unknown (disp=%s conf=%.2f src=%s) — keeping existing label",
                context.run_id[:8], title, res.disposition, res.confidence, res.source,
            )
            continue

        old_label = candidate.classification.value
        overridden, new_label = apply_override(candidate, context.perspective)
        if overridden:
            flips += 1
            logger.info(
                "[JURINEX][%s][DISPOSITION] FLIP %s: %s -> %s confidence=%.2f source=%s operative=\"%s\"",
                context.run_id[:8], title, old_label, new_label.value, res.confidence,
                res.source, (candidate.operative_quote or "")[:80],
            )
        else:
            logger.info(
                "[JURINEX][%s][DISPOSITION] %s disposition=%s winner=%s conf=%.2f src=%s (label unchanged=%s)",
                context.run_id[:8], title, res.disposition, res.winning_party,
                res.confidence, res.source, old_label,
            )

    context.timings["_disposition_flips"] = flips
    context.timings["_disposition_gemini_calls"] = gemini_used
    logger.info(
        "[JURINEX][%s][DISPOSITION] checked %d candidate(s): %d flipped, %d Gemini fallback call(s)",
        context.run_id[:8], len(context.shortlisted), flips, gemini_used,
    )
    return context.shortlisted
