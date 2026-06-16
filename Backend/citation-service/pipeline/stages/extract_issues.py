import logging

from pipeline.pipeline_context import PipelineContext
from services.issue_service import build_issue_cards

logger = logging.getLogger(__name__)


def run(context: PipelineContext):
    """
    Extract legal issue cards. PRIMARY: an LLM reads the case and produces real legal
    issues + search terms (statutes, doctrines). FALLBACK: deterministic heuristic
    extraction (used when the AI is unavailable, over budget, or returns nothing).
    """
    cards = None
    try:
        from integrations.gemini.issue_extractor import extract_issue_cards
        cards = extract_issue_cards(
            context.query, context.case_context, context.perspective,
            context.run_id, context.user_id, context.budget,
        )
    except Exception:
        logger.exception("[extract_issues] AI extraction error; using heuristic fallback")

    if cards:
        logger.info("[extract_issues] Using AI-extracted issues (%d cards)", len(cards))
        context.issues = cards
    else:
        logger.info("[extract_issues] AI unavailable/empty — using heuristic issue extraction")
        context.issues = build_issue_cards(
            context.query, context.case_profile, context.perspective, context.case_context,
        )
    return context.issues
