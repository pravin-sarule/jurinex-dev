"""Agentic Document Service client — fetch case context for the pipeline."""
from __future__ import annotations

import os
from typing import Any, Dict, List, Optional

import httpx

_DOC_SERVICE_URL = os.getenv("DOCUMENT_SERVICE_URL", "http://localhost:8092")
_TIMEOUT = 30.0


async def fetch_case_context(
    case_id: str,
    user_id: str = "anonymous",
    query: Optional[str] = None,
) -> Dict[str, Any]:
    """Query the agentic-document-service for case context.

    Calls POST /api/v1/cases/{case_id}/query with the user's citation query
    so we get the most relevant chunks from the case documents.

    Returns:
        {
          "case_id": str,
          "title": str,
          "facts": str,
          "issues": str,
          "acts": [...],
          "parties": {...},
          "jurisdiction": str,
          "raw_chunks": [...]
        }
    """
    if not case_id or case_id == "none":
        return {}

    effective_query = query or "relevant facts, legal issues, statutes and parties of this case"

    payload = {
        "user_id": user_id,
        "case_id": case_id,
        "query": effective_query,
        "top_k": 10,
    }

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.post(
                f"{_DOC_SERVICE_URL}/api/v1/cases/{case_id}/query",
                json=payload,
            )
            resp.raise_for_status()
            data = resp.json()
    except httpx.HTTPError as exc:
        # Non-fatal — pipeline can still run without document context
        return {"error": str(exc), "case_id": case_id}

    # Normalise the response into a flat context dict
    answer = data.get("answer", "")
    sources = data.get("sources", [])

    return {
        "case_id": case_id,
        "answer": answer,
        "raw_chunks": sources[:10],
        "facts": answer[:3000] if answer else "",
        "metadata": data.get("metadata", {}),
    }


async def list_cases(user_id: str) -> List[Dict[str, Any]]:
    """List cases for a user from the agentic document service."""
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.get(
                f"{_DOC_SERVICE_URL}/api/v1/cases",
                params={"user_id": user_id},
            )
            resp.raise_for_status()
            return resp.json().get("cases", [])
    except httpx.HTTPError:
        return []


async def fetch_case_metadata(case_id: str) -> Dict[str, Any]:
    """Fetch metadata for a single case."""
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.get(f"{_DOC_SERVICE_URL}/api/v1/cases/{case_id}")
            resp.raise_for_status()
            return resp.json()
    except httpx.HTTPError:
        return {"case_id": case_id}
