import logging

from pipeline.pipeline_context import PipelineContext
from utils.text import overlap_score

logger = logging.getLogger(__name__)

_HEADLINE_THRESHOLD = 0.12


def _query_phrase_overlap(matched_query: str, phrase_terms: list[str]) -> int:
    """How many of the issue's phrase/doctrine terms appear in the query that
    retrieved this candidate. A multi-term precision query already did the doctrine
    filtering, so its hits should survive even when the IK headline (an auto-generated
    fact summary) does not mention the doctrine (ADDITIONAL FIX)."""
    q = (matched_query or "").lower()
    if not q:
        return 0
    return sum(1 for p in phrase_terms if p and p.strip() and p.lower() in q)


def run(context: PipelineContext):
    issues = {issue.issue_id: issue for issue in context.issues}
    accepted, rejected = [], []
    rejection_reasons: dict[str, int] = {}

    for candidate in context.candidates:
        issue = issues.get(candidate.matched_issue_id)
        if not issue:
            candidate.rejection_reason = "candidate has no mapped issue"
            rejected.append(candidate)
            rejection_reasons[candidate.rejection_reason] = rejection_reasons.get(candidate.rejection_reason, 0) + 1
            continue

        title_blob = f"{candidate.title} {candidate.headline}"
        headline_overlap = max(
            overlap_score(issue.legal_issue, title_blob),
            overlap_score(candidate.matched_query, title_blob),
        )
        phrase_terms = list(issue.phrase_terms or []) + list(getattr(issue, "doctrines", None) or [])
        query_overlap = _query_phrase_overlap(candidate.matched_query, phrase_terms)
        priority = candidate.metadata.get("query_priority", 6)
        if not isinstance(priority, int):
            priority = 6

        # Keep if ANY signal is positive. NEVER discard a candidate retrieved by a
        # Tier 1/2 (doctrine/precision/landmark/strict, priority <= 2) query — the
        # doctrine query already did the filtering. Precise relevance is then decided
        # downstream by cheap_prescreen + fragment-based scoring.
        if priority <= 2:
            method = "priority_protected"
        elif headline_overlap >= _HEADLINE_THRESHOLD:
            method = "headline"
        elif query_overlap >= 2:
            method = "query"
        else:
            method = ""

        if method:
            accepted.append(candidate)
            logger.debug(
                "[JURINEX][%s][FILTER] KEEP %s headline_overlap=%.2f query_priority=%s method=%s",
                context.run_id[:8], (candidate.title or candidate.doc_id)[:40],
                headline_overlap, priority, method,
            )
        else:
            candidate.rejection_reason = "cheap lexical relevance below threshold"
            rejected.append(candidate)
            rejection_reasons[candidate.rejection_reason] = rejection_reasons.get(candidate.rejection_reason, 0) + 1
            logger.debug(
                "[JURINEX][%s][FILTER] DISCARD %s headline_overlap=%.2f query_priority=%s "
                "reason=low_overlap_and_not_priority_protected",
                context.run_id[:8], (candidate.title or candidate.doc_id)[:40], headline_overlap, priority,
            )

    logger.info("Candidate cheap filter completed", extra={"details": {
        "run_id": context.run_id,
        "stage": "cheap_filter",
        "input_count": len(context.candidates),
        "survived_count": len(accepted),
        "rejected_count": len(rejected),
        "rejection_reasons": rejection_reasons,
    }})

    context.candidates = accepted
    context.rejected.extend(rejected)
    return accepted
