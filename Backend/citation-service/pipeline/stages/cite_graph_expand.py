"""
Stage: cite_graph_expand (Tier 2 — runs after fetch_full_documents, before detect_disposition).

Keyword/boolean search finds cases that SHARE WORDS with the issue. It structurally cannot
find the binding precedent those cases RELY ON when the precedent uses different vocabulary
(e.g. the petition says "arbitrary cancellation"; the controlling authority says "Article 14
manifest arbitrariness"), nor the foundational landmark every on-point judgment cites but that
is too general to rank on the issue keywords.

This stage closes that gap by following the citation graph: each seed judgment's doc_data
already carries its citeList (cases it cites) and citedbyList (cases citing it) — fetched for
free during fetch_full_documents. We harvest those neighbours, rank them by CO-CITATION
FREQUENCY (a case cited by several independently-retrieved seeds is a strong relevance vote no
single query produces), promote the top few into real candidates, full-doc + score them, and
merge the survivors into the shortlist so the AI judge + disposition see them alongside the
seeds. The relevance floor + the existing disposition veto guard against tangential and
overruled authorities.

Cost: harvesting is free (rows already in doc_data); each PROMOTED cite costs one /doc/ fetch,
bounded by cite_graph_max_promote and the remaining ik_full_doc budget. Gated by
settings.enable_cite_graph_expansion for easy A/B against the keyword-only baseline.
"""

from __future__ import annotations

import logging
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any

from core.config import settings
from core.exceptions import BudgetExceeded
from integrations.indian_kanoon.client import IndianKanoonClient
from models.citation_models import Candidate
from pipeline.pipeline_context import PipelineContext
from pipeline.stages.shortlist_candidates import _collapse_common_orders
from services.scoring_service import score
from services.semantic_service import case_similarity_scores

logger = logging.getLogger(__name__)

# A cause-title has parties split by "v." / "vs" / "versus"; a bare statute/rule/notification
# does not. Promoting a statute as a "citation" is noise (no ratio, no disposition), so skip
# rows that look like an instrument rather than a judgment.
_VS_RX = re.compile(r"\s+(?:v\.?|vs\.?|versus)\s+", re.IGNORECASE)
_STATUTE_RX = re.compile(
    r"\b(act|rules?|code|regulations?|ordinance|constitution|bill|notification|circular|"
    r"scheme|policy|manual|amendment|bye[- ]?laws?)\b",
    re.IGNORECASE,
)


def _looks_like_statute(title: str) -> bool:
    """True for bare statutes/rules/notifications (no party split) — they are not judgments."""
    t = (title or "").strip()
    if not t:
        return True  # no title to display/rank — treat as non-promotable
    if _VS_RX.search(t):
        return False  # has a 'v.' split → it's a cause-title (a case)
    return bool(_STATUTE_RX.search(t))


def _harvest(seeds: list[Candidate], seen: set[str]) -> dict[str, dict[str, Any]]:
    """Collect cite/citedby neighbours of the seeds, keyed by tid, with a co-citation count.

    `support` = how many distinct seeds reference this neighbour (the co-citation vote).
    `outbound` = at least one seed CITES it (a relied-upon authority — ranked above pure
    citedby neighbours, which are merely later cases citing a seed).
    """
    harvested: dict[str, dict[str, Any]] = {}
    for seed in seeds:
        doc_data = seed.metadata.get("doc_data") or {}
        cites = doc_data.get("cites") or doc_data.get("citeList") or []
        citedby = doc_data.get("citedby") or doc_data.get("citedbyList") or []
        for is_outbound, rows in ((True, cites), (False, citedby)):
            for row in rows or []:
                row = row or {}
                tid = str(row.get("tid") or row.get("id") or "").strip()
                title = str(row.get("title") or "").strip()
                if not tid or tid in seen:
                    continue
                if _looks_like_statute(title):
                    continue
                entry: dict[str, Any] | None = harvested.get(tid)
                if entry is None:
                    entry = {
                        "tid": tid, "title": title, "support": 0, "best_conf": 0.0,
                        "outbound": False, "issue_id": seed.matched_issue_id,
                        "query": seed.matched_query,
                    }
                    harvested[tid] = entry
                entry["support"] += 1
                entry["best_conf"] = max(entry["best_conf"], float(getattr(seed, "confidence", 0.0) or 0.0))
                entry["outbound"] = entry["outbound"] or is_outbound
    return harvested


