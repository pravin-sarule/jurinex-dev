"""
Arithmetic reranking within a bundle (PART 8) — pure Python, no AI cost.

Combines recency, court hierarchy, doctrine coverage, outcome-alignment and a
citation-authority boost into a single 0-1 score used to order the client and
opponent bundles. For the opponent bundle the same score is used: the strongest
adverse authority (highest rerank) is what the lawyer most needs to prepare against.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime, timezone

from core.enums import Authority, Classification
from models.citation_models import Candidate
from models.issue_models import IssueCard
from services.disposition_service import map_disposition_to_classification
from utils.text import overlap_score

logger = logging.getLogger(__name__)

_YEAR_RX = re.compile(r"(19|20)\d{2}")

_COURT_SCORE = {
    Authority.SUPREME_COURT: 1.0,
    Authority.SAME_HIGH_COURT: 0.85,
    Authority.OTHER_HIGH_COURT: 0.70,
    Authority.TRIBUNAL: 0.50,
    Authority.LOWER_COURT: 0.40,
    Authority.UNKNOWN: 0.65,
}


def _recency(candidate: Candidate, current_year: int) -> float:
    m = _YEAR_RX.search(str(candidate.publishdate or "")) or _YEAR_RX.search(str(candidate.title or ""))
    if not m:
        return 0.7  # unknown date → neutral
    age = current_year - int(m.group(0))
    if age <= 3:
        return 1.0
    if age <= 7:
        return 0.8
    return 0.6


def _doctrine_score(candidate: Candidate, issue: IssueCard | None) -> float:
    if not issue:
        return 0.0
    doctrines = (getattr(issue, "doctrines", None) or []) + (issue.phrase_terms or [])
    if not doctrines:
        return 0.0
    text = " ".join([candidate.title or "", candidate.headline or "",
                     candidate.fragment or "", candidate.reason or ""])
    matched = sum(1 for d in doctrines if d and d.lower() in text.lower())
    return min(matched / 3.0, 1.0)


def _outcome_match(candidate: Candidate, perspective: str) -> float:
    if not candidate.disposition:
        return 0.7
    label = map_disposition_to_classification(candidate.disposition, perspective)
    return 1.0 if label == Classification.SUPPORTING else 0.7


def _citation_boost(candidate: Candidate) -> float:
    doc = (candidate.metadata or {}).get("doc_data") or {}
    cited_by = doc.get("citedby") or doc.get("citedbyList") or doc.get("cited_by") or []
    try:
        count = len(cited_by) if isinstance(cited_by, (list, tuple)) else int(cited_by or 0)
    except (TypeError, ValueError):
        count = 0
    return 0.1 if count > 5 else 0.0


def rerank(candidates: list[Candidate], issues_by_id: dict, perspective: str) -> list[Candidate]:
    """Score and sort candidates descending by rerank_score (mutates rerank_score)."""
    current_year = datetime.now(timezone.utc).year
    for c in candidates or []:
        issue = issues_by_id.get(c.matched_issue_id)
        recency = _recency(c, current_year)
        court = _COURT_SCORE.get(c.authority, 0.65)
        doctrine = _doctrine_score(c, issue)
        outcome = _outcome_match(c, perspective)
        boost = _citation_boost(c)
        c.rerank_score = round(
            recency * 0.25 + court * 0.25 + doctrine * 0.30 + outcome * 0.15 + boost * 0.05, 4,
        )
    return sorted(candidates or [], key=lambda x: x.rerank_score, reverse=True)
