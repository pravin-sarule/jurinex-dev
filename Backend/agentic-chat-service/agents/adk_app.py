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

DEFAULT_TTL_SECONDS = 300      # 5 minutes — cache auto-deletes after 5 min without a prompt
DEFAULT_CACHE_INTERVALS = 10   # refresh cache after 10 uses
DEFAULT_MIN_TOKENS = 2048      # minimum tokens before caching kicks in

# ── Module-level runner pool (one runner per file+model+syshash) ─────────────
_runners: dict[str, tuple[Runner, InMemorySessionService]] = {}

# Sessions that have already been primed with document parts
# Keyed by (runner_key, chat_session_id)
_session_primed: set[str] = set()
# Also track if the runner itself has been primed in any session (server-lifetime)
_runner_primed: set[str] = set()


def _sys_hash(text: str) -> str:
    return hashlib.sha256((text or "").encode()).hexdigest()[:12]


def _runner_key(
    file_id: str,
    model_name: str,
    system_instruction: str,
    *,
    max_output_tokens: int,
    temperature: float,
    thinking_budget: int | None = None,
) -> str:
    # Include generation budget so admin DB changes rebuild the runner.
    tb = "default" if thinking_budget is None else str(int(thinking_budget))
    return (
        f"{file_id}:{model_name}:{_sys_hash(system_instruction)}"
        f":mot={int(max_output_tokens)}:t={temperature:.2f}:tb={tb}"
    )


def _session_prime_key(runner_key: str, chat_session_id: str) -> str:
    return f"{runner_key}:{chat_session_id}"


def get_or_build_document_runner(
    *,
    file_id: str,
    model_name: str,
    system_instruction: str,
    max_output_tokens: int = 65536,
    temperature: float = 0.7,
    thinking_config: Any = None,
    ttl_seconds: int = DEFAULT_TTL_SECONDS,
    cache_intervals: int = DEFAULT_CACHE_INTERVALS,
    min_tokens: int = DEFAULT_MIN_TOKENS,
) -> tuple[Runner, InMemorySessionService, str]:
    """Return (runner, session_service, runner_key).

    One runner is kept per (file_id, model, system_instruction, generation budget).
    `max_output_tokens` comes from Document_DB `llm_chat_config` so a 30k config
    allows up to 30k output tokens and a 5k config caps at 5k.
    The ADK App uses ContextCacheConfig so Gemini explicit caching is managed
    automatically — no manual caches.create() / validate_cache_exists needed.
    """
    mot = max(1, int(max_output_tokens or 65536))
    temp = float(temperature if temperature is not None else 0.7)
    thinking_budget = None
    if thinking_config is not None:
        thinking_budget = getattr(thinking_config, "thinking_budget", None)
        try:
            thinking_budget = int(thinking_budget) if thinking_budget is not None else None
        except (TypeError, ValueError):
            thinking_budget = None
    key = _runner_key(
        file_id,
        model_name,
        system_instruction,
        max_output_tokens=mot,
        temperature=temp,
        thinking_budget=thinking_budget,
    )
    if key not in _runners:
        from google.adk.models.google_llm import Gemini
        from app.core.config import get_settings
        from google import genai
        from google.genai import types as gt

        settings = get_settings()

        # We must subclass Gemini to override api_client, as ADK does not expose these fields
        # and ignores the api_client argument passed to Gemini().
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

        gen_kwargs: dict[str, Any] = {
            "temperature": temp,
            "max_output_tokens": mot,
        }
        if thinking_config is not None:
            gen_kwargs["thinking_config"] = thinking_config
        agent = Agent(
            name=AGENT_NAME,
            model=CustomGemini(model=model_name),
            # static_instruction: never state-injected by ADK, so literal {braces}
            # in the admin-editable prompt (greeting examples like "{name}", JSON
            # samples, legal templates) don't raise "Context variable not found".
            # It is also the cacheable-prefix variant for ContextCacheConfig.
            static_instruction=system_instruction,
            generate_content_config=gt.GenerateContentConfig(**gen_kwargs),
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
            "Built new ADK runner file=%s model=%s max_output_tokens=%s temperature=%.2f "
            "thinking_budget=%s ttl=%ds intervals=%d",
            file_id, model_name, mot, temp, thinking_budget, ttl_seconds, cache_intervals,
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


def is_runner_primed(runner_key: str) -> bool:
    """True if this runner has successfully processed document parts at least once this server lifetime."""
    return runner_key in _runner_primed


def mark_session_primed(runner_key: str, chat_session_id: str) -> None:
    _session_primed.add(_session_prime_key(runner_key, chat_session_id))
    _runner_primed.add(runner_key)


def invalidate_runner(
    file_id: str,
    model_name: str,
    system_instruction: str,
    *,
    max_output_tokens: int | None = None,
    temperature: float | None = None,
) -> None:
    """Drop cached runner(s) for this file (e.g. when file content changes)."""
    prefix = f"{file_id}:{model_name}:{_sys_hash(system_instruction)}"
    if max_output_tokens is not None and temperature is not None:
        keys = [
            _runner_key(
                file_id,
                model_name,
                system_instruction,
                max_output_tokens=int(max_output_tokens),
                temperature=float(temperature),
            )
        ]
    else:
        keys = [k for k in list(_runners) if k.startswith(prefix)]
    for key in keys:
        _runners.pop(key, None)
        stale = [k for k in _session_primed if k.startswith(f"{key}:")]
        for k in stale:
            _session_primed.discard(k)
