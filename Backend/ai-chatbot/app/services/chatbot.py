"""
Core chatbot logic — text (Gemini function-calling) and audio (Gemini Live).
All runtime parameters are loaded from the chatbot_config DB table.
"""
from __future__ import annotations

import asyncio
import base64
import importlib.metadata
import logging
from dataclasses import dataclass
from typing import AsyncGenerator, Callable, Awaitable

from app.services.db import get_db_connection, is_db_available
from app.services.search import search_documents, format_chunks_for_context

logger = logging.getLogger("ai_chatbot.chatbot")

_MIN_GOOGLE_GENAI_LIVE_VERSION = (1, 60, 0)
_MIN_TEXT_OUTPUT_TOKENS = 1
_MAX_TEXT_OUTPUT_TOKENS = 8192

_DEFAULT_SYSTEM_PROMPT = """
You are the JuriNex AI Legal Assistant, a high-speed legal intelligence agent
specializing in the Indian legal system.

Operating rules:
- Provide legal information and research, not legal advice.
- Always prioritize retrieved RAG context from JuriNex/Indian legal sources over
  general model knowledge, especially for BNS, BNSS, and BSA versus IPC, CrPC,
  and IEA.
- If a user mentions a case name, section number, statute, or legal doctrine,
  rely on retrieved context before answering.
- Summarize the core legal principle first. Include citations when available in
  the retrieved context, but do not over-list citations unless asked.
- Default to English. If the user speaks Marathi, Hindi, or Hinglish, respond in
  that language.
- Keep initial answers concise. If the topic is complex, offer to provide more
  detail.
- If no retrieved context is available, say: "My current database doesn't have
  the specific document, but based on general legal principles..." and clearly
  mark the answer as general legal information.
""".strip()

_DEFAULT_AUDIO_SYSTEM_PROMPT = """
You are the JuriNex AI Legal Assistant, a voice-first legal intelligence agent
for the Indian legal system.

Voice behavior:
- Speak clearly, professionally, and conversationally.
- Keep initial spoken answers under 45 seconds.
- Summarize the legal principle first. Avoid reading long citation lists unless
  the user asks.
- Default to English. If the user speaks Marathi, Hindi, or Hinglish, respond in
  that language.

Retrieval behavior:
- Always call search_documents before answering legal questions, especially when
  the user mentions a case name, section number, statute, or legal doctrine.
- Prioritize retrieved context over general training data, especially for BNS,
  BNSS, and BSA versus IPC, CrPC, and IEA.
- If retrieval returns no useful result, say: "My current database doesn't have
  the specific document, but based on general legal principles..." and keep the
  answer clearly framed as legal information, not legal advice.
- If interrupted, stop speaking and listen for the new context.
""".strip()

