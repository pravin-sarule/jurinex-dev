"""Stage: rerank_candidates (after cheap_prescreen, before enrich_fragments).

Phase 3 — the wider net (paging + higher per-query / raw caps) surfaces many more raw
candidates. Embedding the whole pool against a FACT-GROUNDED issue vector and keeping
only the top-K BEFORE any paid fragment/full-doc spend moves precision off the brittle
flat IK query and onto the ranker (R6). It is a pure cull: final relevance is still
decided later on the real ratio text after full-doc fetch.

Safety: if embeddings are unavailable, it falls back to the existing query-priority order
(never crashes); it never drops an issue below ``rerank_min_per_issue`` survivors; and it
no-ops when the pool already fits in ``rerank_top_k``.
"""

from __future__ import annotations

import logging
from collections import defaultdict

from core.config import settings
from pipeline.pipeline_context import PipelineContext
from services.semantic_service import case_similarity_scores
from utils.text import overlap_score

logger = logging.getLogger(__name__)


def _fact_overlap(candidate, issue) -> float:
    if not issue:
        return 0.0
    fact_text = " ".join((getattr(issue, "fact_terms", None) or []) + (issue.must_have_terms or []))
    if not fact_text:
        return 0.0
    blob = " ".join([candidate.title or "", candidate.headline or ""])
    return overlap_score(fact_text, blob)


def _cull(candidates: list, scores: dict, top_k: int, min_per_issue: int, issue_ids: list) -> list:
    """Keep the top_k by score, but guarantee min_per_issue survivors for each issue."""
    ordered = sorted(candidates, key=lambda c: scores.get(c.doc_id, 0.0), reverse=True)
    kept_ids: set = set()
    kept: list = []
    per_issue: dict = defaultdict(int)

    # Pass 1 — per-issue floor: the best `min_per_issue` of each issue always survive.
    for iid in issue_ids:
        for c in ordered:
            if c.matched_issue_id == iid and id(c) not in kept_ids and per_issue[iid] < min_per_issue:
                kept.append(c)
                kept_ids.add(id(c))
                per_issue[iid] += 1
    # Pass 2 — fill the remaining slots by global score order.
    for c in ordered:
        if len(kept) >= top_k:
            break
        if id(c) not in kept_ids:
            kept.append(c)
            kept_ids.add(id(c))
    return sorted(kept, key=lambda c: scores.get(c.doc_id, 0.0), reverse=True)


def run(context: PipelineContext):
    candidates = list(context.candidates)
    top_k = settings.rerank_top_k
    if not settings.enable_rerank_stage or len(candidates) <= top_k:
        return context.candidates

    issue_ids = [issue.issue_id for issue in context.issues]
    issues_by_id = {issue.issue_id: issue for issue in context.issues}

    # Cap how many candidates we EMBED (highest query_priority first). Embedding 150+
    # candidates is the slowest stage and previously blew the runtime budget; the overflow
    # (lowest-priority) is dropped before the expensive embed call.
    pool_cap = settings.rerank_pool_cap
    overflow: list = []
    if len(candidates) > pool_cap:
        candidates.sort(key=lambda c: int((c.metadata or {}).get("query_priority", 99)))
        overflow = candidates[pool_cap:]
        candidates = candidates[:pool_cap]
        for c in overflow:
            c.rejection_reason = c.rejection_reason or "reranked out (beyond embed pool cap)"
            context.rejected.append(c)

    # Reuse the proven embedding path (RETRIEVAL_QUERY/DOCUMENT + cost recording). At this
    # point candidates carry only title/headline, so this is a cheap pre-enrichment cull.
    sims = case_similarity_scores(
        context.case_context, candidates, context.run_id, context.user_id, context.issues,
    )

    scores: dict = {}
    if sims:
        for c in candidates:
            cos = sims.get(c.doc_id, 0.0)
            fov = _fact_overlap(c, issues_by_id.get(c.matched_issue_id))
            s = 0.7 * cos + 0.3 * fov
            c.metadata["_rerank_score"] = round(s, 4)
            scores[c.doc_id] = s
        mode = "embedding"
    else:
        # Embeddings unavailable → preserve existing query-priority order (1 = best),
        # tie-broken by arrival order so the cull is deterministic.
        for idx, c in enumerate(candidates):
            prio = int((c.metadata or {}).get("query_priority", 99))
            scores[c.doc_id] = (1.0 / (1 + prio)) - (idx * 1e-6)
        mode = "priority-fallback"

    kept = _cull(candidates, scores, top_k, settings.rerank_min_per_issue, issue_ids)
    kept_ids = {id(c) for c in kept}
    for c in candidates:
        if id(c) not in kept_ids:
            c.rejection_reason = c.rejection_reason or "reranked out (below top-K relevance)"
            context.rejected.append(c)

    context.candidates = kept
    context.timings["_reranked_count"] = len(kept)
    logger.info(
        "[JURINEX][%s][RERANK] %s: %d -> %d (top_k=%d, min/issue=%d, top_score=%.3f)",
        context.run_id[:8], mode, len(candidates), len(kept), top_k,
        settings.rerank_min_per_issue, max(scores.values()) if scores else 0.0,
    )
    return kept
