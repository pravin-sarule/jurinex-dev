"""citation-service-v1 — FastAPI application.

Exposes the same /citation/* API surface as citation-service so the existing
frontend (citationApi.js) works without modification by pointing
VITE_APP_CITATION_V1_SERVICE_URL to this service (port 8002).

Pipeline: Google ADK SequentialAgent → Serper + Indian Kanoon → Claude extraction
          → Claude ranking → Claude report builder → PostgreSQL storage
"""
from __future__ import annotations

import os
from contextlib import asynccontextmanager
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from pipeline import (
    run_pipeline,
    start_pipeline_background,
    get_run_state,
)
from db.client import (
    get_report,
    list_reports,
    delete_report,
    update_report_shared_with,
    get_report_shares,
    get_team_reports,
    ensure_tables,
    close_pool,
)
from utils.logger import get_logger, get_pipeline_logs
from tools.ik_search import search_indian_kanoon

logger = get_logger("citation-v1.main")

# ---------------------------------------------------------------------------
# Lifespan
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        await ensure_tables()
        logger.info("citation-service-v1 started (port %s)", os.getenv("API_PORT", "8002"))
    except Exception as exc:
        logger.warning("DB table init failed (non-fatal): %s", exc)
    yield
    await close_pool()


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

_CORS_ORIGINS = os.getenv(
    "CORS_ORIGINS",
    "http://localhost:5173,http://localhost:3000,http://localhost:5000,http://localhost:5174",
).split(",")

