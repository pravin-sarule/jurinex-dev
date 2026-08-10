"""
Z.AI Translation Agent client.

Wraps the Z.AI agents endpoint (POST {base}/agents, agent_id="general_translation")
for multilingual translation with auto language detection and six strategies:
general, paraphrase, two_step, three_step, reflection, cot.

Docs: https://docs.z.ai/guides/agents/translation
API:  https://docs.z.ai/api-reference/agents/agent
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any

import httpx

from app.core.config import get_settings

logger = logging.getLogger("agentic_document_service.zai_translation")

TRANSLATION_AGENT_ID = "general_translation"

# Strategies accepted by the agent. "general" resolves >95% of everyday needs;
# reflection/cot are multi-pass and noticeably slower.
SUPPORTED_STRATEGIES: dict[str, str] = {
    "general": "Literal translation preserving format; best default for most content.",
    "paraphrase": "Meaning-first rewrite in the target language's natural phrasing.",
    "two_step": "Literal pass then free-expression pass; literary content.",
    "three_step": "Faithfulness/expressiveness/elegance; classical & poetic styles.",
    "reflection": "Draft, expert self-review, then refined output; formal documents.",
    "cot": "Chain-of-thought analysis before translating; expert domains.",
}

# Language codes verified against the live agent (probed 2026-08-06): every code
# here returned a translation; mr/bn/gu/ta/te/kn/ml/pa/ur were rejected with
# "非法参数: target_lang" — of the Indian languages only Hindi is supported.
SUPPORTED_LANGUAGES: list[dict[str, str]] = [
    {"code": "en", "label": "English"},
    {"code": "hi", "label": "Hindi"},
    {"code": "ar", "label": "Arabic"},
    {"code": "zh-CN", "label": "Chinese (Simplified)"},
    {"code": "zh-TW", "label": "Chinese (Traditional)"},
    {"code": "fr", "label": "French"},
    {"code": "de", "label": "German"},
    {"code": "es", "label": "Spanish"},
    {"code": "pt", "label": "Portuguese"},
    {"code": "ru", "label": "Russian"},
    {"code": "ja", "label": "Japanese"},
    {"code": "ko", "label": "Korean"},
    {"code": "it", "label": "Italian"},
    {"code": "nl", "label": "Dutch"},
    {"code": "tr", "label": "Turkish"},
    {"code": "vi", "label": "Vietnamese"},
    {"code": "th", "label": "Thai"},
    {"code": "id", "label": "Indonesian"},
]

_RETRYABLE_STATUS = {429, 500, 502, 503, 504}
_MAX_ATTEMPTS = 3

# One shared client for all translation calls (same reuse pattern as the
# Document AI client in adapters/ocr.py): the document pipeline fires hundreds
# of small requests, and per-call clients pay a fresh TCP+TLS handshake each
# time. Keep-alive connections make high-concurrency batch translation fast.
_client: httpx.AsyncClient | None = None
_client_lock = asyncio.Lock()


async def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        async with _client_lock:
            if _client is None or _client.is_closed:
                _client = httpx.AsyncClient(
                    limits=httpx.Limits(max_connections=32, max_keepalive_connections=32),
                    timeout=get_settings().zai_translation_timeout_s,
                )
    return _client


class TranslationServiceError(Exception):
    """Z.AI translation failed. `status_code` mirrors the upstream HTTP status when known."""

    def __init__(self, message: str, status_code: int = 502) -> None:
        super().__init__(message)
        self.status_code = status_code


class TranslationNotConfiguredError(TranslationServiceError):
    def __init__(self) -> None:
        super().__init__("Translation is not configured (ZAI_API_KEY is missing).", status_code=503)


def is_translation_configured() -> bool:
    return bool(get_settings().zai_api_key.strip())


def _build_payload(
    text: str,
    *,
    source_lang: str,
    target_lang: str,
    strategy: str,
    glossary: str | None,
    suggestion: str | None,
) -> dict[str, Any]:
    custom_variables: dict[str, Any] = {
        "source_lang": source_lang,
        "target_lang": target_lang,
        "strategy": strategy,
    }
    if glossary:
        custom_variables["glossary"] = glossary
    if suggestion:
        # Expert guidance / style hints ride in strategy_config per the agent docs.
        custom_variables["strategy_config"] = {"suggestion": suggestion}
    return {
        "agent_id": TRANSLATION_AGENT_ID,
        "stream": False,
        "messages": [{"role": "user", "content": [{"type": "text", "text": text}]}],
        "custom_variables": custom_variables,
    }


def _extract_text(payload: dict[str, Any]) -> str:
    """
    Pull the translated text out of an agents response. Documented shape is
    choices[0].messages.content.text, but be tolerant: `messages` may be a list
    and `content` may be a string, an object, or a list of text parts.
    """
    parts: list[str] = []
    for choice in payload.get("choices") or []:
        messages = choice.get("messages") or choice.get("message") or []
        if isinstance(messages, dict):
            messages = [messages]
        for message in messages:
            content = message.get("content")
            if isinstance(content, str):
                parts.append(content)
            elif isinstance(content, dict):
                parts.append(str(content.get("text") or ""))
            elif isinstance(content, list):
                parts.extend(str(item.get("text") or "") for item in content if isinstance(item, dict))
    return "".join(parts).strip()


async def translate_text(
    text: str,
    *,
    target_lang: str,
    source_lang: str = "auto",
    strategy: str = "general",
    glossary: str | None = None,
    suggestion: str | None = None,
    timeout_s: float | None = None,
) -> dict[str, Any]:
    """
    Translate `text` via the Z.AI Translation Agent.

    Returns {"translated_text", "source_lang", "target_lang", "strategy",
    "request_id", "usage"}. Raises TranslationServiceError on failure.
    """
    settings = get_settings()
    api_key = settings.zai_api_key.strip()
    if not api_key:
        raise TranslationNotConfiguredError()

    text = (text or "").strip()
    if not text:
        raise TranslationServiceError("Nothing to translate: text is empty.", status_code=400)
    target_lang = (target_lang or "").strip()
    if not target_lang:
        raise TranslationServiceError("target_lang is required.", status_code=400)
    strategy = (strategy or "general").strip().lower()
    if strategy not in SUPPORTED_STRATEGIES:
        raise TranslationServiceError(
            f"Unknown strategy '{strategy}'. Supported: {', '.join(sorted(SUPPORTED_STRATEGIES))}.",
            status_code=400,
        )

    payload = _build_payload(
        text,
        source_lang=(source_lang or "auto").strip() or "auto",
        target_lang=target_lang,
        strategy=strategy,
        glossary=glossary,
        suggestion=(suggestion or "").strip() or None,
    )
    url = f"{settings.zai_api_base_url.rstrip('/')}/agents"
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}

    last_error: Exception | None = None
    # Callers with many small requests (document pipeline) pass a tighter
    # timeout so one slow call can't stall a whole job for minutes.
    effective_timeout = timeout_s or settings.zai_translation_timeout_s
    client = await _get_client()
    for attempt in range(1, _MAX_ATTEMPTS + 1):
        try:
            response = await client.post(url, json=payload, headers=headers, timeout=effective_timeout)
        except httpx.TimeoutException as exc:
            raise TranslationServiceError(
                "Translation timed out; try a shorter text or the 'general' strategy.",
                status_code=504,
            ) from exc
        except httpx.HTTPError as exc:
            last_error = exc
            logger.warning("[ZAITranslation] network error (attempt %s/%s): %s", attempt, _MAX_ATTEMPTS, exc)
            if attempt < _MAX_ATTEMPTS:
                await asyncio.sleep(1.5 * attempt)
            continue

        if response.status_code in _RETRYABLE_STATUS and attempt < _MAX_ATTEMPTS:
            logger.warning(
                "[ZAITranslation] upstream %s (attempt %s/%s), retrying",
                response.status_code, attempt, _MAX_ATTEMPTS,
            )
            await asyncio.sleep(1.5 * attempt)
            continue
        return _handle_response(response, source_lang=source_lang, target_lang=target_lang, strategy=strategy)

    raise TranslationServiceError(f"Translation service unreachable: {last_error}", status_code=502)


def _handle_response(
    response: httpx.Response,
    *,
    source_lang: str,
    target_lang: str,
    strategy: str,
) -> dict[str, Any]:
    if response.status_code == 401:
        raise TranslationServiceError("Translation API key was rejected by Z.AI.", status_code=502)
    if response.status_code >= 400:
        detail = response.text[:500]
        logger.error("[ZAITranslation] upstream error %s: %s", response.status_code, detail)
        raise TranslationServiceError(
            f"Translation failed upstream (HTTP {response.status_code}).",
            status_code=502 if response.status_code >= 500 else response.status_code,
        )

    try:
        data = response.json()
    except ValueError as exc:
        raise TranslationServiceError("Translation service returned a non-JSON response.") from exc

    # Z.AI reports many failures as HTTP 200 with {"status": "failed", "error": {...}}.
    if data.get("status") == "failed" or isinstance(data.get("error"), dict):
        err = data.get("error") or {}
        message = str(err.get("message") or "unknown error")
        logger.error("[ZAITranslation] agent failed: code=%s message=%s", err.get("code"), message)
        # 非法参数 target_lang/source_lang == unsupported language code.
        if "target_lang" in message or "source_lang" in message:
            raise TranslationServiceError(
                "This language is not supported by the translation provider.", status_code=400
            )
        raise TranslationServiceError(f"Translation provider error: {message}", status_code=502)

    choices = data.get("choices") or []
    finish_reason = (choices[0].get("finish_reason") if choices else "") or ""
    if finish_reason == "sensitive":
        raise TranslationServiceError("The text was flagged by the provider's content filter.", status_code=422)
    if finish_reason == "network_error":
        raise TranslationServiceError("The provider hit a model inference error; please retry.", status_code=502)

    translated = _extract_text(data)
    if not translated:
        logger.error("[ZAITranslation] empty translation, finish_reason=%s payload keys=%s", finish_reason, list(data))
        raise TranslationServiceError("Translation service returned an empty result.")
    if finish_reason == "length":
        logger.warning("[ZAITranslation] output truncated by token limit (finish_reason=length)")

    usage = data.get("usage") or {}
    return {
        "translated_text": translated,
        "source_lang": source_lang or "auto",
        "target_lang": target_lang,
        "strategy": strategy,
        "truncated": finish_reason == "length",
        "request_id": data.get("id") or "",
        "usage": {
            "prompt_tokens": int(usage.get("prompt_tokens") or 0),
            "completion_tokens": int(usage.get("completion_tokens") or 0),
            "total_tokens": int(usage.get("total_tokens") or 0),
        },
    }
