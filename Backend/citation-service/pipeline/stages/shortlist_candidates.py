import logging
import re

from pipeline.pipeline_context import PipelineContext

logger = logging.getLogger(__name__)

# #6 — "common order" detection: separate petitions decided by ONE order (same court, same
# date, same respondent — differing only in the petitioner) are returned by IK as distinct
# docs (e.g. Ajit Singh / Sunil / Adesh / Mukesh Meena v. State of Rajasthan). Collapsing
# them stops the report showing 4 citations that are really one judgment.
_RESP_SPLIT_RX = re.compile(r"\s+(?:v\.?|vs\.?|versus)\s+", re.IGNORECASE)
_RESP_TAIL_RX = re.compile(r"\s*[&,]\s*(ors|anr|others|another|and ors|and anr).*$", re.IGNORECASE)


def _respondent_sig(title: str) -> str:
    """Normalized respondent side of a cause-title — '' when the title has no 'v.' split."""
    parts = _RESP_SPLIT_RX.split(title or "", maxsplit=1)
    if len(parts) < 2:
        return ""
    resp = _RESP_TAIL_RX.sub("", parts[1])
    resp = re.sub(r"[^a-z0-9 ]", " ", resp.lower())
    return " ".join(resp.split())


def _rank_key(c):
    return (getattr(c, "confidence", 0.0), getattr(c, "authority_score", 0.0),
            getattr(c, "relevance_score", 0.0))


def _collapse_common_orders(candidates: list) -> tuple[list, list]:
    """Return (kept, collapsed). Groups by (court, date, respondent); keeps the strongest of
    each group, returns the rest as collapsed (only when ALL THREE keys are present, so a
    candidate missing a date/respondent is never merged — high precision, no false merges)."""
    best_by_key: dict = {}
    keyed: list = []
    for c in candidates:
        court = str(getattr(c, "docsource", "") or "").strip().lower()
        date = str(getattr(c, "publishdate", "") or "").strip()
        resp = _respondent_sig(getattr(c, "title", "") or "")
        key = (court, date, resp) if (court and date and resp) else None
        keyed.append((key, c))
        if key is not None and (key not in best_by_key or _rank_key(c) > _rank_key(best_by_key[key])):
            best_by_key[key] = c

    kept: list = []
    collapsed: list = []
    seen: set = set()
    for key, c in keyed:
        if key is None:
            kept.append(c)
            continue
        best = best_by_key[key]
        if key in seen:
            continue
        seen.add(key)
        kept.append(best)
    for key, c in keyed:
        if key is not None and c is not best_by_key[key]:
            c.rejection_reason = c.rejection_reason or f"same common order as {best_by_key[key].doc_id}"
            collapsed.append(c)
    return kept, collapsed


def run(context: PipelineContext):
    # #6 — collapse common-order duplicates BEFORE the full-doc cap so they neither waste a
    # paid /doc fetch nor surface as separate citations.
    candidates, collapsed = _collapse_common_orders(context.candidates)
    if collapsed:
        context.rejected.extend(collapsed)
        logger.info("[JURINEX][%s][COMMON_ORDER] collapsed %d duplicate(s) into %d distinct judgment(s)",
                    context.run_id[:8], len(collapsed), len(candidates))

    # Keep up to the full-doc budget (so the report can show many citations) — one per
    # issue first for coverage, then fill by confidence. Was hard-capped at 7.
    limit = context.budget.config.max_ik_full_doc_calls
    ranked = sorted(candidates, key=lambda item: (item.confidence, item.authority_score, item.relevance_score), reverse=True)
    selected = []
    for issue in context.issues:
        match = next((candidate for candidate in ranked if candidate.matched_issue_id == issue.issue_id and candidate not in selected), None)
        if match:
            selected.append(match)
    for candidate in ranked:
        if len(selected) >= limit:
            break
        if candidate not in selected:
            selected.append(candidate)
    context.shortlisted = selected[:limit]
    return context.shortlisted
