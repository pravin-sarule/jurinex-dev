import logging
from pipeline.pipeline_context import PipelineContext
from services.classification_service import classify

logger = logging.getLogger(__name__)

def run(context: PipelineContext):
    supporting, adverse, caution = classify(context.shortlisted)
    
    logger.info("Candidate classification completed", extra={"details": {
        "run_id": context.run_id,
        "stage": "classify_results",
        "input_count": len(context.shortlisted),
        "supporting_count": len(supporting),
        "adverse_count": len(adverse),
        "caution_count": len(caution)
    }})
    
    return supporting, adverse, caution
