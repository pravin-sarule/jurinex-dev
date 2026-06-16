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

    rid = context.run_id[:8]
    all_doctrines = sorted({d.lower() for issue in context.issues for d in (getattr(issue, "doctrines", None) or [])})
    main_issue = next((i.issue_id for i in context.issues if getattr(i, "is_main_issue", False)), "?")
    logger.info("[JURINEX][%s][ISSUES] extracted %d issue(s); main=%s; doctrines_found=%s",
                rid, len(context.issues), main_issue, all_doctrines or "[]")
    for issue in context.issues:
        logger.info("[JURINEX][%s][ISSUES] %s: %s", rid, issue.issue_id, (issue.legal_issue or "")[:80])
    # Doctrine-gap alarm: oral-assurance facts but no estoppel/legitimate-expectation doctrine.
    ctx_low = (context.case_context or "").lower()
    if any(k in ctx_low for k in ("oral assurance", "orally assured", "oral direction", "assured", "promised")):
        if not any(("estoppel" in d or "legitimate expectation" in d or "own wrong" in d) for d in all_doctrines):
            logger.warning(
                "[JURINEX][%s][ISSUES] WARNING: oral-assurance facts present but no estoppel/"
                "legitimate-expectation doctrine extracted — check prompt output", rid,
            )
    return context.issues
