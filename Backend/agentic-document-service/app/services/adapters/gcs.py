"""
GCS storage adapter — real Google Cloud Storage operations.

Supports:
  - upload_bytes():  upload raw bytes → returns gs:// URI
  - signed_upload_url(): generate a signed PUT URL for direct browser upload
  - download_bytes(): download a file from a gs:// URI
  - upload_from_path(): upload a local file
"""
from __future__ import annotations

import base64
import json
import logging
import os
import tempfile
import threading
from datetime import timedelta
from pathlib import PurePosixPath
from typing import TYPE_CHECKING

logger = logging.getLogger("agentic_document_service.gcs")

# Per-request deadline for blob transfers. Without it a stalled connection can
# hold a thread (or, before the routes moved uploads off the event loop, the
# whole service) indefinitely.
_TRANSFER_TIMEOUT_S = 120

# storage.Client is thread-safe for uploads/downloads; caching it avoids paying
# credential construction + a token round-trip on every single transfer call.
_client_lock = threading.Lock()
_cached_client = None


def _get_gcs_client():
    """Return a cached authenticated GCS client using GCS_KEY_BASE64 or ADC."""
    global _cached_client
    with _client_lock:
        if _cached_client is not None:
            return _cached_client

        from google.cloud import storage  # type: ignore

        from app.core.config import get_settings
        settings = get_settings()

        client = None
        key_b64 = settings.gcs_key_base64
        if key_b64:
            try:
                key_json = base64.b64decode(key_b64).decode("utf-8")
                creds_dict = json.loads(key_json)
                from google.oauth2 import service_account  # type: ignore
                credentials = service_account.Credentials.from_service_account_info(
                    creds_dict,
                    scopes=["https://www.googleapis.com/auth/cloud-platform"],
                )
                client = storage.Client(credentials=credentials, project=creds_dict.get("project_id"))
            except Exception as exc:
                logger.warning("[GCS] Failed to load GCS_KEY_BASE64 credentials: %s", exc)

        if client is None:
            # Fall back to Application Default Credentials
            client = storage.Client()
        _cached_client = client
        return client


def upload_bytes(
    data: bytes,
    destination_path: str,
    content_type: str = "application/octet-stream",
    bucket_type: str = "input",  # 'input' or 'output'
) -> str:
    """
    Upload bytes to GCS.

    Args:
        data: Raw bytes to upload.
        destination_path: Object path inside the bucket.
        content_type: MIME type of the file.
        bucket_type: 'input' (GCS_INPUT_BUCKET_NAME) or 'output' (GCS_OUTPUT_BUCKET_NAME).

    Returns:
        gs:// URI string.
    """
    from app.core.config import get_settings
    settings = get_settings()
    
    if bucket_type == "input":
        bucket_name = settings.gcs_input_bucket_name or settings.gcs_bucket_name or "fileinputbucket"
    else:
        bucket_name = settings.gcs_output_bucket_name or settings.gcs_bucket_name or "fileoutputbucket"

    client = _get_gcs_client()
    bucket_obj = client.bucket(bucket_name)
    blob = bucket_obj.blob(destination_path)
    blob.upload_from_string(data, content_type=content_type, timeout=_TRANSFER_TIMEOUT_S)
    uri = f"gs://{bucket_name}/{destination_path}"
    logger.info("[GCS] Uploaded %d bytes to %s bucket → %s", len(data), bucket_type, uri)
    return uri


def download_bytes(gs_uri: str) -> bytes:
    """
    Download a file from a gs:// URI and return its bytes.
    """
    if not gs_uri.startswith("gs://"):
        raise ValueError(f"Not a valid gs:// URI: {gs_uri}")
    without_scheme = gs_uri[5:]
    bucket_name, _, object_path = without_scheme.partition("/")

    client = _get_gcs_client()
    bucket_obj = client.bucket(bucket_name)
    blob = bucket_obj.blob(object_path)
    data = blob.download_as_bytes(timeout=_TRANSFER_TIMEOUT_S)
    logger.info("[GCS] Downloaded %d bytes from %s", len(data), gs_uri)
    return data


def delete_blob(gs_uri: str) -> bool:
    """
    Delete a file from GCS by its gs:// URI.

    Returns True if deleted, False if it did not exist.
    """
    if not gs_uri or not gs_uri.startswith("gs://"):
        return False
    without_scheme = gs_uri[5:]
    bucket_name, _, object_path = without_scheme.partition("/")
    if not bucket_name or not object_path:
        return False
    try:
        client = _get_gcs_client()
        bucket_obj = client.bucket(bucket_name)
        blob = bucket_obj.blob(object_path)
        blob.delete()
        logger.info("[GCS] Deleted %s", gs_uri)
        return True
    except Exception as exc:
        logger.warning("[GCS] delete_blob failed for %s: %s", gs_uri, exc)
        return False


def signed_upload_url(
    destination_path: str,
    content_type: str = "application/octet-stream",
    expiration_minutes: int = 15,
    bucket_type: str = "input",
) -> str:
    """
    Generate a v4 signed PUT URL for direct browser-to-GCS uploads.
    """
    from app.core.config import get_settings
    settings = get_settings()
    
    if bucket_type == "input":
        bucket_name = settings.gcs_input_bucket_name or settings.gcs_bucket_name or "fileinputbucket"
    else:
        bucket_name = settings.gcs_output_bucket_name or settings.gcs_bucket_name or "fileoutputbucket"

    client = _get_gcs_client()
    bucket_obj = client.bucket(bucket_name)
    blob = bucket_obj.blob(destination_path)
    url = blob.generate_signed_url(
        version="v4",
        expiration=timedelta(minutes=expiration_minutes),
        method="PUT",
        content_type=content_type,
    )
    logger.info("[GCS] Generated signed upload URL for %s in %s bucket", destination_path, bucket_type)
    return url


def signed_read_url(gs_uri: str, expiration_minutes: int = 60) -> str:
    """
    Generate a v4 signed GET URL for a gs:// URI.
    """
    if not gs_uri.startswith("gs://"):
        raise ValueError(f"Not a valid gs:// URI: {gs_uri}")

    without_scheme = gs_uri[5:]
    bucket_name, _, object_path = without_scheme.partition("/")
    if not bucket_name or not object_path:
        raise ValueError(f"Incomplete gs:// URI: {gs_uri}")

    client = _get_gcs_client()
    bucket_obj = client.bucket(bucket_name)
    blob = bucket_obj.blob(object_path)
    url = blob.generate_signed_url(
        version="v4",
        expiration=timedelta(minutes=expiration_minutes),
        method="GET",
    )
    logger.info("[GCS] Generated signed read URL for %s", gs_uri)
    return url
