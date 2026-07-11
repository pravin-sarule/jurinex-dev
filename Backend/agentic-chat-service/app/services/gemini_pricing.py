"""Gemini API pricing (USD per 1M tokens) — aligned with ai.google.dev pricing."""
from __future__ import annotations

from typing import Any

# Long-context tier threshold (tokens in prompt / cached document)
LONG_CONTEXT_THRESHOLD = 200_000

DEFAULT_CACHE_MODEL = "gemini-2.5-pro"

# Gemini context cache + generation rates (paid tier, <=200k unless noted)
MODEL_PRICING: dict[str, dict[str, float | str]] = {
    # Claude Sonnet 5 (Anthropic API) — sticker $3.00/M in, $15.00/M out
    # (intro $2/$10 through 2026-08-31); prompt-cache read 0.1x, write 1.25x.
    # Drafting mode uses Claude uncached (digest inlined into the prompt).
    "claude-sonnet-5": {
        "model": "claude-sonnet-5",
        "creationRate": 3.75,
        "storageRate": 0.0,
        "cachedInputRate": 0.30,
        "newInputRate": 3.00,
        "outputRate": 15.00,
        "creationRateLong": 3.75,
        "cachedInputRateLong": 0.30,
        "newInputRateLong": 3.00,
        "outputRateLong": 15.00,
    },
    # Claude Sonnet 4.6 — $3.00/M in, $15.00/M out.
    "claude-sonnet-4-6": {
        "model": "claude-sonnet-4-6",
        "creationRate": 3.75,
        "storageRate": 0.0,
        "cachedInputRate": 0.30,
        "newInputRate": 3.00,
        "outputRate": 15.00,
        "creationRateLong": 3.75,
        "cachedInputRateLong": 0.30,
        "newInputRateLong": 3.00,
        "outputRateLong": 15.00,
    },
    # Claude Opus 4.8 / 4.7 / 4.6 — $5.00/M in, $25.00/M out;
    # cache read 0.1x ($0.50), write 1.25x ($6.25).
    "claude-opus-4-8": {
        "model": "claude-opus-4-8",
        "creationRate": 6.25,
        "storageRate": 0.0,
        "cachedInputRate": 0.50,
        "newInputRate": 5.00,
        "outputRate": 25.00,
        "creationRateLong": 6.25,
        "cachedInputRateLong": 0.50,
        "newInputRateLong": 5.00,
        "outputRateLong": 25.00,
    },
    "claude-opus-4-7": {
        "model": "claude-opus-4-7",
        "creationRate": 6.25,
        "storageRate": 0.0,
        "cachedInputRate": 0.50,
        "newInputRate": 5.00,
        "outputRate": 25.00,
        "creationRateLong": 6.25,
        "cachedInputRateLong": 0.50,
        "newInputRateLong": 5.00,
        "outputRateLong": 25.00,
    },
    "claude-opus-4-6": {
        "model": "claude-opus-4-6",
        "creationRate": 6.25,
        "storageRate": 0.0,
        "cachedInputRate": 0.50,
        "newInputRate": 5.00,
        "outputRate": 25.00,
        "creationRateLong": 6.25,
        "cachedInputRateLong": 0.50,
        "newInputRateLong": 5.00,
        "outputRateLong": 25.00,
    },
    # Gemini 3.5 Flash — official: in $1.50, out $9.00 (incl. thinking),
    # cache read $0.15, storage $1.00/1M/hour. Flat pricing (no >200k tier).
    "gemini-3.5-flash": {
        "model": "gemini-3.5-flash",
        "creationRate": 1.50,
        "storageRate": 1.00,
        "cachedInputRate": 0.15,
        "newInputRate": 1.50,
        "outputRate": 9.00,
        "creationRateLong": 1.50,
        "cachedInputRateLong": 0.15,
        "newInputRateLong": 1.50,
        "outputRateLong": 9.00,
    },
    # Gemini 3.1 Pro Preview — official ai.google.dev pricing:
    # in $2.00/$4.00 (<=200k/>200k), out $12.00/$18.00,
    # cache read $0.20/$0.40, storage $4.50/1M/hour.
    "gemini-3.1-pro-preview": {
        "model": "gemini-3.1-pro-preview",
        "creationRate": 2.00,
        "storageRate": 4.50,
        "cachedInputRate": 0.20,
        "newInputRate": 2.00,
        "outputRate": 12.00,
        "creationRateLong": 4.00,
        "cachedInputRateLong": 0.40,
        "newInputRateLong": 4.00,
        "outputRateLong": 18.00,
    },
    # Gemini 3 Pro — official: same base-tier rate as 3.1 Pro Preview
    # ($2.00/$12.00); no separate long-context tier published, so >200k
    # reuses the 3.1 Pro Preview long-context numbers as the closest match.
    "gemini-3-pro": {
        "model": "gemini-3-pro",
        "creationRate": 2.00,
        "storageRate": 4.50,
        "cachedInputRate": 0.20,
        "newInputRate": 2.00,
        "outputRate": 12.00,
        "creationRateLong": 4.00,
        "cachedInputRateLong": 0.40,
        "newInputRateLong": 4.00,
        "outputRateLong": 18.00,
    },
    # Gemini 3.1 Flash-Lite — official: in $0.25, out $1.50.
    "gemini-3.1-flash-lite": {
        "model": "gemini-3.1-flash-lite",
        "creationRate": 0.25,
        "storageRate": 1.00,
        "cachedInputRate": 0.025,
        "newInputRate": 0.25,
        "outputRate": 1.50,
        "creationRateLong": 0.25,
        "cachedInputRateLong": 0.025,
        "newInputRateLong": 0.25,
        "outputRateLong": 1.50,
    },
    # Gemini 3 Flash Preview — official: in $0.50 (text), out $3.00,
    # cache read $0.05, storage $1.00/1M/hour (all context lengths).
    "gemini-3-flash-preview": {
        "model": "gemini-3-flash-preview",
        "creationRate": 0.50,
        "storageRate": 1.00,
        "cachedInputRate": 0.05,
        "newInputRate": 0.50,
        "outputRate": 3.00,
        "creationRateLong": 0.50,
        "cachedInputRateLong": 0.05,
        "newInputRateLong": 0.50,
        "outputRateLong": 3.00,
    },
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
    if "claude" in raw and "sonnet" in raw:
        return "claude-sonnet-4-6" if ("4-6" in raw or "4.6" in raw) else "claude-sonnet-5"
    if "claude" in raw and "opus" in raw:
        if "4-7" in raw or "4.7" in raw:
            return "claude-opus-4-7"
        if "4-6" in raw or "4.6" in raw:
            return "claude-opus-4-6"
        return "claude-opus-4-8"
    # Gemini 3.x families first — the generic "flash"/"pro" checks below would
    # otherwise misprice them at 2.5 rates.
    if "3.5" in raw and "flash" in raw:
        return "gemini-3.5-flash"
    if "3.1" in raw and "pro" in raw:
        return "gemini-3.1-pro-preview"
    if "3.1" in raw and "flash-lite" in raw:
        return "gemini-3.1-flash-lite"
    if ("gemini-3" in raw or raw.startswith("3-") or "3.0" in raw) and "flash" in raw:
        return "gemini-3-flash-preview"
    if ("gemini-3" in raw or raw.startswith("3-")) and "pro" in raw:
        return "gemini-3-pro"
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
