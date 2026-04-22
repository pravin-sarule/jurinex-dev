"""Serper API — Google search for Indian legal judgments."""
from __future__ import annotations

import os
from typing import Any, Dict, List, Optional

import httpx

_SERPER_URL = "https://google.serper.dev/search"
_SERPER_KEY = os.getenv("SERPER_API_KEY", "")


async def search_google_serper(
    query: str,
    num_results: int = 10,
    country: str = "in",
    time_filter: Optional[str] = None,
) -> Dict[str, Any]:
    """Search Google via Serper for relevant Indian legal judgments.

    Args:
        query: The search query (e.g. "Supreme Court bail conditions Section 437 CrPC")
        num_results: Number of results to return (max 100)
        country: Country code for localised results (default: 'in' for India)
        time_filter: Optional time filter: 'qdr:y' = past year, 'qdr:m' = past month

    Returns:
        {"results": [...], "query": str, "total": int}
        Each result: {"title", "url", "snippet", "date", "source": "serper"}
    """
    if not _SERPER_KEY:
        return {"results": [], "query": query, "total": 0, "error": "SERPER_API_KEY not set"}

    payload: Dict[str, Any] = {
        "q": query,
        "gl": country,
        "hl": "en",
        "num": min(num_results, 100),
        "type": "search",
    }
    if time_filter:
        payload["tbs"] = time_filter

    headers = {
        "X-API-KEY": _SERPER_KEY,
        "Content-Type": "application/json",
    }

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(_SERPER_URL, headers=headers, json=payload)
            resp.raise_for_status()
            data = resp.json()
    except httpx.HTTPError as exc:
        return {"results": [], "query": query, "total": 0, "error": str(exc)}

    results: List[Dict[str, Any]] = []
    for item in data.get("organic", []):
        results.append({
            "title": item.get("title", ""),
            "url": item.get("link", ""),
            "snippet": item.get("snippet", ""),
            "date": item.get("date", ""),
            "source": "serper",
            "position": item.get("position", 0),
            "sitelinks": [s.get("link", "") for s in item.get("sitelinks", [])],
        })

    # Also surface "knowledgeGraph" snippets if present
    kg = data.get("knowledgeGraph", {})
    if kg.get("title"):
        results.insert(0, {
            "title": kg.get("title", ""),
            "url": kg.get("website", ""),
            "snippet": kg.get("description", ""),
            "date": "",
            "source": "serper_kg",
            "position": 0,
        })

    return {"results": results, "query": query, "total": len(results)}


async def search_legal_judgments(
    base_query: str,
    court: Optional[str] = None,
    acts: Optional[List[str]] = None,
    num_results: int = 10,
) -> Dict[str, Any]:
    """High-level helper that builds a targeted legal-search query for Serper."""
    parts = [base_query]
    if court:
        parts.append(f'site:indiankanoon.org OR "{court}"')
    else:
        parts.append("site:indiankanoon.org OR site:judis.nic.in OR court judgment")
    if acts:
        parts.append(" ".join(acts[:3]))

    query = " ".join(parts)
    return await search_google_serper(query, num_results=num_results)
