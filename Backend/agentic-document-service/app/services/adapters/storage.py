from __future__ import annotations

from abc import ABC, abstractmethod
from pathlib import PurePosixPath

from app.core.config import Settings
from app.schemas.contracts import DocumentReference


class StorageAdapter(ABC):
    @abstractmethod
    def store_document(self, case_id: str, doc_type: str, document: DocumentReference) -> str:
        raise NotImplementedError


class GCSStorageAdapter(StorageAdapter):
    def __init__(self, settings: Settings) -> None:
        self._bucket_name = settings.gcs_bucket_name

    def store_document(self, case_id: str, doc_type: str, document: DocumentReference) -> str:
        if document.document_uri and document.document_uri.startswith("gs://"):
            return document.document_uri
        safe_name = document.document_name.replace("\\", "_").replace("/", "_")
        object_path = PurePosixPath(case_id) / doc_type / safe_name
        bucket_name = self._bucket_name or "local-agentic-documents"
        return f"gs://{bucket_name}/{object_path}"

