"""
ADK support shim: register Gemma 4 (``gemma-4-*``) with the ADK LLM registry.

Why this exists
---------------
ADK ships a built-in ``Gemma`` class, but it only matches ``gemma-3.*``
(``google/adk/models/gemma_llm.py``). A model the admin selects in the dashboard
such as ``gemma-4-31b-it`` would therefore fail ``LLMRegistry.resolve()`` and the
ADK agents would refuse to build.

This module registers a thin subclass that:
  * matches ``gemma-4.*`` (both ``gemma-4-31b-it`` and ``gemma-4-26b-a4b-it``),
  * inherits Gemma's function-calling-via-system-instruction shim — the legal
    agents pass tools, so that behavior matters, and
  * authenticates with the dedicated ``GEMMA_API_KEY`` (falling back to
    ``GEMINI_API_KEY`` when blank).

Model *selection* stays 100% DB-driven (``public.agent_prompts.model_ids`` →
``public.llm_models``). This shim only teaches ADK how to talk to a Gemma 4
model once an admin has selected one; it never forces any agent onto Gemma.

Call :func:`register_gemma4` once at startup, before any ``LlmAgent`` is built.
It is a safe no-op when google-adk / google-genai are unavailable.
"""
from __future__ import annotations

import logging

logger = logging.getLogger("agentic_document_service.adk_gemma")

_registered = False


def register_gemma4() -> bool:
    """Register the Gemma 4 LLM class with ADK. Returns True when registered (idempotent)."""
    global _registered
    if _registered:
        return True

    try:
        from functools import cached_property

        from google.adk.models import LLMRegistry
        from google.adk.models.gemma_llm import Gemma
    except Exception as exc:  # ADK missing or too old to expose Gemma
        logger.debug("[ADKGemma] ADK unavailable — skipping Gemma 4 registration: %s", exc)
        return False

    class Gemma4(Gemma):
        """Gemma 4 models (``gemma-4-*``) over the Gemini API with a dedicated key."""

        model: str = "gemma-4-31b-it"

        @classmethod
        def supported_models(cls) -> list[str]:
            return [r"gemma-4.*"]

        @cached_property
        def api_client(self):  # type: ignore[override]
            from google.genai import Client
            from google.genai import types as gtypes

            from app.core.config import get_settings

            settings = get_settings()
            api_key = (
                str(getattr(settings, "gemma_api_key", "") or "").strip()
                or str(getattr(settings, "gemini_api_key", "") or "").strip()
            )
            return Client(
                api_key=api_key or None,
                http_options=gtypes.HttpOptions(headers=self._tracking_headers()),
            )

    try:
        LLMRegistry.register(Gemma4)
    except Exception as exc:  # pragma: no cover
        logger.warning("[ADKGemma] Gemma 4 registration failed: %s", exc)
        return False

    _registered = True
    logger.info("[ADKGemma] registered Gemma 4 (gemma-4.*) with ADK LLMRegistry")
    return True
