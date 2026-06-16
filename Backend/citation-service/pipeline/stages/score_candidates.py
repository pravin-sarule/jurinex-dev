from pipeline.pipeline_context import PipelineContext
from services.scoring_service import score
from services.semantic_service import case_similarity_scores


def run(context: PipelineContext):
    issues = {issue.issue_id: issue for issue in context.issues}
    # Semantic relevance: per-issue query vectors vs candidate document vectors → {doc_id: cosine}.
    # Empty dict means embeddings unavailable → scoring falls back to lexical.
    sims = case_similarity_scores(
        context.case_context, context.candidates, context.run_id, context.user_id, context.issues,
    )
    scored = []
    for candidate in context.candidates:
        issue = issues.get(candidate.matched_issue_id)
        if not issue:
            candidate.rejection_reason = "missing issue at scoring"
            context.rejected.append(candidate)
            continue
        score(candidate, issue, candidate.matched_query, context.perspective, context.case_context,
              context.case_profile.court, semantic_score=sims.get(candidate.doc_id))
        if candidate.relevance_score < 0.25:
            candidate.rejection_reason = "scoring relevance below threshold"
            context.rejected.append(candidate)
            continue
        scored.append(candidate)
    context.candidates = scored
    context.timings["_scored_count"] = len(scored)
    return scored
