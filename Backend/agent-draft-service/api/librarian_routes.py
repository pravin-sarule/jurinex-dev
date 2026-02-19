"""
Librarian agent API: retrieve chunks (direct and via orchestrator).
POST /api/retrieve — Direct Librarian (embed query → vector search → top-k chunks).
POST /api/orchestrate/retrieve — Orchestrator → Librarian.
GET /api/test/librarian — Test info and example request bodies.
When a case is attached to the draft, send only draft_id + query; case folder file_ids are resolved automatically.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Body, Depends, HTTPException

from api.deps import require_user_id
from api.orchestrator_helpers import get_orchestrator
from services import draft_db as draft_db_service
from services.db import get_file_ids_for_case

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["Librarian"])


def _resolve_retrieve_file_ids(
    file_ids: Optional[List[str]],
    case_id: Optional[str],
    draft_id: Optional[str],
    user_id: int,
) -> List[str]:
    """
    Resolve file_ids for retrieve so each draft gets ONLY its own stored context.
    Draft context = files and case stored on that draft (draft_field_data.metadata):
    - case_id → case folder file_ids (from document service)
    - uploaded_file_ids → files uploaded for this draft
    When draft_id is provided we use ONLY that draft's case_id + uploaded_file_ids (union).
    """
    draft_id = (draft_id or "").strip() or None
    case_id = (case_id or "").strip() or None

    # When draft_id is provided: use ONLY this draft's stored context (case + uploaded files)
    if draft_id:
        try:
            draft_field_data = draft_db_service.get_draft_field_data_for_retrieve(draft_id, user_id)
            meta = (draft_field_data or {}).get("metadata") or {}
            combined: List[str] = []

            # 1) Case stored on this draft → add case folder file_ids
            draft_case_id = (meta.get("case_id") or "").strip() or None
            if draft_case_id:
                case_file_ids = get_file_ids_for_case(draft_case_id, user_id)
                for f in case_file_ids:
                    if f and f not in combined:
                        combined.append(f)
                logger.info(
                    "Retrieve for draft_id=%s: case_id=%s → %s case file(s)",
                    draft_id, draft_case_id, len(case_file_ids),
                )

            # 2) Files uploaded for this draft → add uploaded_file_ids
            uploaded = draft_db_service.get_draft_uploaded_file_ids(draft_id, user_id)
            for f in uploaded:
                if f and f not in combined:
                    combined.append(f)
            if uploaded:
                logger.info(
                    "Retrieve for draft_id=%s: %s uploaded file(s) → total %s file(s) (draft-scoped)",
                    draft_id, len(uploaded), len(combined),
                )

            if not combined:
                logger.info(
                    "Retrieve for draft_id=%s: no case and no uploaded files → 0 file_ids (draft-scoped)",
                    draft_id,
                )
            return combined
        except Exception as e:
            logger.warning("_resolve_retrieve_file_ids draft_id=%s failed: %s", draft_id, e)
            return []

    # No draft_id: allow request file_ids and/or case_id
    if not case_id:
        return list(dict.fromkeys(f for f in (file_ids or []) if f))
    combined = list(dict.fromkeys(f for f in (file_ids or []) if f))
    case_file_ids = get_file_ids_for_case(case_id, user_id)
    for fid in case_file_ids:
        if fid and fid not in combined:
            combined.append(fid)
    return combined


def _attach_draft_field_data(out: Dict[str, Any], draft_id: Optional[str], user_id: int) -> None:
    """Add merged field_values (autopopulated + draft) and draft_field_data when draft_id is provided.
    Merged field_values so Drafter gets all data (petitioner name, court name, etc.) and avoids [] or blank placeholders.
    """
    if not draft_id:
        return
    _did = str(draft_id or "").strip()
    if not _did:
        return
    try:
        draft_field_data = draft_db_service.get_draft_field_data_for_retrieve(_did, user_id)
        if draft_field_data is not None:
            out["draft_field_data"] = draft_field_data
            merged = draft_db_service.get_merged_field_values_for_draft(_did, user_id)
            out["field_values"] = merged if merged else draft_field_data.get("field_values", {})
    except Exception:
        pass


@router.post("/retrieve")
async def retrieve_chunks(
    user_id: int = Depends(require_user_id),
    query: str = Body(..., embed=True),
    file_ids: Optional[List[str]] = Body(None, embed=True),
    top_k: int = Body(10, embed=True),
    draft_id: Optional[str] = Body(None, embed=True),
    case_id: Optional[str] = Body(None, embed=True),
) -> Dict[str, Any]:
    """
    Run the Librarian agent: user-specific chunks; vector search returns top-k relevant chunks.
    When a case is attached to the draft: send only draft_id and query — no need to pass file_ids.
    **Body (JSON):** query (required), optional: draft_id, top_k, file_ids, case_id.
    """
    merged_file_ids = _resolve_retrieve_file_ids(file_ids, case_id, draft_id, user_id)
    payload: Dict[str, Any] = {
        "user_id": user_id,
        "query": (query or "").strip(),
        "top_k": max(1, min(top_k, 50)),
    }
    # Always pass file_ids so draft-scoped empty list returns no chunks (not all user chunks)
    payload["file_ids"] = merged_file_ids if merged_file_ids is not None else (file_ids or [])

    if not payload.get("query"):
        raise HTTPException(status_code=400, detail="query is required and must be non-empty")

    try:
        from agents.librarian.agent import run_librarian_agent
        result = run_librarian_agent(payload)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e

    if result.get("error"):
        raise HTTPException(status_code=500, detail=result["error"])

    chunks = result.get("chunks", [])
    context = result.get("context", "")
    out: Dict[str, Any] = {
        "success": True,
        "chunks_count": len(chunks),
        "chunks": chunks,
        "context": context,
        "message": f"Retrieved {len(chunks)} relevant chunk(s) for the query.",
        "field_values": {},
        "draft_field_data": None,
    }
    _attach_draft_field_data(out, draft_id, user_id)
    return out


@router.post("/orchestrate/retrieve")
async def orchestrate_retrieve(
    user_id: int = Depends(require_user_id),
    query: str = Body(..., embed=True),
    file_ids: Optional[List[str]] = Body(None, embed=True),
    top_k: int = Body(10, embed=True),
    draft_id: Optional[str] = Body(None, embed=True),
    case_id: Optional[str] = Body(None, embed=True),
) -> Dict[str, Any]:
    """
    Orchestrator → Librarian: embed query, vector search, return top-k chunks.
    When a case is attached to the draft: send only draft_id and query — no file_ids needed.
    **Body (JSON):** query (required), optional: draft_id, top_k, file_ids, case_id.
    """
    merged_file_ids = _resolve_retrieve_file_ids(file_ids, case_id, draft_id, user_id)
    query_payload: Dict[str, Any] = {
        "user_id": user_id,
        "query": (query or "").strip(),
        "top_k": max(1, min(top_k, 50)),
    }
    # Always pass file_ids so draft-scoped empty list returns no chunks (not all user chunks)
    query_payload["file_ids"] = merged_file_ids if merged_file_ids is not None else (file_ids or [])

    if not query_payload.get("query"):
        raise HTTPException(status_code=400, detail="query is required and must be non-empty")

    try:
        orchestrator = get_orchestrator(ingestion_only=False, retrieve_only=True)
        result = orchestrator.run(query_payload=query_payload)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e

    chunks = result.get("chunks", [])
    context = result.get("context", "")
    state = result.get("state", {})
    agent_tasks = result.get("agent_tasks", [])
    out: Dict[str, Any] = {
        "success": True,
        "retrieve_only": True,
        "chunks_count": len(chunks),
        "chunks": chunks,
        "context": context,
        "state": state,
        "agent_tasks": agent_tasks,
        "message": "Orchestrator ran Librarian only: query → embed → vector search → top-k chunks.",
        "field_values": {},
        "draft_field_data": None,
    }
    _attach_draft_field_data(out, draft_id, user_id)
    return out


@router.get("/test/librarian")
def test_librarian_info() -> Dict[str, Any]:
    """How to test the Librarian agent (direct or via orchestrator). All endpoints require Authorization: Bearer <JWT>."""
    base = "http://localhost:8000"
    return {
        "description": "Test the Librarian agent (direct or via orchestrator). User-specific and document-specific only.",
        "auth": "Header: Authorization: Bearer <JWT>. JWT_SECRET must match authservice. user_id from JWT (payload.id).",
        "endpoints": [
            {
                "name": "Direct Librarian (no orchestrator)",
                "method": "POST",
                "url": f"{base}/api/retrieve",
                "headers": "Authorization: Bearer <JWT> (required)",
                "body": "JSON",
                "example_body": {"query": "What are the key terms of the contract?", "top_k": 10},
                "curl": f'curl -X POST "{base}/api/retrieve" -H "Authorization: Bearer YOUR_JWT" -H "Content-Type: application/json" -d \'{{"query": "What are the key terms?", "top_k": 10}}\'',
            },
            {
                "name": "Librarian via Orchestrator (shows agent_tasks)",
                "method": "POST",
                "url": f"{base}/api/orchestrate/retrieve",
                "headers": "Authorization: Bearer <JWT> (required)",
                "body": "JSON",
                "example_body": {"query": "What are the key terms?", "top_k": 10, "draft_id": "optional-draft-uuid"},
                "curl": f'curl -X POST "{base}/api/orchestrate/retrieve" -H "Authorization: Bearer YOUR_JWT" -H "Content-Type: application/json" -d \'{{"query": "What are the key terms?", "top_k": 10, "draft_id": "YOUR_DRAFT_ID"}}\'',
                "response_includes": "agent_tasks: list of { from: 'orchestrator', to: 'librarian', task: '...', payload_summary: {...} }.",
            },
        ],
        "agent_tasks_explained": "Each item in agent_tasks shows: 'from' (orchestrator), 'to' (agent name), 'task' (description), 'payload_summary'.",
    }
