"""Google ADK drafting agent — App + Runner with ContextCacheConfig.

Follows the same pattern as ``agents/adk_app.py`` (the document-chat runner),
per Google's ADK context-caching guidance: the App declares a
``ContextCacheConfig`` and ADK manages Gemini explicit caches automatically —
the stable prefix (system instruction + supporting documents + prior section
turns) is cached and reused across every section-generation call, which is
the dominant cost/latency saver for long section-by-section drafts.

One runner is pooled per (drafting_session, model). One ADK session spans the
whole draft: the first turn is "primed" with the supporting-document parts;
every later section turn sends only the section prompt.
"""
from __future__ import annotations

import logging
import os
from typing import Any, AsyncIterator

from google.adk import Agent
from google.adk.agents.context_cache_config import ContextCacheConfig
from google.adk.apps.app import App
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService

logger = logging.getLogger(__name__)

APP_NAME = "drafting_app"
AGENT_NAME = "drafting_agent"

DEFAULT_TTL_SECONDS = int(os.environ.get("DRAFT_CACHE_TTL_SECONDS", "1800"))
DEFAULT_CACHE_INTERVALS = 100   # a 100-page draft = many turns on one cache
DEFAULT_MIN_TOKENS = 2048

_runners: dict[str, tuple[Runner, InMemorySessionService]] = {}
_primed_sessions: set[str] = set()


def _runner_key(session_id: str, model_name: str) -> str:
    return f"draft:{session_id}:{model_name}"


def get_or_build_drafting_runner(
    *,
    session_id: str,
    model_name: str,
    system_instruction: str,
    max_output_tokens: int = 65536,
    ttl_seconds: int = DEFAULT_TTL_SECONDS,
    cache_intervals: int = DEFAULT_CACHE_INTERVALS,
    min_tokens: int = DEFAULT_MIN_TOKENS,
) -> tuple[Runner, InMemorySessionService, str]:
    """Return (runner, session_service, runner_key) for a drafting session."""
    key = _runner_key(session_id, model_name)
    if key not in _runners:
        from google import genai
        from google.adk.models.google_llm import Gemini
        from google.genai import types as gt

        from app.core.config import get_settings

        settings = get_settings()
        if settings.gemini_api_key:
            client = genai.Client(api_key=settings.gemini_api_key)
        else:
            from app.services.gcs_service import get_service_account_credentials

            kwargs: dict[str, Any] = {
                "vertexai": True,
                "project": settings.gcloud_project_id,
                "location": settings.gcp_location,
            }
            creds = get_service_account_credentials()
            if creds is not None:
                kwargs["credentials"] = creds
            client = genai.Client(**kwargs)

        # ADK ignores an api_client constructor arg — inject via subclass,
        # same workaround as agents/adk_app.py.
        class CustomGemini(Gemini):
            @property
            def api_client(self):
                return client

        agent = Agent(
            name=AGENT_NAME,
            model=CustomGemini(model=model_name),
            # static_instruction: never state-injected by ADK — literal {braces}
            # in drafting prompts (JSON schema samples, template placeholders)
            # must not raise "Context variable not found". Also the cacheable
            # prefix variant for ContextCacheConfig.
            static_instruction=system_instruction,
            # Zero-hallucination posture: deterministic decoding.
            generate_content_config=gt.GenerateContentConfig(
                temperature=0.0,
                top_p=0.1,
                max_output_tokens=max_output_tokens,
            ),
        )
        app = App(
            name=APP_NAME,
            root_agent=agent,
            context_cache_config=ContextCacheConfig(
                min_tokens=min_tokens,
                ttl_seconds=ttl_seconds,
                cache_intervals=cache_intervals,
            ),
        )
        svc = InMemorySessionService()
        _runners[key] = (Runner(app=app, session_service=svc), svc)
        logger.info(
            "Built ADK drafting runner session=%s model=%s ttl=%ds intervals=%d",
            session_id, model_name, ttl_seconds, cache_intervals,
        )
    runner, svc = _runners[key]
    return runner, svc, key


async def ensure_adk_session(
    *, session_service: InMemorySessionService, user_id: str, session_id: str,
) -> str:
    try:
        existing = await session_service.get_session(
            app_name=APP_NAME, user_id=user_id, session_id=session_id,
        )
        if existing is not None:
            return session_id
    except Exception:
        pass
    await session_service.create_session(
        app_name=APP_NAME, user_id=user_id, session_id=session_id,
    )
    return session_id


def is_primed(runner_key: str) -> bool:
    return runner_key in _primed_sessions


def mark_primed(runner_key: str) -> None:
    _primed_sessions.add(runner_key)


def invalidate_drafting_runner(session_id: str, model_name: str) -> None:
    """Drop runner + primed mark (e.g. when supporting docs change)."""
    key = _runner_key(session_id, model_name)
    _runners.pop(key, None)
    _primed_sessions.discard(key)


def invalidate_session_runners(session_id: str) -> None:
    """Drop every runner for a drafting session, regardless of model."""
    prefix = f"draft:{session_id}:"
    for key in [k for k in _runners if k.startswith(prefix)]:
        _runners.pop(key, None)
    for key in [k for k in _primed_sessions if k.startswith(prefix)]:
        _primed_sessions.discard(key)


async def run_drafting_turn(
    *,
    runner: Runner,
    user_id: str,
    adk_session_id: str,
    parts: list[Any],
) -> AsyncIterator[dict[str, Any]]:
    """One drafting turn through the ADK runner.

    Yields {"kind": "chunk", "text": ...} deltas and a final
    {"kind": "done", "finish_reason": ..., "usage": {...}} — the same item
    contract as drafting_service._iter_gemini_draft_chunks, so the caller can
    swap engines transparently.
    """
    from google.genai import types as gt
    from google.adk.runners import RunConfig
    from google.adk.agents.run_config import StreamingMode

    new_message = gt.Content(role="user", parts=parts)
    full = ""
    usage: dict[str, int] = {}
    finish_reason: str | None = None

    async for event in runner.run_async(
        user_id=user_id,
        session_id=adk_session_id,
        new_message=new_message,
        run_config=RunConfig(streaming_mode=StreamingMode.SSE),
    ):
        # ADK may prefix the author with the app name; substring-match like adk_app.
        author = getattr(event, "author", None) or ""
        if author and AGENT_NAME not in author:
            continue

        if getattr(event, "usage_metadata", None):
            um = event.usage_metadata
            prompt = int(getattr(um, "prompt_token_count", 0) or 0)
            out = int(getattr(um, "candidates_token_count", 0) or 0)
            cached = int(getattr(um, "cached_content_token_count", 0) or 0)
            usage = {
                "inputTokens": prompt,
                "outputTokens": out,
                "totalTokens": int(getattr(um, "total_token_count", 0) or (prompt + out)),
                "cachedTokens": cached,
            }

        if getattr(event, "content", None):
            for part in getattr(event.content, "parts", []) or []:
                text = getattr(part, "text", "") or ""
                if not text or getattr(part, "thought", False):
                    continue
                # ADK can re-deliver the full text in a final non-partial event.
                if not full.endswith(text):
                    full += text
                    yield {"kind": "chunk", "text": text}

        if getattr(event, "finish_reason", None):
            finish_reason = str(event.finish_reason)

    yield {"kind": "done", "finish_reason": finish_reason, "usage": usage}
