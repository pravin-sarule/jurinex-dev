import logging

from fastapi import APIRouter, HTTPException, Request

from app.schemas.models import ChatRequest, ChatResponse
from app.services.chatbot import text_chat
from app.services.session_service import get_or_create_session, save_exchange, get_history
from app.services.token_usage_service import log_token_usage

router = APIRouter(prefix="/api/chat", tags=["chat"])
logger = logging.getLogger("ai_chatbot.chat")


@router.post("", response_model=ChatResponse, summary="Text chat (Gemini function-calling)")
def chat_endpoint(body: ChatRequest, request: Request) -> ChatResponse:
    ip_address = request.client.host if request.client else None
    logger.info("POST /api/chat  message=%r  session=%s  ip=%s", body.message, body.session_id, ip_address)

    session_id = get_or_create_session(body.session_id, mode="text")
    logger.debug("POST /api/chat  resolved_session=%s", session_id)

    result = text_chat(body.message, session_id=session_id)
    logger.debug("POST /api/chat  answer_len=%d  answer=%r", len(result.answer or ""), result.answer)

    save_exchange(session_id, body.message, result.answer)

    log_token_usage(
        session_id=session_id,
        mode="text",
        model_name=_get_text_model(),
        input_tokens=result.input_tokens,
        output_tokens=result.output_tokens,
        ip_address=ip_address,
    )

    logger.info("POST /api/chat  done  session=%s", session_id)
    return ChatResponse(answer=result.answer, session_id=session_id)


@router.get("/history/{session_id}", summary="Fetch conversation history")
def chat_history(session_id: str, limit: int = 20) -> list[dict]:
    """Returns past messages for a session, oldest first."""
    logger.info("GET /api/chat/history/%s limit=%s", session_id, limit)
    messages = get_history(session_id, limit=limit)
    logger.debug("GET /api/chat/history/%s returned=%d", session_id, len(messages))
    if not messages:
        raise HTTPException(status_code=404, detail="Session not found or empty")
    return messages


def _get_text_model() -> str:
    from app.services.chatbot import load_chatbot_config
    try:
        return load_chatbot_config().model_text
    except Exception:
        return "gemini-2.5-flash"
