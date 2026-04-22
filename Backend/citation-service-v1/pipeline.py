"""Pipeline orchestrator — runs the Google ADK CitationPipeline for a single request.

Exposes two modes:
  1. ADK mode (default) — uses google.adk Runner + InMemorySessionService
  2. Direct mode (fallback) — calls tool functions directly without ADK overhead

Each run gets a unique run_id. Status and logs are stored in-memory for polling.
Completed reports are persisted to PostgreSQL.
"""
from __future__ import annotations

import asyncio
import os
import traceback
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional

# ---------------------------------------------------------------------------
# Lightweight ToolContext mock for direct-mode plan tool calls
# ---------------------------------------------------------------------------

class _MockToolContext:
    """Minimal stand-in for google.adk.tools.tool_context.ToolContext used in direct mode.
    Wraps the shared state dict so plan tools can read/write state without ADK overhead.
    """
    def __init__(self, state: Dict[str, Any]) -> None:
        self.state = state


# ---------------------------------------------------------------------------
# In-memory run registry (run_id → RunState)
# ---------------------------------------------------------------------------

_runs: Dict[str, Dict[str, Any]] = {}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def get_run_state(run_id: str) -> Optional[Dict[str, Any]]:
    return _runs.get(run_id)


def list_run_ids() -> list:
    return list(_runs.keys())


# ---------------------------------------------------------------------------
# ADK imports (deferred so service starts even if google-adk not installed)
# ---------------------------------------------------------------------------

def _try_import_adk():
    try:
        from google.adk.runners import Runner
        from google.adk.sessions import InMemorySessionService
        from google.genai import types as genai_types
        return Runner, InMemorySessionService, genai_types
    except ImportError:
        return None, None, None


# ---------------------------------------------------------------------------
# Direct pipeline (no ADK) — calls tool functions in sequence
# ---------------------------------------------------------------------------

