"""
Librarian Agent (ADK-style): research and fetch relevant chunks for the orchestrator.

When the orchestrator asks for research or to fetch relevant chunks for specific content,
the Librarian uses the fetch_relevant_chunks tool to search the vector database and
returns the top-k chunks to the orchestrator. The Librarian only fetches and reports—no
content generation. Per ADK: the agent uses a tool (fetch_relevant_chunks) and
reports the tool result back.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from agents.librarian.tools import fetch_relevant_chunks
from services.embedding_service import generate_embeddings

logger = logging.getLogger(__name__)

DEFAULT_TOP_K = int(__import__("os").environ.get("LIBRARIAN_TOP_K", "10"))


def run_librarian_agent(payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    Run the Librarian agent: use fetch_relevant_chunks tool and report to orchestrator.

    When the orchestrator asks for research or to fetch relevant chunks for specific
    content, the agent calls the fetch_relevant_chunks tool and returns the result.
    No content generation—only tool use and report (ADK-style).

    Payload (from orchestrator):
      - user_id: int (required). From JWT (decoded.id). User-specific and document-specific only.
      - query or raw_text: str (required). User question or evidence request.
      - file_ids or file_ids_list: list[str] (optional). Restrict search to these file UUIDs (user's only).
      - top_k or limit: int (optional). Number of chunks (default LIBRARIAN_TOP_K or 10).

    Returns (to orchestrator):
      - chunks: list of {content, file_id, page_start, page_end, heading, similarity, chunk_id}
      - context: concatenation of retrieved chunk content (for downstream use; not generated)
      - raw_text: same as context (orchestrator compatibility)
      - embeddings: [query_embedding] for state compatibility
    """
    user_id = payload.get("user_id")
    if user_id is None:
        logger.warning("Librarian: user_id required for user-specific retrieval")
        return {"chunks": [], "context": "", "raw_text": "", "embeddings": [], "error": "user_id required (from JWT)."}
    try:
        user_id = int(user_id)
    except (TypeError, ValueError):
        return {"chunks": [], "context": "", "raw_text": "", "embeddings": [], "error": "user_id must be numeric (from JWT)."}

    query = (payload.get("query") or payload.get("raw_text") or "").strip()
    if not query:
        return {"chunks": [], "context": "", "raw_text": "", "embeddings": []}

    file_ids = payload.get("file_ids") or payload.get("file_ids_list")
    if isinstance(file_ids, str):
        file_ids = [f.strip() for f in file_ids.split(",") if f.strip()]
    top_k = int(payload.get("top_k") or payload.get("limit") or DEFAULT_TOP_K)
    top_k = max(1, min(top_k, 50))

    # Use the tool (ADK-style: agent uses tool to perform the task); user-specific only
    result = fetch_relevant_chunks(query=query, user_id=user_id, file_ids=file_ids, top_k=top_k)

    if result.get("status") == "error":
        logger.warning("Librarian: tool returned error: %s", result.get("error_message"))
        return {
            "chunks": [],
            "context": "",
            "raw_text": "",
            "embeddings": [],
            "error": result.get("error_message", "Tool failed."),
        }

    chunks = result.get("chunks", [])
    
    # Fetch filenames for chunks to provide source context
    file_ids_in_chunks = list(set(c["file_id"] for c in chunks if c.get("file_id")))
    from services.db import get_filenames_by_ids
    file_map = get_filenames_by_ids(file_ids_in_chunks)

    # Build context with source attribution
    context_parts = []
    for c in chunks:
        fname = file_map.get(str(c.get("file_id")), "Unknown Source")
        content = c.get("content", "").strip()
        if content:
            context_parts.append(f"[Source: {fname}]\n{content}")
    
    context = "\n\n---\n\n".join(context_parts)

    # Query embedding for orchestrator state (optional)
    query_embedding: List[float] = []
    try:
        embs = generate_embeddings([query])
        if embs and embs[0]:
            query_embedding = embs[0]
    except Exception:
        pass

    logger.info("Librarian: reported %s chunks to orchestrator (top_k=%s)", len(chunks), top_k)
    return {
        "chunks": chunks,
        "context": context,
        "raw_text": context,
        "embeddings": [query_embedding] if query_embedding else [],
    }
