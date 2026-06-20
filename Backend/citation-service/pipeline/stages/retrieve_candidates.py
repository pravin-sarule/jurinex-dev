import logging
import time
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeout, as_completed

from core.config import settings
from integrations.indian_kanoon.client import IndianKanoonClient
from pipeline.pipeline_context import PipelineContext
from services.exclusion_service import filter_source_documents
from utils.pricing import IK_SEARCH_INR

logger = logging.getLogger(__name__)


# ── Phase 1 — per-issue round-robin allocator with per-type quotas ───────────────
# Goal: every issue contributes its precision + recall + landmark BEFORE any issue's
# extra precision query runs, so no query TYPE (SC / court / statute / recall / opponent)
# is starved by a budget that filled with one type (R4, R5). The execution budget scales
# with issue count and is capped by the BudgetTracker ceiling.
#
# Each issue's queries are picked in this order (one per round, round-robin across issues).
# Opponent sits in the first band so adverse-authority is RESERVED early (capped globally
# at max_opponent_search_calls), keeping the Adverse bucket alive under a tight budget.
_PICK_FIRST = ("doctrine", "outcome", "broad_fallback", "landmark", "opponent")  # precision, favourable-outcome, recall, landmark, opponent
_PICK_SECOND = ("doctrine", "strict", "statute_combined", "supreme_court",
                "court_filtered", "outcome", "landmark")  # precision #2 (caps precision at 2 early), then more angles


def _effective_search_budget(n_issues: int) -> int:
    """Per-run IK-search budget = base + per_issue * issues, capped by the hard ceiling.
    Defaults base=2, per_issue=7 → 1 issue=9, 2=16, 3=23, 4=30, 5=30 (ceiling)."""
    scaled = settings.ik_search_base_budget + settings.ik_search_per_issue_budget * max(1, n_issues)
    return min(settings.max_ik_search_calls, scaled)


def _issue_pick_order(issue_queries: list) -> list:
    """Order one issue's queries: essential diversity first, then the rest by priority."""
    buckets: dict = defaultdict(list)
    for q in issue_queries:
        buckets[q.get("query_type")].append(q)
    order: list = []
    used: set = set()

    def _take(qtype: str) -> None:
        for q in buckets.get(qtype, []):
            if id(q) not in used:
                used.add(id(q))
                order.append(q)
                return

    for qtype in _PICK_FIRST:
        _take(qtype)
    for qtype in _PICK_SECOND:
        _take(qtype)
    rest = [q for q in issue_queries if id(q) not in used]
    rest.sort(key=lambda q: q.get("priority", 6))
    order.extend(rest)
    return order


def select_queries(queries: list) -> tuple[list, list, int]:
    """Pick which queries to execute: round-robin across issues, per-type quotas.

    Returns (selected, skipped, effective_budget). Opponent queries are capped at
    settings.max_opponent_search_calls (their reserve), counted INSIDE the budget so a
    BudgetTracker collision is impossible. No issue's essential precision/recall/landmark
    is starved — they are picked in the first rounds before any extras.
    """
    issue_order: dict = {}
    for q in queries:
        issue_order.setdefault(q.get("issue_id"), len(issue_order))
    n_issues = len(issue_order) or 1
    budget = _effective_search_budget(n_issues)
    opp_cap = settings.max_opponent_search_calls

    groups: dict = defaultdict(list)
    for q in queries:
        groups[q.get("issue_id")].append(q)
    pick_lists = {iid: _issue_pick_order(qs) for iid, qs in groups.items()}
    ordered_iids = sorted(issue_order, key=lambda i: issue_order[i])

    selected: list = []
    selected_ids: set = set()
    opp_taken = 0
    max_rounds = max((len(lst) for lst in pick_lists.values()), default=0)
    for r in range(max_rounds):
        if len(selected) >= budget:
            break
        for iid in ordered_iids:
            lst = pick_lists[iid]
            if r >= len(lst) or len(selected) >= budget:
                continue
            q = lst[r]
            if q.get("query_type") == "opponent":
                if opp_taken >= opp_cap:
                    continue  # opponent reserve reached — this one falls through to skipped
                opp_taken += 1
            selected.append(q)
            selected_ids.add(id(q))

    skipped = [q for q in queries if id(q) not in selected_ids]
    return selected, skipped, budget


