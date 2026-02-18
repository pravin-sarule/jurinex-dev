"""
Anthropic Claude API client for text completion.
Used by drafter (and optionally critic) when the selected model is a Claude model.
"""

from __future__ import annotations

import logging
import os
from typing import Optional

logger = logging.getLogger(__name__)

# Max tokens for section drafting (enough for long HTML)
DEFAULT_MAX_TOKENS = 8192


def complete(
    system_prompt: str,
    user_message: str,
    model: str,
    max_tokens: int = DEFAULT_MAX_TOKENS,
) -> Optional[str]:
    """
    Call Anthropic Messages API and return the assistant text.
    model: Anthropic API model ID (e.g. claude-sonnet-4-5, claude-opus-4-6).
    Returns None on missing key or API error.
    """
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        logger.warning("ANTHROPIC_API_KEY not set; cannot call Claude")
        return None

    try:
        import anthropic
        client = anthropic.Anthropic(api_key=api_key)
        kwargs = {
            "model": model,
            "max_tokens": max_tokens,
            "messages": [{"role": "user", "content": user_message}],
        }
        if system_prompt:
            kwargs["system"] = system_prompt

        response = client.messages.create(**kwargs)
        if not response.content:
            return None
        for block in response.content:
            text = getattr(block, "text", None) if not isinstance(block, dict) else block.get("text")
            if text:
                return text
        return None
    except Exception as e:
        logger.exception("Claude API call failed: %s", e)
        return None
