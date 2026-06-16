import logging
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

from core.exceptions import BudgetExceeded
from integrations.indian_kanoon.client import IndianKanoonClient
from pipeline.pipeline_context import PipelineContext

logger = logging.getLogger(__name__)


def run(context: PipelineContext, client: IndianKanoonClient):
    found = []
    
    # Split queries into initial and fallback
    initial_queries = [q for q in context.queries if not q.get("is_fallback")]
    fallback_queries = [q for q in context.queries if q.get("is_fallback")]
    
    # Track results per issue to know when to trigger fallback
    issue_results = {q["issue_id"]: 0 for q in context.queries}
    
    def _execute_query(query):
        start_t = time.monotonic()
        # We use query["formInput"] or query["query_string"]
        q_str = query.get("query_string") or query.get("formInput") or query.get("query", "")
        doctypes = query.get("doctypes", "judgments")

        # Log the exact query BEFORE it is sent to Indian Kanoon (Step 4).
        logger.info("Indian Kanoon Search -> sending", extra={"details": {
            "run_id": context.run_id,
            "stage": "indian_kanoon_search",
            "phase": "request",
            "query_id": query.get("query_id", "Qx"),
            "issue_id": query.get("issue_id"),
            "query_type": query.get("query_type"),
            "is_fallback": query.get("is_fallback", False),
            "formInput": q_str,
            "doctypes": doctypes,
            "pagenum": query.get("pagenum", 0),
        }})

        try:
            res = client.search(q_str, doctypes, query["issue_id"])
            dur = int((time.monotonic() - start_t) * 1000)

            # The exact HTTP status / IK 'found' total / response keys are logged by
            # services.indian_kanoon.ik_search (INFO). Here we record the parsed outcome.
            logger.info("Indian Kanoon Search <- result", extra={"details": {
                "run_id": context.run_id,
                "stage": "indian_kanoon_search",
                "phase": "response",
                "query_id": query.get("query_id", "Qx"),
                "issue_id": query.get("issue_id"),
                "formInput": q_str,
                "candidates_returned": len(res),
                "is_fallback": query.get("is_fallback", False),
                "duration_ms": dur,
            }})
            # Surface per-query result count to the report's detailed pipeline view.
            query["docs_count"] = len(res)
            query["result_count"] = len(res)
            query["duration_ms"] = dur
            return query, res
        except Exception as e:
            logger.warning("Indian Kanoon Search Error", extra={"details": {
                "run_id": context.run_id,
                "stage": "indian_kanoon_search",
                "query_id": query.get("query_id", "Qx"),
                "formInput": query.get("query_string", ""),
                "http_status": getattr(e, "status", 500),
                "error_message": str(e),
                "retry_attempt": 1
            }})
            query["result_count"] = 0
            query["error"] = str(e)
            return query, []

    # 1. Run initial queries
    with ThreadPoolExecutor(max_workers=min(10, max(1, len(initial_queries)))) as pool:
        futures = [pool.submit(_execute_query, q) for q in initial_queries]
        for future in as_completed(futures):
            q, res = future.result()
            found.extend(res)
            issue_results[q["issue_id"]] += len(res)

    # 2. Check for fallbacks
    fallbacks_to_run = []
    for fq in fallback_queries:
        if issue_results.get(fq["issue_id"], 0) == 0:
            logger.info("strict_query_zero_results -> broad_fallback_started", extra={"details": {
                "run_id": context.run_id,
                "issue_id": fq["issue_id"]
            }})
            fallbacks_to_run.append(fq)
            
    if fallbacks_to_run:
        with ThreadPoolExecutor(max_workers=min(5, max(1, len(fallbacks_to_run)))) as pool:
            futures = [pool.submit(_execute_query, q) for q in fallbacks_to_run]
            for future in as_completed(futures):
                q, res = future.result()
                found.extend(res)
                issue_results[q["issue_id"]] += len(res)

    context.candidates = found[:context.budget.config.max_raw_candidates]
    context.timings["_raw_candidate_count"] = len(context.candidates)
    return context.candidates
