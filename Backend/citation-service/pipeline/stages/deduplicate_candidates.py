import logging
from pipeline.pipeline_context import PipelineContext

logger = logging.getLogger(__name__)

def run(context: PipelineContext):
    raw_count = len(context.candidates)
    unique = {}
    for candidate in context.candidates:
        if candidate.doc_id in unique:
            # Keep the BEST (lowest) source-query priority across duplicates so the
            # cheap filter's priority protection reflects the strongest query that
            # found this doc (ADDITIONAL FIX).
            kept = unique[candidate.doc_id]
            a = kept.metadata.get("query_priority")
            b = candidate.metadata.get("query_priority")
            if isinstance(b, int) and (not isinstance(a, int) or b < a):
                kept.metadata["query_priority"] = b
                kept.metadata.setdefault("query_type", candidate.metadata.get("query_type", ""))
        else:
            unique[candidate.doc_id] = candidate
    
    context.candidates = list(unique.values())
    deduped_count = len(context.candidates)
    context.timings["_deduped_count"] = deduped_count
    
    logger.info("Candidate deduplication", extra={"details": {
        "run_id": context.run_id,
        "stage": "deduplicate_candidates",
        "raw_candidates": raw_count,
        "deduped_candidates": deduped_count,
        "duplicates_removed": raw_count - deduped_count
    }})
    
    return context.candidates
