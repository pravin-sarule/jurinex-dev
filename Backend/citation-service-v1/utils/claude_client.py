from __future__ import annotations

import os
from functools import lru_cache
from typing import Any, Dict, List, Optional

import anthropic

_CLAUDE_MODEL = os.getenv("CLAUDE_MODEL", "claude-sonnet-4-6-20251001")
_MAX_TOKENS = 8192


@lru_cache(maxsize=1)
def get_claude_client() -> anthropic.AsyncAnthropic:
    api_key = os.getenv("ANTHROPIC_API_KEY") or os.getenv("CLAUDE_API_KEY")
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY or CLAUDE_API_KEY must be set")
    return anthropic.AsyncAnthropic(api_key=api_key)


async def claude_complete(
    system: str,
    user: str,
    model: Optional[str] = None,
    max_tokens: int = _MAX_TOKENS,
    temperature: float = 0.2,
    tools: Optional[List[Dict[str, Any]]] = None,
) -> str:
    """Call Claude and return the text response."""
    client = get_claude_client()
    kwargs: Dict[str, Any] = dict(
        model=model or _CLAUDE_MODEL,
        max_tokens=max_tokens,
        temperature=temperature,
        system=system,
        messages=[{"role": "user", "content": user}],
    )
    if tools:
        kwargs["tools"] = tools

    response = await client.messages.create(**kwargs)

    # Return first text block
    for block in response.content:
        if hasattr(block, "text"):
            return block.text
    return ""


async def claude_complete_json(
    system: str,
    user: str,
    model: Optional[str] = None,
    max_tokens: int = _MAX_TOKENS,
) -> Any:
    """Call Claude expecting a JSON response; parses and returns the dict/list."""
    import json
    import re

    text = await claude_complete(
        system=system,
        user=user,
        model=model,
        max_tokens=max_tokens,
        temperature=0.1,
    )

    # Extract JSON from markdown code fences if present
    fence_match = re.search(r"```(?:json)?\s*([\s\S]+?)\s*```", text)
    json_str = fence_match.group(1) if fence_match else text.strip()

    # Try full parse first
    try:
        return json.loads(json_str)
    except json.JSONDecodeError:
        pass

    # Find the first { or [ and use raw_decode to stop at the end of valid JSON
    # (handles trailing text like "Please let me know if..." after the closing brace)
    decoder = json.JSONDecoder()
    for i, ch in enumerate(json_str):
        if ch in ("{", "["):
            try:
                obj, _ = decoder.raw_decode(json_str, i)
                return obj
            except json.JSONDecodeError:
                pass

    # Complete failure — raise so callers' except branches produce proper fallbacks
    raise ValueError(f"Claude did not return valid JSON. Response snippet: {text[:300]!r}")
