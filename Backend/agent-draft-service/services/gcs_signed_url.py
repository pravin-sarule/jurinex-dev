"""
Generate time-limited signed URLs for GCS objects (e.g. template preview images).
Uses same credentials as storage.py (GCS_KEY_BASE64 or GOOGLE_APPLICATION_CREDENTIALS).
"""

from __future__ import annotations

import os
from datetime import timedelta
from typing import Optional

from google.cloud import storage  # type: ignore


def _get_client() -> storage.Client:
    """Build GCS client from env; must have signing capability (service account with private key)."""
    if os.environ.get("GCS_KEY_BASE64"):
        import base64
        import json
        content = base64.b64decode(os.environ["GCS_KEY_BASE64"]).decode("utf-8")
        info = json.loads(content)
        from google.oauth2 import service_account
        credentials = service_account.Credentials.from_service_account_info(info)
        return storage.Client(credentials=credentials, project=info.get("project_id"))
    return storage.Client()


def generate_signed_url(
    bucket_name: str,
    blob_path: str,
    expiration_minutes: int = 60,
    method: str = "GET",
) -> Optional[str]:
    """
    Return a signed URL for a GCS object, or None if credentials cannot sign or blob missing.
    Frontend can use this URL to display template preview images without making the bucket public.
    """
    if not bucket_name or not blob_path:
        return None
    try:
        client = _get_client()
        bucket = client.bucket(bucket_name)
        blob = bucket.blob(blob_path)
        url = blob.generate_signed_url(
            version="v4",
            expiration=timedelta(minutes=expiration_minutes),
            method=method,
        )
        return url
    except Exception:
        return None


def generate_signed_url_from_gs(gs_url: str, expiration_minutes: int = 60) -> Optional[str]:
    """
    Parse gs://bucket/path and return a signed URL.
    Use when templates.image_url or similar stores full gs:// URIs.
    """
    if not gs_url or not isinstance(gs_url, str) or not gs_url.strip().startswith("gs://"):
        return None
    gs = gs_url.strip()
    prefix = "gs://"
    rest = gs[len(prefix):]
    if "/" not in rest:
        return None
    bucket_name, _, blob_path = rest.partition("/")
    if not bucket_name or not blob_path:
        return None
    return generate_signed_url(bucket_name, blob_path, expiration_minutes)
