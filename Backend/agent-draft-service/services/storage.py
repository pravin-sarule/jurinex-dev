"""GCS upload service for ingestion pipeline. Mirrors document-service gcsService."""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Optional, Tuple

from google.cloud import storage  # type: ignore
from google.oauth2 import service_account  # type: ignore


def _get_client() -> storage.Client:
    """Build GCS client from env: GCS_KEY_BASE64 or GOOGLE_APPLICATION_CREDENTIALS."""
    if os.environ.get("GCS_KEY_BASE64"):
        import base64
        import json
        content = base64.b64decode(os.environ["GCS_KEY_BASE64"]).decode("utf-8")
        info = json.loads(content)
        credentials = service_account.Credentials.from_service_account_info(info)
        return storage.Client(credentials=credentials, project=info.get("project_id"))
    return storage.Client()


def upload_to_gcs(
    filename: str,
    buffer: bytes,
    folder: str = "uploads",
    bucket_name: Optional[str] = None,
    mimetype: str = "application/octet-stream",
) -> Tuple[str, str]:
    """
    Upload file buffer to GCS. Returns (gs_uri, gcs_path).
    Mirrors document-service gcsService.uploadToGCS.
    """
    bucket_name = bucket_name or os.environ.get("GCS_BUCKET_NAME") or os.environ.get("GCS_INPUT_BUCKET_NAME")
    if not bucket_name:
        raise ValueError("GCS_BUCKET_NAME or GCS_INPUT_BUCKET_NAME must be set")

    client = _get_client()
    bucket = client.bucket(bucket_name)
    safe_filename = re.sub(r"\s+", "_", filename)
    timestamp = int(__import__("time").time() * 1000)
    destination = str(Path(folder) / f"{timestamp}_{safe_filename}").replace("\\", "/")
    blob = bucket.blob(destination)
    blob.upload_from_string(
        buffer,
        content_type=mimetype,
    )
    gs_uri = f"gs://{bucket_name}/{destination}"
    return gs_uri, destination
