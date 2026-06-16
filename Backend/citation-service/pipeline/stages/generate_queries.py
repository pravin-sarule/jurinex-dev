from pipeline.pipeline_context import PipelineContext
from services.query_service import generate_ik_queries


def run(context: PipelineContext):
    context.queries = generate_ik_queries(context.issues, context.custom_keywords)
    return context.queries
