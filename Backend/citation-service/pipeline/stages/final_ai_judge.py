import logging

from core.config import settings
from integrations.gemini.evaluator import evaluate_batch
from pipeline.pipeline_context import PipelineContext
from services.disposition_service import apply_disposition_veto

logger = logging.getLogger(__name__)


def run(context: PipelineContext):
    if settings.enable_final_ai_judge:
        context.shortlisted = evaluate_batch(
            context.shortlisted[:7], context.issues, context.perspective,
            context.run_id, context.user_id, context.budget,
        )
    # A confident operative disposition is ground truth about who won — re-assert it
    # AFTER the judge in case the judge was swayed by favourable-sounding reasoning.
    if settings.enable_disposition_check:
        corrected = apply_disposition_veto(context.shortlisted, context.perspective)
        if corrected:
            logger.info(
                "[JURINEX][%s][JUDGE] disposition veto corrected %d post-judge label(s)",
                context.run_id[:8], corrected,
            )
    return context.shortlisted
