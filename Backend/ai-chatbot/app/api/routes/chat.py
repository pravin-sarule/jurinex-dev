import logging

from fastapi import APIRouter, HTTPException

from app.schemas.models import ChatRequest, ChatResponse
from app.services.chatbot import text_chat
from app.services.session_service import get_or_create_session, save_exchange, get_history

router = APIRouter(prefix="/api/chat", tags=["chat"])
logger = logging.getLogger("ai_chatbot.chat")


@router.post("", response_model=ChatResponse, summary="Text chat (Gemini function-calling)")
def chat_endpoint(request: ChatRequest) -> ChatResponse:
    logger.info("POST /api/chat  message=%r  session=%s", request.message, request.session_id)
    session_id = get_or_create_session(request.session_id, mode="text")
    logger.debug("POST /api/chat  resolved_session=%s", session_id)
    answer = text_chat(request.message)
    logger.debug("POST /api/chat  answer_len=%d  answer=%r", len(answer or ""), answer)
    save_exchange(session_id, request.message, answer)
    logger.info("POST /api/chat  done  session=%s", session_id)
    return ChatResponse(answer=answer, session_id=session_id)


@router.get("/history/{session_id}", summary="Fetch conversation history")
def chat_history(session_id: str, limit: int = 20) -> list[dict]:
    """Returns past messages for a session, oldest first."""
    logger.info("GET /api/chat/history/%s limit=%s", session_id, limit)
    messages = get_history(session_id, limit=limit)
    logger.debug("GET /api/chat/history/%s returned=%d", session_id, len(messages))
    if not messages:
        raise HTTPException(status_code=404, detail="Session not found or empty")
    return messages
