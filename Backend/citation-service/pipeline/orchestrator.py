from __future__ import annotations

import logging
import time
import uuid
from typing import Any, Callable

from core.logging import configure_structured_logging, stage_span
from integrations.document_service.context_loader import extract_source_identifiers, from_case_file_context
from integrations.indian_kanoon.client import IndianKanoonClient
from models.run_models import PipelineResult
from pipeline.pipeline_context import PipelineContext
from pipeline.stages import (
    build_report, cheap_filter, cheap_prescreen, classify_results, deduplicate_candidates,
    detect_disposition, enrich_fragments, extract_case_profile, extract_issues,
    fetch_full_documents, final_ai_judge, generate_queries, generate_usage_analysis,
    normalize_perspective, retrieve_candidates, score_candidates, shortlist_candidates,
)
from repositories.cost_repository import summarize_cost
from repositories.report_repository import save_report
from repositories.run_repository import complete_run, ensure_run, fail_run

configure_structured_logging()
logger = logging.getLogger(__name__)


def _stage(context: PipelineContext, name: str, fn: Callable, *args: Any):
    started = time.monotonic()
    input_count = len(context.candidates) if context.candidates else len(context.shortlisted)
    with stage_span(context.run_id, name, input_count=input_count, perspective=context.perspective) as details:
        output = fn(context, *args)
        out_count = len(output) if isinstance(output, (list, tuple, dict)) else 1
        details["output_count"] = out_count
    duration = round(time.monotonic() - started, 4)
    context.timings[f"{name}_duration"] = duration
    # Human-readable end-to-end trace line (visible on the console, one per stage).
    logger.info("[PIPELINE %s] %-22s in=%-3s out=%-3s (%.2fs)",
                context.run_id[:8], name, input_count, out_count, duration)
    return output


