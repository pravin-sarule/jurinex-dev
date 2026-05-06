"""
Core chatbot logic — two separate agents (landing page + in-app) plus Gemini Live audio.
All runtime parameters are loaded from the chatbot_config DB table.

Agents:
  landing_page_agent  — public chatbot: legal search + demo booking tools
  app_panel_agent     — in-app assistant: search only, strict step-by-step format
  text_chat           — dispatcher: routes based on [APP CONTEXT: ...] prefix
  handle_audio_session — Gemini Live audio (supports is_in_app flag)
"""
from __future__ import annotations

import asyncio
import base64
import importlib.metadata
import logging
import math
import re
import time
from dataclasses import dataclass, field
from typing import AsyncGenerator, Callable, Awaitable

from app.services.db import get_db_connection, is_db_available
from app.services.search import search_documents, format_chunks_for_context
from app.services.token_usage_service import log_token_usage

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
- LANGUAGE: Always reply in the exact same language the user used. If the user
  writes in Marathi → reply in Marathi. Hindi → Hindi. English → English.
  Hinglish (mixed) → match the same mix. Never switch languages unprompted.
- Keep initial answers concise. If the topic is complex, offer to provide more
  detail.
- If no retrieved context is available, say: "My current database doesn't have
  the specific document, but based on general legal principles..." and clearly
  mark the answer as general legal information.

RESPONSE FORMATTING — always use rich Markdown:
- Use **bold** for legal terms, section names, and key points.
- Use numbered lists for step-by-step legal procedures.
- Use bullet lists for provisions, rights, or comparisons.
- Use ## or ### headings to separate sections (e.g. "## Key Provisions").
- Use | tables | for comparing statutes, penalties, or timeframes.
- Use > blockquotes for important warnings or legal notes.
- Never write long unbroken paragraphs — keep answers scannable.
""".strip()

_DEFAULT_AUDIO_SYSTEM_PROMPT = """
You are the JuriNex AI Assistant, a voice-first guide for the JuriNex legal platform.

Voice behavior:
- Speak clearly, professionally, and conversationally.
- Always call search_documents first for every question — the knowledge base has
  step-by-step platform guides and legal documents.
- When you find relevant guide content, read the steps aloud in order:
  "Step 1: ... Step 2: ... Step 3: ..."
- Keep spoken answers clear and structured — read numbered steps one at a time.
- Default to English. If the user speaks Marathi, Hindi, or Hinglish, respond in
  that language but keep the step numbering ("Step 1", "Step 2", etc.) clear.
- If interrupted, stop and listen for the new question.

Retrieval behavior:
- Call search_documents for EVERY question — platform guides are uploaded in the DB.
- If the retrieved context has step-by-step instructions, follow them exactly.
- If no relevant content is found, answer from general JuriNex platform knowledge.
- For legal questions: prioritize retrieved context, especially for BNS, BNSS, BSA.
- If retrieval returns nothing useful: "My knowledge base doesn't have that specific
  document, but here is what I know about this topic..."
""".strip()

_SEARCH_FN_DECLARATION = {
    "name": "search_documents",
    "description": (
        "Searches the JuriNex knowledge base — platform step-by-step guides, legal documents, "
        "case law, statutes, and uploaded user documents — using vector + keyword search. "
        "CALL THIS IMMEDIATELY for every user question. Do NOT ask for clarification first. "
        "Do NOT compose any answer before calling this tool."
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

_GET_SLOTS_FN_DECLARATION = {
    "name": "getAvailableSlots",
    "description": (
        "Fetches all available JuriNex product demo time slots. "
        "Call this immediately when the user asks to book, schedule, or see a demo."
    ),
    "parameters": {
        "type": "OBJECT",
        "properties": {},
    },
}

_BOOK_DEMO_FN_DECLARATION = {
    "name": "bookDemo",
    "description": "Books a JuriNex product demo for the user after collecting their details.",
    "parameters": {
        "type": "OBJECT",
        "properties": {
            "name":    {"type": "STRING",  "description": "Full name of the person"},
            "email":   {"type": "STRING",  "description": "Email address"},
            "company": {"type": "STRING",  "description": "Company or organisation name (optional)"},
            "slot_id": {"type": "INTEGER", "description": "The exact numeric `id` field returned by getAvailableSlots (e.g. if getAvailableSlots returned [{\"id\": 12, ...}], pass slot_id=12). Never use the option number or position — always use the id value."},
        },
        "required": ["name", "email", "slot_id"],
    },
}

_IN_APP_SYSTEM_PROMPT = """
You are the JuriNex Platform Assistant. You operate inside the JuriNex legal platform.
The knowledge base contains uploaded step-by-step platform guides. You must search and
use those guides to answer every question.

