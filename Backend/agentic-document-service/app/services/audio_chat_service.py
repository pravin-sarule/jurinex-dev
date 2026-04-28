"""
Audio chat via Gemini Live API, grounded in folder document RAG.

Provides handle_folder_audio_session() — bridges a WebSocket audio stream with
the Gemini Live API and uses the folder's indexed documents as the RAG source.

WS protocol (identical to ai-chatbot audio route):
  client → server: {"type": "audio", "data": "<base64 PCM-16@16kHz mono>"}
                    {"type": "end"}
  server → client: {"type": "audio",            "data": "...", "mime_type": "audio/pcm"}
                    {"type": "text",             "content": "..."}
                    {"type": "input_transcript", "content": "..."}
                    {"type": "tool_call",        "tool": "search_documents", "query": "..."}
                    {"type": "turn_complete"}
                    {"type": "error",            "message": "..."}
"""
from __future__ import annotations

import asyncio
import base64
import importlib.metadata
import logging
from typing import AsyncGenerator, Callable, Awaitable

logger = logging.getLogger("agentic_document_service.audio_chat")

_MIN_GOOGLE_GENAI_LIVE_VERSION = (1, 60, 0)

_DOCUMENT_AUDIO_SYSTEM_PROMPT = """
You are the JuriNex Legal Document Agent, a voice-first assistant for Indian legal
case documents.

Your role:
- Help the user understand and query their uploaded case documents.
- Always call search_documents before answering any question about the case.
- Quote relevant portions from the retrieved documents when available.
- Cite the document name when referencing specific content.
- Speak clearly and professionally. Keep initial answers under 45 seconds.
- Default to English. Switch to Marathi, Hindi, or Hinglish if the user does.
- Provide legal information, not legal advice.

If the documents do not contain the answer, say:
"I couldn't find this in your uploaded documents, but based on general legal
principles..." and give only general legal information.
""".strip()

_SEARCH_FN_DECLARATION = {
    "name": "search_documents",
    "description": (
        "Searches the uploaded case documents for relevant content. "
        "Always call this before answering any question about the case."
    ),
    "parameters": {
        "type": "OBJECT",
        "properties": {
            "query": {
                "type": "STRING",
                "description": "Search query optimised for vector retrieval",
            }
        },
        "required": ["query"],
    },
}


# ── SDK version guard ─────────────────────────────────────────────────────────

def _parse_version(version: str) -> tuple[int, int, int]:
    parts = []
    for part in version.split(".")[:3]:
        digits = "".join(ch for ch in part if ch.isdigit())
        parts.append(int(digits or 0))
    while len(parts) < 3:
        parts.append(0)
    return tuple(parts)  # type: ignore[return-value]


def _ensure_live_sdk() -> None:
    try:
        version = importlib.metadata.version("google-genai")
    except importlib.metadata.PackageNotFoundError as exc:
        raise RuntimeError("google-genai is not installed.") from exc
    if _parse_version(version) < _MIN_GOOGLE_GENAI_LIVE_VERSION:
        required = ".".join(str(p) for p in _MIN_GOOGLE_GENAI_LIVE_VERSION)
        raise RuntimeError(
            f"google-genai {version} is too old for Gemini Live. Required >= {required}. "
            "Run: pip install -U google-genai"
        )


def _make_audio_transcription_config(gt):
    return gt.AudioTranscriptionConfig()


# ── RAG search tool ───────────────────────────────────────────────────────────

async def search_folder_documents(
    folder_name: str,
    user_id: str,
    query: str,
    top_k: int = 5,
) -> str:
    """
    RAG retrieval for audio agent tool calls.
    Uses the same hybrid search (semantic + keyword RRF) as the text-based model.
    """
    from app.services.container import get_folder_service, get_pipeline_service

    loop = asyncio.get_running_loop()
    folder_service = get_folder_service()
    pipeline_service = get_pipeline_service()

    # 1. Resolve file IDs for this folder
    file_ids: list[str] = []
    try:
        db_docs = await loop.run_in_executor(
            None, folder_service.get_documents_in_folder, folder_name, user_id
        )
        records = db_docs.get("documents") or db_docs.get("files") or []
        file_ids = [str(item.get("id")) for item in records if item.get("id")]
    except Exception as exc:
        logger.warning(
            "audio_rag: folder document lookup failed folder=%s error=%s", folder_name, exc
        )

    # 2. Fallback: recover file IDs via the same path as answer_folder_chat
    if not file_ids:
        try:
            file_ids = await loop.run_in_executor(
                None, folder_service._resolve_file_ids_for_folder_case, folder_name, user_id
            )
            if file_ids:
                logger.info(
                    "audio_rag: recovered file_ids=%d via fallback folder=%s",
                    len(file_ids), folder_name,
                )
        except Exception as exc:
            logger.warning("audio_rag: file_ids fallback failed folder=%s error=%s", folder_name, exc)

    # 3. Delegate to pipeline_service hybrid search (semantic + keyword RRF)
    try:
        context = await loop.run_in_executor(
            None,
            pipeline_service.retrieve_context_text,
            folder_name,
            query,
            file_ids,
            top_k,
        )
    except Exception as exc:
        logger.error("audio_rag: retrieve_context_text failed folder=%s error=%s", folder_name, exc)
        return "Document search failed."

    return context