def run(context: PipelineContext, client: IndianKanoonClient):
    found = []
    rid = context.run_id[:8]

    # Phase 1 — pick queries via the per-issue round-robin allocator: each issue gets its
    # precision + recall + landmark first, no query TYPE is starved, opponent capped at its
    # reserve, total <= effective budget (scales with issue count, <= the BudgetTracker
    # ceiling so consume() never raises mid-run).
    queries = list(context.queries)
    selected, skipped, budget = select_queries(queries)

    for q in skipped:
        q["skipped"] = True
        q["result_count"] = 0
        q["error"] = "skipped: budget (round-robin/type quota reached)"
        logger.info('[JURINEX][%s][QUERY_SKIP] %s "%s" SKIPPED reason=budget type=%s priority=%s',
                    rid, q.get("query_id"), q.get("formInput"), q.get("query_type"), q.get("priority"))

    by_type = Counter(q.get("query_type") for q in selected)
    logger.info(
        "[JURINEX][%s][QUERY_ORDER] Executing %d/%d queries (budget=%d, round-robin) "
        "doctrine=%d outcome=%d landmark=%d strict=%d sc=%d statute=%d court=%d opponent=%d fallback=%d",
        rid, len(selected), len(queries), budget, by_type.get("doctrine", 0), by_type.get("outcome", 0),
        by_type.get("landmark", 0), by_type.get("strict", 0), by_type.get("supreme_court", 0),
        by_type.get("statute_combined", 0), by_type.get("court_filtered", 0), by_type.get("opponent", 0),
        by_type.get("broad_fallback", 0),
    )
    if skipped:
        logger.info("[JURINEX][%s][QUERY_BUDGET_WARN] %d/%d queries skipped (budget=%d) — "
                    "every issue still got precision+recall+landmark", rid, len(skipped), len(queries), budget)

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
            res = client.search(q_str, doctypes, query["issue_id"],
                                is_case_name_search=bool(query.get("case_name_search")))
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

    # Execute the budget-selected queries (already in priority order) concurrently, with a
    # stage deadline (B2): once the deadline passes we stop waiting and use whatever returned
    # — a single hung connection can't stall the whole stage. Recall is protected because the
    # pool is priority-sorted before truncation, so a dropped straggler never displaces a
    # high-priority hit. The per-call 12s HTTP timeout (B1) is the primary guard; this is the
    # ceiling.
    deadline = settings.ik_retrieve_deadline_seconds
    pool = ThreadPoolExecutor(max_workers=min(10, max(1, len(selected))))
    futures = [pool.submit(_execute_query, q) for q in selected]
    done = 0
    try:
        for future in as_completed(futures, timeout=deadline):
            try:
                _q, res = future.result()
                found.extend(res)
                done += 1
            except Exception:
                pass
    except FuturesTimeout:
        logger.warning("[JURINEX][%s][QUERY_DEADLINE] retrieve stage hit %ss deadline; used %d/%d queries",
                       rid, deadline, done, len(futures))
    finally:
        pool.shutdown(wait=False, cancel_futures=True)

    # FIX 2 — strip out the user's own uploaded/source documents so the system never
    # cites its own inputs (circular contamination).
    found = filter_source_documents(found, context)

    # R6 — sort the pool by the source-query priority (1 = best) BEFORE truncating, so a
    # wider, recall-heavy pool never silently drops the high-priority doctrine/fact hits
    # the reranker/scorer most want. Stable sort preserves per-query arrival order within
    # a priority band. Duplicates are collapsed by the later deduplicate_candidates stage.
    found.sort(key=lambda c: int((c.metadata or {}).get("query_priority", 99)))

    context.candidates = found[:context.budget.config.max_raw_candidates]
    context.timings["_raw_candidate_count"] = len(context.candidates)
    return context.candidates