def run_v2_pipeline(
    query: str,
    user_id: str,
    case_file_context: list[dict[str, Any]] | None = None,
    case_id: str | None = None,
    perspective: str | None = None,
    custom_keywords: list[str] | None = None,
    selected_keywords: list[str] | None = None,
    selected_case_names: list[str] | None = None,
    run_id: str | None = None,
) -> dict[str, Any]:
    started = time.monotonic()
    run_id = run_id or str(uuid.uuid4())
    user_id = (user_id or "anonymous").strip()
    query = (query or "").strip()
    if not query:
        return PipelineResult(None, None, run_id, "failed", "query is required").to_dict()
    normalized = normalize_perspective.run(perspective)
    case_context = from_case_file_context(case_file_context)
    if not case_context and case_id:
        try:
            from legacy_pipeline import _fetch_case_chunks_sync
            case_context = _fetch_case_chunks_sync(case_id, user_id)
        except Exception:
            logger.exception("Document service context load failed", extra={"details": {"run_id": run_id, "case_id": case_id}})

    custom_pool = list(dict.fromkeys((selected_keywords or []) + (custom_keywords or []) + (selected_case_names or [])))
    case_context = case_context or ""
    case_context_chars = len(case_context.strip())
    logger.info("V2 pipeline start", extra={"details": {
        "run_id": run_id,
        "case_id": case_id,
        "perspective": normalized,
        "case_context_chars": case_context_chars,
        "case_context_preview": case_context[:200],
        "query_preview": query[:200],
        "custom_keywords_count": len(custom_pool),
    }})

    # Empty/missing document context with only a party caption → nothing to research.
    # Detect this early instead of generating party-name queries that always return 0.
    from services.issue_service import has_research_signal
    if not has_research_signal(query, case_context) and not custom_pool:
        logger.warning("DOCUMENT_CONTEXT_MISSING — empty case context and no usable legal query terms", extra={"details": {
            "run_id": run_id, "case_id": case_id, "case_context_chars": case_context_chars, "query_preview": query[:200],
        }})
        ensure_run(run_id, user_id, query, case_id)
        try:
            fail_run(run_id, "DOCUMENT_CONTEXT_MISSING")
        except Exception:
            logger.debug("Unable to persist DOCUMENT_CONTEXT_MISSING state", exc_info=True)
        return PipelineResult(None, None, run_id, "failed", "DOCUMENT_CONTEXT_MISSING").to_dict()

    # FAILURE 3 — resolve the represented side from multiple signals (frontend value +
    # document framing). A wrong side flips every SUPPORTING/ADVERSE label, so a
    # high-confidence petitioner-side writ may correct a wrong "respondent" perspective.
    from services.perspective_service import detect_represented_side
    represented_side = detect_represented_side(normalized, case_context, query, run_id)

    context = PipelineContext(
        run_id=run_id, query=query, user_id=user_id, case_id=case_id,
        perspective=represented_side, case_context=case_context,
        custom_keywords=custom_pool,
    )
    context.represented_side = represented_side
    # FAILURE 2 — register the user's own source documents so they can never be returned
    # as citation candidates (circular contamination).
    excluded_ids, excluded_titles = extract_source_identifiers(case_file_context, case_context)
    context.case_title = query
    context.excluded_doc_ids = excluded_ids
    context.excluded_titles = excluded_titles
    ensure_run(run_id, user_id, query, case_id)
    client = IndianKanoonClient(run_id, user_id, context.budget)
    logger.info(
        "[JURINEX][%s][START] case=%s client_role=%s context_chars=%d custom_keywords=%d",
        run_id[:8], (case_id or query)[:60], represented_side, case_context_chars, len(custom_pool),
    )
    try:
        _stage(context, "extract_case_profile", extract_case_profile.run)
        _stage(context, "extract_issues", extract_issues.run)
        logger.debug("Generated issue cards", extra={"details": {"run_id": run_id, "issues": [item.to_dict() for item in context.issues]}})
        _stage(context, "generate_queries", generate_queries.run)
        logger.debug("Generated IK queries", extra={"details": {"run_id": run_id, "queries": context.queries}})
        _stage(context, "retrieve_candidates", retrieve_candidates.run, client)
        _stage(context, "deduplicate_candidates", deduplicate_candidates.run)
        _stage(context, "cheap_filter", cheap_filter.run)
        _stage(context, "cheap_prescreen", cheap_prescreen.run)
        _stage(context, "enrich_fragments", enrich_fragments.run, client)
        _stage(context, "score_candidates", score_candidates.run)
        logger.debug("Candidate scores and rejections", extra={"details": {
            "run_id": run_id,
            "scores": [{"doc_id": c.doc_id, "issue": c.matched_issue_id, "relevance": c.relevance_score, "confidence": c.confidence} for c in context.candidates],
            "rejected": [{"doc_id": c.doc_id, "reason": c.rejection_reason} for c in context.rejected],
        }})
        _stage(context, "shortlist_candidates", shortlist_candidates.run)
        _stage(context, "fetch_full_documents", fetch_full_documents.run, client)
        _stage(context, "detect_disposition", detect_disposition.run)
        _stage(context, "final_ai_judge", final_ai_judge.run)
        supporting, adverse, caution = _stage(context, "classify_results", classify_results.run)
        # Per-citation usage memo + relevance gate (keeps Recommended genuinely relevant).
        supporting, adverse, caution = _stage(
            context, "generate_usage_analysis", generate_usage_analysis.run,
            supporting, adverse, caution,
        )
        cost = summarize_cost(run_id)
        cost["estimatedCostInr"] = round(context.budget.estimated_cost_inr, 4)
        cost["operationCounts"] = context.budget.counts
        try:
            from services.cost_service import pricing_rates
            cost["rates"] = pricing_rates()
        except Exception:
            logger.debug("pricing_rates unavailable", exc_info=True)
        context.timings["total_duration"] = round(time.monotonic() - started, 4)
        from services.issue_service import assess_context
        ctx_quality = assess_context(context.case_context)
        diagnostics = {
            "case_id": case_id,
            "case_name": context.query if context.case_id else None,
            "case_context_chars": len(context.case_context or ""),
            "case_context_preview": (context.case_context or "")[:800],
            "context_quality": ctx_quality,
            "issues_count": len(context.issues),
            "queries_count": len(context.queries),
            "queries": [
                {
                    "query_id": q.get("query_id"),
                    "query_type": q.get("query_type"),
                    "query_string": q.get("formInput") or q.get("query_string"),
                    "is_fallback": q.get("is_fallback", False),
                    "docs_count": q.get("docs_count", 0),
                    # extras for the detailed pipeline view (harmless supersets):
                    "issue_id": q.get("issue_id"),
                    "doctypes": q.get("doctypes"),
                    "result_count": q.get("result_count"),
                    "error": q.get("error"),
                }
                for q in (context.queries or [])
            ],
            "rejected": [
                {"doc_id": c.doc_id, "title": c.title, "matched_issue_id": c.matched_issue_id,
                 "matched_query": c.matched_query, "reason": c.rejection_reason}
                for c in (context.rejected or [])[:30]
            ],
            "raw_candidates_count": context.timings.get("_raw_candidate_count", 0),
            "deduped_candidates_count": context.timings.get("_deduped_count", 0),
            "cheap_filtered_count": len(context.candidates),
            "fragment_checked_count": context.timings.get("_enriched_count", 0),
            "scored_count": context.timings.get("_scored_count", 0),
            "shortlisted_count": len(context.shortlisted),
            "full_docs_fetched_count": context.timings.get("_full_docs_count", 0),
            "ai_judged_count": len(context.shortlisted),
            "recommended_count": len(supporting),
            "adverse_count": len(adverse),
            "caution_count": len(caution),
            "relevance_filtered_count": context.timings.get("_relevance_filtered", 0),
            "rejected_count": len(context.rejected),
            "no_result_reason": "" if supporting else (
                "document context missing" if not case_context and not query
                else "Only the document cover page / cause-title was available "
                     f"({ctx_quality['chars']} chars, {ctx_quality['substantive_term_count']} substantive terms) — "
                     "the full judgment text was not extracted, so no real legal issues could be derived"
                     if ctx_quality["cover_page_only"]
                else "Indian Kanoon returned 0 results" if context.timings.get("_raw_candidate_count", 0) == 0
                else "all candidates filtered" if not context.shortlisted
                else "no candidate supported selected side"
            ),
        }
        logger.info(
            "[PIPELINE %s] FUNNEL ctx_chars=%s quality=%s | issues=%s queries=%s -> raw=%s deduped=%s "
            "filtered=%s fragments=%s scored=%s shortlisted=%s fulldocs=%s | recommended=%s adverse=%s caution=%s rejected=%s%s",
            run_id[:8], diagnostics["case_context_chars"], ctx_quality["quality"],
            diagnostics["issues_count"], diagnostics["queries_count"], diagnostics["raw_candidates_count"],
            diagnostics["deduped_candidates_count"], diagnostics["cheap_filtered_count"],
            diagnostics["fragment_checked_count"], diagnostics["scored_count"], diagnostics["shortlisted_count"],
            diagnostics["full_docs_fetched_count"], diagnostics["recommended_count"], diagnostics["adverse_count"],
            diagnostics["caution_count"], diagnostics["rejected_count"],
            f" | NO_RESULT_REASON: {diagnostics['no_result_reason']}" if diagnostics["no_result_reason"] else "",
        )
        report = _stage(context, "build_report", build_report.run, supporting, adverse, caution, cost, diagnostics)
        report_id = str(uuid.uuid4())
        save_report(report_id, user_id, query, report, case_id, run_id)
        complete_run(run_id, report_id, len(context.candidates), len(supporting), len(adverse) + len(caution))
        logger.info(
            "[JURINEX][%s][END] completed in %.2fs supporting=%d adverse=%d caution=%d "
            "total_cost=Rs%.2f disposition_overrides=%d",
            run_id[:8], context.timings.get("total_duration", 0.0),
            len(supporting), len(adverse), len(caution),
            round(context.budget.estimated_cost_inr, 2), context.timings.get("_disposition_flips", 0),
        )
        logging.getLogger("citation.audit").info("Citation report generated", extra={"details": {
            "run_id": run_id, "user_id": user_id, "report_id": report_id,
            "cost": cost, "recommended": len(supporting), "adverse": len(adverse), "caution": len(caution),
        }})
        return PipelineResult(report_id, report, run_id, "completed").to_dict()
    except Exception as exc:
        logger.exception("Citation Pipeline V2 failed", extra={"details": {"run_id": run_id, "perspective": normalized}})
        try:
            fail_run(run_id, str(exc))
        except Exception:
            logger.debug("Unable to persist failed state", exc_info=True)
        return PipelineResult(None, None, run_id, "failed", str(exc)).to_dict()
