import logging
from pipeline.pipeline_context import PipelineContext
from utils.text import overlap_score

logger = logging.getLogger(__name__)

def run(context: PipelineContext):
    issues = {issue.issue_id: issue for issue in context.issues}
    accepted, rejected = [], []
    rejection_reasons = {}
    
    for candidate in context.candidates:
        issue = issues.get(candidate.matched_issue_id)
        if not issue:
            candidate.rejection_reason = "candidate has no mapped issue"
            rejected.append(candidate)
            rejection_reasons[candidate.rejection_reason] = rejection_reasons.get(candidate.rejection_reason, 0) + 1
            continue
            
        score = max(overlap_score(issue.legal_issue, f"{candidate.title} {candidate.headline}"), overlap_score(candidate.matched_query, f"{candidate.title} {candidate.headline}"))
        
        if score < 0.12:
            candidate.rejection_reason = "cheap lexical relevance below threshold"
            rejected.append(candidate)
            rejection_reasons[candidate.rejection_reason] = rejection_reasons.get(candidate.rejection_reason, 0) + 1
        else:
            accepted.append(candidate)
            
    logger.info("Candidate cheap filter completed", extra={"details": {
        "run_id": context.run_id,
        "stage": "cheap_filter",
        "input_count": len(context.candidates),
        "survived_count": len(accepted),
        "rejected_count": len(rejected),
        "rejection_reasons": rejection_reasons
    }})
    
    context.candidates = accepted
    context.rejected.extend(rejected)
    return accepted
