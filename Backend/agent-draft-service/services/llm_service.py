"""
Shared LLM Service: Unified interface for calling Gemini and Claude.
"""

from __future__ import annotations

import logging
import os
from typing import Any, Dict, List, Optional, Union

from config.gemini_models import is_claude_model, claude_api_model_id

logger = logging.getLogger(__name__)

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
        logger.warning("ANTHROPIC_API_KEY not set")
        return None

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
        response = client.models.generate_content(
            model=model,
            contents=[prompt],
            config=types.GenerateContentConfig(**config_args),
        )
        return response.text if response and response.text else ""
    except Exception as e:
        logger.exception("Gemini call failed: %s", e)
        return None
