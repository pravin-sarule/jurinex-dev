"""
Structured-case route.

POST /api/summarize
    Body: { "caseText": "<raw text>", "query": "<optional instruction>", "model": "<optional>" }
    Returns: SummarizeResponse — a strict StructuredCase JSON (generic legal shape)
             plus optional rawMarkdown fallback and warnings.

Calls DeepSeek in JSON mode (response_format=json_object). Not gated by the LLM
chat-policy / payment-token middleware (those only apply to intelligent-chat and a
few other paths), so it works for ad-hoc structuring without a chat session.
"""
from __future__ import annotations

from fastapi import APIRouter

from app.schemas.structured_case import SummarizeRequest, SummarizeResponse
from app.services.structured_case import summarize_to_structured_case

router = APIRouter(prefix="/api", tags=["summarize"])


@router.post("/summarize", response_model=SummarizeResponse)
def summarize(request: SummarizeRequest) -> SummarizeResponse:
    return summarize_to_structured_case(
        case_text=request.caseText,
        query=request.query,
        model=request.model,
    )
