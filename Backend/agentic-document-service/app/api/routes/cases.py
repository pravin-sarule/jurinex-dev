from __future__ import annotations

import base64
import json
import logging

from fastapi import APIRouter, HTTPException, Query, Request

from agents.legal_case_management.agent import (
    answer_case_question,
    execute_case_preset,
    process_case_documents as run_agent_case_documents,
    run_case_intake,
)
from app.schemas.contracts import (
    IngestDocumentsRequest,
    IngestDocumentsResponse,
    IntakeRequest,
    IntakeResponse,
    PresetExecutionRequest,
    PresetExecutionResponse,
    PresetPrompt,
    QueryRequest,
    QueryResponse,
)
from app.services.container import get_pipeline_service


router = APIRouter(prefix="/api/v1", tags=["cases"])
logger = logging.getLogger("agentic_document_service.api.cases")


def _extract_user_id(request: Request, query_param: str | None) -> str | None:
    if query_param:
        return query_param
    uid = request.headers.get("x-user-id")
    if uid:
        return uid
    authorization = request.headers.get("authorization", "")
    if authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1].strip()
        try:
            parts = token.split(".")
            if len(parts) == 3:
                payload = parts[1]
                payload += "=" * ((4 - len(payload) % 4) % 4)
                decoded = json.loads(base64.urlsafe_b64decode(payload.encode()).decode())
                uid = decoded.get("id") or decoded.get("userId") or decoded.get("user_id") or decoded.get("sub")
                return str(uid) if uid is not None else None
        except Exception:
            pass
    return None


@router.post("/intake", response_model=IntakeResponse)
def process_intake(request: IntakeRequest) -> IntakeResponse:
    logger.info(
        "[Route:intake] status=received user_id=%s document=%s schema=%s",
        request.user_id,
        request.document.document_name,
        request.schema_name,
    )
    try:
        payload = run_case_intake(
            user_id=request.user_id,
            document_name=request.document.document_name,
            document_uri=request.document.document_uri,
            inline_text=request.document.inline_text,
            mime_type=request.document.mime_type,
            schema_name=request.schema_name,
        )
        return IntakeResponse.model_validate(payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/cases/{case_id}/documents:process", response_model=IngestDocumentsResponse)
def process_case_documents(case_id: str, request: IngestDocumentsRequest) -> IngestDocumentsResponse:
    if case_id != request.case_id:
        raise HTTPException(status_code=400, detail="Path case_id must match body case_id.")
    logger.info(
        "[Route:documents_process] status=received user_id=%s case_id=%s documents=%s",
        request.user_id,
        request.case_id,
        len(request.documents),
    )
    try:
        payload = run_agent_case_documents(
            user_id=request.user_id,
            case_id=request.case_id,
            documents=[document.model_dump(mode="json") for document in request.documents],
        )
        return IngestDocumentsResponse.model_validate(payload)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/cases/{case_id}/query", response_model=QueryResponse)
def answer_query(case_id: str, request: QueryRequest) -> QueryResponse:
    if case_id != request.case_id:
        raise HTTPException(status_code=400, detail="Path case_id must match body case_id.")
    logger.info(
        "[Route:query] status=received user_id=%s case_id=%s top_k=%s",
        request.user_id,
        request.case_id,
        request.top_k,
    )
    try:
        payload = answer_case_question(
            user_id=request.user_id,
            case_id=request.case_id,
            query=request.query,
        )
        return QueryResponse.model_validate(payload)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/presets", response_model=list[PresetPrompt])
def list_presets(
    request: Request,
    user_id: str | None = Query(default=None),
) -> list[PresetPrompt]:
    resolved_uid = _extract_user_id(request, user_id)
    return get_pipeline_service().list_presets(
        user_id=resolved_uid,
        authorization=request.headers.get("authorization"),
    )


@router.post("/cases/{case_id}/presets/{preset_id}:execute", response_model=PresetExecutionResponse)
def execute_preset(
    case_id: str,
    preset_id: str,
    request: PresetExecutionRequest,
) -> PresetExecutionResponse:
    if case_id != request.case_id:
        raise HTTPException(status_code=400, detail="Path case_id must match body case_id.")
    if preset_id != request.preset_id:
        raise HTTPException(status_code=400, detail="Path preset_id must match body preset_id.")
    logger.info(
        "[Route:preset_execute] status=received user_id=%s case_id=%s preset_id=%s",
        request.user_id,
        request.case_id,
        request.preset_id,
    )
    try:
        payload = execute_case_preset(
            user_id=request.user_id,
            case_id=request.case_id,
            preset_id=request.preset_id,
            additional_context=request.additional_context,
        )
        return PresetExecutionResponse.model_validate(payload)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
