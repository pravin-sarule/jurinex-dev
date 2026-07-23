"""
DeepSeek (OpenAI-compatible) API client for text completion.

Used for FREE-tier users, whom payment-service routes to a DeepSeek model. The
caller (services/llm_service.call_llm) always keeps the original Gemini model as
a fallback, so any failure here degrades gracefully rather than blocking the user.
Mirrors the shape of services/claude_client.complete.
"""

from __future__ import annotations

import logging
import os
import time
from typing import Optional

logger = logging.getLogger(__name__)

# Max tokens for section drafting (enough for long HTML)
DEFAULT_MAX_TOKENS = 8192

# DeepSeek is OpenAI-API compatible.
_BASE_URL = "https://api.deepseek.com"

# Retry config for transient errors
_MAX_RETRIES = 2
_RETRY_BASE_DELAY = 2.0  # seconds; doubles each attempt


def _deepseek_model_id(model_name: str) -> str:
    """Return the bare model id expected by DeepSeek (strip any vendor/ prefix)."""
    s = (model_name or "").strip()
    if "/" in s:
        s = s.split("/")[-1].strip()
    return s


def complete(
    system_prompt: str,
    user_message: str,
    model: str,
    max_tokens: int = DEFAULT_MAX_TOKENS,
    temperature: float = 0.7,
    response_mime_type: Optional[str] = None,
) -> Optional[str]:
    """
    Call the DeepSeek chat-completions API and return the assistant text.
    Returns None on missing key / missing package / non-retryable error so the
    caller can fall back to Gemini.
    """
    api_key = os.environ.get("DEEPSEEK_API_KEY")
    if not api_key:
        logger.warning("DEEPSEEK_API_KEY not set; cannot call DeepSeek")
        return None

    try:
        import openai
    except ImportError:
        logger.warning("openai package not installed; cannot call DeepSeek (pip install openai)")
        return None

    client = openai.OpenAI(api_key=api_key, base_url=_BASE_URL, timeout=600.0, max_retries=2)
    api_model = _deepseek_model_id(model)

    wants_json = response_mime_type == "application/json"
    system_text = (system_prompt or "").strip()
    if wants_json and "json" not in (system_text + user_message).lower():
        # DeepSeek JSON mode requires the word "json" somewhere in the messages.
        system_text = (system_text + "\nRespond with valid JSON only.").strip()

    messages = []
    if system_text:
        messages.append({"role": "system", "content": system_text})
    messages.append({"role": "user", "content": user_message})

    kwargs: dict = {
        "model": api_model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    if wants_json:
        kwargs["response_format"] = {"type": "json_object"}

    logger.info(
        "[DeepSeek] model=%r | temperature=%.2f | system=%s | user_msg=%d chars | json=%s",
        api_model, temperature,
        f"{len(system_text)} chars" if system_text else "none",
        len(user_message), wants_json,
    )

    last_error: Optional[Exception] = None
    for attempt in range(1, _MAX_RETRIES + 1):
        try:
            response = client.chat.completions.create(**kwargs)
            if not response or not response.choices:
                return None
            text = response.choices[0].message.content
            usage = getattr(response, "usage", None)
            ti = int(getattr(usage, "prompt_tokens", 0) or 0)
            to = int(getattr(usage, "completion_tokens", 0) or 0)
            try:
                from services.request_context import current_user_id
                from services.daily_limit_guard import log_llm_usage

                uid = current_user_id.get()
                if uid and (ti > 0 or to > 0):
                    log_llm_usage(
                        user_id=uid,
                        model_name=api_model,
                        input_tokens=ti,
                        output_tokens=to,
                        endpoint="agent-draft:deepseek",
                    )
            except Exception:
                pass
            return text
        except Exception as e:  # openai raises various transient errors
            last_error = e
            message = str(e).lower()
            retryable = any(m in message for m in ("429", "rate limit", "timeout", "503", "502", "overloaded"))
            if retryable and attempt < _MAX_RETRIES:
                delay = _RETRY_BASE_DELAY * (2 ** (attempt - 1))
                logger.warning(
                    "[DeepSeek] retryable error on attempt %d/%d — retrying in %.1fs: %s",
                    attempt, _MAX_RETRIES, delay, e,
                )
                time.sleep(delay)
                continue
            logger.warning("[DeepSeek] API call failed: %s", e)
            return None

    logger.warning("[DeepSeek] API call failed after %d retries: %s", _MAX_RETRIES, last_error)
    return None