━━━ ABSOLUTE RULES - NEVER BREAK THESE ━━━
1. LANGUAGE: ALWAYS reply in the EXACT same language the user used. If the user writes
   or speaks in Marathi → reply fully in Marathi. Hindi → reply in Hindi. English → English.
   Hinglish (mixed) → match the same mix. Never switch languages unless the user does first.
2. NEVER ask the user for clarification. NEVER say "what do you mean", "could you clarify",
   "are you asking about", or any similar phrase. Just search and answer immediately.
3. NEVER reply with a paragraph of prose. ALWAYS use numbered steps (1. 2. 3.).
4. ALWAYS call search_documents as the very first action for every single question.
5. Assume every question is about JuriNex platform features unless proven otherwise.
   "Create a case" = creating a case inside JuriNex.
   "Upload" = uploading a document in JuriNex.
   "Analysis" = running AI analysis in JuriNex. Never ask which context — just search.

━━━ WORKFLOW - FOLLOW THIS EXACTLY ━━━
Step A → Call search_documents immediately with the user's question as the query.
Step B → Read the retrieved chunks.
Step C → If chunks are relevant: write a numbered step-by-step answer quoting the guide.
          If chunks are NOT relevant: answer from the CURRENT PAGE context below,
          still in numbered steps, using the button names and actions listed there.
Step D → NEVER produce a response without first completing Step A.

━━━ ANSWER FORMAT - MANDATORY ━━━
Every answer must be structured like this:

## [Short Title of What You Are Explaining]

1. **Step one action** - brief explanation
2. **Step two action** - brief explanation
3. **Step three action** - brief explanation

> **Tip:** any helpful note or warning

Rules:
- Keep answers SHORT — 3 to 5 steps maximum. No padding, no long explanations.
- **Bold** every button name, field name, tab name, and action
- Use numbered lists for all sequences and workflows
- Use bullet lists (- item) for feature lists or options
- Use > blockquotes for tips and warnings only when essential
- Never write long unbroken paragraphs
- Never ask for clarification — search first, answer from results
- Never offer demo booking, never call getAvailableSlots or bookDemo
""".strip()

# Regex to extract [APP CONTEXT: ...] prefix that the frontend injects
_APP_CONTEXT_RE = re.compile(
    r"^\[APP CONTEXT:\s*(?P<ctx>[^\]]+)\]\s*\nUSER:\s*(?P<question>.+)$",
    re.DOTALL,
)

_DEMO_TEXT_ADDENDUM = """
DEMO BOOKING CAPABILITY:
- When the user asks to book, schedule, or see a demo — IMMEDIATELY call getAvailableSlots().
- After getAvailableSlots() returns, reply with ONLY this raw JSON (no extra text before or after):
  {"type":"slot_selection","message":"Great choice! Here are our available demo slots — pick a time that works for you and I'll collect your details.","slots":[{"id":<id>,"label":"<label>"},...]}
