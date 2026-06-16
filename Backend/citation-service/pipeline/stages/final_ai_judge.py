from core.config import settings
from integrations.gemini.evaluator import evaluate_batch
from pipeline.pipeline_context import PipelineContext


def run(context: PipelineContext):
    if settings.enable_final_ai_judge:
        context.shortlisted = evaluate_batch(
            context.shortlisted[:7], context.issues, context.perspective,
            context.run_id, context.user_id, context.budget,
        )
    return context.shortlisted
