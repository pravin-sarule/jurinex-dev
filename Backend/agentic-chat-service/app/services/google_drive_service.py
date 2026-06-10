from __future__ import annotations

import io
import logging
from typing import Any

from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload

logger = logging.getLogger(__name__)

EXPORT_MIMES = {
    "application/vnd.google-apps.document": (
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".docx",
    ),
    "application/vnd.google-apps.spreadsheet": (
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ".xlsx",
    ),
    "application/vnd.google-apps.presentation": (
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        ".pptx",
    ),
    "application/vnd.google-apps.drawing": ("application/pdf", ".pdf"),
}


async def download_file(access_token: str, file_id: str) -> dict[str, Any]:
    creds = Credentials(token=access_token)
    drive = build("drive", "v3", credentials=creds, cache_discovery=False)

    meta = (
        drive.files()
        .get(fileId=file_id, fields="id,name,mimeType,size", supportsAllDrives=True)
        .execute()
    )
    filename = meta.get("name") or "document"
    mime_type = meta.get("mimeType") or "application/octet-stream"

    if mime_type in EXPORT_MIMES:
        export_mime, ext = EXPORT_MIMES[mime_type]
        request = drive.files().export_media(fileId=file_id, mimeType=export_mime)
        mime_type = export_mime
        if not filename.lower().endswith(ext):
            filename += ext
    else:
        request = drive.files().get_media(fileId=file_id, supportsAllDrives=True)

    buf = io.BytesIO()
    downloader = MediaIoBaseDownload(buf, request)
    done = False
    while not done:
        _, done = downloader.next_chunk()
    return {"buffer": buf.getvalue(), "filename": filename, "mimeType": mime_type, "metadata": meta}
