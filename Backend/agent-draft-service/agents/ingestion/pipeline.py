"""
Ingestion pipeline (in agents folder): GCS upload → Document AI → chunk → embed → store in DB.
Orchestrated by orchestrator. All Ingestion agent code lives under agents/ingestion/.
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass, field
from typing import List, Optional

from agents.ingestion.chunker import chunk_structured_content
from services.db import (
    ensure_file_record,
    save_chunk_vectors,
    save_chunks,
    update_file_full_text,
    update_file_processed,
    update_file_status,
)
from services.document_ai import extract_text_from_document
from services.embedding_service import generate_embeddings
from services.storage import upload_to_gcs

logger = logging.getLogger(__name__)


@dataclass
class IngestionInput:
    """Input for the ingestion pipeline."""

    user_id: str
    file_id: Optional[str] = None
    file_content: Optional[bytes] = None
    gcs_uri: Optional[str] = None
    originalname: str = "document"
    folder_path: str = ""
    mimetype: str = "application/pdf"
    size: int = 0
    chunk_size: int = 1200
    chunk_overlap: int = 150


@dataclass
class IngestionResult:
    """Output of the ingestion pipeline."""

    file_id: str
    raw_text: str
    chunks: List[str]
    embeddings: List[List[float]]
    gcs_uri: Optional[str] = None
    gcs_path: Optional[str] = None
    error: Optional[str] = field(default=None)


def run_ingestion(input_data: IngestionInput) -> IngestionResult:
    """
    Run full ingestion: upload to GCS (if content provided), Document AI extract,
    chunk, embed, store in DB. Returns raw_text, chunks, embeddings for orchestrator state.
    """
    logger.info(
        "Agent: Ingestion — run_ingestion started file=%s user_id=%s",
        input_data.originalname,
        input_data.user_id,
    )
    file_id = input_data.file_id or str(uuid.uuid4())
    user_id = input_data.user_id
    file_content = input_data.file_content
    gcs_uri = input_data.gcs_uri
    originalname = input_data.originalname or "document"
    folder_path = input_data.folder_path or ""
    mimetype = input_data.mimetype or "application/pdf"
    size = input_data.size or (len(file_content) if file_content else 0)

    raw_text = ""
    chunks_list: List[str] = []
    embeddings_list: List[List[float]] = []
    gcs_path_result: Optional[str] = None
    gcs_uri_result: Optional[str] = gcs_uri

    try:
        if file_content and not gcs_uri:
            update_file_status(file_id, "processing", 5.0, "Uploading to GCS")
            gcs_uri_result, gcs_path_result = upload_to_gcs(
                filename=originalname,
                buffer=file_content,
                folder="uploads",
                mimetype=mimetype,
            )
            ensure_file_record(
                user_id=user_id,
                originalname=originalname,
                gcs_path=gcs_path_result or (gcs_uri_result.split("/")[-1] if gcs_uri_result else ""),
                folder_path=folder_path,
                mimetype=mimetype,
                size=size,
                file_id=file_id,
                status="processing",
            )
        elif gcs_uri:
            gcs_path_result = gcs_uri.replace("gs://", "").split("/", 1)[-1] if "gs://" in gcs_uri else gcs_uri
            ensure_file_record(
                user_id=user_id,
                originalname=originalname,
                gcs_path=gcs_path_result or gcs_uri,
                folder_path=folder_path,
                mimetype=mimetype,
                size=size,
                file_id=file_id,
                status="processing",
            )

        update_file_status(file_id, "processing", 20.0, "Extracting text with Document AI")
        if file_content:
            page_texts = extract_text_from_document(file_content, mimetype)
        else:
            raise ValueError("file_content is required when gcs_uri is not used for extraction")
        if not page_texts:
            raise ValueError("Document AI returned no text")
        raw_text = "\n\n".join(p.get("text", "") for p in page_texts).strip()
        update_file_status(file_id, "processing", 40.0, "Text extracted")
        update_file_full_text(file_id, raw_text)

        update_file_status(file_id, "processing", 50.0, "Chunking document")
        structured = [
            {"text": p.get("text", ""), "page_start": p.get("page_start"), "page_end": p.get("page_end"), "heading": None}
            for p in page_texts
        ]
        chunk_objects = chunk_structured_content(
            structured,
            chunk_size=input_data.chunk_size,
            chunk_overlap=input_data.chunk_overlap,
            method="optimized_recursive",
        )
        chunks_list = [c["content"] for c in chunk_objects]
        if not chunks_list:
            raise ValueError("Chunking produced no chunks")

        update_file_status(file_id, "processing", 60.0, "Generating embeddings")
        embeddings_list = generate_embeddings(chunks_list)
        if len(embeddings_list) != len(chunks_list):
            raise ValueError("Embedding count does not match chunk count")
        update_file_status(file_id, "processing", 80.0, "Embeddings generated")

        update_file_status(file_id, "processing", 85.0, "Saving chunks and vectors")
        chunk_rows = [
            {
                "content": c["content"],
                "token_count": c["token_count"],
                "page_start": c["metadata"].get("page_start"),
                "page_end": c["metadata"].get("page_end"),
                "heading": c["metadata"].get("heading"),
            }
            for c in chunk_objects
        ]
        saved = save_chunks(file_id, chunk_rows)
        vectors = [
            {"chunk_id": chunk_id, "embedding": embeddings_list[i], "file_id": file_id}
            for i, (chunk_id, _) in enumerate(saved)
        ]
        save_chunk_vectors(vectors)
        update_file_processed(file_id)
        logger.info("Ingestion completed for file_id=%s, chunks=%s", file_id, len(chunks_list))
        return IngestionResult(
            file_id=file_id,
            raw_text=raw_text,
            chunks=chunks_list,
            embeddings=embeddings_list,
            gcs_uri=gcs_uri_result,
            gcs_path=gcs_path_result,
        )
    except Exception as e:
        logger.exception("Ingestion failed for file_id=%s", file_id)
        update_file_status(file_id, "failed", None, str(e)[:200])
        return IngestionResult(
            file_id=file_id,
            raw_text=raw_text,
            chunks=chunks_list,
            embeddings=embeddings_list,
            gcs_uri=gcs_uri_result,
            gcs_path=gcs_path_result,
            error=str(e),
        )
