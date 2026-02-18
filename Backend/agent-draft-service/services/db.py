"""
Document_DB: PostgreSQL connection and repository for document content.

All document content (user_files, file_chunks, chunk_vectors, cases) is stored in
Document_DB. This module fetches from it for:
- Ingestion: save file metadata, chunks, embeddings (chunk_vectors)
- Librarian: find_nearest_chunks, get_file_ids_for_case

Set DOCUMENT_DATABASE_URL (or DATABASE_URL) in .env to the Document_DB connection string.
"""

from __future__ import annotations

import os
import re
import uuid
from contextlib import contextmanager
from typing import Any, Dict, List, Optional, Tuple

import psycopg2
from psycopg2.extras import execute_values, RealDictCursor


def get_connection_string() -> str:
    """Document_DB connection: DOCUMENT_DATABASE_URL or DATABASE_URL."""
    url = os.environ.get("DOCUMENT_DATABASE_URL") or os.environ.get("DATABASE_URL")
    if not url:
        raise ValueError("DOCUMENT_DATABASE_URL or DATABASE_URL must be set (Document_DB)")
    return url


@contextmanager
def get_conn():
    """Connection to Document_DB (user_files, file_chunks, chunk_vectors, cases)."""
    conn = psycopg2.connect(get_connection_string())
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def ensure_file_record(
    user_id: str,
    originalname: str,
    gcs_path: str,
    folder_path: str,
    mimetype: str,
    size: int,
    file_id: Optional[str] = None,
    status: str = "uploaded",
) -> str:
    """Insert or get file_id. Returns file_id (UUID). Mirrors File.create / documentModel.saveFileMetadata."""
    fid = file_id or str(uuid.uuid4())
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO user_files
                  (id, user_id, originalname, gcs_path, folder_path, mimetype, size, is_folder, status, processing_progress, current_operation)
                VALUES (%s, %s, %s, %s, %s, %s, %s, FALSE, %s, 0.00, 'Pending')
                ON CONFLICT (id) DO UPDATE SET
                  gcs_path = EXCLUDED.gcs_path,
                  status = EXCLUDED.status,
                  updated_at = NOW()
                RETURNING id
                """,
                (fid, user_id, originalname, gcs_path, folder_path or "", mimetype, size, status),
            )
            row = cur.fetchone()
            return str(row[0]) if row else fid


def update_file_status(file_id: str, status: str, progress: Optional[float] = None, operation: Optional[str] = None) -> None:
    """Mirrors documentModel.updateFileStatus / updateProgressWithOperation."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            if progress is not None and operation is not None:
                cur.execute(
                    """
                    UPDATE user_files
                    SET status = %s, processing_progress = %s, current_operation = %s, updated_at = NOW()
                    WHERE id = %s
                    """,
                    (status, progress, operation, file_id),
                )
            else:
                cur.execute(
                    "UPDATE user_files SET status = %s, updated_at = NOW() WHERE id = %s",
                    (status, file_id),
                )