# ── Gemini Live audio session ─────────────────────────────────────────────────

SendFn = Callable[[dict], Awaitable[None]]


async def handle_folder_audio_session(
    folder_name: str,
    user_id: str,
    receive_audio: AsyncGenerator[bytes, None],
    send_response: SendFn,
    *,
    session_id: str | None = None,
    ip_address: str | None = None,
) -> None:
    """
    Bridges a WebSocket audio stream with the Gemini Live API using the
    folder's indexed documents as the RAG knowledge base.

    receive_audio  — async generator of raw PCM-16 bytes @ 16 kHz mono
    send_response  — async callable that pushes JSON dicts to the client
    """
    try:
        from google import genai  # type: ignore
        from google.genai import types as gt
        from app.core.config import get_settings

        _ensure_live_sdk()

        settings = get_settings()
        api_key = settings.gemini_api_key
        if not api_key:
            await send_response({"type": "error", "message": "Missing GEMINI_API_KEY."})
            return

        audio_model = settings.audio_model
        voice_name = settings.audio_voice_name
        top_k = settings.audio_top_k_results

        logger.info(
            "Folder audio session starting folder=%s user=%s model=%s voice=%s session=%s",
            folder_name, user_id, audio_model, voice_name, session_id,
        )

        # Must use v1beta for Gemini 3.x Live models
        client = genai.Client(
            api_key=api_key,
            http_options={"api_version": "v1beta"},
        )
        model_name = audio_model.removeprefix("models/")

        live_config = gt.LiveConnectConfig(
            response_modalities=["AUDIO"],
            output_audio_transcription=_make_audio_transcription_config(gt),
            input_audio_transcription=_make_audio_transcription_config(gt),
            realtime_input_config=gt.RealtimeInputConfig(
                automatic_activity_detection=gt.AutomaticActivityDetection(
                    disabled=False,
                    start_of_speech_sensitivity=gt.StartSensitivity.START_SENSITIVITY_HIGH,
                    end_of_speech_sensitivity=gt.EndSensitivity.END_SENSITIVITY_LOW,
                    prefix_padding_ms=20,
                    silence_duration_ms=600,
                )
            ),
            speech_config=gt.SpeechConfig(
                voice_config=gt.VoiceConfig(
                    prebuilt_voice_config=gt.PrebuiltVoiceConfig(voice_name=voice_name)
                )
            ),
            tools=[gt.Tool(
                function_declarations=[gt.FunctionDeclaration(**_SEARCH_FN_DECLARATION)]
            )],
            system_instruction=(
                _DOCUMENT_AUDIO_SYSTEM_PROMPT
                + "\nAlways call search_documents before answering questions about the case. "
                  "Prioritize retrieved document content over your general knowledge."
            ),
        )

        async with client.aio.live.connect(model=model_name, config=live_config) as session:
            input_done = asyncio.Event()
            forwarded_chunks = 0
            forwarded_bytes = 0
            received_events = 0
            input_done_at: float | None = None

            # ── Task 1: forward mic audio → Gemini ────────────────────────────
            async def _forward_audio() -> None:
                nonlocal forwarded_chunks, forwarded_bytes, input_done_at
                try:
                    async for audio_bytes in receive_audio:
                        forwarded_chunks += 1
                        forwarded_bytes += len(audio_bytes)
                        await session.send_realtime_input(
                            audio=gt.Blob(
                                data=audio_bytes,
                                mime_type="audio/pcm;rate=16000",
                            )
                        )
                finally:
                    try:
                        await session.send_realtime_input(audio_stream_end=True)
                        # Force turn generation in SDK variants that don't auto-close on stream end
                        await session.send(input=".", end_of_turn=True)
                    except Exception as exc:
                        logger.debug("Could not send audio_stream_end: %s", exc)
                    input_done_at = asyncio.get_running_loop().time()
                    input_done.set()

            # ── Task 2: receive Gemini responses → client ─────────────────────
            async def _receive_responses() -> None:
                nonlocal received_events
                while True:
                    got_model_output = False
                    turn = session.receive()
                    async for response in turn:
                        received_events += 1
                        logger.debug(
                            "Gemini Live event #%d folder=%s", received_events, folder_name
                        )

                        # ── tool calls ──
                        tool_call = getattr(response, "tool_call", None)
                        if tool_call:
                            fn_responses: list[gt.FunctionResponse] = []
                            for fc in tool_call.function_calls:
                                if fc.name == "search_documents":
                                    audio_query = fc.args.get("query", "")
                                    logger.info(
                                        "Audio tool call: search_documents(query=%r) folder=%s",
                                        audio_query, folder_name,
                                    )
                                    context = await search_folder_documents(
                                        folder_name, user_id, audio_query, top_k
                                    )
                                    logger.info(
                                        "Audio tool result: folder=%s context_chars=%d",
                                        folder_name, len(context),
                                    )
                                    fn_responses.append(
                                        gt.FunctionResponse(
                                            id=fc.id,
                                            name=fc.name,
                                            response={"result": context},
                                        )
                                    )
                                    await send_response({
                                        "type": "tool_call",
                                        "tool": "search_documents",
                                        "query": audio_query,
                                    })
                            if fn_responses:
                                await session.send_tool_response(
                                    function_responses=fn_responses
                                )

                        # ── server content (primary response path) ────────────
                        sent_audio = False
                        sent_text = False
                        server_content = getattr(response, "server_content", None)
                        if server_content:
                            input_tx = getattr(server_content, "input_transcription", None)
                            if input_tx and getattr(input_tx, "text", None):
                                logger.info(
                                    "Audio input transcript: %r folder=%s",
                                    input_tx.text, folder_name,
                                )
                                await send_response({
                                    "type": "input_transcript",
                                    "content": input_tx.text,
                                })

                            output_tx = getattr(server_content, "output_transcription", None)
                            if output_tx and getattr(output_tx, "text", None):
                                got_model_output = True
                                sent_text = True
                                logger.info(
                                    "Audio output transcript: %r folder=%s",
                                    output_tx.text, folder_name,
                                )
                                await send_response({
                                    "type": "text",
                                    "content": output_tx.text,
                                })

                            model_turn = getattr(server_content, "model_turn", None)
                            parts = getattr(model_turn, "parts", None) if model_turn else None
                            if parts:
                                for part in parts:
                                    inline_data = getattr(part, "inline_data", None)
                                    if inline_data and getattr(inline_data, "data", None):
                                        got_model_output = True
                                        sent_audio = True
                                        mime_type = getattr(
                                            inline_data, "mime_type", "audio/pcm;rate=24000"
                                        )
                                        await send_response({
                                            "type": "audio",
                                            "data": base64.b64encode(
                                                inline_data.data
                                            ).decode(),
                                            "mime_type": mime_type,
                                        })
                                    if not sent_text and getattr(part, "text", None):
                                        got_model_output = True
                                        sent_text = True
                                        await send_response({
                                            "type": "text",
                                            "content": part.text,
                                        })

                        # ── legacy SDK response shape (fallback) ──────────────
                        if not sent_audio and getattr(response, "data", None):
                            got_model_output = True
                            await send_response({
                                "type": "audio",
                                "data": base64.b64encode(response.data).decode(),
                                "mime_type": "audio/pcm;rate=24000",
                            })
                        if not sent_text and getattr(response, "text", None):
                            got_model_output = True
                            await send_response({
                                "type": "text",
                                "content": response.text,
                            })

                    await send_response({"type": "turn_complete"})
                    logger.info(
                        "Audio turn complete folder=%s input_done=%s events=%d output=%s",
                        folder_name, input_done.is_set(), received_events, got_model_output,
                    )

                    if input_done.is_set():
                        if got_model_output:
                            return
                        if input_done_at is not None:
                            elapsed = asyncio.get_running_loop().time() - input_done_at
                            if elapsed > 20:
                                logger.warning(
                                    "Gemini Live produced no output %.1fs after stream end "
                                    "folder=%s; closing session",
                                    elapsed, folder_name,
                                )
                                return

            forward_task = asyncio.create_task(_forward_audio())
            receive_task = asyncio.create_task(_receive_responses())
            try:
                await asyncio.gather(forward_task, receive_task)
            finally:
                for task in (forward_task, receive_task):
                    if not task.done():
                        task.cancel()
                logger.info(
                    "Folder audio session closed folder=%s user=%s "
                    "chunks=%d bytes=%d events=%d session=%s ip=%s",
                    folder_name, user_id,
                    forwarded_chunks, forwarded_bytes, received_events,
                    session_id, ip_address,
                )

    except Exception as exc:
        logger.error("handle_folder_audio_session error folder=%s: %s", folder_name, exc)
        await send_response({"type": "error", "message": str(exc)})