- If no slots are returned, respond warmly: "I'm sorry, no demo slots are available right now. Please check back tomorrow or drop us an email at demo@jurinex.com."
- After the user selects a slot and provides their name and email, call bookDemo() immediately to confirm — do not ask the user to fill any form.
- On successful bookDemo(), confirm warmly: "Your demo is confirmed for <slot label>! We'll send details to <email> shortly."
""".strip()

_DEMO_AUDIO_ADDENDUM = """
DEMO BOOKING CAPABILITY:
- When the user asks to book or schedule a demo, IMMEDIATELY call getAvailableSlots().
- Read the available slots aloud clearly, e.g.: "We have slots available: Option 1 — Monday, May 5th at 10 AM. Option 2 — Tuesday, May 6th at 2 PM." Then say: "A slot selection panel has appeared on your screen — please tap a slot to choose."
- After the user picks a slot, ask: "What is your full name?" then "What is your email address?" then "Which company are you from?" (optional).
- Once you have name, email and slot, call bookDemo() immediately to confirm the booking.
- Confirm aloud: "Your demo is confirmed! We'll send details to your email shortly."
- If no slots are available, apologise warmly and suggest trying again tomorrow.
""".strip()


# ── config ────────────────────────────────────────────────────────────────────

@dataclass
class ChatbotConfig:
    model_text: str             = "gemini-2.5-flash"
    model_audio: str            = "gemini-3.1-flash-live-preview"
    max_tokens: int             = 2048
    temperature: float          = 0.1
    top_p: float                = 0.95
    top_k_results: int          = 5
    voice_name: str             = "Aoede"
    language_code: str          = "en-US"
    speaking_rate: float        = 1.0
    pitch: float                = 0.0
    volume_gain_db: float       = 0.0
    system_prompt: str          = _DEFAULT_SYSTEM_PROMPT
    audio_system_prompt: str    = _DEFAULT_AUDIO_SYSTEM_PROMPT
    in_app_system_prompt: str   = _IN_APP_SYSTEM_PROMPT
    in_app_audio_override: str  = (
        "━━━ VOICE MODE — THESE RULES OVERRIDE EVERYTHING ABOVE ━━━\n"
        "ABSOLUTE PROHIBITION — NEVER output ANY of these in voice mode:\n"
        "  - Markdown headers: ##, ###  |  Bold/italic: **, __, *, _\n"
        "  - Bullet symbols: -, *, +    |  Tables: | column |\n"
        "  - Blockquotes: >             |  Code blocks: ``` or `\n"
        "\n"
        "SPEAK LIKE THIS instead:\n"
        "  - Replace numbered list → say 'First... Second... Third...'\n"
        "  - Replace bold term → just say the word normally\n"
        "  - Replace heading → say 'Here is how to...' as an intro sentence\n"
        "  - Keep answers to 3–5 spoken steps. Short, clear sentences.\n"
        "\n"
        "LANGUAGE: Detect the language the user spoke and reply in that exact language.\n"
        "ALWAYS call search_documents first before answering.\n"
        "Never offer demo booking in the in-app panel."
    )
    demo_text_addendum: str     = _DEMO_TEXT_ADDENDUM
    demo_audio_addendum: str    = _DEMO_AUDIO_ADDENDUM


@dataclass
class ChatResult:
    answer: str
    input_tokens: int = 0
    output_tokens: int = 0


_config_cache: ChatbotConfig | None = None
_config_loaded_at: float = 0.0
_CONFIG_CACHE_TTL: float = 120.0  # re-read DB every 2 minutes so voice/model changes apply without restart


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


def load_chatbot_config(bypass_cache: bool = False) -> ChatbotConfig:
    global _config_cache, _config_loaded_at
    now = time.monotonic()
    if not bypass_cache and _config_cache is not None and (now - _config_loaded_at) < _CONFIG_CACHE_TTL:
        return _config_cache
    if not is_db_available():
        logger.warning("DB unavailable — using default ChatbotConfig")
        return ChatbotConfig()
    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
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
            cfg.system_prompt         = row["system_prompt"]          if row.get("system_prompt")          is not None else cfg.system_prompt
            cfg.audio_system_prompt   = row["audio_system_prompt"]    if row.get("audio_system_prompt")    is not None else cfg.audio_system_prompt
            cfg.in_app_system_prompt  = row["in_app_system_prompt"]   if row.get("in_app_system_prompt")   is not None else cfg.in_app_system_prompt
            cfg.in_app_audio_override = row["in_app_audio_override"]  if row.get("in_app_audio_override")  is not None else cfg.in_app_audio_override
            cfg.demo_text_addendum    = row["demo_text_addendum"]     if row.get("demo_text_addendum")     is not None else cfg.demo_text_addendum
            cfg.demo_audio_addendum   = row["demo_audio_addendum"]    if row.get("demo_audio_addendum")    is not None else cfg.demo_audio_addendum
            logger.info(
                "Loaded chatbot config from DB: model_text=%s model_audio=%s voice=%s",
                cfg.model_text, cfg.model_audio, cfg.voice_name,
            )
            _config_cache = cfg
            _config_loaded_at = time.monotonic()
            return _config_cache
    except Exception as exc:
        logger.warning("Could not load chatbot config from DB: %s", exc)
    return ChatbotConfig()


def invalidate_config_cache() -> None:
    global _config_cache, _config_loaded_at
    _config_cache = None
    _config_loaded_at = 0.0


def _make_audio_transcription_config(gt):
    return gt.AudioTranscriptionConfig()


# ── shared helpers ─────────────────────────────────────────────────────────────

def _execute_text_tool(name: str, args: dict, cfg: ChatbotConfig, top_k_override: int | None = None) -> object:
    """Execute a tool call during the text-chat agentic loop."""
    if name == "search_documents":
        query = args.get("query", "")
        top_k = top_k_override if top_k_override is not None else cfg.top_k_results
        logger.info("TEXT TOOL: search_documents query=%r top_k=%d", query, top_k)
        chunks = search_documents(query, top_k=top_k)
        logger.info("TEXT TOOL: search_documents returned %d chunks", len(chunks))
        return format_chunks_for_context(chunks) or "No relevant documents found."

    if name == "getAvailableSlots":
        logger.info("TEXT TOOL: getAvailableSlots")
        from app.services.demo_service import get_available_slots
        slots = get_available_slots()
        if not slots:
            return {"available": False, "message": "No demo slots available. Please try again tomorrow."}
        return {"available": True, "slots": [{"id": s["id"], "label": s["label"]} for s in slots]}

    if name == "bookDemo":
        logger.info("TEXT TOOL: bookDemo args=%r", args)
        from app.services.demo_service import book_demo
        return book_demo(
            name=str(args.get("name", "")),
            email=str(args.get("email", "")),
            slot_id=int(args.get("slot_id", 0)),
            company=str(args.get("company", "")),
        )

    logger.warning("TEXT TOOL: unknown tool name=%s", name)
    return {"error": f"Unknown tool: {name}"}


def _load_history_contents(session_id: str | None, gt) -> list:
    """Load recent chat history as Gemini Content list for multi-turn context."""
    if not session_id or session_id == "no-db":
        return []
    try:
        from app.services.session_service import get_history
        history = get_history(session_id, limit=6)  # last 3 Q&A turns
        contents = []
        for msg in history:
            role = "user" if msg["role"] == "user" else "model"
            contents.append(gt.Content(role=role, parts=[gt.Part(text=msg["content"])]))
        return contents
    except Exception as exc:
        logger.warning("Could not load conversation history: %s", exc)
        return []


def _run_agentic_loop(
    client,
    cfg: ChatbotConfig,
    system_instruction: str,
    tools: list,
    clean_question: str,
    history_contents: list,
    is_in_app: bool,
) -> ChatResult:
    """
    Shared agentic loop — builds Gemini contents from history + current question,
    executes up to 6 tool-call rounds, returns the final answer.
    """
    from google.genai import types as gt  # type: ignore

    effective_max_tokens = max(_MIN_TEXT_OUTPUT_TOKENS, min(cfg.max_tokens, _MAX_TEXT_OUTPUT_TOKENS))

    gen_cfg = gt.GenerateContentConfig(
        system_instruction=system_instruction,
        temperature=cfg.temperature,
        max_output_tokens=effective_max_tokens,
        top_p=cfg.top_p,
        tools=tools,
    )

    # Prior turns (history) + current question
    contents = list(history_contents) + [
        gt.Content(role="user", parts=[gt.Part(text=clean_question)])
    ]

    # total_input is set to the LAST round's prompt_token_count only.
    # Each round's prompt_token_count grows as tool results are appended to the
    # context window — summing across rounds would count earlier tokens multiple
    # times and inflate the figure massively (the reported 8→18939 bug).
    # The final round's prompt_token_count already reflects the full accumulated
    # context, so it is the correct single number to record for input cost.
    # Output tokens are summed because each round generates independent tokens.
    last_input_tokens = 0
    total_output = 0
    response = None
    _in_app_top_k = 12 if is_in_app else None

    for _round in range(6):
        response = client.models.generate_content(
            model=cfg.model_text,
            contents=contents,
            config=gen_cfg,
        )
        logger.debug("AGENT ROUND %d response=%r", _round, response)

        usage = getattr(response, "usage_metadata", None)
        if usage:
            round_input = int(getattr(usage, "prompt_token_count", 0) or 0)
            if round_input > 0:
                last_input_tokens = round_input  # keep updating; final value = last round
            total_output += int(getattr(usage, "candidates_token_count", 0) or 0)

        candidate = response.candidates[0] if response.candidates else None
        if not candidate or not candidate.content:
            break

        parts = candidate.content.parts or []
        fn_calls = [p.function_call for p in parts if getattr(p, "function_call", None)]

        if not fn_calls:
            break  # final text response

        fn_response_parts = []
        for fc in fn_calls:
            result = _execute_text_tool(fc.name, dict(fc.args or {}), cfg, top_k_override=_in_app_top_k)
            fn_response_parts.append(
                gt.Part(
                    function_response=gt.FunctionResponse(
                        name=fc.name,
                        response={"result": result},
                    )
                )
            )

        contents.append(candidate.content)
        contents.append(gt.Content(role="user", parts=fn_response_parts))

    total_input = last_input_tokens

    answer = (response.text if response else None) or "I couldn't generate a response."
    logger.info("BOT REPLY (%s): %s", "app" if is_in_app else "landing", answer[:200])
    logger.info("TOKENS input=%d output=%d model=%s", total_input, total_output, cfg.model_text)

    return ChatResult(answer=answer, input_tokens=total_input, output_tokens=total_output)


# ── landing page agent ────────────────────────────────────────────────────────

def landing_page_agent(user_message: str, session_id: str | None = None) -> ChatResult:
    """
    Landing page chatbot agent.
    Tools: search_documents + getAvailableSlots + bookDemo.
    Conversational, markdown-rich, legal-focused responses.
    """
    logger.info("LANDING AGENT session=%s msg=%r", session_id, user_message[:100])
    try:
        from google import genai  # type: ignore
        from google.genai import types as gt
        from app.core.config import get_settings

        api_key = get_settings().gemini_api_key
        if not api_key:
            return ChatResult(answer="Service not configured — missing GEMINI_API_KEY.")

        cfg = load_chatbot_config()
        client = genai.Client(api_key=api_key)

        system_instruction = cfg.system_prompt + "\n\n" + cfg.demo_text_addendum
        tools = [gt.Tool(function_declarations=[
            gt.FunctionDeclaration(**_SEARCH_FN_DECLARATION),
            gt.FunctionDeclaration(**_GET_SLOTS_FN_DECLARATION),
            gt.FunctionDeclaration(**_BOOK_DEMO_FN_DECLARATION),
        ])]

        history_contents = _load_history_contents(session_id, gt)
        logger.debug(
            "LANDING AGENT model=%s history_turns=%d temperature=%s top_k=%s",
            cfg.model_text, len(history_contents) // 2, cfg.temperature, cfg.top_k_results,
        )

        return _run_agentic_loop(
            client, cfg, system_instruction, tools,
            user_message, history_contents, is_in_app=False,
        )

    except Exception as exc:
        logger.exception("landing_page_agent error")
        return ChatResult(answer=f"AI service error: {exc}")


# ── in-app panel agent ────────────────────────────────────────────────────────

def app_panel_agent(user_message: str, session_id: str | None = None) -> ChatResult:
    """
    In-app platform assistant agent.
    Parses [APP CONTEXT: page] prefix injected by the frontend.
    Tools: search_documents only — no demo booking.
    Strict numbered step-by-step format.
    """
    m = _APP_CONTEXT_RE.match(user_message.strip())
    if m:
        page_context = m.group("ctx").strip()
        clean_question = m.group("question").strip()
    else:
        page_context = "JuriNex Platform"
        clean_question = user_message

    logger.info("APP AGENT session=%s page=%r question=%r", session_id, page_context, clean_question[:100])
    try:
        from google import genai  # type: ignore
        from google.genai import types as gt
        from app.core.config import get_settings

        api_key = get_settings().gemini_api_key
        if not api_key:
            return ChatResult(answer="Service not configured — missing GEMINI_API_KEY.")

        cfg = load_chatbot_config()
        client = genai.Client(api_key=api_key)

        system_instruction = cfg.in_app_system_prompt + f"\n\nCURRENT PAGE: {page_context}"
        tools = [gt.Tool(function_declarations=[
            gt.FunctionDeclaration(**_SEARCH_FN_DECLARATION),
        ])]

        history_contents = _load_history_contents(session_id, gt)
        logger.debug(
            "APP AGENT model=%s history_turns=%d page=%r",
            cfg.model_text, len(history_contents) // 2, page_context,
        )

        return _run_agentic_loop(
            client, cfg, system_instruction, tools,
            clean_question, history_contents, is_in_app=True,
        )

    except Exception as exc:
        logger.exception("app_panel_agent error")
        return ChatResult(answer=f"AI service error: {exc}")


# ── dispatcher ────────────────────────────────────────────────────────────────

def text_chat(user_message: str, session_id: str | None = None) -> ChatResult:
    """
    Routes to app_panel_agent (when [APP CONTEXT: ...] prefix is present)
    or landing_page_agent for public chatbot messages.
    """
    m = _APP_CONTEXT_RE.match(user_message.strip())
    if m:
        return app_panel_agent(user_message, session_id=session_id)
    return landing_page_agent(user_message, session_id=session_id)


# ── audio chat (Gemini Live) ──────────────────────────────────────────────────

SendFn = Callable[[dict], Awaitable[None]]


async def handle_audio_session(
    receive_audio: AsyncGenerator[bytes, None],
    send_response: SendFn,
    *,
    session_id: str | None = None,
    ip_address: str | None = None,
    is_in_app: bool = False,
    initial_message: str | None = None,
    text_inject_queue: asyncio.Queue | None = None,
) -> None:
    """
    Bridges a client WebSocket audio stream with the Gemini Live API.

    is_in_app=True  → in-app panel audio: search only, no demo booking
    is_in_app=False → landing page audio: search + demo booking
    text_inject_queue → optional queue of text strings to inject into the session
                        (used when the frontend sends a UI-driven slot selection)
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

        # Always read fresh from DB for each audio session so voice/model changes
        # from the admin panel take effect immediately without waiting for TTL
        # and without being affected by stale caches in other worker processes.
        cfg = load_chatbot_config(bypass_cache=True)

        # ── agent-specific tools and system instruction ───────────────────────
        if is_in_app:
            audio_system_instruction = cfg.in_app_system_prompt + "\n\n" + cfg.in_app_audio_override
            audio_tools = [gt.Tool(function_declarations=[
                gt.FunctionDeclaration(**_SEARCH_FN_DECLARATION),
            ])]
            logger.debug("AUDIO CONFIG (in-app) model=%s voice=%s", cfg.model_audio, cfg.voice_name)
        else:
            audio_system_instruction = (
                cfg.audio_system_prompt
                + "\n\n" + cfg.demo_audio_addendum
                + "\nAlways call search_documents with the user's question before answering. "
                  "Use retrieved context first. If no useful context is returned, say the "
                  "database does not have the specific document and give only general "
                  "information, not legal advice."
            )
            audio_tools = [gt.Tool(function_declarations=[
                gt.FunctionDeclaration(**_SEARCH_FN_DECLARATION),
                gt.FunctionDeclaration(**_GET_SLOTS_FN_DECLARATION),
                gt.FunctionDeclaration(**_BOOK_DEMO_FN_DECLARATION),
            ])]
            logger.debug("AUDIO CONFIG (landing) model=%s voice=%s", cfg.model_audio, cfg.voice_name)

        # ── MUST use api_version=v1beta for Gemini 3.1 Flash Live ──
        client = genai.Client(
            api_key=api_key,
            http_options={"api_version": "v1beta"},
        )

        model_name = cfg.model_audio.removeprefix("models/")

        # speaking_rate / pitch / volume_gain_db are stored in DB config but are not
        # parameters of the Gemini Live API (they belong to Google Cloud TTS). Logged
        # here so the values are visible and ready if the voice backend ever changes.
        logger.info(
            "AUDIO SESSION cfg: model=%s voice=%s lang=%s speaking_rate=%s pitch=%s volume_gain_db=%s",
            model_name, cfg.voice_name, cfg.language_code,
            cfg.speaking_rate, cfg.pitch, cfg.volume_gain_db,
        )

        live_config = gt.LiveConnectConfig(
            response_modalities=["AUDIO"],
            output_audio_transcription=_make_audio_transcription_config(gt),
            input_audio_transcription=_make_audio_transcription_config(gt),
            generation_config=gt.GenerationConfig(
                temperature=cfg.temperature,
                top_p=cfg.top_p,
            ),
            realtime_input_config=gt.RealtimeInputConfig(
                automatic_activity_detection=gt.AutomaticActivityDetection(
                    disabled=False,
                    start_of_speech_sensitivity=gt.StartSensitivity.START_SENSITIVITY_HIGH,
                    end_of_speech_sensitivity=gt.EndSensitivity.END_SENSITIVITY_LOW,
                    prefix_padding_ms=300,
                    silence_duration_ms=1000,
                )
            ),
            speech_config=gt.SpeechConfig(
                language_code=cfg.language_code,
                voice_config=gt.VoiceConfig(
                    prebuilt_voice_config=gt.PrebuiltVoiceConfig(
                        voice_name=cfg.voice_name
                    )
                )
            ),
            tools=audio_tools,
            system_instruction=audio_system_instruction,
        )

        async with client.aio.live.connect(
            model=model_name, config=live_config
        ) as session:
            input_done = asyncio.Event()
            forwarded_chunks = 0
            forwarded_bytes = 0        # raw PCM-16 bytes sent to Gemini @ 16 kHz
            audio_output_bytes = 0     # raw PCM-16 bytes received from Gemini @ 24 kHz
            last_text_input_tokens = 0 # prompt_token_count from Gemini Live usage_metadata (system prompt + chunks)
            received_events = 0
            input_done_at: float | None = None
            # Track transcripts per turn for DB storage
            _last_input_transcript: str = ""
            _last_output_transcript: str = ""

            logger.info(
                "Gemini Live connected model=%s mode=%s session=%s",
                model_name, "app" if is_in_app else "landing", session_id,
            )

            # ── Task 1: forward mic audio → Gemini ────────────────────────────
            async def _forward_audio() -> None:
                nonlocal forwarded_chunks, forwarded_bytes, input_done_at
                try:
                    if initial_message:
                        logger.info("Injecting initial message for booking mode: %r", initial_message)
                        await session.send(input=initial_message, end_of_turn=True)

                    async for audio_bytes in receive_audio:
                        # Drain any UI-injected text (e.g. slot selection tapped on screen)
                        # before sending the next audio chunk so the model sees the context.
                        if text_inject_queue:
                            while not text_inject_queue.empty():
                                try:
                                    text = text_inject_queue.get_nowait()
                                    logger.info("AUDIO TEXT INJECT: %r", text)
                                    await session.send(input=text, end_of_turn=True)
                                except asyncio.QueueEmpty:
                                    break

                        forwarded_chunks += 1
                        forwarded_bytes += len(audio_bytes)
                        logger.debug(
                            "Gemini Live forward chunk=%d bytes=%d total=%d",
                            forwarded_chunks, len(audio_bytes), forwarded_bytes,
                        )
                        await session.send_realtime_input(
                            audio=gt.Blob(data=audio_bytes, mime_type="audio/pcm;rate=16000")
                        )
                finally:
                    try:
                        logger.info(
                            "Gemini Live audio_stream_end chunks=%d bytes=%d",
                            forwarded_chunks, forwarded_bytes,
                        )
                        # Only signal audio end — server-side VAD already fired at silence_duration_ms
                        # and the model has started responding. Sending end_of_turn here would
                        # interrupt the in-progress response.
                        await session.send_realtime_input(audio_stream_end=True)
                    except Exception as exc:
                        logger.debug("Could not send audio_stream_end: %s", exc)
                    input_done_at = asyncio.get_running_loop().time()
                    input_done.set()

            # ── Task 2: receive Gemini responses → client ─────────────────────
            async def _receive_responses() -> None:
                nonlocal received_events, audio_output_bytes, last_text_input_tokens
                nonlocal _last_input_transcript, _last_output_transcript
                while True:
                    got_model_output = False
                    turn_input_transcript = ""
                    turn_output_transcript = ""
                    turn_audio_sent = False  # tracks whether inline_data audio was sent this turn
                    turn = session.receive()
                    async for response in turn:
                        received_events += 1
                        logger.debug("Gemini Live event #%d raw=%r", received_events, response)

                        # ── tool calls ────────────────────────────────────────
                        tool_call = getattr(response, "tool_call", None)
                        if tool_call:
                            fn_responses: list[gt.FunctionResponse] = []
                            for fc in tool_call.function_calls:
                                if fc.name == "search_documents":
                                    audio_query = fc.args.get("query", "")
                                    logger.info("AUDIO TOOL: search_documents(query=%r)", audio_query)
                                    chunks = await asyncio.get_event_loop().run_in_executor(
                                        None, search_documents, audio_query, cfg.top_k_results
                                    )
                                    logger.info("AUDIO TOOL: %d chunk(s) returned", len(chunks))
                                    fn_responses.append(
                                        gt.FunctionResponse(
                                            id=fc.id,
                                            name=fc.name,
                                            response={"result": format_chunks_for_context(chunks)},
                                        )
                                    )
                                    await send_response({"type": "tool_call", "tool": "search_documents", "query": audio_query})

                                elif fc.name == "getAvailableSlots" and not is_in_app:
                                    logger.info("AUDIO TOOL: getAvailableSlots")
                                    from app.services.demo_service import get_available_slots
                                    slots = await asyncio.get_event_loop().run_in_executor(None, get_available_slots)
                                    if slots:
                                        formatted = [{"id": s["id"], "label": s["label"]} for s in slots]
                                        await send_response({
                                            "type": "slot_selection",
                                            "message": "Here are the available demo slots. Please select one:",
                                            "slots": formatted,
                                        })
                                        fn_responses.append(
                                            gt.FunctionResponse(
                                                id=fc.id, name=fc.name,
                                                response={"result": {"available": True, "slots": formatted}},
                                            )
                                        )
                                    else:
                                        fn_responses.append(
                                            gt.FunctionResponse(
                                                id=fc.id, name=fc.name,
                                                response={"result": {"available": False, "message": "No slots available."}},
                                            )
                                        )

                                elif fc.name == "bookDemo" and not is_in_app:
                                    args = dict(fc.args or {})
                                    logger.info("AUDIO TOOL: bookDemo args=%r", args)
                                    from app.services.demo_service import book_demo
                                    result = await asyncio.get_event_loop().run_in_executor(
                                        None,
                                        lambda: book_demo(
                                            name=str(args.get("name", "")),
                                            email=str(args.get("email", "")),
                                            slot_id=int(args.get("slot_id", 0)),
                                            company=str(args.get("company", "")),
                                        ),
                                    )
                                    fn_responses.append(
                                        gt.FunctionResponse(id=fc.id, name=fc.name, response={"result": result})
                                    )

                            if fn_responses:
                                await session.send_tool_response(function_responses=fn_responses)

                        # ── response content ──────────────────────────────────
                        sent_audio = False
                        sent_text = False
                        server_content = getattr(response, "server_content", None)
                        if server_content:
                            input_tx = getattr(server_content, "input_transcription", None)
                            if input_tx and getattr(input_tx, "text", None):
                                turn_input_transcript += input_tx.text
                                logger.info("AUDIO INPUT TRANSCRIPT: %r", input_tx.text)
                                await send_response({"type": "input_transcript", "content": input_tx.text})

                            output_tx = getattr(server_content, "output_transcription", None)
                            if output_tx and getattr(output_tx, "text", None):
                                got_model_output = True
                                sent_text = True
                                turn_output_transcript += output_tx.text
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
                                        turn_audio_sent = True
                                        audio_output_bytes += len(inline_data.data)
                                        mime_type = getattr(inline_data, "mime_type", "audio/pcm;rate=24000")
                                        await send_response({
                                            "type": "audio",
                                            "data": base64.b64encode(inline_data.data).decode(),
                                            "mime_type": mime_type,
                                        })
                                    if not sent_text and getattr(part, "text", None):
                                        got_model_output = True
                                        sent_text = True
                                        turn_output_transcript += part.text
                                        await send_response({"type": "text", "content": part.text})

                        if not turn_audio_sent and not sent_audio and getattr(response, "data", None):
                            got_model_output = True
                            turn_audio_sent = True
                            audio_output_bytes += len(response.data)
                            await send_response({
                                "type": "audio",
                                "data": base64.b64encode(response.data).decode(),
                                "mime_type": "audio/pcm;rate=24000",
                            })
                        if not sent_text and getattr(response, "text", None):
                            got_model_output = True
                            turn_output_transcript += response.text
                            await send_response({"type": "text", "content": response.text})

                        # Track text token count (system prompt + document chunks) from API metadata.
                        # This mirrors the text model rule: use the last positive prompt_token_count.
                        # Audio bytes are counted separately via duration formula in the finally block.
                        usage = getattr(response, "usage_metadata", None)
                        if usage:
                            _t = int(getattr(usage, "prompt_token_count", 0) or 0)
                            if _t > 0:
                                last_text_input_tokens = _t

                    await send_response({"type": "turn_complete"})

                    # Save this turn's Q&A to DB
                    if turn_input_transcript or turn_output_transcript:
                        _last_input_transcript = turn_input_transcript or _last_input_transcript
                        _last_output_transcript = turn_output_transcript
                        if session_id and session_id != "no-db" and turn_input_transcript and turn_output_transcript:
                            loop = asyncio.get_running_loop()
                            try:
                                from app.services.session_service import save_exchange
                                await loop.run_in_executor(
                                    None,
                                    lambda: save_exchange(session_id, turn_input_transcript, turn_output_transcript),
                                )
                            except Exception as exc:
                                logger.debug("Audio save_exchange failed (non-fatal): %s", exc)

                    logger.info(
                        "Gemini Live turn complete input_done=%s events=%d got_output=%s",
                        input_done.is_set(), received_events, got_model_output,
                    )

                    if input_done.is_set():
                        if got_model_output:
                            return
                        if input_done_at is not None:
                            elapsed = asyncio.get_running_loop().time() - input_done_at
                            if elapsed > 20:
                                logger.warning(
                                    "Gemini Live no output %.1fs after audio_stream_end; closing",
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

                # Hybrid token counting for audio model:
                #   Text context (system prompt + document chunks): API usage_metadata.prompt_token_count
                #   User audio input: PCM-16 @ 16 kHz → 32000 bytes/sec → tokens = seconds × 32
                #                     = forwarded_bytes / 32000 × 32 = forwarded_bytes / 1000
                #   AI audio output:  PCM-16 @ 24 kHz → 48000 bytes/sec → tokens = seconds × 32
                #                     = audio_output_bytes / 48000 × 32 = audio_output_bytes / 1500
                audio_input_tokens = math.ceil(forwarded_bytes / 1000) if forwarded_bytes > 0 else 0
                computed_input_tokens  = last_text_input_tokens + audio_input_tokens
                computed_output_tokens = math.ceil(audio_output_bytes / 1500) if audio_output_bytes > 0 else 0

                logger.info(
                    "AUDIO TOKENS input=%d (text=%d audio=%d) output=%d "
                    "(in_bytes=%d out_bytes=%d) model=%s session=%s ip=%s",
                    computed_input_tokens, last_text_input_tokens, audio_input_tokens,
                    computed_output_tokens,
                    forwarded_bytes, audio_output_bytes,
                    model_name, session_id, ip_address,
                )
                loop = asyncio.get_running_loop()
                await loop.run_in_executor(
                    None,
                    lambda: log_token_usage(
                        session_id=session_id,
                        mode="audio",
                        model_name=model_name,
                        input_tokens=computed_input_tokens,
                        output_tokens=computed_output_tokens,
                        ip_address=ip_address,
                    ),
                )

    except Exception as exc:
        logger.error("handle_audio_session error: %s", exc)
        await send_response({"type": "error", "message": str(exc)})
