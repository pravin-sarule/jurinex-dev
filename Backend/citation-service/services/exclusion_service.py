"""
Source-document exclusion (FAILURE 2).

The user's own uploaded / source documents must NEVER come back as citation
candidates (circular contamination — the system citing its own inputs). The V2
candidate pool comes only from Indian Kanoon search, so a user-uploaded judgment
that is also a real IK case can be returned by IK. This module removes any
candidate that matches a registered source document — by IK doc_id, by overlap
with the case under analysis, or by token-containment of an uploaded title.
"""

from __future__ import annotations

import logging
import re
from typing import Any

logger = logging.getLogger(__name__)

# Cause-title noise that should not drive a match.
_NOISE = {
    "vs", "v", "versus", "state", "union", "of", "the", "and", "ltd", "pvt",
    "m", "s", "ms", "mr", "mrs", "smt", "others", "anr", "ors", "etc",
    "through", "thru", "in", "re", "govt", "government", "india",
}
_TITLE_OVERLAP_THRESHOLD = 0.85   # spec safety-net threshold (symmetric overlap)
_TITLE_CONTAINMENT_THRESHOLD = 0.90  # uploaded title's tokens contained in candidate


def _tokens(title: str) -> set[str]:
    t = re.sub(r"\.(pdf|docx?|txt|rtf)$", "", (title or "").strip(), flags=re.I)
    t = re.sub(r"[^a-z0-9\s]", " ", t.lower())
    return {w for w in t.split() if w not in _NOISE and len(w) > 1}


def title_overlap(title_a: str, title_b: str) -> float:
    """Symmetric token overlap (spec's metric): intersection / larger set."""
    ta, tb = _tokens(title_a), _tokens(title_b)
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / max(len(ta), len(tb))


def title_containment(source_title: str, candidate_title: str) -> float:
    """How much of the SOURCE title's distinctive tokens appear in the candidate.

    Catches a short uploaded name ("Lashya Developers") inside a long IK cause-title
    ("M/S Lashya Developers vs The State Of Madhya Pradesh"), where symmetric overlap
    would be diluted by the extra court/state tokens.
    """
    ts, tc = _tokens(source_title), _tokens(candidate_title)
    if len(ts) < 2 or not tc:
        return 0.0
    return len(ts & tc) / len(ts)


def filter_source_documents(candidates: list, context: Any) -> list:
    """Drop candidates that match the run's registered source documents."""
    excluded_ids = {str(i) for i in (getattr(context, "excluded_doc_ids", None) or set())}
    excluded_titles = [t for t in (getattr(context, "excluded_titles", None) or []) if t]
    case_title = getattr(context, "case_title", "") or ""
    rid = (getattr(context, "run_id", "") or "")[:8]

    if not excluded_ids and not excluded_titles and not case_title:
        return candidates

    kept: list = []
    removed = 0
    for c in candidates:
        doc_id = str(getattr(c, "doc_id", "") or "")
        title = getattr(c, "title", "") or ""

        # 1) Exact IK doc_id match against a registered source id.
        if doc_id and doc_id in excluded_ids:
            removed += 1
            logger.info("[JURINEX][%s][EXCLUSION] %s excluded — source document match "
                        "method=id_match doc_id=%s", rid, title[:60], doc_id)
            continue

        # 2) The case under analysis itself (don't cite the case you're researching).
        if case_title and title_overlap(title, case_title) > _TITLE_OVERLAP_THRESHOLD:
            removed += 1
            logger.info("[JURINEX][%s][EXCLUSION] %s excluded — source document match "
                        "method=title_overlap overlap=%.2f (case under analysis)",
                        rid, title[:60], title_overlap(title, case_title))
            continue

        # 3) An uploaded source document (by symmetric overlap OR token containment).
        matched = False
        for st in excluded_titles:
            ov = title_overlap(title, st)
            ct = title_containment(st, title)
            if ov > _TITLE_OVERLAP_THRESHOLD or ct >= _TITLE_CONTAINMENT_THRESHOLD:
                removed += 1
                matched = True
                logger.info("[JURINEX][%s][EXCLUSION] %s excluded — source document match "
                            "method=%s overlap=%.2f source=\"%s\"", rid, title[:60],
                            "title_overlap" if ov > _TITLE_OVERLAP_THRESHOLD else "title_containment",
                            max(ov, ct), st[:60])
                break
        if matched:
            continue

        kept.append(c)

    if removed:
        logger.info("[JURINEX][%s][EXCLUSION_SUMMARY] %d candidates excluded as source "
                    "documents from pool of %d", rid, removed, len(candidates))
    return kept
