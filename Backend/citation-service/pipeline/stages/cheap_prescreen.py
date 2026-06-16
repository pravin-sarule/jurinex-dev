"""
Stage: cheap_prescreen (runs after cheap_filter, before enrich_fragments).

Zero-cost narrowing of raw candidates before we spend money on fragment/meta calls:

  Step 1  Free metadata filter — court relevance + age. A candidate is discarded
          only when it is irrelevant on EVERY axis (too few issue terms AND wrong
          court AND too old AND no doctrine overlap), so recall stays safe.
  Step 2  (paid) tail-fragment disposition probe — DISABLED by default. The
          disposition service already reads the operative order from full_text
          later; doing it here would double fragment spend. Enable via
          CITATION_V2_PRESCREEN_TAIL_FRAGMENT=true if desired.
  Step 3  Free doctrine-overlap score. Adverse-looking candidates are tagged
          potentially_adverse and kept regardless (they feed the opponent bundle).

The expensive _balanced() selection in enrich_fragments then picks from a cleaner,
adverse-aware pool.
"""

from __future__ import annotations

import logging
import re

from core.config import settings
from pipeline.pipeline_context import PipelineContext
from services.query_service import COURT_DOCTYPE_MAP
from utils.text import overlap_score

logger = logging.getLogger(__name__)

_YEAR_RX = re.compile(r"(19|20)\d{2}")
_ADVERSE_HINT_RX = re.compile(
    r"\b(dismiss|dismissed|rejected|no\s+merit|cannot\s+interfere|petition\s+fails)\b",
    re.IGNORECASE,
)


def _candidate_year(candidate) -> int | None:
    meta = candidate.metadata or {}
    for key in ("publishdate", "date", "year", "docdate"):
        m = _YEAR_RX.search(str(meta.get(key) or ""))
        if m:
            return int(m.group(0))
    m = _YEAR_RX.search(str(candidate.title or ""))
    return int(m.group(0)) if m else None


def _court_ok(candidate, issue) -> bool:
    """True if the candidate court is Supreme Court, a preferred court, or unknown."""
    src = (candidate.docsource or "").lower() + " " + (candidate.title or "").lower()
    if not src.strip():
        return True  # unknown source — don't penalise
    if "supreme court" in src:
        return True
    for court in (getattr(issue, "preferred_courts", None) or []):
        c = (court or "").strip().lower()
        if c and (c in src or COURT_DOCTYPE_MAP.get(c, "___") in src):
            return True
    # Any High Court is acceptable; only clearly low fora are weak signals.
    return "high court" in src


def run(context: PipelineContext):
    if not settings.enable_cheap_prescreen:
        return context.candidates

    issues = {issue.issue_id: issue for issue in context.issues}
    max_age = settings.prescreen_max_age_years
    current_year = 2026  # server clock-independent ceiling; recency handled again at rerank
    kept, discarded, kept_adverse = [], 0, 0

    for candidate in context.candidates:
        issue = issues.get(candidate.matched_issue_id)
        if not issue:
            kept.append(candidate)
            continue

        text = f"{candidate.title} {candidate.headline}"
        text_low = text.lower()

        must_haves = [t for t in (issue.must_have_terms or []) if t]
        must_hits = sum(1 for t in must_haves if t.lower() in text_low)

        doctrine_terms = (getattr(issue, "doctrines", None) or []) + (issue.phrase_terms or [])
        doctrine_score = overlap_score(" ".join(doctrine_terms), text) if doctrine_terms else 0.0

        landmark_names = [n.lower() for n in (getattr(issue, "landmark_cases", None) or []) if n]
        is_landmark = any(n in text_low for n in landmark_names)

        year = _candidate_year(candidate)
        too_old = bool(year and (current_year - year) > max_age) and not is_landmark

        potentially_adverse = bool(_ADVERSE_HINT_RX.search(text))
        candidate.metadata["_potentially_adverse"] = potentially_adverse

        # Discard only when irrelevant on every axis (keep adverse + landmarks always).
        irrelevant = (
            must_hits < 2
            and doctrine_score < 0.10
            and not _court_ok(candidate, issue)
            and not is_landmark
            and not potentially_adverse
        )
        if irrelevant or (too_old and doctrine_score < 0.10 and not potentially_adverse):
            candidate.rejection_reason = (
                "prescreen: too old + low doctrine overlap" if too_old
                else "prescreen: irrelevant (terms+court+doctrine all weak)"
            )
            context.rejected.append(candidate)
            discarded += 1
            logger.debug(
                "[JURINEX][%s][PRESCREEN] %s -> DISCARD reason=%s",
                context.run_id[:8], (candidate.title or candidate.doc_id)[:50], candidate.rejection_reason,
            )
            continue

        if potentially_adverse:
            kept_adverse += 1
        kept.append(candidate)

    context.candidates = kept
    context.timings["_prescreen_kept"] = len(kept)
    logger.info(
        "[JURINEX][%s][PRESCREEN_SUMMARY] %d -> %d kept (%d discarded, %d kept as opponent-bundle)",
        context.run_id[:8], len(kept) + discarded, len(kept), discarded, kept_adverse,
    )
    return context.candidates