async def _run_direct_pipeline(
    run_id: str,
    query: str,
    user_id: str,
    case_id: Optional[str],
    perspective: str,
) -> Dict[str, Any]:
    """Fallback pipeline that runs without Google ADK."""
    from tools.document_service import fetch_case_context
    from tools.serper_search import search_google_serper
    from tools.ik_search import search_indian_kanoon
    from agents.extractor_agent import tool_extract_from_snippets
    from agents.ranker_agent import tool_rank_and_group_citations
    from agents.reporter_agent import tool_build_report
    from utils.logger import pipeline_log

    state: Dict[str, Any] = {}

    # Stage 1: Case context
    _update_run(run_id, progress=10, stage="case_context")
    pipeline_log(run_id, "CaseContextAgent", f"Fetching case context for case_id={case_id}")
    case_ctx: Dict[str, Any] = {}
    if case_id:
        case_ctx = await fetch_case_context(case_id=case_id, user_id=user_id, query=query)
    state["case_context"] = case_ctx

    # Stage 1.5: Pipeline planning — Claude reasons before any agent executes
    _update_run(run_id, progress=18, stage="planning")
    pipeline_log(run_id, "PlannerAgent", "Creating pipeline execution plan")
    try:
        from utils.claude_client import claude_complete_json as _ccj
        _case_text = str(case_ctx.get("answer", "") or case_ctx.get("facts", ""))[:400]
        _plan_system = (
            "You are a legal citation pipeline orchestrator. "
            "Create a concise execution plan for the full citation research pipeline."
        )
        _plan_user = f"""
Query: {query}
Perspective: {perspective}
Case context: {_case_text or 'Not available — infer from query'}

Create a 4–6 step pipeline execution plan covering:
- Which courts/databases to prioritise in search
- Extraction approach (full-text vs snippet)
- Ranking priorities and authority hierarchy
- Legal dimensions to group citations into
- Report emphasis for '{perspective}' perspective

Return ONLY this JSON:
{{
  "steps": ["1. ...", "2. ...", "3. ...", "4. ..."],
  "reasoning": "overall strategy",
  "focus_areas": ["term1", "term2"],
  "priority_courts": ["Supreme Court of India"],
  "expected_dimensions": ["Dimension A", "Dimension B"]
}}
"""
        pipeline_plan = await _ccj(system=_plan_system, user=_plan_user, max_tokens=512)
    except Exception as _pe:
        pipeline_plan = {
            "steps": [
                f"1. Search Indian Kanoon for '{query}'",
                "2. Search Serper for related judgments",
                "3. Extract citation metadata",
                "4. Rank by relevance and court authority",
                "5. Build final report",
            ],
            "reasoning": f"Default plan (planning call failed: {_pe})",
            "focus_areas": [],
            "priority_courts": ["Supreme Court of India"],
            "expected_dimensions": ["General"],
        }
    state["pipeline_plan"] = pipeline_plan
    for _step in pipeline_plan.get("steps", []):
        pipeline_log(run_id, "PlannerAgent", f"  → {_step}")
    pipeline_log(run_id, "PlannerAgent",
                 f"Plan complete — focus: {pipeline_plan.get('focus_areas', [])}")

    # Stage 2: Search (Serper + IK in parallel)
    _update_run(run_id, progress=30, stage="search")
    pipeline_log(run_id, "SearchAgent", f"Searching for: {query}")
    legal_query = f"{query} site:indiankanoon.org OR court judgment India"
    serper_task = search_google_serper(legal_query, num_results=10)
    ik_task = search_indian_kanoon(query, page_num=0)
    serper_result, ik_result = await asyncio.gather(serper_task, ik_task, return_exceptions=True)

    search_results: list = []
    if not isinstance(serper_result, Exception):
        search_results.extend(serper_result.get("results", []))
    if not isinstance(ik_result, Exception):
        search_results.extend(ik_result.get("results", []))

    # Deduplicate
    seen: set = set()
    deduped = []
    for r in search_results:
        u = r.get("url", "")
        if u and u not in seen:
            seen.add(u)
            deduped.append(r)
    state["search_results"] = deduped
    pipeline_log(run_id, "SearchAgent", f"Found {len(deduped)} unique results")

    # Stage 3: Extraction planning + extract
    _update_run(run_id, progress=50, stage="extraction")
    from agents.extractor_agent import tool_create_extraction_plan
    _mock_ctx = _MockToolContext(state)
    await tool_create_extraction_plan(_mock_ctx)
    pipeline_log(run_id, "ExtractorAgent", f"Extracting citations from {len(deduped)} results")
    extraction = await tool_extract_from_snippets(
        search_results=deduped,
        original_query=query,
    )
    raw_citations = extraction.get("citations", [])
    state["raw_citations"] = raw_citations
    pipeline_log(run_id, "ExtractorAgent", f"Extracted {len(raw_citations)} citations")

    # Stage 4: Ranking planning + rank
    _update_run(run_id, progress=70, stage="ranking")
    from agents.ranker_agent import tool_create_ranking_plan
    await tool_create_ranking_plan(_mock_ctx)
    pipeline_log(run_id, "RankerAgent", "Ranking citations by relevance")
    ranking = await tool_rank_and_group_citations(
        citations=raw_citations,
        query=query,
        case_context=case_ctx,
        perspective=perspective,
    )
    ranked = ranking.get("ranked_citations", raw_citations)
    dims = ranking.get("dimensions", [])
    state["ranked_citations"] = ranked
    state["dimensions"] = dims
    pipeline_log(run_id, "RankerAgent", f"Ranked {len(ranked)} citations into {len(dims)} dimensions")

    # Stage 5: Report planning + build
    _update_run(run_id, progress=88, stage="report_planning")
    from agents.reporter_agent import tool_create_report_plan
    await tool_create_report_plan(_mock_ctx)
    _update_run(run_id, progress=92, stage="report")
    pipeline_log(run_id, "ReporterAgent", "Building final report")
    report_format = await tool_build_report(
        ranked_citations=ranked,
        dimensions=dims,
        query=query,
        user_id=user_id,
        case_id=case_id,
        run_id=run_id,
        perspective=perspective,
        tool_context=_mock_ctx,
    )
    state["report_format"] = report_format
    pipeline_log(run_id, "ReporterAgent", f"Report built with {len(report_format.get('citations', []))} citations")

    return report_format


# ---------------------------------------------------------------------------
# Proposition pipeline — primary mode (proposition-based search + validation)
# ---------------------------------------------------------------------------

