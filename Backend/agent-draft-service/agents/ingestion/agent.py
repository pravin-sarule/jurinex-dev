"""
Ingestion Agent: upload → GCS, Document AI extract, chunk, embed, store in DB.

Controlled by the orchestrator. Payload from orchestrator:
- raw_input: (optional) plain text for mock/CLI flow; returned as raw_text.
- user_id, file_id, file_content (base64), originalname, folder_path, mimetype, size:
  for production flow; runs full pipeline and returns raw_text, chunks, embeddings.
"""

from __future__ import annotations

import base64
import logging
from typing import Any, Dict, Optional

from agents.ingestion.pipeline import IngestionInput, IngestionResult, run_ingestion

logger = logging.getLogger(__name__)


def run_ingestion_agent(payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    Run the ingestion agent. Called by the orchestrator (or ADK wrapper).

    Payload:
      - raw_input: str (optional). If present and no file_content, return { raw_text: raw_input } (mock).
      - user_id: str (required for pipeline).
      - file_id: str (optional).
      - file_content: str (optional) base64-encoded file bytes.
      - gcs_uri: str (optional) if file already in GCS.
      - originalname: str.
      - folder_path: str.
      - mimetype: str.
      - size: int.

    Returns:
      - raw_text: str
      - chunks: list[str]
      - embeddings: list[list[float]]
      - file_id: str (optional)
      - error: str (optional)
    """
    raw_input = payload.get("raw_input")
    file_content_b64 = payload.get("file_content")
    user_id = payload.get("user_id", "")
    file_id = payload.get("file_id")
    gcs_uri = payload.get("gcs_uri")
    originalname = payload.get("originalname", "document")
    folder_path = payload.get("folder_path", "")
    mimetype = payload.get("mimetype", "application/pdf")
    size = int(payload.get("size") or 0)

    # Mock/CLI: only raw_input text, no file
    if raw_input is not None and not file_content_b64 and not gcs_uri:
        return {"raw_text": raw_input, "chunks": [], "embeddings": []}

    # Production: run full pipeline
    if not user_id:
        return {"raw_text": "", "chunks": [], "embeddings": [], "error": "user_id required"}

    file_content: Optional[bytes] = None
    if file_content_b64:
        try:
            file_content = base64.b64decode(file_content_b64)
        except Exception as e:
            logger.warning("Invalid file_content base64: %s", e)
            return {"raw_text": "", "chunks": [], "embeddings": [], "error": "Invalid file_content base64"}

    if not file_content and not gcs_uri:
        return {"raw_text": raw_input or "", "chunks": [], "embeddings": [], "error": "file_content or gcs_uri required"}

    input_data = IngestionInput(
        user_id=user_id,
        file_id=file_id,
        file_content=file_content,
        gcs_uri=gcs_uri,
        originalname=originalname,
        folder_path=folder_path,
        mimetype=mimetype,
        size=size or (len(file_content) if file_content else 0),
    )
    result: IngestionResult = run_ingestion(input_data)

    out: Dict[str, Any] = {
        "raw_text": result.raw_text,
        "chunks": result.chunks,
        "embeddings": result.embeddings,
        "file_id": result.file_id,
    }
    if result.error:
        out["error"] = result.error
    return out
