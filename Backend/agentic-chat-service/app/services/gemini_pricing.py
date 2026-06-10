"""Gemini API pricing (USD per 1M tokens) — aligned with ai.google.dev pricing."""
from __future__ import annotations

from typing import Any

# Long-context tier threshold (tokens in prompt / cached document)
LONG_CONTEXT_THRESHOLD = 200_000

DEFAULT_CACHE_MODEL = "gemini-2.5-pro"

# Gemini context cache + generation rates (paid tier, <=200k unless noted)
MODEL_PRICING: dict[str, dict[str, float | str]] = {
    "gemini-2.5-pro": {
        "model": "gemini-2.5-pro",
        "creationRate": 1.25,
        "storageRate": 4.50,
        "cachedInputRate": 0.125,
        "newInputRate": 1.25,
        "outputRate": 10.00,
        "creationRateLong": 2.50,
        "cachedInputRateLong": 0.25,
        "newInputRateLong": 2.50,
        "outputRateLong": 15.00,
    },
    "gemini-2.5-flash": {
        "model": "gemini-2.5-flash",
        "creationRate": 0.30,
        "storageRate": 1.00,
        "cachedInputRate": 0.03,
        "newInputRate": 0.30,
        "outputRate": 2.50,
        "creationRateLong": 0.30,
        "cachedInputRateLong": 0.03,
        "newInputRateLong": 0.30,
        "outputRateLong": 2.50,
    },
    "gemini-2.5-flash-lite": {
        "model": "gemini-2.5-flash-lite",
        "creationRate": 0.10,
        "storageRate": 1.00,
        "cachedInputRate": 0.01,
        "newInputRate": 0.10,
        "outputRate": 0.40,
        "creationRateLong": 0.10,
        "cachedInputRateLong": 0.01,
        "newInputRateLong": 0.10,
        "outputRateLong": 0.40,
    },
}


def normalize_model_name(model: str | None) -> str:
    raw = (model or DEFAULT_CACHE_MODEL).strip().lower()
    if not raw:
        return DEFAULT_CACHE_MODEL
    if raw in MODEL_PRICING:
        return raw
    if "pro" in raw and "2.5" in raw:
        return "gemini-2.5-pro"
    if "flash-lite" in raw or "flash_lite" in raw:
        return "gemini-2.5-flash-lite"
    if "flash" in raw:
        return "gemini-2.5-flash"
    return raw


def _resolve_key(model: str | None) -> str:
    normalized = normalize_model_name(model)
    if normalized in MODEL_PRICING:
        return normalized
    for key in MODEL_PRICING:
        if key in normalized or normalized in key:
            return key
    return "gemini-2.5-pro"


def get_pricing(model: str | None, *, context_token_count: int = 0) -> dict[str, Any]:
    """Return per-1M token USD rates for UI and cost math."""
    key = _resolve_key(model)
    base = dict(MODEL_PRICING[key])
    long_ctx = int(context_token_count or 0) > LONG_CONTEXT_THRESHOLD
    if long_ctx:
        base["newInputRate"] = float(base.get("newInputRateLong", base["newInputRate"]))
        base["cachedInputRate"] = float(base.get("cachedInputRateLong", base["cachedInputRate"]))
        base["creationRate"] = float(base.get("creationRateLong", base["creationRate"]))
        base["outputRate"] = float(base.get("outputRateLong", base["outputRate"]))
    base["longContext"] = long_ctx
    base["contextTokenCount"] = int(context_token_count or 0)
    return base


def compute_usage_cost(
    *,
    model: str | None,
    prompt_tokens: int = 0,
    cached_tokens: int = 0,
    output_tokens: int = 0,
    document_tokens: int = 0,
) -> dict[str, float]:
    """Compute USD costs from real Gemini usage_metadata token counts."""
    ctx = max(int(document_tokens or 0), int(prompt_tokens or 0))
    pricing = get_pricing(model, context_token_count=ctx)
    cached = max(0, int(cached_tokens or 0))
    prompt = max(0, int(prompt_tokens or 0))
    new_prompt = max(0, prompt - cached)
    out = max(0, int(output_tokens or 0))

    cached_cost = cached * (float(pricing["cachedInputRate"]) / 1_000_000)
    prompt_cost = new_prompt * (float(pricing["newInputRate"]) / 1_000_000)
    output_cost = out * (float(pricing["outputRate"]) / 1_000_000)
    query_cost = cached_cost + prompt_cost + output_cost

    return {
        "cachedCost": cached_cost,
        "promptCost": prompt_cost,
        "outputCost": output_cost,
        "queryCost": query_cost,
        "newPromptTokens": float(new_prompt),
    }


def compute_storage_cost(
    model: str | None,
    document_tokens: int,
    active_hours: float,
) -> float:
    pricing = get_pricing(model, context_token_count=document_tokens)
    return int(document_tokens or 0) * (float(pricing["storageRate"]) / 1_000_000) * max(0.0, active_hours)


def compute_setup_cost(model: str | None, document_tokens: int) -> float:
    """One-time context-cache write cost estimate (billed at input rate)."""
    pricing = get_pricing(model, context_token_count=document_tokens)
    return int(document_tokens or 0) * (float(pricing["creationRate"]) / 1_000_000)
