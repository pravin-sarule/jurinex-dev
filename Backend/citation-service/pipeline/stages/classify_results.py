import logging

from core.config import settings
from pipeline.pipeline_context import PipelineContext
from services.classification_service import classify

logger = logging.getLogger(__name__)


def run(context: PipelineContext):
    supporting, adverse, caution = classify(context.shortlisted)

    # PART 8 — arithmetic reranking within each bundle (recency, court, doctrine,
    # outcome-alignment, citation authority). Pure Python, no AI cost.
    if settings.enable_rerank:
        from services.rerank_service import rerank
        issues_by_id = {issue.issue_id: issue for issue in context.issues}
        supporting = rerank(supporting, issues_by_id, context.perspective)
        adverse = rerank(adverse, issues_by_id, context.perspective)
        caution = rerank(caution, issues_by_id, context.perspective)

    # PART 6 — opposition bundle: one batched Gemini call writes counter-argument
    # hints for the adverse (opponent) authorities.
    if settings.enable_opposition_bundle and adverse:
        try:
            from services.opposition_service import annotate_counter_arguments
            annotate_counter_arguments(
                adverse, context.perspective, context.run_id, context.user_id, context.budget,
            )
        except Exception:
            logger.exception("[classify_results] opposition annotation failed (non-fatal)")

    logger.info("Candidate classification completed", extra={"details": {
        "run_id": context.run_id,
        "stage": "classify_results",
        "input_count": len(context.shortlisted),
        "supporting_count": len(supporting),
        "adverse_count": len(adverse),
        "caution_count": len(caution),
    }})

    return supporting, adverse, caution
