import logging

from pipeline.pipeline_context import PipelineContext
from services.query_service import generate_ik_queries

logger = logging.getLogger(__name__)


def run(context: PipelineContext):
    context.queries = generate_ik_queries(context.issues, context.custom_keywords)
    rid = context.run_id[:8]
    logger.info("[JURINEX][%s][QUERIES] %d queries generated for %d issue(s)",
                rid, len(context.queries), len(context.issues))
    for q in context.queries:
        logger.info("[JURINEX][%s][QUERIES] %s \"%s\" type=%s issue=%s doctypes=%s%s",
                    rid, q.get("query_id"), q.get("formInput"), q.get("query_type"),
                    q.get("issue_id"), q.get("doctypes"),
                    " (fallback)" if q.get("is_fallback") else "")
    return context.queries
