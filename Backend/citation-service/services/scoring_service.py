from __future__ import annotations

import logging

from core.enums import Authority, Classification
from models.citation_models import Candidate
from models.issue_models import IssueCard
from utils.text import overlap_score

logger = logging.getLogger(__name__)


def authority_for(source: str, same_court: str = "") -> tuple[Authority, float]:
    lowered = (source or "").lower()
    if "supreme court" in lowered:
        return Authority.SUPREME_COURT, 1.0
    if same_court and same_court.lower() in lowered:
        return Authority.SAME_HIGH_COURT, 0.9
    if "high court" in lowered:
        return Authority.OTHER_HIGH_COURT, 0.75
    if "tribunal" in lowered:
        return Authority.TRIBUNAL, 0.55
    if lowered:
        return Authority.LOWER_COURT, 0.4
    return Authority.UNKNOWN, 0.2


def score(candidate: Candidate, issue: IssueCard, query: str, perspective: str, case_context: str, same_court: str = "", semantic_score: float | None = None, run_id: str = "") -> Candidate:
    candidate.authority, candidate.authority_score = authority_for(candidate.docsource, same_court)

    # BM25 title score approximation (overlap of query and title)
    title_score = max(overlap_score(issue.legal_issue, candidate.title), overlap_score(query, candidate.title))

    # Fragment overlap approximation
    fragment_score = max(overlap_score(issue.legal_issue, candidate.fragment), overlap_score(query, candidate.fragment))

    # Phase 3 (R6) — overlap with THIS case's own fact terms, so a candidate that matches
    # the fact pattern (forfeiture / non-utilisation / change of user) out-scores a case
    # that only shares the generic doctrine.
    fact_text = " ".join((getattr(issue, "fact_terms", None) or []) + (issue.must_have_terms or []))
    fact_score = max(overlap_score(fact_text, candidate.title), overlap_score(fact_text, candidate.fragment)) if fact_text else 0.0

    text = " ".join((candidate.title, candidate.headline, candidate.fragment))

    if semantic_score is not None:
        # Semantic ranking: embedding similarity (case vs candidate) is the primary
        # relevance signal; lexical + fact overlap + authority refine it.
        lexical = max(title_score, fragment_score, fact_score)
        candidate.fact_similarity_score = round(float(semantic_score), 3)
        candidate.relevance_score = round((0.65 * float(semantic_score)) + (0.20 * lexical) + (0.15 * candidate.authority_score), 3)
    else:
        # Fallback: deterministic lexical reranking (embeddings unavailable).
        candidate.relevance_score = round((0.4 * title_score) + (0.25 * fragment_score) + (0.2 * fact_score) + (0.15 * candidate.authority_score), 3)
        candidate.fact_similarity_score = round(max(overlap_score(case_context[:3000], text), fact_score), 3)

    support_terms = ("allowed", "granted", "quashed", "set aside", "in favour", "entitled", "protected")
    adverse_terms = ("dismissed", "rejected", "against", "not entitled", "convicted", "barred")
    lowered = text.lower()
    support_hits = sum(term in lowered for term in support_terms)
    adverse_hits = sum(term in lowered for term in adverse_terms)
    if perspective == "neutral":
        candidate.favorability_score = 0.5
    else:
        candidate.favorability_score = round(min(1.0, max(0.0, 0.5 + 0.15 * (support_hits - adverse_hits))), 3)

    # FAILURE 3 — direction-aware adjustment. A directed principle (e.g. "advantage of
    # its own wrong") applied against the WRONG party makes a phrase-matching case adverse,
    # not supporting. Penalise heavily on reversal; small boost when correctly directed.
    if perspective != "neutral":
        from services.direction_service import (
            CORRECT_DIRECTION, WRONG_DIRECTION, assess_fragment_direction,
        )
        principles = list(issue.phrase_terms or []) + list(getattr(issue, "doctrines", None) or [])
        direction, principle, evidence = assess_fragment_direction(candidate.fragment, principles)
        if direction == WRONG_DIRECTION:
            candidate.favorability_score = round(candidate.favorability_score * 0.3, 3)
            candidate.direction_flag = "PRINCIPLE_REVERSED"
            logger.info('[JURINEX][%s][DIRECTION_FLAG] %s principle="%s" applied to WRONG party '
                        '— penalising score. Fragment: "%s"',
                        run_id[:8], (candidate.title or candidate.doc_id)[:50], principle, evidence[:100])
        elif direction == CORRECT_DIRECTION:
            candidate.favorability_score = round(min(1.0, candidate.favorability_score * 1.2), 3)
            candidate.direction_flag = "PRINCIPLE_ALIGNED"
            logger.info('[JURINEX][%s][DIRECTION] %s principle="%s" direction=CORRECT penalty=1.2',
                        run_id[:8], (candidate.title or candidate.doc_id)[:40], principle)

    candidate.risk_score = round(max(0.0, 1.0 - candidate.relevance_score) * 0.7 + (0.2 if candidate.authority_score < 0.5 else 0), 3)
    candidate.confidence = round(
        0.45 * candidate.relevance_score + 0.25 * candidate.authority_score
        + 0.15 * candidate.fact_similarity_score + 0.15 * (1.0 - candidate.risk_score), 3
    )
    candidate.supports_selected_side = candidate.favorability_score >= 0.55
    candidate.adverse_to_selected_side = candidate.favorability_score <= 0.4
    if candidate.relevance_score < 0.25:
        candidate.classification = Classification.IRRELEVANT
    elif candidate.adverse_to_selected_side:
        candidate.classification = Classification.ADVERSE
    elif candidate.supports_selected_side and candidate.confidence >= 0.45:
        candidate.classification = Classification.SUPPORTING
    elif candidate.risk_score >= 0.55:
        candidate.classification = Classification.DISTINGUISHABLE
    else:
        candidate.classification = Classification.WEAK_CONTEXTUAL
    candidate.reason = f"Matched {issue.issue_id}; relevance={candidate.relevance_score}, authority={candidate.authority.value}"
    candidate.use_in_argument = issue.expected_citation_use
    candidate.risk_note = "Review factual and procedural fit before relying on this authority." if candidate.risk_score >= 0.4 else ""
    return candidate
