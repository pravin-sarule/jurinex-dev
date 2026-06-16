from pipeline.pipeline_context import PipelineContext
from services.issue_service import build_case_profile


def run(context: PipelineContext):
    context.case_profile = build_case_profile(context.query, context.case_context, context.perspective)
    return context.case_profile
