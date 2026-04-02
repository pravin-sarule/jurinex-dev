from __future__ import annotations

import logging
from typing import Any

import httpx

logger = logging.getLogger("agentic_document_service.google_drive_tool")

DRIVE_API_BASE = "https://www.googleapis.com/drive/v3/files"
GOOGLE_DOC_EXPORTS: dict[str, tuple[str, str]] = {
    "application/vnd.google-apps.document": ("application/pdf", ".pdf"),
    "application/vnd.google-apps.spreadsheet": (
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ".xlsx",
    ),
    "application/vnd.google-apps.presentation": (
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        ".pptx",
    ),
}


def _auth_headers(access_token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {access_token}"}


def get_file_metadata(access_token: str, file_id: str) -> dict[str, Any]:
    url = f"{DRIVE_API_BASE}/{file_id}"
    params = {"fields": "id,name,mimeType,size", "supportsAllDrives": "true"}
    with httpx.Client(timeout=30.0) as client:
        response = client.get(url, params=params, headers=_auth_headers(access_token))
        response.raise_for_status()
        return response.json()


def download_file_bytes(access_token: str, file_id: str) -> tuple[bytes, str, str]:
    metadata = get_file_metadata(access_token, file_id)
    name = str(metadata.get("name") or f"drive-file-{file_id}")
    mime_type = str(metadata.get("mimeType") or "application/octet-stream")

    with httpx.Client(timeout=120.0) as client:
        if mime_type in GOOGLE_DOC_EXPORTS:
            export_mime, extension = GOOGLE_DOC_EXPORTS[mime_type]
            export_url = f"{DRIVE_API_BASE}/{file_id}/export"
            response = client.get(
                export_url,
                params={"mimeType": export_mime},
                headers=_auth_headers(access_token),
            )
            response.raise_for_status()
            final_name = name if name.lower().endswith(extension) else f"{name}{extension}"
            logger.info("[DriveTool] Exported Google file id=%s as %s", file_id, export_mime)
            return response.content, final_name, export_mime

        download_url = f"{DRIVE_API_BASE}/{file_id}"
        response = client.get(
            download_url,
            params={"alt": "media", "supportsAllDrives": "true"},
            headers=_auth_headers(access_token),
        )
        response.raise_for_status()
        logger.info("[DriveTool] Downloaded file id=%s mime=%s", file_id, mime_type)
        return response.content, name, mime_type