async def _run_proposition_pipeline(
    run_id: str,
    query: str,
    user_id: str,
    case_id: Optional[str],
    perspective: str,
) -> Dict[str, Any]:
    """Primary pipeline: proposition extraction → targeted search → YES/NO filter
    → full text fetch → deep validation + scoring → ranked report."""
    from tools.document_service import fetch_case_context
    from agents.proposition_pipeline import run_proposition_pipeline
    from utils.logger import pipeline_log

    _update_run(run_id, progress=5, stage="case_context")
    pipeline_log(run_id, "pipeline", "Fetching full case text (multiple queries)")
    case_text = ""
    if case_id:
        # Run 3 targeted queries to extract different parts of the case document
        fetch_queries = [
            "facts parties issue in dispute relief sought prayer",
            "legal arguments statutes sections constitutional rights violated",
            "grounds of challenge legal issues jurisdiction court",
        ]
        chunks_seen: set = set()
        all_chunks: list = []
        fetch_tasks = [
            fetch_case_context(case_id=case_id, user_id=user_id, query=q)
            for q in fetch_queries
        ]
        fetch_results = await asyncio.gather(*fetch_tasks, return_exceptions=True)
        for i, res in enumerate(fetch_results):
            if isinstance(res, Exception):
                pipeline_log(run_id, "pipeline",
                             f"Case fetch [{i}] raised exception: {res}", "warning")
                continue
            if "error" in res:
                pipeline_log(run_id, "pipeline",
                             f"Case fetch [{i}] document-service error: {res['error']}", "warning")
                continue
            raw = res.get("raw_chunks", [])
            ans = res.get("answer", "") or res.get("facts", "")
            pipeline_log(run_id, "pipeline",
                         f"Case fetch [{i}] got {len(raw)} chunks, answer={len(ans)} chars")
            for chunk in raw:
                cid = chunk.get("id") or chunk.get("content", "")[:40]
                if cid not in chunks_seen:
                    chunks_seen.add(cid)
                    all_chunks.append(chunk.get("content", "") or chunk.get("text", ""))
            if ans and ans not in chunks_seen:
                chunks_seen.add(ans[:40])
                all_chunks.insert(0, ans)

        case_text = "\n\n".join(filter(None, all_chunks))[:8000]
        pipeline_log(run_id, "pipeline",
                     f"Case text: {len(case_text)} chars from {len(all_chunks)} chunks"
                     + ("" if case_text else " — document service returned no data for this case_id"))

    _update_run(run_id, progress=15, stage="legal_point_extraction")

    # Hook proposition pipeline log events to also update progress percentage
    _STAGE_PROGRESS = {
        "PropositionExtractor": 20,
        "QueryGenerator":       28,
        "SearchAgent":          38,
        "ValidatorAgent":       52,
        "FetchAgent":           65,
        "DeepValidator":        80,
        "PropositionPipeline":  90,
    }
    from utils.logger import _pipeline_logs  # noqa: avoid circular

    original_log_count = len(_pipeline_logs.get(run_id, []))

    report_format = await run_proposition_pipeline(
        query=query,
        case_context=case_text[:8000],
        run_id=run_id,
        perspective=perspective,
        user_id=user_id,
        case_id=case_id,
    )

    # Sync final progress from last log entry's agent name
    logs = _pipeline_logs.get(run_id, [])
    for entry in reversed(logs[original_log_count:]):
        agent = entry.get("agent", "")
        if agent in _STAGE_PROGRESS:
            _update_run(run_id, progress=_STAGE_PROGRESS[agent], stage=agent.lower())
            break

    _update_run(run_id, progress=95, stage="done")
    return report_format


# ---------------------------------------------------------------------------
# Agentic pipeline — Claude web search (secondary mode)
# ---------------------------------------------------------------------------

async def _run_agentic_pipeline(
    run_id: str,
    query: str,
    user_id: str,
    case_id: Optional[str],
    perspective: str,
) -> Dict[str, Any]:
    """Primary pipeline: Claude autonomously searches the web using Brave (via Anthropic)."""
    from tools.document_service import fetch_case_context
    from agents.agentic_citation_agent import run_citation_agent
    from utils.logger import pipeline_log

    # Fetch case context if case_id provided
    _update_run(run_id, progress=10, stage="case_context")
    case_text = ""
    if case_id:
        pipeline_log(run_id, "CitationAgent", f"Fetching case context for case_id={case_id}")
        case_ctx = await fetch_case_context(case_id=case_id, user_id=user_id, query=query)
        case_text = (
            case_ctx.get("answer", "")
            or case_ctx.get("facts", "")
            or "\n".join(c.get("content", "") for c in case_ctx.get("raw_chunks", [])[:6])
        )

    _update_run(run_id, progress=20, stage="agentic_search")
    report_format = await run_citation_agent(
        query=query,
        case_context=case_text[:6000],
        run_id=run_id,
        perspective=perspective,
        user_id=user_id,
        case_id=case_id,
    )
    _update_run(run_id, progress=95, stage="done")
    return report_format


# ---------------------------------------------------------------------------
# Broad search pipeline — maximum coverage, no filtering
# ---------------------------------------------------------------------------

