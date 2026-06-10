from __future__ import annotations

import base64
import json
import logging
import mimetypes
import uuid
from datetime import timedelta
from typing import Any

from google.cloud import storage
from google.oauth2 import service_account

from app.core.config import get_settings

logger = logging.getLogger(__name__)
_client: storage.Client | None = None


_VERTEX_SCOPES = ("https://www.googleapis.com/auth/cloud-platform",)


def get_service_account_credentials() -> service_account.Credentials | None:
    """Service account from GCS_KEY_BASE64 (GCS + Vertex Gemini)."""
    creds = _credentials()
    if creds is None:
        return None
    return creds.with_scopes(_VERTEX_SCOPES)


def parse_gcs_uri(uri: str) -> tuple[str, str] | None:
    """Return (bucket_name, object_path) for gs://bucket/path."""
    raw = str(uri or "").strip()
    if not raw.startswith("gs://"):
        return None
    rest = raw[5:]
    if "/" not in rest:
        return None
    bucket, path = rest.split("/", 1)
    return bucket, path


def _credentials() -> service_account.Credentials | None:
    raw = get_settings().gcs_key_base64
    if not raw:
        return None
    try:
        data = json.loads(base64.b64decode(raw).decode("utf-8"))
        return service_account.Credentials.from_service_account_info(data)
    except Exception as exc:
        logger.warning("GCS credentials parse failed: %s", exc)
        return None


def get_client() -> storage.Client:
    global _client
    if _client is None:
        creds = _credentials()
        project = get_settings().gcloud_project_id or None
        _client = storage.Client(project=project, credentials=creds) if creds else storage.Client(project=project)
    return _client


def mime_from_path(path: str) -> str:
    guessed, _ = mimetypes.guess_type(path)
    return guessed or "application/octet-stream"


def create_signed_upload_url(
    bucket_name: str,
    object_path: str,
    content_type: str,
    expires_seconds: int = 15 * 60,
) -> dict[str, Any]:
    bucket = get_client().bucket(bucket_name)
    blob = bucket.blob(object_path)
    expires = timedelta(seconds=max(60, expires_seconds))
    url = blob.generate_signed_url(
        version="v4",
        expiration=expires,
        method="PUT",
        content_type=content_type,
    )
    from datetime import datetime, timezone

    expires_at = (datetime.now(timezone.utc) + expires).isoformat().replace("+00:00", "Z")
    return {
        "signedUrl": url,
        "upload_url": url,
        "expiresAt": expires_at,
        "contentType": content_type,
        "method": "PUT",
        "headers": {"Content-Type": content_type},
        "gcs_path": object_path,
        "bucket": bucket_name,
    }


def upload_file_to_gcs(bucket_name: str, gcs_path: str, data: bytes, mime_type: str) -> str:
    bucket = get_client().bucket(bucket_name)
    blob = bucket.blob(gcs_path)
    blob.upload_from_string(data, content_type=mime_type or "application/octet-stream")
    return f"gs://{bucket_name}/{gcs_path}"


def get_object_metadata(bucket_name: str, object_path: str) -> dict[str, Any]:
    blob = get_client().bucket(bucket_name).blob(object_path)
    blob.reload()
    return {"size": blob.size, "content_type": blob.content_type}


def download_object_buffer(bucket_name: str, object_path: str) -> bytes:
    blob = get_client().bucket(bucket_name).blob(object_path)
    return blob.download_as_bytes()


def delete_object_if_exists(bucket_name: str, object_path: str) -> None:
    blob = get_client().bucket(bucket_name).blob(object_path)
    if blob.exists():
        blob.delete()


def build_upload_token() -> str:
    return str(uuid.uuid4())
