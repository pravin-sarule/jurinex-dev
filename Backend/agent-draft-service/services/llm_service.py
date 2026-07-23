"""
Shared LLM Service: Unified interface for calling Gemini and Claude.
"""

from __future__ import annotations

import logging
import os
import random
import threading
import time
from typing import Any, Dict, List, Optional, Union

from config.gemini_models import is_claude_model, claude_api_model_id, is_deepseek_model

logger = logging.getLogger(__name__)

_gemini_rate_lock = threading.Lock()
_last_gemini_call_at = 0.0
# Process-wide pacing for Gemini calls. The old default of 2 req/s serialized
# every "parallel" worker to a crawl; 8 req/s is still conservative for paid
# quotas and retries with backoff handle any 429s.
_gemini_min_interval_seconds = max(
    0.0,
    1.0 / max(1, int(os.environ.get("GEMINI_REQUESTS_PER_SECOND", "8"))),
)
_gemini_max_retry_attempts = max(0, int(os.environ.get("GEMINI_MAX_RETRY_ATTEMPTS", "3")))
_gemini_retry_backoff_seconds = max(1, int(os.environ.get("GEMINI_RETRY_INITIAL_BACKOFF_SECONDS", "2")))
_gemini_fallback_models_csv = os.environ.get("GEMINI_FALLBACK_MODELS", "").strip()


def _record_shared_pool_usage(
    model: str,
    input_tokens: int,
    output_tokens: int,
    endpoint: str,
) -> None:
    try:
        from services.request_context import current_user_id
        from services.daily_limit_guard import log_llm_usage

        uid = current_user_id.get()
        if not uid:
            return
        if input_tokens <= 0 and output_tokens <= 0:
            return
        log_llm_usage(
            user_id=uid,
            model_name=(model or "unknown").strip() or "unknown",
            input_tokens=max(0, int(input_tokens)),
            output_tokens=max(0, int(output_tokens)),
            endpoint=endpoint,
        )
    except Exception as exc:
        logger.debug("[LLM] shared pool usage log skipped: %s", exc)

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
    # ── FREE-TIER DeepSeek override ───────────────────────────────────────────
    # payment-service decides (centrally) that free-tier users should run on a
    # DeepSeek model and threads the model id in via the request context. We only
    # redirect Gemini-bound calls — explicit Claude models (paid drafting) are
    # left untouched. Any DeepSeek failure falls through to the original Gemini
    # path below, so a free user is never fully blocked.
    if not is_claude_model(model):
        override = _free_tier_model_override()
        if override:
            try:
                text = _call_deepseek(prompt, system_prompt, override, temperature, response_mime_type)
                if text is not None and text != "":
                    return text
                logger.warning("[LLM] DeepSeek returned empty; falling back to Gemini model=%r", model)
            except Exception as e:  # noqa: BLE001
                logger.warning("[LLM] DeepSeek call failed (%s); falling back to Gemini model=%r", e, model)

    if is_claude_model(model):
        return _call_claude(prompt, system_prompt, model, temperature)
    else:
        return _call_gemini(
            prompt, system_prompt, model,
            response_mime_type, thinking_budget, use_google_search,
            temperature=temperature,
        )


def _free_tier_model_override() -> Optional[str]:
    """Return a DeepSeek model id when the current request is free-tier, else None."""
    try:
        from services.request_context import current_model_override

        override = current_model_override.get()
    except Exception:
        override = None
    return override if (override and is_deepseek_model(override)) else None


def _call_deepseek(
    prompt: str,
    system_prompt: str,
    model: str,
    temperature: float = 0.7,
    response_mime_type: Optional[str] = None,
) -> Optional[str]:
    from services.deepseek_client import complete as deepseek_complete

    logger.info("[LLM] DeepSeek call → model=%r | temperature=%.2f", model, temperature)
    return deepseek_complete(
        system_prompt=system_prompt,
        user_message=prompt,
        model=model,
        temperature=temperature,
        response_mime_type=response_mime_type,
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
    text = claude_complete(
        system_prompt=system_prompt,
        user_message=prompt,
        model=api_model,
        temperature=temperature,
    )
    return text

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
        model_chain = _build_gemini_model_chain(model)
        last_error: Optional[Exception] = None

        for model_index, active_model in enumerate(model_chain):
            attempt = 0
            while True:
                _wait_for_gemini_rate_slot()
                try:
                    response = client.models.generate_content(
                        model=active_model,
                        contents=[prompt],
                        config=types.GenerateContentConfig(**config_args),
                    )
                    if not response or not response.text:
                        logger.warning("[LLM] Gemini returned empty response for model=%r", active_model)
                        return ""
                    if active_model != model:
                        logger.info("[LLM] Gemini fallback model succeeded: %r -> %r", model, active_model)
                    usage_meta = getattr(response, "usage_metadata", None)
                    ti = int(getattr(usage_meta, "prompt_token_count", 0) or 0)
                    to = int(getattr(usage_meta, "candidates_token_count", 0) or 0)
                    _record_shared_pool_usage(active_model, ti, to, "agent-draft:generate")
                    return response.text
                except Exception as e:
                    last_error = e
                    attempt += 1
                    retryable = _is_retryable_gemini_error(e)
                    if retryable and attempt <= _gemini_max_retry_attempts:
                        # Exponential backoff + jitter to reduce thundering herd on 503 spikes.
                        base_sleep = _gemini_retry_backoff_seconds * (2 ** (attempt - 1))
                        sleep_seconds = base_sleep + random.uniform(0.0, 0.5)
                        logger.warning(
                            "[LLM] Gemini retryable error on attempt %s/%s for model=%r; sleeping %.2fs: %s",
                            attempt,
                            _gemini_max_retry_attempts,
                            active_model,
                            sleep_seconds,
                            e,
                        )
                        time.sleep(sleep_seconds)
                        continue

                    has_next_model = model_index + 1 < len(model_chain)
                    if retryable and has_next_model:
                        next_model = model_chain[model_index + 1]
                        logger.warning(
                            "[LLM] Gemini model=%r exhausted retries due to retryable error; switching to fallback model=%r",
                            active_model,
                            next_model,
                        )
                        break

                    logger.exception("Gemini call failed: %s", e)
                    raise RuntimeError(f"Gemini API error (model={active_model!r}): {e}") from e

        if last_error is not None:
            raise RuntimeError(f"Gemini API error after fallback chain (start={model!r}): {last_error}") from last_error
        raise RuntimeError(f"Gemini API error: no model attempted for start model={model!r}")
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


def _build_gemini_model_chain(primary_model: str) -> List[str]:
    chain: List[str] = []

    def _add(model_name: str) -> None:
        name = str(model_name or "").strip()
        if name and name not in chain:
            chain.append(name)

    _add(primary_model)

    # Optional explicit chain from env:
    # GEMINI_FALLBACK_MODELS=gemini-2.5-flash,gemini-2.0-flash
    if _gemini_fallback_models_csv:
        for candidate in _gemini_fallback_models_csv.split(","):
            _add(candidate)
    else:
        # Sensible defaults when primary model is Pro and capacity spikes.
        if str(primary_model).strip().lower() == "gemini-2.5-pro":
            _add("gemini-2.5-flash")
            _add("gemini-2.0-flash")

    return chain
