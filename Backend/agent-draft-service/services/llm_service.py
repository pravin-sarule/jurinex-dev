"""
Shared LLM Service: Unified interface for calling Gemini and Claude.
"""

from __future__ import annotations

import logging
import os
import threading
import time
from typing import Any, Dict, List, Optional, Union

from config.gemini_models import is_claude_model, claude_api_model_id

logger = logging.getLogger(__name__)

_gemini_rate_lock = threading.Lock()
_last_gemini_call_at = 0.0
_gemini_min_interval_seconds = max(
    0.0,
    1.0 / max(1, int(os.environ.get("GEMINI_REQUESTS_PER_SECOND", "2"))),
)
_gemini_max_retry_attempts = max(0, int(os.environ.get("GEMINI_MAX_RETRY_ATTEMPTS", "3")))
_gemini_retry_backoff_seconds = max(1, int(os.environ.get("GEMINI_RETRY_INITIAL_BACKOFF_SECONDS", "2")))

def call_llm(
    prompt: str,
    system_prompt: str = "",
    model: str = "gemini-flash-lite-latest",
    temperature: float = 0.7,
    response_mime_type: Optional[str] = None,
    thinking_budget: int = 0,
    use_google_search: bool = False,
) -> Optional[str]:
    """
    Unified LLM call. system_prompt is sent as system_instruction (Gemini) or system prompt (Claude).
    Raises RuntimeError with the real error message on failure so callers can surface it to the user.
    """
    if is_claude_model(model):
        return _call_claude(prompt, system_prompt, model, temperature)
    else:
        return _call_gemini(
            prompt, system_prompt, model,
            response_mime_type, thinking_budget, use_google_search,
            temperature=temperature,
        )

def _call_claude(prompt: str, system_prompt: str, model: str, temperature: float = 0.7) -> Optional[str]:
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise RuntimeError(
            "ANTHROPIC_API_KEY is not set. "
            "The agent is configured to use a Claude model but the API key is missing. "
            "Add ANTHROPIC_API_KEY to your .env file."
        )

    api_model = claude_api_model_id(model)
    logger.info(
        "[LLM] Claude call → model=%r | temperature=%.2f | system_prompt=%s",
        api_model, temperature,
        f"{len(system_prompt)} chars" if system_prompt else "none",
    )
    from services.claude_client import complete as claude_complete
    return claude_complete(
        system_prompt=system_prompt,
        user_message=prompt,
        model=api_model,
        temperature=temperature,
    )

def _call_gemini(
    prompt: str,
    system_prompt: str,
    model: str,
    response_mime_type: Optional[str],
    thinking_budget: int = 0,
    use_google_search: bool = False,
    temperature: float = 0.7,
) -> Optional[str]:
    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        logger.warning("Gemini API key not found")
        return None

    from google import genai
    from google.genai import types

    client = genai.Client(api_key=api_key)

    config_args: dict = {}

    # ── System instruction (drafter/agent prompt — HOW to behave) ────────────
    if system_prompt and system_prompt.strip():
        config_args["system_instruction"] = system_prompt.strip()
        logger.info("[LLM] Gemini system_instruction set (length=%d)", len(system_prompt))

    # ── Temperature ───────────────────────────────────────────────────────────
    config_args["temperature"] = temperature

    if response_mime_type:
        config_args["response_mime_type"] = response_mime_type

    # ── Thinking budget for reasoning models ──────────────────────────────────
    THINKING_MODELS = ("gemini-2.5-pro", "gemini-3-pro-preview")
    actual_thinking_budget = thinking_budget
    if model in THINKING_MODELS and actual_thinking_budget <= 0:
        actual_thinking_budget = 1024
    if actual_thinking_budget > 0:
        config_args["thinking_config"] = types.ThinkingConfig(thinking_budget=actual_thinking_budget)

    # ── Google Search grounding ───────────────────────────────────────────────
    if use_google_search:
        config_args["tools"] = [types.Tool(googleSearch=types.GoogleSearch())]

    logger.info(
        "[LLM] Gemini call → model=%r | temperature=%.2f | system_instruction=%s | search=%s",
        model, temperature,
        f"{len(system_prompt)} chars" if system_prompt else "none",
        use_google_search,
    )

    try:
        attempt = 0
        while True:
            _wait_for_gemini_rate_slot()
            try:
                response = client.models.generate_content(
                    model=model,
                    contents=[prompt],
                    config=types.GenerateContentConfig(**config_args),
                )
                if not response or not response.text:
                    logger.warning("[LLM] Gemini returned empty response for model=%r", model)
                    return ""
                return response.text
            except Exception as e:
                attempt += 1
                if _is_retryable_gemini_error(e) and attempt <= _gemini_max_retry_attempts:
                    sleep_seconds = _gemini_retry_backoff_seconds * (2 ** (attempt - 1))
                    logger.warning(
                        "[LLM] Gemini retryable error on attempt %s/%s for model=%r; sleeping %ss: %s",
                        attempt,
                        _gemini_max_retry_attempts,
                        model,
                        sleep_seconds,
                        e,
                    )
                    time.sleep(sleep_seconds)
                    continue

                logger.exception("Gemini call failed: %s", e)
                raise RuntimeError(f"Gemini API error (model={model!r}): {e}") from e
    except Exception:
        raise


def _wait_for_gemini_rate_slot() -> None:
    global _last_gemini_call_at

    if _gemini_min_interval_seconds <= 0:
        return

    with _gemini_rate_lock:
        now = time.monotonic()
        elapsed = now - _last_gemini_call_at
        wait_for = _gemini_min_interval_seconds - elapsed
        if wait_for > 0:
            time.sleep(wait_for)
        _last_gemini_call_at = time.monotonic()


def _is_retryable_gemini_error(error: Exception) -> bool:
    message = str(error).lower()
    retryable_markers = (
        "429",
        "too many requests",
        "rate limit",
        "503",
        "service unavailable",
        "temporarily unavailable",
        "resource exhausted",
    )
    return any(marker in message for marker in retryable_markers)
