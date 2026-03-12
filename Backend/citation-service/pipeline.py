"""
Citation pipeline — now delegates to CitationRootAgent (ADK-compatible orchestrator).
Watchdog → Fetcher → Clerk → Librarian → Auditor → ReportBuilder
Tracks run_id, pipeline_run, and agent logs in DB.
"""

from __future__ import annotations

import logging
import os
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parent / ".env")

logger = logging.getLogger(__name__)


def run_pipeline(
    query: str,
    user_id: str,
    ingest_external: bool = True,
    case_file_context: Optional[List[Dict[str, Any]]] = None,
    case_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Run the full citation pipeline via CitationRootAgent.
    Creates a pipeline_run row and passes run_id for agent logs and report.

    Returns: { report_id, report_format, run_id, status, error }
    """
    import time as _time
    from agents.root_agent import CitationRootAgent, AgentContext
    from db.client import pipeline_run_insert, pipeline_run_update

    # Rich console logging
    try:
        from utils.rich_logger import pipeline_console
    except ImportError:
        pipeline_console = None

    user_id = (user_id or "anonymous").strip()
    query   = (query or "").strip()
    if not query:
        return {"error": "query is required", "report_id": None, "report_format": None, "run_id": None, "status": None}

    run_id = str(uuid.uuid4())
    try:
        pipeline_run_insert(run_id, user_id, query, case_id=case_id)
    except Exception as e:
        logger.warning("[PIPELINE] pipeline_run_insert failed: %s", e)

    # Log pipeline start
    pipeline_start = _time.time()
    if pipeline_console:
        pipeline_console.log_pipeline_start(query, user_id, run_id=run_id, case_id=case_id or "")

    context = AgentContext(
        query   = query,
        user_id = user_id,
        case_id = case_id,
        metadata = {
            "case_file_context": case_file_context or [],
            "ingest_external":   ingest_external,
            "run_id":            run_id,
        },
    )

    try:
        root   = CitationRootAgent()
        result = root.run(context)
    except Exception as e:
        logger.exception("[PIPELINE] Root agent crashed: %s", e)
        if pipeline_console:
            pipeline_console.log_pipeline_end("failed", duration=_time.time() - pipeline_start)
        try:
            pipeline_run_update(run_id, "failed", error_message=str(e)[:2000])
        except Exception:
            pass
        return {"error": str(e), "report_id": None, "report_format": None, "run_id": run_id, "status": "failed"}

    if not result.success:
        if pipeline_console:
            pipeline_console.log_pipeline_end("failed", duration=_time.time() - pipeline_start)
        try:
            pipeline_run_update(run_id, "failed", error_message=(result.error or "")[:2000])
        except Exception:
            pass
        return {"error": result.error, "report_id": None, "report_format": None, "run_id": run_id, "status": "failed"}

    # Log pipeline success
    status = result.data.get("report_status", "completed")
    if pipeline_console:
        pipeline_console.log_pipeline_end(
            status,
            citation_count=result.data.get("citation_count", 0),
            duration=_time.time() - pipeline_start,
        )

    # Pipeline run is updated inside root_agent with report_id and counts
    return {
        "report_id":     result.data.get("report_id"),
        "report_format": result.data.get("report_format"),
        "run_id":        run_id,
        "status":        status,
        "error":         None,
    }
