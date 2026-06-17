from __future__ import annotations

from datetime import datetime, timezone

from core.enums import CitationStatus, Classification
from models.citation_models import Candidate


def citation_to_dict(candidate: Candidate) -> dict:
    status = CitationStatus.SUGGESTED_FOR_REVIEW
    if candidate.classification == Classification.ADVERSE:
        status = CitationStatus.ADVERSE
    elif candidate.classification in {Classification.DISTINGUISHABLE, Classification.WEAK_CONTEXTUAL}:
        status = CitationStatus.NEEDS_REVIEW
    canonical_id = f"ik:{candidate.doc_id}"
    return {
        "canonicalId": canonical_id,
        "canonical_id": canonical_id,
        "caseName": candidate.title,
        "case_name": candidate.title,
        "primaryCitation": candidate.metadata.get("citation") or candidate.metadata.get("primary_citation") or "",
        "court": candidate.docsource,
        "dateOfJudgment": candidate.publishdate,
        "ratio": candidate.reason,
        "headnote": candidate.fragment[:1500],
        "excerptText": candidate.fragment[:1500],
        "fullText": candidate.full_text,
        "which_issue": candidate.matched_issue_id,
        "matched_issue_id": candidate.matched_issue_id,
        "relevanceScore": candidate.relevance_score,
        "relevance_score": candidate.relevance_score,
        "favorability_score": candidate.favorability_score,
        "authority_score": candidate.authority_score,
        "authority": candidate.authority.value,
        "fact_similarity_score": candidate.fact_similarity_score,
        "risk_score": candidate.risk_score,
        "confidence": candidate.confidence,
        "classification": candidate.classification.value,
        "supports_selected_side": candidate.supports_selected_side,
        "adverse_to_selected_side": candidate.adverse_to_selected_side,
        "reason": candidate.reason,
        "use_in_argument": candidate.use_in_argument,
        "risk_note": candidate.risk_note,
        # Outcome-aware adverse detection (disposition service).
        "disposition": candidate.disposition,
        "winning_party": candidate.winning_party,
        "operative_quote": candidate.operative_quote,
        "outcome_confidence": candidate.outcome_confidence,
        "outcome_source": candidate.outcome_source,
        "outcome_overridden": candidate.outcome_overridden,
        # Opposition bundle + reranking.
        "counter_argument_hint": candidate.counter_argument_hint,
        "rerank_score": candidate.rerank_score,
        "direction_flag": candidate.direction_flag,
        # Usage-analysis memo (500-600 words, category-aware) + relevance verdict.
        "usage_analysis": candidate.usage_analysis,
        "usage_verdict": candidate.usage_verdict,
        "relevance_verdict": candidate.relevance_verdict,
        "relevance_reason": candidate.relevance_reason,
        "argumentParty": "selected_side" if candidate.supports_selected_side else "opposite_side" if candidate.adverse_to_selected_side else "neutral",
        "source": "Indian Kanoon",
        "sourceUrl": f"https://indiankanoon.org/doc/{candidate.doc_id}/",
        "verificationStatus": status.value,
        "status": status.value,
    }


def build_report(run_id: str, perspective: str, profile: dict, issues: list[dict], queries: list[dict], supporting: list[Candidate], adverse: list[Candidate], caution: list[Candidate], cost: dict, timings: dict, diagnostics: dict | None = None) -> dict:
    recommended = [citation_to_dict(item) for item in supporting[:5]]
    adverse_rows = [citation_to_dict(item) for item in adverse[:3]]
    caution_rows = [citation_to_dict(item) for item in caution[:3]]
    for row in recommended:
        row["argumentParty"] = perspective
    for row in adverse_rows:
        row["argumentParty"] = "opposite_party"
    for row in caution_rows:
        row["argumentParty"] = "neutral"

    recommended_count = len(recommended)
    adverse_count = len(adverse_rows)
    caution_count = len(caution_rows)
    total = recommended_count + adverse_count + caution_count

    # Determine result status and message
    if recommended_count > 0:
        result_status = "CITATIONS_FOUND"
        message = "Citation candidates require legal review."
    elif adverse_count > 0 or caution_count > 0:
        result_status = "PARTIAL_RESULT"
        message = "No supporting citations found, but adverse or caution citations were identified."
    else:
        result_status = "NO_RELIABLE_CITATION_FOUND"
        diag = diagnostics or {}
        if diag.get("raw_candidates_count", 0) == 0:
            message = "No candidate judgments were retrieved. This may be due to service unavailability or overly specific queries."
        elif diag.get("fragment_checked_count", 0) == 0:
            message = "Candidates were found but none passed relevance filtering."
        else:
            message = "No reliable supporting citation found in this run."

    return {
        "run_id": run_id,
        "perspective": perspective,
        "result_status": result_status,
        "message": message,
        "recommended_citations": recommended,
        "adverse_citations": adverse_rows,
        "use_with_caution": caution_rows,
        # Explicit two-bundle view (PART 6). client = authority FOR the selected side;
        # opponent = adverse authority WITH counter_argument_hint to prepare against.
        "client_citations": recommended,
        "opponent_citations": adverse_rows,
        "citations": recommended + adverse_rows + caution_rows,
        "citation_count": total,
        "recommended_count": recommended_count,
        "adverse_count": adverse_count,
        "caution_count": caution_count,
        "case_profile": profile,
        "issue_cards": issues,
        "queries": queries,
        "cost_summary": cost,
        "runCostInr": cost.get("estimatedCostInr", 0),
        "timings": timings,
        "pipeline_diagnostics": diagnostics or {},
        "generatedAt": datetime.now(timezone.utc).isoformat(),
    }