def update_file_full_text(file_id: str, full_text: str) -> None:
    """Mirrors documentModel.updateFileFullTextContent."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE user_files SET full_text_content = %s, updated_at = NOW() WHERE id = %s",
                (full_text, file_id),
            )


def update_file_processed(file_id: str) -> None:
    """Mirrors documentModel.updateFileProcessedAt."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE user_files
                SET processed_at = NOW(), status = 'processed', processing_progress = 100.00, current_operation = 'Completed'
                WHERE id = %s
                """,
                (file_id,),
            )


def save_chunks(
    file_id: str,
    chunks: List[Dict[str, Any]],
) -> List[Tuple[str, int]]:
    """
    Insert file_chunks. chunks: list of {content, token_count, page_start, page_end, heading}.
    Returns list of (chunk_id, chunk_index). Mirrors FileChunk.saveMultipleChunks.
    """
    if not chunks:
        return []
    BATCH = 100
    out: List[Tuple[str, int]] = []
    with get_conn() as conn:
        with conn.cursor() as cur:
            for start in range(0, len(chunks), BATCH):
                batch = chunks[start : start + BATCH]
                for i, c in enumerate(batch):
                    idx = start + i
                    cur.execute(
                        """
                        INSERT INTO file_chunks (file_id, chunk_index, content, token_count, page_start, page_end, heading)
                        VALUES (%s::uuid, %s, %s, %s, %s, %s, %s)
                        RETURNING id, chunk_index
                        """,
                        (
                            file_id,
                            idx,
                            c.get("content", ""),
                            c.get("token_count", 0),
                            c.get("page_start"),
                            c.get("page_end"),
                            c.get("heading"),
                        ),
                    )
                    row = cur.fetchone()
                    if row:
                        out.append((str(row[0]), row[1]))
    return out


def save_chunk_vectors(
    vectors: List[Dict[str, Any]],
) -> None:
    """
    vectors: list of {chunk_id, embedding: list[float], file_id}.
    Mirrors ChunkVector.saveMultipleChunkVectors.
    """
    if not vectors:
        return
    with get_conn() as conn:
        with conn.cursor() as cur:
            for v in vectors:
                chunk_id = v["chunk_id"]
                emb = v["embedding"]
                file_id = v["file_id"]
                emb_str = "[" + ",".join(str(x) for x in emb) + "]"
                cur.execute(
                    """
                    INSERT INTO chunk_vectors (chunk_id, embedding, file_id)
                    VALUES (%s::uuid, %s::vector, %s::uuid)
                    ON CONFLICT (chunk_id) DO UPDATE SET
                      embedding = EXCLUDED.embedding,
                      file_id = EXCLUDED.file_id,
                      updated_at = NOW()
                    """,
                    (chunk_id, emb_str, file_id),
                )


def find_nearest_chunks(
    embedding: List[float],
    limit: int = 5,
    file_ids: Optional[List[str]] = None,
    user_id: Optional[int] = None,
) -> List[Dict[str, Any]]:
    """
    Vector search: return top-k chunks by similarity (pgvector <=>).
    User-specific and document-specific: only chunks from files belonging to user_id
    (via user_files). If file_ids provided, still restricted to that user's files.
    Returns list of {chunk_id, content, file_id, page_start, page_end, heading, distance, similarity}.
    """
    import logging
    logger = logging.getLogger(__name__)
    
    if user_id is None:
        raise ValueError("user_id is required for user-specific retrieval; do not return random chunks from other users")
    if not embedding or not isinstance(embedding, list) or len(embedding) == 0:
        raise ValueError("Invalid embedding for vector search")
    emb_str = "[" + ",".join(str(float(x)) for x in embedding) + "]"

    query = """
        SELECT
            cv.chunk_id,
            fc.content,
            fc.file_id,
            fc.page_start,
            fc.page_end,
            fc.heading,
            (cv.embedding <=> %s::vector) AS distance,
            (1 / (1 + (cv.embedding <=> %s::vector))) AS similarity
        FROM chunk_vectors cv
        INNER JOIN file_chunks fc ON cv.chunk_id = fc.id
        INNER JOIN user_files uf ON fc.file_id = uf.id
    """
    params: List[Any] = [emb_str, emb_str]
    where_clauses: List[str] = []

    # User-specific: only this user's documents (no random chunks from other users)
    # user_files.user_id may be varchar in DB; pass as string to avoid operator does not exist: character varying = integer
    if user_id is not None:
        where_clauses.append(" uf.user_id = %s ")
        params.append(str(user_id))

    if file_ids is not None:
        valid = [f for f in (file_ids if isinstance(file_ids, list) else []) if f and _is_uuid(f)]
        if valid:
            where_clauses.append(" fc.file_id = ANY(%s::uuid[]) ")
            params.append(valid)
            logger.info(f"[find_nearest_chunks] Searching for chunks in {len(valid)} files: {valid[:3]}")
        elif file_ids == [] or (isinstance(file_ids, list) and len(file_ids) == 0):
            # Explicit empty list: this draft has no case and no uploaded files → return no chunks
            where_clauses.append(" 1 = 0 ")
            logger.warning(f"[find_nearest_chunks] Empty file_ids list, returning 0 chunks")

    if where_clauses:
        query += " WHERE " + " AND ".join(where_clauses)
    query += " ORDER BY distance ASC LIMIT %s"
    params.append(limit)
    
    logger.info(f"[find_nearest_chunks] Executing query with user_id={user_id}, file_ids={file_ids}, limit={limit}")

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(query, params)
            columns = [d[0] for d in cur.description]
            rows = cur.fetchall()
    
    logger.info(f"[find_nearest_chunks] Query returned {len(rows)} rows")
    
    if len(rows) == 0 and file_ids:
        # Check if the file exists and has chunks
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT COUNT(*) FROM file_chunks WHERE file_id = ANY(%s::uuid[])",
                    (file_ids,)
                )
                chunk_count = cur.fetchone()[0]
                logger.warning(f"[find_nearest_chunks] File has {chunk_count} chunks in file_chunks table")
                
                cur.execute(
                    "SELECT status, processing_progress FROM user_files WHERE id = ANY(%s::uuid[])",
                    (file_ids,)
                )
                file_status = cur.fetchall()
                logger.warning(f"[find_nearest_chunks] File status: {file_status}")
    
    out = []
    for row in rows:
        d = dict(zip(columns, row))
        d["chunk_id"] = str(d["chunk_id"]) if d.get("chunk_id") else None
        d["file_id"] = str(d["file_id"]) if d.get("file_id") else None
        out.append(d)
    return out


def _is_uuid(s: str) -> bool:
    return bool(re.match(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", str(s).lower()))


def get_file_ids_for_case(case_id: str, user_id: int | str) -> List[str]:
    """
    Fetch all file IDs in the case's folder for chunk retrieval. No need to pass file_ids
    when case is selected — this uses cases.folder_id and user_files only.

    Supports case_id as UUID or integer (e.g. "89") — matches cases.id accordingly.

    Flow:
    1. cases.folder_id → user_files.id of the case folder (is_folder = true).
    2. Get that folder's folder_path from user_files.
    3. Select all user_files where is_folder = false and folder_path equals or is under that path.
    4. Return those file ids; Librarian will fetch and filter chunks by query (vector search).
    Returns [] on any DB/schema error so retrieve still works without case expansion.
    """
    import logging
    logger = logging.getLogger(__name__)
    
    case_id = (case_id or "").strip()
    if not case_id:
        logger.info(f"[get_file_ids_for_case] Empty case_id, returning []")
        return []
    uid_str = str(user_id)
    logger.info(f"[get_file_ids_for_case] Called with case_id={case_id}, user_id={uid_str}")
    
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                if _is_uuid(case_id):
                    logger.info(f"[get_file_ids_for_case] case_id is UUID, querying cases table")
                    cur.execute(
                        """
                        SELECT c.folder_id FROM cases c
                        WHERE c.id = %s::uuid
                          AND (c.user_id_int = %s OR c.user_id = %s)
                        LIMIT 1
                        """,
                        (case_id, user_id, uid_str),
                    )
                else:
                    # case_id is integer or non-UUID string (e.g. "89"); match by id::text
                    logger.info(f"[get_file_ids_for_case] case_id is not UUID, treating as integer/string")
                    cur.execute(
                        """
                        SELECT c.folder_id FROM cases c
                        WHERE c.id::text = %s
                          AND (c.user_id_int = %s OR c.user_id = %s)
                        LIMIT 1
                        """,
                        (case_id, user_id, uid_str),
                    )
                row = cur.fetchone()
        if not row or not row[0]:
            logger.warning(f"[get_file_ids_for_case] No case found or no folder_id for case_id={case_id}")
            return []
        folder_id = str(row[0])
        logger.info(f"[get_file_ids_for_case] Found folder_id={folder_id} for case_id={case_id}")
        
        # ISOLATION FIX: Use gcs_path for strict isolation.
        # folder_path is ambiguous ('3/cases' shared by 7 folders).
        # gcs_path is unique per folder ('.../Vishal_Bainade.../').
        
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT uf.gcs_path, uf.folder_path FROM user_files uf
                    WHERE uf.id = %s::uuid AND uf.user_id = %s AND uf.is_folder = true
                    LIMIT 1
                    """,
                    (folder_id, uid_str),
                )
                row = cur.fetchone()
        
        if not row:
            logger.warning(f"[get_file_ids_for_case] No folder found with id={folder_id}")
            return []
            
        folder_gcs_path = (row[0] or "").strip()
        folder_path = (row[1] or "").strip()
        
        logger.info(f"[get_file_ids_for_case] Found folder_gcs_path='{folder_gcs_path}' for folder_id={folder_id}")
        
        # Determine query strategy
        query = ""
        params = []
        
        if folder_gcs_path and len(folder_gcs_path) > 5:
            # Use strict GCS path filtering (PRIMARY STRATEGY)
            logger.info(f"[get_file_ids_for_case] Using GCS Path Filtering: {folder_gcs_path}%")
            query = """
                SELECT id FROM user_files
                WHERE user_id = %s AND is_folder = false
                  AND gcs_path ILIKE %s
                ORDER BY created_at ASC
            """
            params = (uid_str, folder_gcs_path + '%')
        elif folder_path:
            # Fallback to folder_path (Legacy/Backup)
            logger.warning(f"[get_file_ids_for_case] folder_gcs_path invalid/empty. Fallback to folder_path='{folder_path}'")
            query = """
                SELECT id FROM user_files
                WHERE user_id = %s AND is_folder = false
                  AND folder_path = %s
                ORDER BY created_at ASC
            """
            params = (uid_str, folder_path)
        else:
            logger.error("[get_file_ids_for_case] Both gcs_path and folder_path are empty for folder.")
            return []

        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(query, params)
                rows = cur.fetchall()
        
        file_ids = [str(r[0]) for r in rows if r and r[0]]
        logger.info(f"[get_file_ids_for_case] Found {len(file_ids)} files using isolation strategy.")
        return file_ids
    except Exception as e:
        logger.exception(f"[get_file_ids_for_case] Error: {e}")
        return []
        
    return []  # Should be unreachable but safe


