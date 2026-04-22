"""Judgment full-text fetcher — resolves IK docs and web URLs to plain text."""
from __future__ import annotations

import re
from typing import Any, Dict, Optional
from urllib.parse import urlparse

import httpx

_TIMEOUT = 30.0
_MAX_CHARS = 12000


def _strip_html(html: str) -> str:
    """Minimal HTML tag stripper."""
    from html.parser import HTMLParser

    class _S(HTMLParser):
        def __init__(self):
            super().__init__()
            self.parts = []

        def handle_data(self, data):
            self.parts.append(data)

    s = _S()
    s.feed(html)
    return re.sub(r"\s+", " ", " ".join(s.parts)).strip()


async def fetch_judgment_text(
    url_or_id: str,
    ik_token: Optional[str] = None,
) -> Dict[str, Any]:
    """Fetch full text of a judgment from a URL or IK doc ID.

    Handles:
    - IK canonical IDs: "ik:123456"
    - IK URLs: "https://indiankanoon.org/doc/123456/"
    - Generic web URLs (judiciary/court sites)

    Returns:
        {"url": str, "title": str, "full_text": str, "source": str}
    """
    import os

    token = ik_token or os.getenv("INDIAN_KANOON_API_TOKEN") or os.getenv("INDIAN_KANOON_TOKEN", "")

    # IK canonical id
    if url_or_id.startswith("ik:"):
        from .ik_search import fetch_ik_document
        result = await fetch_ik_document(url_or_id)
        return {
            "url": result.get("url", ""),
            "title": result.get("title", ""),
            "full_text": result.get("full_text", "")[:_MAX_CHARS],
            "source": "indian_kanoon",
            "doc_id": url_or_id,
        }

    # IK URL pattern
    ik_match = re.match(r"https?://(?:www\.)?indiankanoon\.org/doc/(\d+)", url_or_id)
    if ik_match:
        from .ik_search import fetch_ik_document
        tid = ik_match.group(1)
        result = await fetch_ik_document(f"ik:{tid}")
        return {
            "url": url_or_id,
            "title": result.get("title", ""),
            "full_text": result.get("full_text", "")[:_MAX_CHARS],
            "source": "indian_kanoon",
            "doc_id": f"ik:{tid}",
        }

    # Generic web URL — simple HTTP GET + HTML strip
    try:
        async with httpx.AsyncClient(
            timeout=_TIMEOUT,
            follow_redirects=True,
            headers={"User-Agent": "Mozilla/5.0 (JuriNex CitationBot/1.0)"},
        ) as client:
            resp = await client.get(url_or_id)
            resp.raise_for_status()
            content_type = resp.headers.get("content-type", "")
            if "html" in content_type:
                text = _strip_html(resp.text)
            else:
                text = resp.text
    except httpx.HTTPError as exc:
        return {"url": url_or_id, "title": "", "full_text": "", "source": "web", "error": str(exc)}

    # Grab title from <title> tag if present
    title_match = re.search(r"<title[^>]*>(.*?)</title>", resp.text, re.IGNORECASE | re.DOTALL)
    title = _strip_html(title_match.group(1)) if title_match else urlparse(url_or_id).netloc

    return {
        "url": url_or_id,
        "title": title,
        "full_text": text[:_MAX_CHARS],
        "source": "web",
        "doc_id": None,
    }
