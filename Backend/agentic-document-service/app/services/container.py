from __future__ import annotations

from functools import lru_cache

from app.core.config import get_settings
from app.services.draft_service import CaseDraftService
from app.services.folder_service import FolderWorkflowService
from app.services.pipeline_service import LegalCasePipelineService


@lru_cache(maxsize=1)
def get_pipeline_service() -> LegalCasePipelineService:
    return LegalCasePipelineService(get_settings())


@lru_cache(maxsize=1)
def get_folder_service() -> FolderWorkflowService:
    return FolderWorkflowService(get_pipeline_service())


@lru_cache(maxsize=1)
def get_draft_service() -> CaseDraftService:
    return CaseDraftService()