_SEARCH_FN_DECLARATION = {
    "name": "search_documents",
    "description": (
        "Searches the JuriNex knowledge base to find technical answers. "
        "Always call this before answering any user question."
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


# ── config ────────────────────────────────────────────────────────────────────

@dataclass
class ChatbotConfig:
    model_text: str          = "gemini-2.5-flash"
    model_audio: str         = "gemini-3.1-flash-live-preview"
    max_tokens: int          = 150
    temperature: float       = 0.1
    top_p: float             = 0.95
    top_k_results: int       = 5
    voice_name: str          = "Puck"
    language_code: str       = "en-US"
    speaking_rate: float     = 1.0
    pitch: float             = 0.0
    volume_gain_db: float    = 0.0
    system_prompt: str       = _DEFAULT_SYSTEM_PROMPT
    audio_system_prompt: str = _DEFAULT_AUDIO_SYSTEM_PROMPT


_config_cache: ChatbotConfig | None = None


def _parse_version(version: str) -> tuple[int, int, int]:
    parts = []
    for part in version.split(".")[:3]:
        digits = "".join(ch for ch in part if ch.isdigit())
        parts.append(int(digits or 0))
    while len(parts) < 3:
        parts.append(0)
    return tuple(parts)  # type: ignore[return-value]


def _ensure_current_live_sdk() -> None:
    try:
        version = importlib.metadata.version("google-genai")
    except importlib.metadata.PackageNotFoundError as exc:
        raise RuntimeError("google-genai is not installed. Run: pip install -U google-genai") from exc

    if _parse_version(version) < _MIN_GOOGLE_GENAI_LIVE_VERSION:
        required = ".".join(str(part) for part in _MIN_GOOGLE_GENAI_LIVE_VERSION)
        raise RuntimeError(
            "google-genai is too old for Gemini Live audio. "
            f"Installed {version}, required >= {required}. "
            "Run: pip install -U google-genai"
        )
    logger.debug("google-genai SDK version ok: %s", version)


def load_chatbot_config() -> ChatbotConfig:
    global _config_cache
    if _config_cache is not None:
        return _config_cache
    if not is_db_available():
        logger.warning("DB unavailable — using default ChatbotConfig")
        return ChatbotConfig()
    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                # Ensure a default row exists so DB-level defaults are applied first.
                cur.execute(
                    "INSERT INTO chatbot_config (config_key) VALUES ('default') "
                    "ON CONFLICT (config_key) DO NOTHING"
                )
                conn.commit()
                cur.execute(
                    "SELECT * FROM chatbot_config WHERE config_key = 'default' LIMIT 1"
                )
                row = cur.fetchone()
        if row:
            cfg = ChatbotConfig()
            cfg.model_text       = row["model_text"]           if row.get("model_text") is not None else cfg.model_text
            cfg.model_audio      = row["model_audio"]          if row.get("model_audio") is not None else cfg.model_audio
            cfg.max_tokens       = int(row["max_tokens"])       if row.get("max_tokens")    is not None else cfg.max_tokens
            cfg.temperature      = float(row["temperature"])    if row.get("temperature")   is not None else cfg.temperature
            cfg.top_p            = float(row["top_p"])          if row.get("top_p")         is not None else cfg.top_p
            cfg.top_k_results    = int(row["top_k_results"])    if row.get("top_k_results") is not None else cfg.top_k_results
            cfg.voice_name       = row["voice_name"]           if row.get("voice_name") is not None else cfg.voice_name
            cfg.language_code    = row["language_code"]        if row.get("language_code") is not None else cfg.language_code
            cfg.speaking_rate    = float(row["speaking_rate"]) if row.get("speaking_rate") is not None else cfg.speaking_rate
            cfg.pitch            = float(row["pitch"])          if row.get("pitch")         is not None else cfg.pitch
            cfg.volume_gain_db   = float(row["volume_gain_db"]) if row.get("volume_gain_db") is not None else cfg.volume_gain_db
            cfg.system_prompt    = row["system_prompt"]        if row.get("system_prompt") is not None else cfg.system_prompt
            cfg.audio_system_prompt = row["audio_system_prompt"] if row.get("audio_system_prompt") is not None else cfg.audio_system_prompt
            logger.info(
                "Loaded chatbot config from DB: model_text=%s model_audio=%s "
                "system_prompt=%r... audio_system_prompt=%r...",
                cfg.model_text, cfg.model_audio,
                cfg.system_prompt[:60], cfg.audio_system_prompt[:60],
            )
            _config_cache = cfg
            return _config_cache
    except Exception as exc:
        logger.warning("Could not load chatbot config from DB: %s", exc)
    return ChatbotConfig()


def invalidate_config_cache() -> None:
    global _config_cache
    _config_cache = None


def _make_audio_transcription_config(gt, _language_code: str):
    """
    Build AudioTranscriptionConfig in the most broadly compatible way.
    `language_codes` is skipped because some Gemini SDK/API versions reject it.
    """
    return gt.AudioTranscriptionConfig()


# ── text chat ─────────────────────────────────────────────────────────────────

def text_chat(user_message: str) -> str:
    """
    Sends user_message to Gemini with search_documents tool.
    Gemini calls the tool → backend executes search → Gemini answers.
    """
    logger.info("USER ASK: %s", user_message)

    try:
        from google import genai  # type: ignore
        from google.genai import types as gt
        from app.core.config import get_settings

        api_key = get_settings().gemini_api_key
        if not api_key:
            return "Service not configured — missing GEMINI_API_KEY."

        cfg = load_chatbot_config()
        client = genai.Client(api_key=api_key)
        effective_max_tokens = max(
            _MIN_TEXT_OUTPUT_TOKENS,
            min(cfg.max_tokens, _MAX_TEXT_OUTPUT_TOKENS),
        )

        logger.debug(
            "TEXT CONFIG model=%s max_tokens=%s effective_max_tokens=%s temperature=%s top_p=%s top_k=%s",
            cfg.model_text,
            cfg.max_tokens,
            effective_max_tokens,
            cfg.temperature,
            cfg.top_p,
            cfg.top_k_results,
        )

        chunks = search_documents(user_message, top_k=cfg.top_k_results)
        context = format_chunks_for_context(chunks)
        logger.info("TEXT RAG: %d chunk(s) returned", len(chunks))
        logger.debug("TEXT RAG CONTEXT length=%d preview=%r", len(context), context[:2000])

        if chunks:
            prompt = (
                "Use the retrieved legal/document context below as the primary authority. "
                "Answer the user's question from this context first. If the context has "
                "citations, section numbers, or case names, mention the most relevant ones "
                "briefly. Do not invent citations.\n"
                f"Keep the final answer very short and under {effective_max_tokens} output tokens.\n\n"
                f"RETRIEVED CONTEXT:\n{context}\n\n"
                f"USER QUESTION:\n{user_message}"
            )
        else:
            prompt = (
                "No relevant RAG context was retrieved for this query. Begin with: "
                "\"My current database doesn't have the specific document, but based on "
                "general legal principles...\" Then provide concise general legal "
                "information only, not legal advice.\n"
                f"Keep the final answer very short and under {effective_max_tokens} output tokens.\n\n"
                f"USER QUESTION:\n{user_message}"
            )
        gen_cfg = gt.GenerateContentConfig(
            system_instruction=cfg.system_prompt,
            temperature=cfg.temperature,
            max_output_tokens=effective_max_tokens,
            top_p=cfg.top_p,
            thinking_config=gt.ThinkingConfig(thinking_budget=0),
        )

        response = client.models.generate_content(
            model=cfg.model_text,
            contents=prompt,
            config=gen_cfg,
        )
        logger.debug("TEXT GEMINI RAW RESPONSE=%r", response)

        answer = response.text or "I couldn't generate a response."
        logger.info("BOT REPLY: %s", answer)
        return answer

    except Exception as exc:
        logger.exception("text_chat error")
        return f"AI service error: {exc}"


# ── audio chat (Gemini Live) ──────────────────────────────────────────────────

SendFn = Callable[[dict], Awaitable[None]]


async def handle_audio_session(
    receive_audio: AsyncGenerator[bytes, None],
    send_response: SendFn,
) -> None:
    """
    Bridges a client WebSocket audio stream with the Gemini Live API.
    Follows the official Google Gemini Live cookbook pattern:
      https://github.com/google-gemini/cookbook/blob/main/quickstarts/Get_started_LiveAPI.py

    receive_audio  — async generator of raw PCM-16 bytes @ 16 kHz mono
    send_response  — async callable that pushes JSON dicts to the client
    """
    try:
        from google import genai  # type: ignore
        from google.genai import types as gt
        from app.core.config import get_settings

        _ensure_current_live_sdk()

        api_key = get_settings().gemini_api_key
        if not api_key:
            await send_response({"type": "error", "message": "Missing GEMINI_API_KEY."})
            return

        cfg = load_chatbot_config()
        logger.debug(
            "AUDIO CONFIG model=%s voice=%s temperature=%s top_k=%s prompt_prefix=%r",
            cfg.model_audio,
            cfg.voice_name,
            cfg.temperature,
            cfg.top_k_results,
            cfg.audio_system_prompt[:500],
        )

        # ── MUST use api_version=v1beta for Gemini 3.1 Flash Live ──
        client = genai.Client(
            api_key=api_key,
            http_options={"api_version": "v1beta"},
        )

        # GenAI SDK Live examples use model ids without the "models/" prefix.
        model_name = cfg.model_audio.removeprefix("models/")

        live_config = gt.LiveConnectConfig(
            response_modalities=["AUDIO"],
            output_audio_transcription=_make_audio_transcription_config(gt, cfg.language_code),
            input_audio_transcription=_make_audio_transcription_config(gt, cfg.language_code),
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
                    prebuilt_voice_config=gt.PrebuiltVoiceConfig(
                        voice_name=cfg.voice_name
                    )
                )
            ),
            tools=[gt.Tool(
                function_declarations=[
                    gt.FunctionDeclaration(**_SEARCH_FN_DECLARATION)
                ]
            )],
            system_instruction=(
                cfg.audio_system_prompt
                + "\nAlways call search_documents with the user's question before answering. "
                  "Use retrieved context first. If no useful context is returned, say the "
                  "database does not have the specific document and give only general legal "
                  "information, not legal advice."
            ),
        )

        async with client.aio.live.connect(
            model=model_name, config=live_config
        ) as session:
            input_done = asyncio.Event()
            forwarded_chunks = 0
            forwarded_bytes = 0
            received_events = 0
            input_done_at: float | None = None
            logger.info("Gemini Live connected model=%s", model_name)

            # ── Task 1: forward mic audio → Gemini via send_realtime_input ──
            async def _forward_audio() -> None:
                nonlocal forwarded_chunks, forwarded_bytes, input_done_at
                try:
                    async for audio_bytes in receive_audio:
                        forwarded_chunks += 1
                        forwarded_bytes += len(audio_bytes)
                        logger.debug(
                            "Gemini Live forwarding audio chunk=%d bytes=%d total_bytes=%d",
                            forwarded_chunks,
                            len(audio_bytes),
                            forwarded_bytes,
                        )
                        # Keep this as realtime audio input for low-latency streaming.
                        await session.send_realtime_input(
                            audio=gt.Blob(data=audio_bytes, mime_type="audio/pcm;rate=16000")
                        )
                finally:
                    try:
                        logger.info(
                            "Gemini Live sending audio_stream_end chunks=%d bytes=%d",
                            forwarded_chunks,
                            forwarded_bytes,
                        )
                        await session.send_realtime_input(audio_stream_end=True)
                        # Explicitly mark end_of_turn to force model generation
                        # in SDK/API variants that don't auto-close a turn on audio_stream_end.
                        await session.send(input=".", end_of_turn=True)
                    except Exception as exc:
                        logger.debug("Could not send audio_stream_end: %s", exc)
                    input_done_at = asyncio.get_running_loop().time()
                    input_done.set()

            # ── Task 2: receive Gemini responses → client ──────────────────
            async def _receive_responses() -> None:
                nonlocal received_events
                while True:
                    got_model_output = False
                    turn = session.receive()
                    async for response in turn:
                        received_events += 1
                        logger.debug("Gemini Live event #%d raw=%r", received_events, response)

                        # ── tool calls ──
                        tool_call = getattr(response, "tool_call", None)
                        if tool_call:
                            fn_responses: list[gt.FunctionResponse] = []
                            for fc in tool_call.function_calls:
                                if fc.name == "search_documents":
                                    audio_query = fc.args.get("query", "")
                                    logger.info("AUDIO TOOL CALL: search_documents(query=%r)", audio_query)
                                    chunks = await asyncio.get_event_loop().run_in_executor(
                                        None, search_documents, audio_query, cfg.top_k_results
                                    )
                                    logger.info("AUDIO TOOL RESULT: %d chunk(s) returned", len(chunks))
                                    logger.debug(
                                        "AUDIO TOOL CONTEXT query=%r context=%r",
                                        audio_query,
                                        format_chunks_for_context(chunks)[:2000],
                                    )
                                    fn_responses.append(
                                        gt.FunctionResponse(
                                            id=fc.id,
                                            name=fc.name,
                                            response={"result": format_chunks_for_context(chunks)},
                                        )
                                    )
                                    await send_response({"type": "tool_call", "tool": "search_documents", "query": audio_query})
                            if fn_responses:
                                await session.send_tool_response(function_responses=fn_responses)

                        # ── newer SDK response shape (primary path) ──
                        # Always check server_content first. The older response.data /
                        # response.text shortcuts are SDK aliases to the same underlying
                        # data, so only use them as fallback to avoid sending duplicates.
                        sent_audio = False
                        sent_text = False
                        server_content = getattr(response, "server_content", None)
                        if server_content:
                            input_tx = getattr(server_content, "input_transcription", None)
                            if input_tx and getattr(input_tx, "text", None):
                                logger.info("AUDIO INPUT TRANSCRIPT: %r", input_tx.text)
                                await send_response({"type": "input_transcript", "content": input_tx.text})

                            output_tx = getattr(server_content, "output_transcription", None)
                            if output_tx and getattr(output_tx, "text", None):
                                got_model_output = True
                                sent_text = True
                                logger.info("AUDIO OUTPUT TRANSCRIPT: %r", output_tx.text)
                                await send_response({"type": "text", "content": output_tx.text})

                            model_turn = getattr(server_content, "model_turn", None)
                            parts = getattr(model_turn, "parts", None) if model_turn else None
                            if parts:
                                for part in parts:
                                    inline_data = getattr(part, "inline_data", None)
                                    if inline_data and getattr(inline_data, "data", None):
                                        got_model_output = True
                                        sent_audio = True
                                        mime_type = getattr(inline_data, "mime_type", "audio/pcm;rate=24000")
                                        logger.debug("Gemini Live audio response bytes=%d", len(inline_data.data))
                                        await send_response({
                                            "type": "audio",
                                            "data": base64.b64encode(inline_data.data).decode(),
                                            "mime_type": mime_type,
                                        })
                                    if not sent_text and getattr(part, "text", None):
                                        got_model_output = True
                                        sent_text = True
                                        await send_response({"type": "text", "content": part.text})

                        # ── older SDK response shape (fallback only) ──
                        # Only used when server_content did not carry audio/text,
                        # preventing double-send on current SDK versions.
                        if not sent_audio and getattr(response, "data", None):
                            got_model_output = True
                            logger.debug("Gemini Live audio response (legacy) bytes=%d", len(response.data))
                            await send_response({
                                "type": "audio",
                                "data": base64.b64encode(response.data).decode(),
                                "mime_type": "audio/pcm;rate=24000",
                            })
                        if not sent_text and getattr(response, "text", None):
                            got_model_output = True
                            logger.info("AUDIO TRANSCRIPT (legacy): %r", response.text)
                            await send_response({"type": "text", "content": response.text})

                    await send_response({"type": "turn_complete"})
                    logger.info(
                        "Gemini Live turn complete input_done=%s events=%d got_output=%s",
                        input_done.is_set(),
                        received_events,
                        got_model_output,
                    )

                    if input_done.is_set():
                        if got_model_output:
                            return
                        if input_done_at is not None:
                            elapsed = asyncio.get_running_loop().time() - input_done_at
                            if elapsed > 20:
                                logger.warning(
                                    "Gemini Live produced no model output %.1fs after audio_stream_end; closing session",
                                    elapsed,
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

    except Exception as exc:
        logger.error("handle_audio_session error: %s", exc)
        await send_response({"type": "error", "message": str(exc)})
