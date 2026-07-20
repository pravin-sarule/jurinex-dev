from dataclasses import asdict

from pipeline.pipeline_context import PipelineContext
from services.report_service import build_report


def run(context: PipelineContext, supporting, adverse, caution, cost, diagnostics=None):
    return build_report(
        context.run_id, context.perspective, asdict(context.case_profile),
        [issue.to_dict() for issue in context.issues], context.queries,
        supporting, adverse, caution, cost, context.timings, diagnostics,
    )
