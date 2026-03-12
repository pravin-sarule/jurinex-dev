"""
Fetcher agent: fetch full document content from Indian Kanoon API or from URL (Google result).
Returns raw content / HTML for Clerk to OCR and chunk.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import urllib.request
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

# Minimum judgment text length to consider fetch successful (CHECK 5)
MIN_JUDGMENT_CHARS = 500


def _db_log(run_id: Optional[str], agent: str, stage: str, level: str, msg: str, meta: Optional[Dict] = None) -> None:
    if not run_id:
        return
    try:
        from db.client import agent_log_insert
        agent_log_insert(run_id, None, agent, stage, level, msg, meta)
    except Exception:
        pass


def _fetch_ik_doc(doc_id: str) -> Optional[Dict[str, Any]]:
    """Fetch single document from Indian Kanoon API. Returns { doc (HTML), title, ... } or None."""
    token = os.environ.get("INDIAN_KANOON_API_TOKEN") or os.environ.get("IK_API_TOKEN")
    if not token:
        return None
    try:
        # Per IK docs + AJAX samples, use POST for API calls while passing doc_id in path.
        url = f"https://api.indiankanoon.org/doc/{doc_id}/"
        req = urllib.request.Request(url, method="POST")
        req.add_header("Authorization", f"Token {token}")
        req.add_header("Accept", "application/json")
        req.add_header("User-Agent", "Mozilla/5.0 (compatible; JurinexCitation/1.0)")
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode())
        return data
    except Exception as e:
        logger.warning("IK doc fetch failed for %s: %s", doc_id, e)
        return None


def _strip_html(html: str) -> str:
    """Remove tags and decode entities for plain text."""
    if not html:
        return ""
    text = re.sub(r"<[^>]+>", " ", html)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def fetch_ik_candidates(candidates: List[Dict[str, Any]], run_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """
    For each Indian Kanoon candidate (with external_id = tid), fetch doc and return
    list of { external_id, title, doc_html, raw_content, docsource } for Clerk.
    """
    _db_log(run_id, "fetcher", "fetcher", "INFO",
            f"📡 Fetching full text for {len(candidates)} Indian Kanoon document(s)…",
            {"total": len(candidates)})
    out = []
    skipped = 0
    for c in candidates:
        tid = c.get("external_id")
        title = (c.get("title") or f"tid:{tid}")[:70]
        if not tid:
            continue
        _db_log(run_id, "fetcher", "fetcher", "INFO",
                f"  📄 Fetching IK doc #{tid}: {title}")
        data = _fetch_ik_doc(tid)
        if not data:
            _db_log(run_id, "fetcher", "fetcher", "WARNING",
                    f"  ⚠ IK doc #{tid} — fetch failed or empty response")
            skipped += 1
            continue
        doc_html = data.get("doc") or ""
        raw_content = _strip_html(doc_html)
        if len(raw_content or "") < MIN_JUDGMENT_CHARS:
            logger.warning(
                "[FETCHER] IK doc %s skipped: judgment text length %d < %d chars",
                tid, len(raw_content or ""), MIN_JUDGMENT_CHARS,
            )
            _db_log(run_id, "fetcher", "fetcher", "WARNING",
                    f"  ⚠ IK doc #{tid} skipped — only {len(raw_content or '')} chars (min {MIN_JUDGMENT_CHARS})")
            skipped += 1
            continue
        _db_log(run_id, "fetcher", "fetcher", "INFO",
                f"  ✓ IK doc #{tid}: {title} — {len(raw_content):,} chars")
        out.append({
            "external_id": tid,
            "title": c.get("title") or data.get("title", ""),
            "doc_html": doc_html,
            "raw_content": raw_content[:500000],  # cap size
            "docsource": c.get("docsource", ""),
            "source": "indian_kanoon",
        })
    _db_log(run_id, "fetcher", "fetcher", "INFO",
            f"✅ Indian Kanoon fetch complete — {len(out)}/{len(candidates)} docs fetched" +
            (f", {skipped} skipped" if skipped else ""),
            {"fetched": len(out), "skipped": skipped})
    return out


def fetch_google_candidates(candidates: List[Dict[str, Any]], run_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """
    For each Google candidate (with link), fetch URL content. Simple GET; for PDFs we store URL.
    Returns list of { link, title, raw_content, source } for Clerk.
    """
    _db_log(run_id, "fetcher", "fetcher", "INFO",
            f"📡 Fetching full text for {len(candidates)} Google URL(s)…",
            {"total": len(candidates)})
    out = []
    skipped = 0
    for c in candidates:
        link = c.get("link", "")
        title = (c.get("title") or link)[:70]
        if not link:
            continue
        _db_log(run_id, "fetcher", "fetcher", "INFO",
                f"  🌐 Fetching: {title} | {link[:60]}")
        try:
            req = urllib.request.Request(link, method="GET")
            req.add_header("User-Agent", "Mozilla/5.0 (compatible; JurinexCitation/1.0)")
            with urllib.request.urlopen(req, timeout=15) as resp:
                raw = resp.read()
            try:
                raw_content = raw.decode("utf-8", errors="replace")
            except Exception:
                raw_content = ""
            if "pdf" in (resp.headers.get("Content-Type") or "").lower() or link.lower().endswith(".pdf"):
                raw_content = "[PDF content not extracted in fetcher; URL stored for reference.]"
            content = (raw_content or "")[:300000]
            if len(content) < MIN_JUDGMENT_CHARS:
                logger.warning(
                    "[FETCHER] Google URL %s skipped: judgment text length %d < %d chars",
                    link[:80], len(content), MIN_JUDGMENT_CHARS,
                )
                _db_log(run_id, "fetcher", "fetcher", "WARNING",
                        f"  ⚠ Skipped — only {len(content)} chars at {link[:60]}")
                skipped += 1
            else:
                _db_log(run_id, "fetcher", "fetcher", "INFO",
                        f"  ✓ Fetched: {title} — {len(content):,} chars")
                out.append({
                    "link": link,
                    "title": c.get("title", ""),
                    "snippet": c.get("snippet", ""),
                    "raw_content": content,
                    "source": "google",
                })
        except Exception as e:
            logger.warning("Fetch URL failed %s: %s", link[:80], e)
            _db_log(run_id, "fetcher", "fetcher", "WARNING",
                    f"  ⚠ Fetch failed: {link[:60]} — {e}")
            skipped += 1
    _db_log(run_id, "fetcher", "fetcher", "INFO",
            f"✅ Google fetch complete — {len(out)}/{len(candidates)} URLs fetched" +
            (f", {skipped} skipped" if skipped else ""),
            {"fetched": len(out), "skipped": skipped})
    return out