app = FastAPI(
    title="Citation Service v1 (ADK)",
    description="Legal citation research using Google ADK + Claude + Serper + Indian Kanoon",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Request / Response bodies
# ---------------------------------------------------------------------------

class ReportRequest(BaseModel):
    query: str
    user_id: str = "anonymous"
    case_id: Optional[str] = None
    case_file_context: Optional[List[Dict[str, Any]]] = None
    perspective: str = "all"
    retrieval_method: str = "serper"
    use_pipeline: bool = True


class ShareRequest(BaseModel):
    shared_with: List[str]


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

@app.get("/health")
async def health():
    return {"status": "ok", "service": "citation-v1", "version": "1.0.0"}


@app.get("/")
async def root():
    return {"service": "citation-service-v1", "docs": "/docs"}


# ---------------------------------------------------------------------------
# Citation report — synchronous (blocks until complete)
# ---------------------------------------------------------------------------

@app.post("/citation/report")
async def generate_report(req: ReportRequest):
    """Generate a citation report synchronously. Returns full report when done."""
    if not req.query.strip():
        raise HTTPException(status_code=400, detail="query must not be empty")

    try:
        result = await run_pipeline(
            query=req.query.strip(),
            user_id=req.user_id or "anonymous",
            case_id=req.case_id,
            perspective=req.perspective,
        )
        return {
            "success": True,
            "report_id": result["report_id"],
            "report_format": result["report_format"],
            "case_id": req.case_id,
            "run_id": result["run_id"],
            "service_version": "v1-adk",
        }
    except Exception as exc:
        logger.exception("Pipeline failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


# ---------------------------------------------------------------------------
# Citation report — async (start + poll pattern)
# ---------------------------------------------------------------------------

@app.post("/citation/report/start")
async def start_report(req: ReportRequest):
    """Start citation pipeline in background. Returns run_id immediately."""
    query = req.query.strip() or (req.case_id and f"Find relevant citations for case {req.case_id}") or ""
    if not query:
        raise HTTPException(status_code=400, detail="query must not be empty")

    run_id = await start_pipeline_background(
        query=query,
        user_id=req.user_id or "anonymous",
        case_id=req.case_id,
        perspective=req.perspective,
    )
    return {"run_id": run_id, "status": "running"}


@app.get("/citation/runs/{run_id}/status")
async def get_run_status(run_id: str):
    """Poll run status. Returns status, progress, report_format when completed."""
    state = get_run_state(run_id)
    if not state:
        return JSONResponse(status_code=404, content={"status": "not_found", "run_id": run_id})
    return {
        "run_id": run_id,
        "status": state.get("status", "unknown"),
        "progress": state.get("progress", 0),
        "stage": state.get("stage", ""),
        "report_id": state.get("report_id"),
        "report_format": state.get("report_format"),
        "error": state.get("error"),
    }


@app.get("/citation/runs/{run_id}/logs")
async def get_run_logs(
    run_id: str,
    since_time: str = Query(default="", alias="since_time"),
    limit: int = Query(default=200),
):
    """Incremental log streaming for run progress UI."""
    logs = get_pipeline_logs(run_id, since_time=since_time or None)
    return {"run_id": run_id, "logs": logs[:limit]}


# ---------------------------------------------------------------------------
# Reports CRUD
# ---------------------------------------------------------------------------

@app.get("/citation/reports")
async def list_user_reports(
    user_id: str = Query(...),
    case_id: Optional[str] = Query(default=None),
):
    reports = await list_reports(user_id=user_id, case_id=case_id)
    return {"reports": reports, "total": len(reports)}


@app.get("/citation/reports/team")
async def get_team_reports_endpoint(
    user_id: str = Query(default=""),
    case_id: Optional[str] = Query(default=None),
    member_ids: str = Query(default=""),
    account_type: str = Query(default=""),
):
    ids = [m.strip() for m in member_ids.split(",") if m.strip()] if member_ids else []
    reports = await get_team_reports(user_id=user_id, case_id=case_id, member_ids=ids)
    return {"reports": reports}


@app.get("/citation/reports/{report_id}")
async def get_one_report(report_id: str):
    report = await get_report(report_id)
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    return report


@app.delete("/citation/reports/{report_id}")
async def remove_report(report_id: str, user_id: Optional[str] = Query(default=None)):
    deleted = await delete_report(report_id, user_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Report not found or permission denied")
    return {"deleted": True, "report_id": report_id}


# ---------------------------------------------------------------------------
# Report sharing
# ---------------------------------------------------------------------------

@app.post("/citation/reports/{report_id}/share")
async def share_report(report_id: str, body: ShareRequest):
    await update_report_shared_with(report_id, body.shared_with)
    return {"shared": True, "report_id": report_id, "shared_with": body.shared_with}


@app.get("/citation/reports/{report_id}/shares")
async def get_shares(report_id: str):
    shared_with = await get_report_shares(report_id)
    return {"report_id": report_id, "shared_with": shared_with}


# ---------------------------------------------------------------------------
# Judgment full-text
# ---------------------------------------------------------------------------

@app.get("/citation/judgements/{canonical_id}/full-text")
async def get_judgment_full_text(canonical_id: str):
    """Fetch full text of a judgment by canonical_id (e.g. 'ik:123456' or URL)."""
    from tools.judgment_fetcher import fetch_judgment_text
    result = await fetch_judgment_text(canonical_id)
    if not result or not result.get("full_text"):
        raise HTTPException(status_code=404, detail="Judgment not found")
    return result


# ---------------------------------------------------------------------------
# Search
# ---------------------------------------------------------------------------

@app.get("/citation/judgements/search")
async def search_judgements(
    q: str = Query(default=""),
    court: str = Query(default=""),
    area: str = Query(default=""),
    limit: int = Query(default=20),
):
    if not q:
        return {"results": [], "total": 0}
    query = q
    if court:
        query += f" {court}"
    if area:
        query += f" {area}"
    result = await search_indian_kanoon(query, page_num=0)
    return {"results": result.get("results", [])[:limit], "total": result.get("total", 0)}


# ---------------------------------------------------------------------------
# Citation graph (stub — Neo4j not used in v1)
# ---------------------------------------------------------------------------

@app.get("/citation/cases/{canonical_id}/graph")
async def get_citation_graph(canonical_id: str):
    """IK cite/cited-by graph for a judgment."""
    if canonical_id.startswith("ik:"):
        from tools.ik_search import fetch_ik_citations
        data = await fetch_ik_citations(canonical_id)
        nodes = [{"id": canonical_id, "type": "root"}]
        edges = []
        for c in data.get("cites", [])[:10]:
            nid = f"ik:{c.get('tid', '')}"
            nodes.append({"id": nid, "title": c.get("title", ""), "type": "cites"})
            edges.append({"from": canonical_id, "to": nid, "type": "cites"})
        for c in data.get("cited_by", [])[:10]:
            nid = f"ik:{c.get('tid', '')}"
            nodes.append({"id": nid, "title": c.get("title", ""), "type": "cited_by"})
            edges.append({"from": nid, "to": canonical_id, "type": "cited_by"})
        return {"nodes": nodes, "edges": edges}
    return {"nodes": [], "edges": []}


# ---------------------------------------------------------------------------
# Analytics stubs (compatible interface)
# ---------------------------------------------------------------------------

@app.get("/citation/analytics/enterprise")
async def enterprise_analytics(days: int = Query(default=30), months: int = Query(default=6)):
    return {"service": "v1-adk", "days": days, "months": months, "note": "analytics not yet implemented"}


@app.get("/citation/analytics/usage")
async def usage_analytics(days: int = Query(default=30), scope: str = Query(default="firm")):
    return {"service": "v1-adk", "days": days, "scope": scope, "note": "analytics not yet implemented"}


# ---------------------------------------------------------------------------
# HITL stub
# ---------------------------------------------------------------------------

@app.post("/citation/hitl/{ticket_id}/notify")
async def hitl_notify(ticket_id: str, body: Dict[str, Any] = {}):
    return {"success": True, "ticket_id": ticket_id}


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host=os.getenv("API_HOST", "0.0.0.0"),
        port=int(os.getenv("API_PORT", "8002")),
        reload=os.getenv("DEBUG", "false").lower() == "true",
        log_level="info",
    )