async def _run_broad_pipeline(
    run_id: str,
    query: str,
    user_id: str,
    case_id: Optional[str],
    perspective: str,
) -> Dict[str, Any]:
    """Broad search pipeline: multiple Serper + IK queries, Claude enrichment, no filtering."""
    from tools.document_service import fetch_case_context
    from agents.broad_search_pipeline import run_broad_pipeline
    from utils.logger import pipeline_log

    _update_run(run_id, progress=10, stage="case_context")
    case_text = ""
    if case_id:
        pipeline_log(run_id, "BroadSearch", f"Fetching case context for case_id={case_id}")
        case_ctx = await fetch_case_context(case_id=case_id, user_id=user_id, query=query)
        case_text = (
            case_ctx.get("answer", "")
            or case_ctx.get("facts", "")
            or "\n".join(c.get("content", "") for c in case_ctx.get("raw_chunks", [])[:6])
        )

    _update_run(run_id, progress=20, stage="broad_search")
    report_format = await run_broad_pipeline(
        query=query,
        case_context=case_text[:6000],
        run_id=run_id,
        perspective=perspective,
        user_id=user_id,
        case_id=case_id,
    )
    _update_run(run_id, progress=95, stage="done")
    return report_format


# ---------------------------------------------------------------------------
# ADK pipeline
# ---------------------------------------------------------------------------

async def _run_adk_pipeline(
    run_id: str,
    query: str,
    user_id: str,
    case_id: Optional[str],
    perspective: str,
) -> Dict[str, Any]:
    """Run the citation pipeline via Google ADK SequentialAgent."""
    from utils.logger import pipeline_log

    Runner, InMemorySessionService, genai_types = _try_import_adk()
    if Runner is None:
        pipeline_log(run_id, "pipeline", "google-adk not available, falling back to direct mode", "warning")
        return await _run_direct_pipeline(run_id, query, user_id, case_id, perspective)

    from agents.root_agent import build_root_agent

    _update_run(run_id, progress=5, stage="init")
    pipeline_log(run_id, "pipeline", "Initialising ADK runner")

    session_svc = InMemorySessionService()
    root_agent = build_root_agent()

    runner = Runner(
        agent=root_agent,
        app_name="citation-v1",
        session_service=session_svc,
    )

    # Seed session state with run context
    session = await session_svc.create_session(
        app_name="citation-v1",
        user_id=user_id,
        state={
            "run_id": run_id,
            "query": query,
            "user_id": user_id,
            "case_id": case_id or "",
            "perspective": perspective,
            "search_results": [],
            "raw_citations": [],
            "ranked_citations": [],
            "dimensions": [],
            # Plan slots — each agent writes its plan here before executing
            "pipeline_plan": {},
            "search_plan": {},
            "extraction_plan": {},
            "ranking_plan": {},
            "report_plan": {},
        },
    )

    _update_run(run_id, progress=10, stage="running_adk")
    pipeline_log(run_id, "pipeline", "ADK SequentialAgent started")

    user_message = genai_types.Content(
        role="user",
        parts=[
            genai_types.Part(
                text=(
                    f"Research citations for: {query}\n"
                    f"case_id: {case_id or 'none'}\n"
                    f"user_id: {user_id}\n"
                    f"perspective: {perspective}"
                )
            )
        ],
    )

    try:
        async for event in runner.run_async(
            user_id=user_id,
            session_id=session.id,
            new_message=user_message,
        ):
            if event.is_final_response():
                pipeline_log(run_id, "pipeline", "ADK pipeline completed")

        # Extract report_format from session state
        final_session = await session_svc.get_session(
            app_name="citation-v1", user_id=user_id, session_id=session.id
        )
        report_format = final_session.state.get("report_format", {})

        if not report_format:
            pipeline_log(run_id, "pipeline", "ADK produced no report; falling back to direct mode", "warning")
            return await _run_direct_pipeline(run_id, query, user_id, case_id, perspective)

        return report_format

    except Exception as exc:
        pipeline_log(run_id, "pipeline", f"ADK error: {exc}; falling back to direct mode", "error")
        return await _run_direct_pipeline(run_id, query, user_id, case_id, perspective)


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

