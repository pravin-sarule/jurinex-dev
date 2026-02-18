"""
FastAPI app for JuriNex Agent Draft Service.

Routers (each agent/domain in its own file):
- api/template_routes  — Template gallery (list, get, preview image).
- api/draft_routes     — Drafts (create, list, get, update, attach-case, template fields).
- api/section_routes   — Section generation (Drafter + Critic): generate, refine, get sections.
- api/ingestion_routes — Ingestion agent: POST /api/ingest, POST /api/orchestrate/upload.
- api/librarian_routes — Librarian agent: POST /api/retrieve, POST /api/orchestrate/retrieve, GET /api/test/librarian.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any, Dict

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Logging: show orchestrator → agent task in console
logging.basicConfig(level=logging.INFO, format="%(levelname)s [%(name)s] %(message)s")
logging.getLogger("agents.orchestrator.agent").setLevel(logging.INFO)

# Load .env from agent-draft-service root
_project_root = Path(__file__).resolve().parent.parent
load_dotenv(_project_root / ".env")

app = FastAPI(
    title="JuriNex Agent Draft Service",
    description="Ingestion (GCS → Document AI → chunk → embed → DB), Librarian (retrieve), templates & drafts.",
    version="1.0.1",
)

# Force reload trigger: v2.5 migration
app.state.migration_version = "2.5.pro.v1"

# CORS
_allowed_origins = os.environ.get("CORS_ORIGINS", "http://localhost:5173,http://localhost:3000").strip().split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in _allowed_origins if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Request logging
_request_logger = logging.getLogger("api.request")


@app.middleware("http")
async def log_requests(request, call_next):
    """Log every incoming request (method + path)."""
    _request_logger.info("API called: %s %s", request.method, request.url.path)
    return await call_next(request)


# --- Routers (each agent/domain in separate file) ---
from api import (
    agent_routes,
    draft_routes,
    ingestion_routes,
    librarian_routes,
    section_routes,
    template_routes,
    universal_sections_routes,
    assemble_routes,
)

app.include_router(agent_routes.router)
app.include_router(template_routes.router)
app.include_router(draft_routes.router)
app.include_router(section_routes.router)
app.include_router(universal_sections_routes.router)
app.include_router(assemble_routes.router)
app.include_router(ingestion_routes.router)
app.include_router(librarian_routes.router)


# --- Core endpoints (root, health, endpoint list) ---
@app.get("/")
def root() -> Dict[str, Any]:
    return {
        "service": "JuriNex Agent Draft Service",
        "docs": "/docs",
        "ingest": "POST /api/ingest (Bearer JWT; file)",
        "orchestrate_upload": "POST /api/orchestrate/upload (Bearer JWT; file)",
        "retrieve": "POST /api/retrieve (Bearer JWT; query)",
        "orchestrate_retrieve": "POST /api/orchestrate/retrieve (Bearer JWT; query → Librarian)",
        "test_librarian": "GET /api/test/librarian",
        "templates": "GET /api/templates",
        "template_by_id": "GET /api/templates/{template_id}",
        "template_preview_image": "GET /api/templates/{template_id}/preview-image",
    }


@app.get("/health")
def health() -> Dict[str, str]:
    return {"status": "ok"}


@app.get("/api/endpoints")
def list_test_endpoints() -> Dict[str, Any]:
    """List endpoints for testing Orchestrator → Ingestion and Librarian."""
    base = "http://localhost:8000"
    return {
        "description": "Test Orchestrator → Ingestion (upload) and Orchestrator → Librarian (retrieve).",
        "endpoints": [
            {
                "name": "Orchestrator + Ingestion (upload)",
                "method": "POST",
                "path": "/api/orchestrate/upload",
                "url": f"{base}/api/orchestrate/upload",
                "body": "form-data",
                "fields": {"file": "required", "folder_path": "optional", "draft_id": "optional", "case_id": "optional"},
                "flow": "Upload → Orchestrator → Ingestion → GCS → Document AI → chunk → embed → DB.",
            },
            {
                "name": "Ingestion only (no orchestrator)",
                "method": "POST",
                "path": "/api/ingest",
                "url": f"{base}/api/ingest",
                "body": "form-data",
                "fields": {"file": "required", "user_id": "from JWT", "folder_path": "optional"},
                "flow": "Direct: GCS → Document AI → chunk → embed → DB.",
            },
            {
                "name": "Librarian (retrieve)",
                "method": "POST",
                "path": "/api/retrieve",
                "url": f"{base}/api/retrieve",
                "body": "JSON",
                "fields": {"query": "required", "file_ids": "optional", "top_k": "optional", "draft_id": "optional"},
                "flow": "Query → Librarian → embed → vector search → top-k chunks.",
            },
            {
                "name": "Orchestrator + Librarian (retrieve)",
                "method": "POST",
                "path": "/api/orchestrate/retrieve",
                "url": f"{base}/api/orchestrate/retrieve",
                "body": "JSON",
                "fields": {"query": "required", "file_ids": "optional", "top_k": "optional", "draft_id": "optional"},
                "flow": "Query → Orchestrator → Librarian → chunks, context, agent_tasks.",
            },
        ],
        "test_order": "1) POST /api/orchestrate/upload with a PDF. 2) POST /api/orchestrate/retrieve or /api/retrieve with query.",
    }
