import logging
from concurrent.futures import ThreadPoolExecutor, as_completed

from core.exceptions import BudgetExceeded
from integrations.indian_kanoon.client import IndianKanoonClient
from pipeline.pipeline_context import PipelineContext

logger = logging.getLogger(__name__)


def _balanced(candidates, issue_ids, limit):
    selected = []
    queues = {issue_id: [candidate for candidate in candidates if candidate.matched_issue_id == issue_id] for issue_id in issue_ids}
    while len(selected) < limit and any(queues.values()):
        for issue_id in issue_ids:
            if queues[issue_id] and len(selected) < limit:
                selected.append(queues[issue_id].pop(0))
    return selected


def run(context: PipelineContext, client: IndianKanoonClient):
    limit = min(context.budget.config.max_ik_fragment_calls, context.budget.config.max_ik_meta_calls)
    selected = _balanced(context.candidates, [issue.issue_id for issue in context.issues], limit)
    completed = {candidate.doc_id: set() for candidate in selected}
    with ThreadPoolExecutor(max_workers=min(10, max(1, len(selected) * 2))) as pool:
        futures = {}
        for candidate in selected:
            futures[pool.submit(client.fetch_fragment, candidate)] = (candidate, "fragment")
            futures[pool.submit(client.fetch_meta, candidate)] = (candidate, "meta")
        for future in as_completed(futures):
            candidate, kind = futures[future]
            try:
                future.result()
                completed[candidate.doc_id].add(kind)
            except BudgetExceeded:
                candidate.rejection_reason = f"{kind} budget exhausted"
            except Exception as exc:
                candidate.rejection_reason = f"{kind} enrichment failed: {exc}"
                logger.exception("Candidate enrichment failed", extra={"details": {"run_id": context.run_id, "doc_id": candidate.doc_id, "kind": kind}})
    enriched = []
    cache_hits = 0
    
    for candidate in selected:
        if completed[candidate.doc_id] == {"fragment", "meta"} and candidate.fragment and candidate.metadata.get("meta_data"):
            enriched.append(candidate)
            # Rough cache hit heuristic for now based on fast timing or metadata flags if any
            if candidate.metadata.get("_cache_hit"):
                cache_hits += 1
        else:
            candidate.rejection_reason = candidate.rejection_reason or "fragment or metadata unavailable"
            context.rejected.append(candidate)
            
    logger.info("Candidate fragment and metadata enrichment", extra={"details": {
        "run_id": context.run_id,
        "stage": "enrich_fragments",
        "attempted_count": len(selected),
        "enriched_count": len(enriched),
        "failed_count": len(selected) - len(enriched),
        "cache_hits": cache_hits
    }})
            
    context.candidates = enriched
    context.timings["_enriched_count"] = len(enriched)
    return enriched
