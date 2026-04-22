"""Indian Kanoon API — search and document retrieval."""
from __future__ import annotations

import os
from typing import Any, Dict, List, Optional

import httpx

_IK_TOKEN = os.getenv("INDIAN_KANOON_API_TOKEN") or os.getenv("INDIAN_KANOON_TOKEN", "")
_IK_BASE = "https://api.indiankanoon.org"
_TIMEOUT = 30.0


def _ik_headers() -> Dict[str, str]:
    return {
        "Authorization": f"Token {_IK_TOKEN}",
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
    }


async def search_indian_kanoon(
    query: str,
    page_num: int = 0,
    doc_types: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """Search Indian Kanoon for relevant judgments.

    Args:
        query: Legal search query
        page_num: Pagination offset (0-indexed)
        doc_types: Document types to filter, e.g. ["judgment", "supremecourt"]

    Returns:
        {"results": [...], "query": str, "total": int}
        Each result: {"title", "tid", "url", "snippet", "court", "date", "source": "indian_kanoon"}
    """
    if not _IK_TOKEN:
        return {"results": [], "query": query, "total": 0, "error": "INDIAN_KANOON_API_TOKEN not set"}

    params: Dict[str, Any] = {"formInput": query, "pagenum": page_num}
    if doc_types:
        params["doctypes"] = ",".join(doc_types)

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.post(
                f"{_IK_BASE}/search/",
                headers=_ik_headers(),
                data=params,
            )
            resp.raise_for_status()
            data = resp.json()
    except httpx.HTTPError as exc:
        return {"results": [], "query": query, "total": 0, "error": str(exc)}

    results: List[Dict[str, Any]] = []
    for doc in data.get("docs", []):
        tid = doc.get("tid", "")
        results.append({
            "title": doc.get("title", ""),
            "tid": tid,
            "url": f"https://indiankanoon.org/doc/{tid}/",
            "snippet": doc.get("headline", ""),
            "court": doc.get("docsource", ""),
            "date": doc.get("publishdate", ""),
            "source": "indian_kanoon",
            "doc_id": f"ik:{tid}",
        })

    return {
        "results": results,
        "query": query,
        "total": data.get("total", len(results)),
        "page": page_num,
    }


async def fetch_ik_document(tid: str) -> Dict[str, Any]:
    """Fetch full text of an Indian Kanoon document.

    Args:
        tid: Document TID (numeric ID from IK)

    Returns:
        {"tid": str, "title": str, "full_text": str, "doc": dict}
    """
    if not _IK_TOKEN:
        return {"error": "INDIAN_KANOON_API_TOKEN not set", "full_text": ""}

    clean_tid = str(tid).replace("ik:", "")

    try:
        async with httpx.AsyncClient(timeout=45.0) as client:
            resp = await client.get(
                f"{_IK_BASE}/doc/{clean_tid}/",
                headers=_ik_headers(),
            )
            resp.raise_for_status()
            data = resp.json()
    except httpx.HTTPError as exc:
        return {"error": str(exc), "full_text": "", "tid": clean_tid}

    doc_text = data.get("doc", "")
    # IK returns HTML; strip tags for plain text processing
    try:
        from html.parser import HTMLParser

        class _Stripper(HTMLParser):
            def __init__(self):
                super().__init__()
                self.parts: List[str] = []

            def handle_data(self, data):
                self.parts.append(data)

        s = _Stripper()
        s.feed(doc_text)
        plain_text = " ".join(s.parts)
    except Exception:
        plain_text = doc_text

    # Extract headnotes — IK may return as string or list
    raw_headnotes = data.get("headnotes", "") or data.get("headnote", "")
    if isinstance(raw_headnotes, list):
        headnotes_text = "\n".join(str(h) for h in raw_headnotes if h)
    else:
        headnotes_text = str(raw_headnotes) if raw_headnotes else ""

    # Strip HTML from headnotes too
    if "<" in headnotes_text:
        try:
            s2 = _Stripper()
            s2.feed(headnotes_text)
            headnotes_text = " ".join(s2.parts).strip()
        except Exception:
            pass

    bench = data.get("bench", "") or data.get("coram", "")
    citation_str = data.get("citation", "") or data.get("primarycitation", "")

    return {
        "tid": clean_tid,
        "title": data.get("title", ""),
        "full_text": plain_text[:15000],
        "court": data.get("docsource", ""),
        "date": data.get("publishdate", ""),
        "url": f"https://indiankanoon.org/doc/{clean_tid}/",
        "doc_id": f"ik:{clean_tid}",
        "headnotes": headnotes_text[:2000],
        "bench": bench,
        "ik_citation": citation_str,
    }


async def fetch_ik_citations(tid: str) -> Dict[str, Any]:
    """Fetch forward/backward citations for an IK document."""
    if not _IK_TOKEN:
        return {"cited_by": [], "cites": []}

    clean_tid = str(tid).replace("ik:", "")
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.get(
                f"{_IK_BASE}/docfragment/{clean_tid}/",
                headers=_ik_headers(),
            )
            resp.raise_for_status()
            data = resp.json()
    except httpx.HTTPError:
        return {"cited_by": [], "cites": []}

    return {
        "cited_by": data.get("citedby_docs", [])[:10],
        "cites": data.get("cites_docs", [])[:10],
    }
