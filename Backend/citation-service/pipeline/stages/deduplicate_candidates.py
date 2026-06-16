import logging
from pipeline.pipeline_context import PipelineContext

logger = logging.getLogger(__name__)

def run(context: PipelineContext):
    raw_count = len(context.candidates)
    unique = {}
    for candidate in context.candidates:
        if candidate.doc_id in unique:
            # Merge matched queries/issues if needed
            pass
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
