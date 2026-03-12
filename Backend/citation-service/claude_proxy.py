"""
Claude API proxy — same logic as proxy.js: forward POST to Anthropic, keep API key server-side.
Solves CORS and keeps CLAUDE_API_KEY out of the browser.
"""

from __future__ import annotations

import json
import logging
import os
import urllib.request
from typing import Any, Dict

logger = logging.getLogger(__name__)

ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"


def forward_to_claude(body: Dict[str, Any]) -> Dict[str, Any]:
    """
    Forward request body to Anthropic Messages API. Returns parsed JSON response or raises.
    """
    api_key = os.environ.get("CLAUDE_API_KEY")
    if not api_key:
        raise ValueError("CLAUDE_API_KEY not set")

    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        ANTHROPIC_URL,
        data=data,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            out = json.loads(resp.read().decode())
            logger.info("Claude API response: %s bytes", len(data))
            return out
    except urllib.error.HTTPError as e:
        err_body = e.read().decode() if e.fp else ""
        try:
            err_json = json.loads(err_body)
            logger.warning("Claude API error: %s %s", e.code, err_json)
        except Exception:
            logger.warning("Claude API error: %s %s", e.code, err_body[:200])
        raise
