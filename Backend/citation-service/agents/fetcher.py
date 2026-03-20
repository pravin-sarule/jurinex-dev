"""
Fetcher agent: fetch full document content from Indian Kanoon API or from URL (Google result).
Returns raw content / HTML for Clerk to OCR and chunk.

IK fetch now includes ALL five API endpoints per document:
  - /doc/<id>/          → full HTML + citeList + citedbyList
  - /docfragment/<id>/  → query-relevant text fragment / headline
  - /docmeta/<id>/      → lightweight metadata
  - /origdoc/<id>/      → original court copy (PDF → GCS upload)
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed as _as_completed
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


def _strip_html(html: str) -> str:
    """Remove tags and decode entities for plain text."""
    if not html:
        return ""
    text = re.sub(r"<[^>]+>", " ", html)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def fetch_ik_candidates(
    candidates: List[Dict[str, Any]],
    query: str = "",
    run_id: Optional[str] = None,
    fetch_origdoc: bool = True,
    maxcites: int = 10,
    maxcitedby: int = 10,
) -> List[Dict[str, Any]]:
    """
    For each Indian Kanoon candidate (with external_id = tid), call ALL IK API endpoints:
      - /doc/<id>/          — full document + citeList + citedbyList
      - /docfragment/<id>/  — query-relevant snippets
      - /docmeta/<id>/      — metadata
      - /origdoc/<id>/      — court copy PDF; uploaded to GCS; URL stored in result

    Returns list of enriched dicts for Clerk ingestion.
    """
    try:
        from services.indian_kanoon import ik_enrich_candidate_cached, build_ik_report_fields
        _use_ik_service = True
    except ImportError:
        _use_ik_service = False
        logger.warning("[FETCHER] services.indian_kanoon not importable — falling back to basic fetch")

    _db_log(run_id, "fetcher", "fetcher", "INFO",
            f"📡 Fetching full text + origdoc + fragments for {len(candidates)} Indian Kanoon document(s)…",
            {"total": len(candidates)})

    def _fetch_one_ik(c: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Fetch and enrich one IK candidate. Returns result dict or None on skip."""
        tid = c.get("external_id")
        title = (c.get("title") or f"tid:{tid}")[:70]
        if not tid:
            return None

        _db_log(run_id, "fetcher", "fetcher", "INFO", f"  📄 Fetching IK doc #{tid}: {title}")

        if _use_ik_service:
            enriched = ik_enrich_candidate_cached(
                doc_id=tid, query=query, fetch_origdoc=fetch_origdoc,
                maxcites=maxcites, maxcitedby=maxcitedby,
            )
            fields = build_ik_report_fields(enriched)

            for entry in (enriched.get("_api_log") or []):
                ep = entry.get("endpoint", "")
                st = entry.get("status", "")
                if ep == "CACHE":
                    _db_log(run_id, "fetcher", "fetcher", "INFO",
                            f"  🗄 CACHE HIT: doc #{tid} — served from DB (age={entry.get('age_hours','?')}h) — IK API calls skipped",
                            {"tid": tid, "cache_hit": True, "age_hours": entry.get("age_hours")})
                elif "/doc/" in ep:
                    _db_log(run_id, "fetcher", "fetcher", "INFO" if st == "OK" else "WARNING",
                            f"  📄 /doc/{tid}/ → {st} | {entry.get('chars', 0):,} chars | cites={entry.get('cite_count', 0)} citedBy={entry.get('citedby_count', 0)}",
                            {"endpoint": ep, "status": st, "chars": entry.get("chars"), "cite_count": entry.get("cite_count"), "citedby_count": entry.get("citedby_count")})
                elif "/docfragment/" in ep:
                    _db_log(run_id, "fetcher", "fetcher", "INFO" if st in ("OK", "SKIPPED") else "WARNING",
                            f"  🔍 /docfragment/{tid}/ → {st}" + (" | headline found" if entry.get("has_headline") else ""),
                            {"endpoint": ep, "status": st})
                elif "/docmeta/" in ep:
                    _db_log(run_id, "fetcher", "fetcher", "INFO" if st in ("OK", "SKIPPED") else "WARNING",
                            f"  📋 /docmeta/{tid}/ → {st} | publishdate={entry.get('publishdate','?')} numcites={entry.get('numcites','?')}",
                            {"endpoint": ep, "status": st, "publishdate": entry.get("publishdate"), "numcites": entry.get("numcites")})
                elif "/origdoc/" in ep:
                    _db_log(run_id, "fetcher", "fetcher", "INFO" if "OK" in st or st == "SKIPPED" else "WARNING",
                            f"  📎 /origdoc/{tid}/ → {st}" + (" | PDF → GCS" if entry.get("is_pdf") and entry.get("gcs_url") else ""),
                            {"endpoint": ep, "status": st, "is_pdf": entry.get("is_pdf"), "gcs_url": (entry.get("gcs_url") or "")[:80]})

            raw_content = fields.get("raw_content") or ""
            doc_html    = fields.get("doc_html") or ""
            if not raw_content and doc_html:
                raw_content = _strip_html(doc_html)

            if len(raw_content or "") < MIN_JUDGMENT_CHARS:
                logger.warning("[FETCHER] IK doc %s skipped: %d chars < %d", tid, len(raw_content or ""), MIN_JUDGMENT_CHARS)
                _db_log(run_id, "fetcher", "fetcher", "WARNING",
                        f"  ⚠ IK doc #{tid} skipped — only {len(raw_content or '')} chars (min {MIN_JUDGMENT_CHARS})")
                return None

            orig_url = fields.get("original_copy_url") or ""
            _db_log(run_id, "fetcher", "fetcher", "INFO",
                    f"  ✓ IK doc #{tid}: {title} — {len(raw_content):,} chars"
                    + (f" | origdoc={orig_url[:60]}" if orig_url else "")
                    + (f" | cites={len(fields.get('cite_list') or [])} citedby={len(fields.get('cited_by_list') or [])}"),
                    {"tid": tid, "chars": len(raw_content), "original_copy_url": orig_url,
                     "cite_list_count": len(fields.get("cite_list") or []),
                     "cited_by_list_count": len(fields.get("cited_by_list") or [])})
            return {
                "external_id":            tid,
                "title":                  c.get("title") or fields.get("title", ""),
                "doc_html":               doc_html,
                "raw_content":            raw_content[:500000],
                "docsource":              c.get("docsource") or fields.get("docsource", ""),
                "source":                 "indian_kanoon",
                "cite_list":              fields.get("cite_list") or [],
                "cited_by_list":          fields.get("cited_by_list") or [],
                "ik_fragment_headline":   fields.get("ik_fragment_headline") or "",
                "ik_fragment_html":       fields.get("ik_fragment_html") or "",
                "ik_form_input":          fields.get("ik_form_input") or "",
                "ik_doc_meta":            fields.get("ik_doc_meta") or {},
                "original_copy_url":      orig_url,
                "original_copy_gcs_path": fields.get("original_copy_gcs_path") or "",
                "is_original_copy_pdf":   fields.get("is_original_copy_pdf") or False,
                "origdoc_html_content":   fields.get("origdoc_html_content") or "",
            }

        else:
            # ── Fallback: basic /doc/<id>/ only ──────────────────────────────
            token = (
                os.environ.get("INDIAN_KANOON_TOKEN")
                or os.environ.get("INDIAN_KANOON_API_TOKEN")
                or os.environ.get("IK_API_TOKEN")
            )
            if not token:
                return None
            try:
                url = f"https://api.indiankanoon.org/doc/{tid}/"
                req = urllib.request.Request(url, method="POST")
                req.add_header("Authorization", f"Token {token}")
                req.add_header("Accept", "application/json")
                req.add_header("User-Agent", "Mozilla/5.0 (compatible; JurinexCitation/1.0)")
                with urllib.request.urlopen(req, timeout=30) as resp:
                    data = json.loads(resp.read().decode())
            except Exception as e:
                logger.warning("IK doc fetch failed for %s: %s", tid, e)
                return None
            doc_html = data.get("doc") or ""
            raw_content = _strip_html(doc_html)
            if len(raw_content or "") < MIN_JUDGMENT_CHARS:
                return None
            return {
                "external_id": tid,
                "title": c.get("title") or data.get("title", ""),
                "doc_html": doc_html,
                "raw_content": raw_content[:500000],
                "docsource": c.get("docsource", ""),
                "source": "indian_kanoon",
                "cite_list": data.get("citeList") or [],
                "cited_by_list": data.get("citedbyList") or [],
            }

    # Parallel fetch — 4 workers (balances IK rate limits vs latency)
    out = []
    skipped = 0
    with ThreadPoolExecutor(max_workers=min(4, len(candidates) or 1)) as pool:
        futs = {pool.submit(_fetch_one_ik, c): c for c in candidates}
        for fut in _as_completed(futs):
            try:
                result = fut.result(timeout=90)
                if result:
                    out.append(result)
                else:
                    skipped += 1
            except Exception as exc:
                logger.warning("[FETCHER] IK worker error: %s", exc)
                skipped += 1

    _db_log(run_id, "fetcher", "fetcher", "INFO",
            f"✅ Indian Kanoon fetch complete — {len(out)}/{len(candidates)} docs fetched" +
            (f", {skipped} skipped" if skipped else ""),
            {"fetched": len(out), "skipped": skipped})
    return out