def run(context: PipelineContext, client: IndianKanoonClient):
    if not settings.enable_cite_graph_expansion or not context.shortlisted:
        return context.shortlisted

    seeds = list(context.shortlisted)
    # Never re-promote a doc already anywhere in the pipeline, or the user's own source docs.
    seen = {c.doc_id for c in seeds}
    seen |= {c.doc_id for c in context.candidates}
    seen |= {c.doc_id for c in context.rejected}
    seen |= set(context.excluded_doc_ids or set())

    harvested = _harvest(seeds, seen)
    if not harvested:
        logger.info("[JURINEX][%s][CITE_GRAPH] no promotable neighbours in seed cite graph", context.run_id[:8])
        return context.shortlisted

    # Rank: most co-cited first; relied-upon authorities (outbound) ahead of later citers;
    # break ties by the strongest seed that referenced it.
    ranked = sorted(
        harvested.values(),
        key=lambda e: (e["support"], e["outbound"], e["best_conf"]),
        reverse=True,
    )

    # Promotions share the ik_full_doc budget with the seed shortlist — only take what's left.
    used = context.budget.counts.get("ik_full_doc", 0)
    remaining = max(0, settings.max_ik_full_doc_calls - used)
    n_promote = min(settings.cite_graph_max_promote, remaining, len(ranked))
    if n_promote <= 0:
        logger.info("[JURINEX][%s][CITE_GRAPH] %d neighbours found but no full-doc budget left (used=%d/%d)",
                    context.run_id[:8], len(harvested), used, settings.max_ik_full_doc_calls)
        return context.shortlisted

    promoted = [
        Candidate(
            doc_id=e["tid"], title=e["title"], headline=e["title"],
            matched_issue_id=e["issue_id"], matched_query=e["query"],
            metadata={"_cite_graph": True, "_seed_support": e["support"],
                      "_cite_direction": "cites" if e["outbound"] else "citedby"},
        )
        for e in ranked[:n_promote]
    ]

    # Full-doc the promoted cites (gives full_text + doc_data: court/date/title). Cite rows are
    # {tid,title} only, so court/date come from the promoted doc's own fetch.
    enriched: list[Candidate] = []
    with ThreadPoolExecutor(max_workers=min(7, max(1, len(promoted)))) as pool:
        futures = {pool.submit(client.fetch_full_document, c): c for c in promoted}
        for future in as_completed(futures):
            candidate = futures[future]
            try:
                future.result()
            except BudgetExceeded:
                candidate.rejection_reason = "cite-graph: full-doc budget exhausted"
                context.rejected.append(candidate)
                continue
            except Exception as exc:
                candidate.rejection_reason = f"cite-graph: full-doc fetch failed: {exc}"
                context.rejected.append(candidate)
                logger.exception("Cite-graph full-doc fetch failed", extra={"details": {"run_id": context.run_id, "doc_id": candidate.doc_id}})
                continue
            if not candidate.full_text:
                candidate.rejection_reason = "cite-graph: full document unavailable"
                context.rejected.append(candidate)
                continue
            dd = candidate.metadata.get("doc_data") or {}
            candidate.docsource = candidate.docsource or str(dd.get("docsource") or "")
            candidate.title = candidate.title or str(dd.get("title") or "")
            candidate.publishdate = candidate.publishdate or str(dd.get("publishdate") or "")
            enriched.append(candidate)

    if not enriched:
        logger.info("[JURINEX][%s][CITE_GRAPH] harvested=%d, promoted %d, none full-doc'd", context.run_id[:8], len(harvested), len(promoted))
        return context.shortlisted

    # Score promoted cites (semantic uses the full_text ratio slice). The relevance floor
    # culls tangential/overruled neighbours before they reach the judge.
    sims = case_similarity_scores(context.case_context, enriched, context.run_id, context.user_id, context.issues)
    issues_by_id = {issue.issue_id: issue for issue in context.issues}
    fallback_issue = context.issues[0] if context.issues else None
    kept: list[Candidate] = []
    for candidate in enriched:
        issue = issues_by_id.get(candidate.matched_issue_id) or fallback_issue
        if issue is None:
            candidate.rejection_reason = "cite-graph: no issue to score against"
            context.rejected.append(candidate)
            continue
        score(candidate, issue, candidate.matched_query, context.perspective, context.case_context,
              context.case_profile.court, semantic_score=sims.get(candidate.doc_id), run_id=context.run_id)
        if candidate.relevance_score < settings.cite_graph_min_relevance:
            candidate.rejection_reason = f"cite-graph: relevance {candidate.relevance_score} below floor {settings.cite_graph_min_relevance}"
            context.rejected.append(candidate)
            continue
        kept.append(candidate)

    # Merge into the shortlist, collapse any common-order duplicates across the merged set,
    # re-rank best-first, and cap at the total budget so the judge slice sees the strongest.
    merged, collapsed = _collapse_common_orders(seeds + kept)
    if collapsed:
        context.rejected.extend(collapsed)
    merged.sort(key=lambda c: (c.confidence, c.authority_score, c.relevance_score), reverse=True)
    context.shortlisted = merged[:settings.max_ik_full_doc_calls]

    context.timings["_cite_graph_harvested"] = len(harvested)
    context.timings["_cite_graph_promoted"] = len(kept)
    logger.info(
        "[JURINEX][%s][CITE_GRAPH] harvested=%d full_doc=%d kept=%d (relevance>=%.2f) collapsed=%d -> shortlist=%d",
        context.run_id[:8], len(harvested), len(enriched), len(kept),
        settings.cite_graph_min_relevance, len(collapsed), len(context.shortlisted),
    )
    return context.shortlisted