def get_best_source_document(case_id: str, user_id: int | str) -> Optional[str]:
    """
    Find the best source document for a case.
    Prioritizes RECENCY (Newest valid file) to handle shared folder issues.
    Returns file_id or None.
    """
    import logging
    logger = logging.getLogger(__name__)

    # Get file IDs (Sorted by created_at ASC usually, but we will re-query/sort)
    # The get_file_ids_for_case returns IDs sorted by created_at ASC.
    file_ids = get_file_ids_for_case(case_id, user_id)
    if not file_ids:
        return None
    
    # Filter for valid file IDs
    valid_ids = [f for f in file_ids if _is_uuid(f)]
    if not valid_ids:
        return None
        
    # We need to pick the NEWEST file that has chunks.
    # The file_ids list is ASC (Oldest first). So reverse it for Descending (Newest first).
    valid_ids_desc = list(reversed(valid_ids))
    
    with get_conn() as conn:
        with conn.cursor() as cur:
            # Check chunks for these files.
            # We want to pick the FIRST one in valid_ids_desc that has > 0 chunks.
            
            cur.execute(
                """
                SELECT file_id, COUNT(*) as cnt 
                FROM file_chunks 
                WHERE file_id = ANY(%s::uuid[])
                GROUP BY file_id
                """,
                (valid_ids_desc,)
            )
            rows = cur.fetchall()
            
    # Map file_id -> count
    counts = {str(r[0]): r[1] for r in rows}
    
    logger.info(f"[get_best_source_document] File counts for case {case_id}: {counts}")

    # Iterate newest to oldest
    for fid in valid_ids_desc:
        c = counts.get(fid, 0)
        if c > 0:
            logger.info(f"[get_best_source_document] Selected NEWEST valid file: {fid} ({c} chunks)")
            return fid
            
    logger.warning("[get_best_source_document] No file with chunks found.")
    return None


def get_filenames_by_ids(file_ids: List[str]) -> Dict[str, str]:
    """
    Given a list of file UUIDs, return a mapping of {file_id: originalname}.
    Used by the Librarian agent to add source attribution to retrieved chunks.
    """
    import logging
    logger = logging.getLogger(__name__)

    if not file_ids:
        return {}

    valid_ids = [f for f in file_ids if f and _is_uuid(str(f))]
    if not valid_ids:
        return {}

    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT id, originalname FROM user_files WHERE id = ANY(%s::uuid[])",
                    (valid_ids,),
                )
                rows = cur.fetchall()
        result = {str(r[0]): (r[1] or "Unknown") for r in rows}
        logger.info(f"[get_filenames_by_ids] Resolved {len(result)} filenames for {len(valid_ids)} file_ids")
        return result
    except Exception as e:
        logger.warning(f"[get_filenames_by_ids] Error: {e}")
        return {fid: "Unknown" for fid in valid_ids}