_IK_WEB_URL_RE = re.compile(
    r"https?://(?:www\.)?indiankanoon\.org/(?:doc|docfragment)/(\d+)/?", re.I
)
_IK_SEARCH_URL_RE = re.compile(
    r"https?://(?:www\.)?indiankanoon\.org/search/\?", re.I
)


def fetch_google_candidates(candidates: List[Dict[str, Any]], run_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """
    For each Google candidate (with link), fetch URL content. Simple GET; for PDFs we store URL.
    IK web URLs (indiankanoon.org/doc/{tid}/) are redirected to the IK API automatically.
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

        if _IK_SEARCH_URL_RE.match(link):
            _db_log(
                run_id, "fetcher", "fetcher", "INFO",
                f"  ↷ Skipping Indian Kanoon search page: {title}"
            )
            skipped += 1
            continue

        # Detect indiankanoon.org web URLs and route them to the IK API instead
        ik_match = _IK_WEB_URL_RE.match(link)
        if ik_match:
            tid = ik_match.group(1)
            _db_log(run_id, "fetcher", "fetcher", "INFO",
                    f"  🔀 IK web URL detected → routing to IK API (tid={tid}): {title}")
            ik_result = fetch_ik_candidates(
                [{"external_id": tid, "title": c.get("title", "")}],
                run_id=run_id,
                fetch_origdoc=False,
            )
            if ik_result:
                out.extend(ik_result)
            else:
                skipped += 1
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
