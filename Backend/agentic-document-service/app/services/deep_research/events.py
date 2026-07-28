"""SSE event builders for Deep Research.

These MUST match the shapes intelligent_chat_stream already emits so the existing
frontend renders them with no changes:

    {"type": "status",   "status": "<phase>", "message": "..."}
    {"type": "thinking", "text": "...\n"}          # progress / reasoning trace
    {"type": "chunk",    "text": "<delta>"}         # answer delta (NOT "token")
    {"type": "chunk",    "text": "<snapshot>", "replace": true}
    {"type": "done",     ...}                        # terminal success
    {"type": "error",    "message": "..."}           # terminal failure

The wire format is exactly `data: <json>\n\n`, identical to the `_sse` closure in
files.py.
"""

from __future__ import annotations

import json
from typing import Any


def sse(payload: dict[str, Any]) -> str:
    return f"data: {json.dumps(payload)}\n\n"


def status(status_name: str, message: str, **fields: Any) -> str:
    payload = {"type": "status", "status": status_name, "message": message}
    payload.update(fields)
    return sse(payload)


def thinking(text: str, **fields: Any) -> str:
    if not text.endswith("\n"):
        text += "\n"
    payload = {"type": "thinking", "text": text}
    payload.update(fields)
    return sse(payload)


def chunk(delta: str, *, replace: bool = False) -> str:
    payload: dict[str, Any] = {"type": "chunk", "text": delta}
    if replace:
        payload["replace"] = True
    return sse(payload)


def error(
    message: str,
    *,
    code: str = "deep_research_failed",
    retryable: bool = False,
    **fields: Any,
) -> str:
    payload = {"type": "error", "message": message, "code": code, "retryable": retryable}
    payload.update(fields)
    return sse(payload)


def done(**fields: Any) -> str:
    payload: dict[str, Any] = {"type": "done"}
    payload.update(fields)
    return sse(payload)
