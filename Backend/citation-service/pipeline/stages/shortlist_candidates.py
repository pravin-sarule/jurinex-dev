from pipeline.pipeline_context import PipelineContext


def run(context: PipelineContext):
    ranked = sorted(context.candidates, key=lambda item: (item.confidence, item.authority_score, item.relevance_score), reverse=True)
    selected = []
    for issue in context.issues:
        match = next((candidate for candidate in ranked if candidate.matched_issue_id == issue.issue_id and candidate not in selected), None)
        if match:
            selected.append(match)
    for candidate in ranked:
        if len(selected) >= context.budget.config.max_ik_full_doc_calls:
            break
        if candidate not in selected:
            selected.append(candidate)
    context.shortlisted = selected[:7]
    return context.shortlisted
