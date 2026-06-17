import logging
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed

from core.config import settings
from integrations.indian_kanoon.client import IndianKanoonClient
from pipeline.pipeline_context import PipelineContext
from services.exclusion_service import filter_source_documents
from utils.pricing import IK_SEARCH_INR

logger = logging.getLogger(__name__)


def run(context: PipelineContext, client: IndianKanoonClient):
    found = []
    rid = context.run_id[:8]

    # FAILURE 1 fix — execute queries in PRIORITY order (doctrine=1 → strict=2 → SC=3 →
    # court=4 → opponent=5 → fallback=6), round-robin across issues. Then apply the budget:
    # everything runs up to the soft budget; past it, ONLY doctrine/strict (priority<=2) are
    # protected up to the hard cap; opponent/fallback are dropped first.
    queries = list(context.queries)
    issue_order: dict = {}
    for q in queries:
        issue_order.setdefault(q.get("issue_id"), len(issue_order))
    queries.sort(key=lambda q: (q.get("priority", 6), issue_order.get(q.get("issue_id"), 99), q.get("query_id", "")))

    soft = settings.ik_search_soft_budget
    hard = settings.max_ik_search_calls
    selected: list = []
    n = 0
    for q in queries:
        prio = q.get("priority", 6)
        if n < soft:
            selected.append(q)
            n += 1
        elif prio <= 2 and n < hard:
            selected.append(q)
            n += 1
            logger.info('[JURINEX][%s][QUERY_PROTECTED] %s "%s" PROTECTED from budget cut priority=%s '
                        '— doctrine/strict queries always execute', rid, q.get("query_id"), q.get("formInput"), prio)
        else:
            q["skipped"] = True
            q["result_count"] = 0
            q["error"] = "skipped: budget_low (low priority)"
            logger.info('[JURINEX][%s][QUERY_SKIP] %s "%s" SKIPPED reason=budget_low priority=%s '
                        '(only skipping p>=3)', rid, q.get("query_id"), q.get("formInput"), prio)

    by_type = Counter(q.get("query_type") for q in selected)
    logger.info(
        "[JURINEX][%s][QUERY_ORDER] Executing %d/%d queries in priority order "
        "doctrine=%d landmark=%d strict=%d sc=%d statute=%d court=%d opponent=%d fallback=%d",
        rid, len(selected), len(queries), by_type.get("doctrine", 0), by_type.get("landmark", 0),
        by_type.get("strict", 0), by_type.get("supreme_court", 0), by_type.get("statute_combined", 0),
        by_type.get("court_filtered", 0), by_type.get("opponent", 0), by_type.get("broad_fallback", 0),
    )
    if len(selected) < len(queries):
        pct = int(round(100 * len(selected) / max(1, hard)))
        logger.info("[JURINEX][%s][QUERY_BUDGET_WARN] Budget at %d%% — dropped %d opponent/fallback "
                    "queries, protecting doctrine queries", rid, pct, len(queries) - len(selected))

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

            # Stamp the source-query priority/type onto every candidate so the cheap
            # filter never discards a result retrieved by a high-priority doctrine/
            # precision query (ADDITIONAL FIX). Keep the BEST (lowest) priority seen.
            prio = query.get("priority", 6)
            for cand in res:
                existing = cand.metadata.get("query_priority")
                cand.metadata["query_priority"] = min(prio, existing) if isinstance(existing, int) else prio
                cand.metadata.setdefault("query_type", query.get("query_type", ""))

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
            logger.info('[JURINEX][%s][QUERY_EXEC] %s priority=%s type=%s query="%s" -> %d results cost=Rs%.2f',
                        rid, query.get("query_id"), query.get("priority"), query.get("query_type"),
                        q_str, len(res), IK_SEARCH_INR)
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

    # Execute the budget-selected queries (already in priority order) concurrently.
    with ThreadPoolExecutor(max_workers=min(10, max(1, len(selected)))) as pool:
        futures = [pool.submit(_execute_query, q) for q in selected]
        for future in as_completed(futures):
            q, res = future.result()
            found.extend(res)

    # FIX 2 — strip out the user's own uploaded/source documents so the system never
    # cites its own inputs (circular contamination).
    found = filter_source_documents(found, context)

    context.candidates = found[:context.budget.config.max_raw_candidates]
    context.timings["_raw_candidate_count"] = len(context.candidates)
    return context.candidates
