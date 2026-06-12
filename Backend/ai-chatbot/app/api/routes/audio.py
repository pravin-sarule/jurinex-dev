"""
WebSocket endpoint for real-time audio chat via Gemini Live API.

Client message format:
  {"type": "audio", "data": "<base64 PCM-16 @ 16 kHz>"}
  {"type": "end"}

Server message format:
  {"type": "audio", "data": "<base64>", "mime_type": "audio/pcm"}
  {"type": "text", "content": "..."}
  {"type": "tool_call", "tool": "search_documents", "query": "..."}
  {"type": "turn_complete"}
  {"type": "error", "message": "..."}
"""
from __future__ import annotations

import asyncio
import base64
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.services.chatbot import handle_audio_session
from app.services.session_service import get_or_create_session

router = APIRouter(tags=["audio"])
logger = logging.getLogger("ai_chatbot.audio_route")


@router.websocket("/ws/audio")
async def audio_chat_ws(websocket: WebSocket, mode: str = "landing") -> None:
    """
    mode="app"     → in-app assistant audio (search only)
    mode="landing" → landing page audio (greet user, collect name/email/phone, answer legal questions)
    mode="booking" → alias for landing; agent opens by greeting and starting contact collection
    """
    await websocket.accept()
    ip_address = websocket.client.host if websocket.client else None
    is_in_app = (mode == "app")
    # For landing/booking modes, inject an opening prompt so the agent greets first
    initial_message = (
        "Please greet the user warmly, introduce yourself as the JuriNex AI Assistant, and ask for their full name to get started."
        if not is_in_app else None
    )
    session_id = get_or_create_session(None, mode="audio")
    logger.info(
        "Audio WebSocket connected client=%s session=%s mode=%s",
        websocket.client, session_id, mode,
    )

    audio_queue: asyncio.Queue[bytes] = asyncio.Queue(maxsize=200)
    text_inject_queue: asyncio.Queue[str] = asyncio.Queue(maxsize=50)
    done = asyncio.Event()
    received_audio_chunks = 0
    received_audio_bytes = 0
    sent_messages = 0

    async def _receive_from_client() -> None:
        nonlocal received_audio_chunks, received_audio_bytes
        try:
            while not done.is_set():
                try:
                    data = await asyncio.wait_for(websocket.receive_json(), timeout=60.0)
                except asyncio.TimeoutError:
                    logger.debug("Audio WebSocket receive timeout; waiting for client")
                    continue

                msg_type = data.get("type")
                logger.debug("Audio WebSocket client message type=%s keys=%s", msg_type, list(data.keys()))

                if msg_type == "audio":
                    raw = base64.b64decode(data["data"])
                    received_audio_chunks += 1
                    received_audio_bytes += len(raw)
                    logger.debug(
                        "Audio chunk received index=%d bytes=%d total_bytes=%d queue_size=%d",
                        received_audio_chunks,
                        len(raw),
                        received_audio_bytes,
                        audio_queue.qsize(),
                    )
                    try:
                        audio_queue.put_nowait(raw)
                    except asyncio.QueueFull:
                        logger.warning("Audio queue full - dropping chunk index=%d", received_audio_chunks)
                elif msg_type == "text":
                    content = str(data.get("content", "")).strip()
                    if content:
                        try:
                            text_inject_queue.put_nowait(content)
                            logger.info("Audio WebSocket text inject queued: %r", content[:120])
                        except asyncio.QueueFull:
                            logger.warning("Text inject queue full — dropping message")
                elif msg_type == "end":
                    logger.info(
                        "Audio WebSocket received end chunks=%d bytes=%d queue_size=%d",
                        received_audio_chunks,
                        received_audio_bytes,
                        audio_queue.qsize(),
                    )
                    done.set()
                    break
                else:
                    logger.warning("Audio WebSocket unknown client message type=%s payload=%r", msg_type, data)
        except WebSocketDisconnect:
            logger.info(
                "Audio WebSocket disconnected by client chunks=%d bytes=%d",
                received_audio_chunks,
                received_audio_bytes,
            )
            done.set()
        except Exception as exc:
            logger.exception("_receive_from_client error: %s", exc)
            done.set()

    async def _audio_generator():
        while not (done.is_set() and audio_queue.empty()):
            try:
                chunk = await asyncio.wait_for(audio_queue.get(), timeout=1.0)
                logger.debug("Audio generator yielding bytes=%d remaining_queue=%d", len(chunk), audio_queue.qsize())
                yield chunk
            except asyncio.TimeoutError:
                logger.debug("Audio generator waiting done=%s queue_empty=%s", done.is_set(), audio_queue.empty())
                continue
        logger.info("Audio generator finished chunks=%d bytes=%d", received_audio_chunks, received_audio_bytes)

    async def _send_to_client(msg: dict) -> None:
        nonlocal sent_messages
        try:
            sent_messages += 1
            safe_msg = dict(msg)
            if safe_msg.get("type") == "audio" and "data" in safe_msg:
                safe_msg["data"] = f"<base64 {len(msg.get('data') or '')} chars>"
            logger.debug("Audio WebSocket send #%d payload=%r", sent_messages, safe_msg)
            await websocket.send_json(msg)
        except (RuntimeError, WebSocketDisconnect) as exc:
            logger.debug("Audio WebSocket send skipped (client disconnected): %s", exc)
        except Exception as exc:
            logger.exception("Audio WebSocket send failed: %s", exc)

    receive_task = asyncio.create_task(_receive_from_client())
    try:
        logger.info("Audio session handler starting session=%s is_in_app=%s", session_id, is_in_app)
        await handle_audio_session(
            _audio_generator(),
            _send_to_client,
            session_id=session_id,
            ip_address=ip_address,
            is_in_app=is_in_app,
            initial_message=initial_message,
            text_inject_queue=text_inject_queue,
        )
    except Exception as exc:
        logger.exception("Audio session error: %s", exc)
    finally:
        done.set()
        receive_task.cancel()
        try:
            await websocket.close()
        except Exception as exc:
            logger.debug("Audio WebSocket close ignored: %s", exc)
        logger.info(
            "Audio WebSocket closed chunks=%d bytes=%d sent_messages=%d",
            received_audio_chunks,
            received_audio_bytes,
            sent_messages,
        )
