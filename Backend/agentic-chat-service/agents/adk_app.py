"""Google ADK App factory — explicit context caching via ContextCacheConfig."""
from __future__ import annotations

import hashlib
import logging
from typing import Any

from google.adk import Agent
from google.adk.agents.context_cache_config import ContextCacheConfig
from google.adk.apps.app import App
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService

logger = logging.getLogger(__name__)

# ── App / runner config ───────────────────────────────────────────────────────
APP_NAME = "document_cache_app"
AGENT_NAME = "document_cache_agent"

DEFAULT_TTL_SECONDS = 1800     # 30 minutes
DEFAULT_CACHE_INTERVALS = 10   # refresh cache after 10 uses
DEFAULT_MIN_TOKENS = 2048      # minimum tokens before caching kicks in

# ── Module-level runner pool (one runner per file+model+syshash) ─────────────
_runners: dict[str, tuple[Runner, InMemorySessionService]] = {}

# Sessions that have already been primed with document parts
_session_primed: set[str] = set()


def _sys_hash(text: str) -> str:
    return hashlib.sha256((text or "").encode()).hexdigest()[:12]


def _runner_key(file_id: str, model_name: str, system_instruction: str) -> str:
    return f"{file_id}:{model_name}:{_sys_hash(system_instruction)}"


def _session_prime_key(runner_key: str, chat_session_id: str) -> str:
    return f"{runner_key}:{chat_session_id}"


def get_or_build_document_runner(
    *,
    file_id: str,
    model_name: str,
    system_instruction: str,
    ttl_seconds: int = DEFAULT_TTL_SECONDS,
    cache_intervals: int = DEFAULT_CACHE_INTERVALS,
    min_tokens: int = DEFAULT_MIN_TOKENS,
) -> tuple[Runner, InMemorySessionService, str]:
    """Return (runner, session_service, runner_key).

    One runner is kept per (file_id, model, system_instruction) combination.
    The ADK App uses ContextCacheConfig so Gemini explicit caching is managed
    automatically — no manual caches.create() / validate_cache_exists needed.
    """
    key = _runner_key(file_id, model_name, system_instruction)
    if key not in _runners:
        from google.adk.models.google_llm import Gemini
        from app.core.config import get_settings
        from google import genai

        settings = get_settings()
        
        # We must subclass Gemini to override api_client, as ADK does not expose these fields
        # and ignores the api_client argument passed to Gemini().
        from functools import cached_property
        
        if settings.gemini_api_key:
            client = genai.Client(api_key=settings.gemini_api_key)
            
            class CustomGemini(Gemini):
                @property
                def api_client(self):
                    return client

        else:
            from app.services.gcs_service import get_service_account_credentials
            kwargs = {
                "vertexai": True,
                "project": settings.gcloud_project_id,
                "location": settings.gcp_location,
            }
            creds = get_service_account_credentials()
            if creds is not None:
                kwargs["credentials"] = creds
            client = genai.Client(**kwargs)
            
            class CustomGemini(Gemini):
                @property
                def api_client(self):
                    return client

        agent = Agent(
            name=AGENT_NAME,
            model=CustomGemini(model=model_name),
            instruction=system_instruction,
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
        runner = Runner(app=app, session_service=svc)
        _runners[key] = (runner, svc)
        logger.info(
            "Built new ADK runner file=%s model=%s ttl=%ds intervals=%d",
            file_id, model_name, ttl_seconds, cache_intervals,
        )
    return _runners[key][0], _runners[key][1], key


async def get_or_create_adk_session(
    *,
    runner_key: str,
    session_service: InMemorySessionService,
    user_id: str,
    chat_session_id: str,
) -> str:
    """Return an ADK session id, creating one if it doesn't exist yet."""
    try:
        existing = await session_service.get_session(
            app_name=APP_NAME,
            user_id=user_id,
            session_id=chat_session_id,
        )
        if existing is not None:
            return chat_session_id
    except Exception:
        pass

    await session_service.create_session(
        app_name=APP_NAME,
        user_id=user_id,
        session_id=chat_session_id,
    )
    return chat_session_id


def is_session_primed(runner_key: str, chat_session_id: str) -> bool:
    return _session_prime_key(runner_key, chat_session_id) in _session_primed


def mark_session_primed(runner_key: str, chat_session_id: str) -> None:
    _session_primed.add(_session_prime_key(runner_key, chat_session_id))


def invalidate_runner(file_id: str, model_name: str, system_instruction: str) -> None:
    """Drop a cached runner (e.g. when file content changes)."""
    key = _runner_key(file_id, model_name, system_instruction)
    _runners.pop(key, None)
    # Clear all session primed marks for this runner
    stale = [k for k in _session_primed if k.startswith(f"{key}:")]
    for k in stale:
        _session_primed.discard(k)
