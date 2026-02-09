"""
Librarian agent tools (in agents folder).

When the orchestrator asks the Librarian for research or to fetch relevant chunks,
the Librarian uses fetch_relevant_chunks to search the vector store and return chunks.
Tools execute predefined logic; they do not generate content.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from services.db import find_nearest_chunks
from services.embedding_service import generate_embeddings

logger = logging.getLogger(__name__)


def fetch_relevant_chunks(
    query: str,
    user_id: int,
    file_ids: Optional[List[str]] = None,
    top_k: int = 10,
) -> Dict[str, Any]:
    """
    Fetch the most relevant document chunks from the vector database for a given query.
    User-specific: only chunks from this user's documents. Use JWT-decoded user id.

    Args:
        query: User question or evidence request. Used to embed and search for similar chunks.
        user_id: Numeric user id from JWT. Only this user's document chunks are returned.
        file_ids: Optional list of file UUIDs to restrict the search to (must belong to user_id).
        top_k: Number of chunks to return (1–50). Default 10.

    Returns:
        On success: { status: 'success', chunks: [...], context: str, count: int }
        On failure: { status: 'error', error_message: str }
    """
    query = (query or "").strip()
    if not query:
        return {"status": "error", "error_message": "query is required and must be non-empty."}
    
    logger.info(f"[Librarian Tool] Called with query='{query[:100]}...', user_id={user_id}, file_ids={file_ids}, top_k={top_k}")
    
    try:
        uid = int(user_id)
    except (TypeError, ValueError):
        return {"status": "error", "error_message": "user_id is required (numeric, from JWT) for user-specific retrieval."}

    top_k = max(1, min(int(top_k), 50))
    if isinstance(file_ids, str):
        file_ids = [f.strip() for f in file_ids.split(",") if f.strip()]

    # Explicit empty list: this draft has no case and no uploaded files → return no chunks
    if file_ids is not None and isinstance(file_ids, list) and len(file_ids) == 0:
        logger.warning(f"[Librarian Tool] file_ids=[] (draft-scoped, no files attached) → returning 0 chunks")
        return {
            "status": "success",
            "chunks": [],
            "context": "",
            "count": 0,
        }
    
    if file_ids:
        logger.info(f"[Librarian Tool] Searching in {len(file_ids)} files: {file_ids[:5] if len(file_ids) > 5 else file_ids}")

    try:
        embeddings = generate_embeddings([query])
        if not embeddings or not embeddings[0]:
            logger.warning("Librarian tool: no embedding for query")
            return {"status": "error", "error_message": "Could not embed query."}

        rows = find_nearest_chunks(
            embedding=embeddings[0],
            limit=top_k,
            file_ids=file_ids,
            user_id=uid,
        )
        
        logger.info(f"[Librarian Tool] find_nearest_chunks returned {len(rows)} rows")

        chunks: List[Dict[str, Any]] = []
        for r in rows:
            chunks.append({
                "chunk_id": r.get("chunk_id"),
                "content": r.get("content") or "",
                "file_id": r.get("file_id"),
                "page_start": r.get("page_start"),
                "page_end": r.get("page_end"),
                "heading": r.get("heading"),
                "similarity": float(r.get("similarity") or 0),
                "distance": float(r.get("distance") or 0),
            })

        context = "\n\n".join(c.get("content", "") for c in chunks if c.get("content"))
        
        unique_files = list(set(c.get("file_id") for c in chunks if c.get("file_id")))
        logger.info(f"[Librarian Tool] Fetched {len(chunks)} chunks from {len(unique_files)} files, context length: {len(context)} chars")
        
        return {
            "status": "success",
            "chunks": chunks,
            "context": context,
            "count": len(chunks),
        }
    except Exception as e:
        logger.exception("Librarian tool failed: %s", e)
        return {"status": "error", "error_message": str(e)}
