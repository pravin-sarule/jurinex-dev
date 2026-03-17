"""
Anthropic Claude API client for text completion.
Used by drafter (and optionally critic) when the selected model is a Claude model.
"""

from __future__ import annotations

import logging
import os
import time
from typing import Optional

logger = logging.getLogger(__name__)

# Max tokens for section drafting (enough for long HTML)
DEFAULT_MAX_TOKENS = 8192

# Retry config for transient 5xx errors from Anthropic
_MAX_RETRIES = 3
_RETRY_BASE_DELAY = 2.0  # seconds; doubles each attempt


def complete(
    system_prompt: str,
    user_message: str,
    model: str,
    max_tokens: int = DEFAULT_MAX_TOKENS,
    temperature: float = 0.7,
) -> Optional[str]:
    """
    Call Anthropic Messages API and return the assistant text.
    model: Anthropic API model ID (e.g. claude-sonnet-4-5, claude-opus-4-6).
    Retries up to _MAX_RETRIES times on transient 5xx errors.
    Returns None on missing key or non-retryable error.
    """
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        logger.warning("ANTHROPIC_API_KEY not set; cannot call Claude")
        return None

    import anthropic
    client = anthropic.Anthropic(api_key=api_key)
    kwargs = {
        "model": model,
        "max_tokens": max_tokens,
        "temperature": temperature,
        "messages": [{"role": "user", "content": user_message}],
    }
    if system_prompt:
        kwargs["system"] = system_prompt

    logger.info(
        "[Claude] model=%r | temperature=%.2f | system=%s | user_msg=%d chars",
        model, temperature,
        f"{len(system_prompt)} chars" if system_prompt else "none",
        len(user_message),
    )

    last_error: Optional[Exception] = None
    for attempt in range(1, _MAX_RETRIES + 1):
        try:
            response = client.messages.create(**kwargs)
            if not response.content:
                return None
            for block in response.content:
                text = getattr(block, "text", None) if not isinstance(block, dict) else block.get("text")
                if text:
                    return text
            return None
        except anthropic.InternalServerError as e:
            last_error = e
            if attempt < _MAX_RETRIES:
                delay = _RETRY_BASE_DELAY * (2 ** (attempt - 1))
                logger.warning(
                    "[Claude] 500 InternalServerError on attempt %d/%d — retrying in %.1fs: %s",
                    attempt, _MAX_RETRIES, delay, e,
                )
                time.sleep(delay)
            else:
                logger.error("[Claude] 500 InternalServerError after %d attempts: %s", _MAX_RETRIES, e)
        except anthropic.RateLimitError as e:
            last_error = e
            if attempt < _MAX_RETRIES:
                delay = _RETRY_BASE_DELAY * (2 ** (attempt - 1))
                logger.warning(
                    "[Claude] RateLimitError on attempt %d/%d — retrying in %.1fs",
                    attempt, _MAX_RETRIES, delay,
                )
                time.sleep(delay)
            else:
                logger.error("[Claude] RateLimitError after %d attempts", _MAX_RETRIES)
        except Exception as e:
            logger.exception("Claude API call failed: %s", e)
            return None

    logger.error("Claude API call failed after %d retries: %s", _MAX_RETRIES, last_error)
    return None
