import logging
from concurrent.futures import ThreadPoolExecutor, as_completed

from core.exceptions import BudgetExceeded
from integrations.indian_kanoon.client import IndianKanoonClient
from pipeline.pipeline_context import PipelineContext

logger = logging.getLogger(__name__)


def run(context: PipelineContext, client: IndianKanoonClient):
    selected = context.shortlisted[:context.budget.config.max_ik_full_doc_calls]
    fetched = []
    with ThreadPoolExecutor(max_workers=min(7, max(1, len(selected)))) as pool:
        futures = {pool.submit(client.fetch_full_document, candidate): candidate for candidate in selected}
        for future in as_completed(futures):
            candidate = futures[future]
            try:
                future.result()
                if candidate.full_text:
                    fetched.append(candidate)
                else:
                    candidate.rejection_reason = "full document unavailable"
                    context.rejected.append(candidate)
            except BudgetExceeded:
                candidate.rejection_reason = "full document budget exhausted"
                context.rejected.append(candidate)
            except Exception as exc:
                candidate.rejection_reason = f"full document fetch failed: {exc}"
                context.rejected.append(candidate)
                logger.exception("Full document fetch failed", extra={"details": {"run_id": context.run_id, "doc_id": candidate.doc_id}})
    context.shortlisted = sorted(fetched, key=lambda item: (item.confidence, item.authority_score), reverse=True)
    context.timings["_full_docs_count"] = len(context.shortlisted)
    
    total_chars = sum(len(c.full_text) for c in context.shortlisted if c.full_text)
    cache_hits = sum(1 for c in context.shortlisted if c.metadata.get("_cache_hit"))
    
    logger.info("Candidate full document fetch completed", extra={"details": {
        "run_id": context.run_id,
        "stage": "fetch_full_documents",
        "attempted_count": len(selected),
        "fetched_count": len(context.shortlisted),
        "failed_count": len(selected) - len(context.shortlisted),
        "total_characters": total_chars,
        "cache_hits": cache_hits
    }})
    
    return context.shortlisted
