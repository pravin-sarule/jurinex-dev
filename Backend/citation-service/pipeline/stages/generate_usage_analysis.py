"""
Stage: generate_usage_analysis (runs after classify_results, before build_report).

1. Writes a 500-600 word "how to use this judgment" memo on every shown citation
   (one batched Gemini call — services/analysis_service.py).
2. Applies the RELEVANCE GATE so the Recommended bucket stays genuinely relevant:
     - NOT_RELEVANT        → dropped from the report (logged, kept in rejected).
     - ADVERSE             → reclassified + routed to the Adverse bucket (on-point but
                             against the client — surfaced as opponent authority, never dropped).
     - PARTIALLY_RELEVANT  → if Recommended, demoted to Caution (still visible).
     - RELEVANT / unscored → kept in place.

Returns the cleaned (supporting, adverse, caution) tuple for build_report.
Non-fatal throughout: if the memo call fails the gate is a no-op and the original
buckets pass through unchanged.
"""

from __future__ import annotations

import logging

from core.config import settings
from pipeline.pipeline_context import PipelineContext
from services.analysis_service import (
    ADVERSE, NOT_RELEVANT, PARTIALLY_RELEVANT, generate_usage_analyses,
)

logger = logging.getLogger(__name__)


def run(context: PipelineContext, supporting: list, adverse: list, caution: list):
    if not settings.enable_usage_analysis:
        return supporting, adverse, caution

    union = list(supporting) + list(adverse) + list(caution)
    try:
        generate_usage_analyses(
            union, context.issues, context.perspective, context.case_context,
            context.run_id, context.user_id, context.budget,
        )
    except Exception:
        logger.exception("[USAGE_ANALYSIS] stage failed (non-fatal); keeping buckets as-is")
        return supporting, adverse, caution

    if not settings.enable_relevance_gate:
        return supporting, adverse, caution

    from core.enums import Classification

    rid = context.run_id[:8]
    new_sup, new_adv, new_cau = [], [], []
    dropped, demoted, to_adverse = [], [], []

    def _route(c, origin: str) -> None:
        rv = c.relevance_verdict
        if rv == NOT_RELEVANT:
            c.rejection_reason = (f"relevance gate: NOT_RELEVANT — {c.relevance_reason}").strip(" —")
            dropped.append(c)
            return
        if rv == ADVERSE:
            # On-point but against the client → SURFACE as adverse authority, never drop.
            c.classification = Classification.ADVERSE
            c.supports_selected_side = False
            c.adverse_to_selected_side = True
            if origin != "adverse":
                to_adverse.append(c)
            new_adv.append(c)
            return
        if rv == PARTIALLY_RELEVANT and origin == "supporting":
            demoted.append(c)
            new_cau.append(c)
            return
        # RELEVANT / unscored / partial-in-non-recommended → keep in its bucket.
        {"supporting": new_sup, "adverse": new_adv, "caution": new_cau}[origin].append(c)

    for c in supporting:
        _route(c, "supporting")
    for c in adverse:
        _route(c, "adverse")
    for c in caution:
        _route(c, "caution")

    context.rejected.extend(dropped)
    context.timings["_relevance_filtered"] = len(dropped)
    context.timings["_relevance_demoted"] = len(demoted)
    context.timings["_relevance_to_adverse"] = len(to_adverse)
    logger.info(
        "[JURINEX][%s][RELEVANCE_GATE] recommended %d->%d | adverse %d->%d (+%d reclassified) | "
        "demoted_to_caution=%d | dropped(NOT_RELEVANT)=%d",
        rid, len(supporting), len(new_sup), len(adverse), len(new_adv), len(to_adverse),
        len(demoted), len(dropped),
    )
    for c in to_adverse:
        logger.info("[JURINEX][%s][RELEVANCE_GATE] ->ADVERSE %s reason=%s",
                    rid, (c.title or c.doc_id)[:50], c.relevance_reason or "adverse to client")
    for c in dropped:
        logger.info("[JURINEX][%s][RELEVANCE_GATE] DROP %s reason=%s",
                    rid, (c.title or c.doc_id)[:50], c.relevance_reason or "not relevant")

    return new_sup, new_adv, new_cau
