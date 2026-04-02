from __future__ import annotations

from fastapi import APIRouter

from app.schemas.contracts import HealthResponse
from app.services.container import get_pipeline_service


router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthResponse)
def health_check() -> HealthResponse:
    return get_pipeline_service().health()