async def run_pipeline(
    query: str,
    user_id: str = "anonymous",
    case_id: Optional[str] = None,
    perspective: str = "all",
    use_adk: bool = True,
) -> Dict[str, Any]:
    """Run the full citation pipeline synchronously.

    Returns:
        {"run_id": str, "report_format": dict, "report_id": str, "status": str}
    """
    from db.client import save_report, ensure_tables
    from utils.logger import pipeline_log

    run_id = str(uuid.uuid4())
    _runs[run_id] = {
        "run_id": run_id,
        "status": "running",
        "progress": 0,
        "stage": "init",
        "report_id": None,
        "report_format": None,
        "error": None,
        "started_at": _now(),
        "logs": [],
    }

    pipeline_log(run_id, "pipeline", f"Pipeline started | query='{query[:80]}' | user={user_id}")

    try:
        await ensure_tables()

        use_broad       = os.getenv("CITATION_USE_BROAD", "false").lower() == "true"
        use_proposition = os.getenv("CITATION_USE_PROPOSITION", "true").lower() == "true"
        use_agentic     = os.getenv("CITATION_USE_AGENTIC", "false").lower() == "true"
        use_adk         = os.getenv("CITATION_USE_ADK", "false").lower() == "true"
        if use_broad:
            report_format = await _run_broad_pipeline(run_id, query, user_id, case_id, perspective)
        elif use_proposition:
            report_format = await _run_proposition_pipeline(run_id, query, user_id, case_id, perspective)
        elif use_agentic:
            report_format = await _run_agentic_pipeline(run_id, query, user_id, case_id, perspective)
        elif use_adk:
            report_format = await _run_adk_pipeline(run_id, query, user_id, case_id, perspective)
        else:
            report_format = await _run_direct_pipeline(run_id, query, user_id, case_id, perspective)

        # Persist to database
        _update_run(run_id, progress=95, stage="saving")
        report_id = await save_report(
            user_id=user_id,
            query=query,
            report_format=report_format,
            run_id=run_id,
            case_id=case_id,
        )

        _update_run(run_id, progress=100, stage="completed", status="completed",
                    report_id=report_id, report_format=report_format)
        pipeline_log(run_id, "pipeline", f"Pipeline completed | report_id={report_id}")

        return {
            "run_id": run_id,
            "report_format": report_format,
            "report_id": report_id,
            "status": "completed",
        }

    except Exception as exc:
        tb = traceback.format_exc()
        _update_run(run_id, status="failed", error=str(exc))
        from utils.logger import pipeline_log
        pipeline_log(run_id, "pipeline", f"Pipeline FAILED: {exc}\n{tb}", "error")
        raise


async def start_pipeline_background(
    query: str,
    user_id: str = "anonymous",
    case_id: Optional[str] = None,
    perspective: str = "all",
) -> str:
    """Start the pipeline as a background task and immediately return run_id."""
    run_id = str(uuid.uuid4())
    _runs[run_id] = {
        "run_id": run_id,
        "status": "running",
        "progress": 0,
        "stage": "queued",
        "report_id": None,
        "report_format": None,
        "error": None,
        "started_at": _now(),
    }

    asyncio.create_task(
        _background_wrapper(run_id, query, user_id, case_id, perspective)
    )
    return run_id


async def _background_wrapper(
    run_id: str,
    query: str,
    user_id: str,
    case_id: Optional[str],
    perspective: str,
) -> None:
    """Wraps run_pipeline for background task execution."""
    from db.client import save_report, ensure_tables
    from utils.logger import pipeline_log

    try:
        await ensure_tables()

        use_broad       = os.getenv("CITATION_USE_BROAD", "false").lower() == "true"
        use_proposition = os.getenv("CITATION_USE_PROPOSITION", "true").lower() == "true"
        use_agentic     = os.getenv("CITATION_USE_AGENTIC", "false").lower() == "true"
        use_adk         = os.getenv("CITATION_USE_ADK", "false").lower() == "true"
        if use_broad:
            report_format = await _run_broad_pipeline(run_id, query, user_id, case_id, perspective)
        elif use_proposition:
            report_format = await _run_proposition_pipeline(run_id, query, user_id, case_id, perspective)
        elif use_agentic:
            report_format = await _run_agentic_pipeline(run_id, query, user_id, case_id, perspective)
        elif use_adk:
            report_format = await _run_adk_pipeline(run_id, query, user_id, case_id, perspective)
        else:
            report_format = await _run_direct_pipeline(run_id, query, user_id, case_id, perspective)

        report_id = await save_report(
            user_id=user_id,
            query=query,
            report_format=report_format,
            run_id=run_id,
            case_id=case_id,
        )
        _update_run(run_id, status="completed", progress=100,
                    report_id=report_id, report_format=report_format)
        pipeline_log(run_id, "pipeline", f"Background pipeline completed | report_id={report_id}")

    except Exception as exc:
        _update_run(run_id, status="failed", error=str(exc))
        pipeline_log(run_id, "pipeline", f"Background pipeline FAILED: {exc}", "error")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _update_run(run_id: str, **kwargs) -> None:
    if run_id in _runs:
        _runs[run_id].update(kwargs)
        _runs[run_id]["updated_at"] = _now()
