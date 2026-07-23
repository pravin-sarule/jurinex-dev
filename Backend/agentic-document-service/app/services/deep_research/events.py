"""SSE event builders for Deep Research.

These MUST match the shapes intelligent_chat_stream already emits so the existing
frontend renders them with no changes:

    {"type": "status",   "status": "<phase>", "message": "..."}
    {"type": "thinking", "text": "...\n"}          # progress / reasoning trace
    {"type": "chunk",    "text": "<delta>"}         # answer tokens  (NOT "token")
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


def status(phase: str, message: str) -> str:
    return sse({"type": "status", "status": phase, "message": message})


def thinking(text: str) -> str:
    if not text.endswith("\n"):
        text += "\n"
    return sse({"type": "thinking", "text": text})


def chunk(delta: str) -> str:
    return sse({"type": "chunk", "text": delta})


def error(message: str) -> str:
    return sse({"type": "error", "message": message})


def done(**fields: Any) -> str:
    payload: dict[str, Any] = {"type": "done"}
    payload.update(fields)
    return sse(payload)
