"""
WebSocket endpoint for real-time audio chat grounded in folder documents.

Connect with query params:
  ?folder_name=<case_id>&user_id=<uid>[&session_id=<uuid>]

Client → Server:
  {"type": "audio", "data": "<base64 PCM-16 @ 16 kHz mono>"}
  {"type": "end"}

Server → Client:
  {"type": "audio",            "data": "...", "mime_type": "audio/pcm"}
  {"type": "text",             "content": "..."}
  {"type": "input_transcript", "content": "..."}
  {"type": "tool_call",        "tool": "search_documents", "query": "..."}
  {"type": "turn_complete"}
  {"type": "error",            "message": "..."}
"""
from __future__ import annotations

import asyncio
import base64
import logging

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

from app.services.audio_chat_service import handle_folder_audio_session

router = APIRouter(tags=["audio"])
logger = logging.getLogger("agentic_document_service.audio_chat_route")


@router.websocket("/api/v1/audio/chat")
async def folder_audio_chat_ws(
    websocket: WebSocket,
    folder_name: str = Query(..., description="Case / folder identifier (case_id)"),
    user_id: str = Query(..., description="Authenticated user ID"),
    session_id: str | None = Query(None, description="Optional session UUID"),
) -> None:
    await websocket.accept()
    ip_address = websocket.client.host if websocket.client else None
    logger.info(
        "Audio WebSocket connected folder=%s user=%s session=%s client=%s",
        folder_name, user_id, session_id, ip_address,
    )

    audio_queue: asyncio.Queue[bytes] = asyncio.Queue(maxsize=200)
    done = asyncio.Event()
    received_chunks = 0
    received_bytes = 0
    sent_messages = 0

    async def _receive_from_client() -> None:
        nonlocal received_chunks, received_bytes
        try:
            while not done.is_set():
                try:
                    data = await asyncio.wait_for(websocket.receive_json(), timeout=60.0)
                except asyncio.TimeoutError:
                    logger.debug("Audio WS receive timeout; waiting folder=%s", folder_name)
                    continue

                msg_type = data.get("type")
                if msg_type == "audio":
                    raw = base64.b64decode(data["data"])
                    received_chunks += 1
                    received_bytes += len(raw)
                    try:
                        audio_queue.put_nowait(raw)
                    except asyncio.QueueFull:
                        logger.warning(
                            "Audio queue full, dropping chunk %d folder=%s",
                            received_chunks, folder_name,
                        )
                elif msg_type == "end":
                    logger.info(
                        "Audio end signal received chunks=%d bytes=%d folder=%s",
                        received_chunks, received_bytes, folder_name,
                    )
                    done.set()
                    break
                else:
                    logger.warning(
                        "Unknown client message type=%s folder=%s", msg_type, folder_name
                    )
        except WebSocketDisconnect:
            logger.info(
                "Audio WebSocket disconnected by client chunks=%d bytes=%d folder=%s",
                received_chunks, received_bytes, folder_name,
            )
            done.set()
        except Exception as exc:
            logger.exception("_receive_from_client error folder=%s: %s", folder_name, exc)
            done.set()

    async def _audio_generator():
        while not (done.is_set() and audio_queue.empty()):
            try:
                chunk = await asyncio.wait_for(audio_queue.get(), timeout=1.0)
                yield chunk
            except asyncio.TimeoutError:
                continue
        logger.info(
            "Audio generator finished chunks=%d bytes=%d folder=%s",
            received_chunks, received_bytes, folder_name,
        )

    async def _send_to_client(msg: dict) -> None:
        nonlocal sent_messages
        try:
            sent_messages += 1
            await websocket.send_json(msg)
        except Exception as exc:
            logger.exception(
                "Audio WebSocket send failed #%d folder=%s: %s",
                sent_messages, folder_name, exc,
            )

    receive_task = asyncio.create_task(_receive_from_client())
    try:
        await handle_folder_audio_session(
            folder_name=folder_name,
            user_id=user_id,
            receive_audio=_audio_generator(),
            send_response=_send_to_client,
            session_id=session_id,
            ip_address=ip_address,
        )
    except Exception as exc:
        logger.exception("Audio session error folder=%s: %s", folder_name, exc)
    finally:
        done.set()
        receive_task.cancel()
        try:
            await websocket.close()
        except Exception:
            pass
        logger.info(
            "Audio WebSocket closed folder=%s user=%s chunks=%d bytes=%d sent=%d",
            folder_name, user_id, received_chunks, received_bytes, sent_messages,
        )
