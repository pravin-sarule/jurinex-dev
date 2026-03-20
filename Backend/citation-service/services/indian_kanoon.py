"""
Indian Kanoon API client — full implementation of all 5 IK API endpoints.

Endpoints:
  1. /search/        — full-text search with all filter params
  2. /doc/<id>/      — full document + citeList + citedbyList
  3. /origdoc/<id>/  — original court copy (PDF/HTML); uploaded to GCS bucket
  4. /docfragment/<id>/  — document fragments relevant to a query
  5. /docmeta/<id>/  — document metadata only

Authentication: shared token via Authorization: Token <token> header.
Token is resolved from env vars INDIAN_KANOON_TOKEN / INDIAN_KANOON_API_TOKEN / IK_API_TOKEN.
"""

from __future__ import annotations

import base64
import io
import json
import logging
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

_IK_BASE = "https://api.indiankanoon.org"


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _get_token() -> Optional[str]:
    return (
        os.environ.get("INDIAN_KANOON_TOKEN")
        or os.environ.get("INDIAN_KANOON_API_TOKEN")
        or os.environ.get("IK_API_TOKEN")
    )


def _ik_request(path: str, params: Optional[Dict[str, Any]] = None, method: str = "POST") -> Optional[Any]:
    """
    Make an authenticated request to the IK API.
    Always POSTs (IK API requires POST for all endpoints).
    Returns parsed JSON dict/list, or None on failure.
    """
    token = _get_token()
    if not token:
        logger.warning("[IK] Token not configured — skipping request to %s", path)
        return None

    url = _IK_BASE + path
    if params:
        qs = urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
        if qs:
            url = url + ("&" if "?" in url else "?") + qs

    try:
        req = urllib.request.Request(url, method=method)
        req.add_header("Authorization", f"Token {token}")
        req.add_header("Accept", "application/json")
        req.add_header("User-Agent", "Mozilla/5.0 (compatible; JurinexCitation/1.0)")
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8", errors="replace"))
    except urllib.error.HTTPError as e:
        body = ""
        try:
            body = e.read().decode("utf-8", errors="replace")[:300]
        except Exception:
            pass
        logger.warning("[IK] HTTP %s for %s: %s", getattr(e, "code", "?"), path, body)
        return None
    except Exception as exc:
        logger.warning("[IK] Request failed for %s: %s", path, exc)
        return None


def _ik_request_raw(path: str) -> Optional[bytes]:
    """Same as _ik_request but returns raw bytes (for origdoc PDF download)."""
    token = _get_token()
    if not token:
        return None
    url = _IK_BASE + path
    try:
        req = urllib.request.Request(url, method="POST")
        req.add_header("Authorization", f"Token {token}")
        req.add_header("User-Agent", "Mozilla/5.0 (compatible; JurinexCitation/1.0)")
        with urllib.request.urlopen(req, timeout=60) as resp:
            content_type = resp.headers.get("Content-Type") or ""
            raw = resp.read()
            return raw, content_type
    except Exception as exc:
        logger.warning("[IK] Raw request failed for %s: %s", path, exc)
        return None, ""


# ─── 1. Search API ────────────────────────────────────────────────────────────

def ik_search(
    query: str,
    pagenum: int = 0,
    maxpages: int = 1,
    doctypes: Optional[str] = None,
    fromdate: Optional[str] = None,
    todate: Optional[str] = None,
    title: Optional[str] = None,
    cite: Optional[str] = None,
    author: Optional[str] = None,
    bench: Optional[str] = None,
    maxcites: Optional[int] = None,
) -> Optional[Dict[str, Any]]:
    """
    Search Indian Kanoon.

    Returns the full API response dict including:
      - docs: list of {tid, title, headline, docsource, docsize}
      - found: total count
      - categories: facets
      - encodedformInput: URL-encoded query string for further use
    """
    params: Dict[str, Any] = {
        "formInput": query,
        "pagenum": pagenum,
    }
    if maxpages and maxpages > 1:
        params["maxpages"] = maxpages
    if doctypes:
        params["doctypes"] = doctypes
    if fromdate:
        params["fromdate"] = fromdate
    if todate:
        params["todate"] = todate
    if title:
        params["title"] = title
    if cite:
        params["cite"] = cite
    if author:
        params["author"] = author
    if bench:
        params["bench"] = bench
    if maxcites:
        params["maxcites"] = maxcites

    return _ik_request("/search/", params=params)


# ─── 2. Document API ──────────────────────────────────────────────────────────

def ik_fetch_doc(
    doc_id: str,
    maxcites: int = 10,
    maxcitedby: int = 10,
) -> Optional[Dict[str, Any]]:
    """
    Fetch full document by IK tid.

    Returns dict with:
      - doc: HTML content of judgment
      - title, tid, docsource
      - citeList:    [{tid, title, docsource}, …]  — cases this judgment cites
      - citedbyList: [{tid, title, docsource}, …]  — cases that cite this judgment
    """
    params: Dict[str, Any] = {}
    if maxcites:
        params["maxcites"] = maxcites
    if maxcitedby:
        params["maxcitedby"] = maxcitedby
    return _ik_request(f"/doc/{doc_id}/", params=params if params else None)


# ─── 3. Original Court Copy (origdoc) ─────────────────────────────────────────

def ik_fetch_origdoc(doc_id: str) -> Dict[str, Any]:
    """
    Fetch the original court copy for an IK document.
    Returns { content_type, data_bytes, gcs_url, gcs_path, error }.

    If the response is a PDF it is uploaded to GCS and the public/signed URL is returned.
    If HTML, content is returned as text (not uploaded).
    """
    result: Dict[str, Any] = {
        "doc_id": doc_id,
        "content_type": None,
        "data_bytes": None,
        "gcs_url": None,
        "gcs_path": None,
        "is_pdf": False,
        "html_content": None,
        "error": None,
    }

    raw, content_type = _ik_request_raw(f"/origdoc/{doc_id}/")
    if not raw:
        result["error"] = "origdoc fetch returned empty response"
        return result

    content_type = (content_type or "").lower()
    result["content_type"] = content_type
    result["data_bytes"] = raw

    is_pdf = "pdf" in content_type or raw[:4] == b"%PDF"
    result["is_pdf"] = is_pdf

    if is_pdf:
        gcs_url, gcs_path = _upload_origdoc_to_gcs(doc_id, raw, "application/pdf")
        result["gcs_url"] = gcs_url
        result["gcs_path"] = gcs_path
        if not gcs_url:
            result["error"] = "GCS upload failed"
    else:
        # HTML or plain text — just decode, don't upload
        try:
            result["html_content"] = raw.decode("utf-8", errors="replace")
        except Exception:
            result["html_content"] = None
        result["error"] = None

    return result


def _upload_origdoc_to_gcs(doc_id: str, data: bytes, content_type: str) -> tuple[Optional[str], Optional[str]]:
    """
    Upload original court copy PDF to GCS.
    Returns (public_url, gcs_path) or (None, None) on failure.
    Bucket is resolved from env: GCS_BUCKET_NAME (defaults to 'draft_templates').
    Subfolder: 'ik_origdocs/'.
    """
    try:
        from google.cloud import storage as gcs_storage
        from google.oauth2 import service_account

        bucket_name = os.environ.get("GCS_BUCKET_NAME", "draft_templates")
        gcs_key_b64 = os.environ.get("GCS_KEY_BASE64")
        project_id = os.environ.get("GCS_PROJECT_ID") or os.environ.get("GCLOUD_PROJECT_ID")

        if gcs_key_b64:
            key_json = base64.b64decode(gcs_key_b64).decode("utf-8")
            info = json.loads(key_json)
            creds = service_account.Credentials.from_service_account_info(info)
            client = gcs_storage.Client(project=project_id, credentials=creds)
        else:
            client = gcs_storage.Client(project=project_id)

        gcs_path = f"ik_origdocs/{doc_id}.pdf"
        bucket = client.bucket(bucket_name)
        blob = bucket.blob(gcs_path)

        # Skip re-upload if already exists
        if blob.exists():
            logger.info("[IK_ORIGDOC] Already uploaded: gs://%s/%s", bucket_name, gcs_path)
        else:
            blob.upload_from_string(data, content_type=content_type)
            logger.info("[IK_ORIGDOC] Uploaded: gs://%s/%s (%d bytes)", bucket_name, gcs_path, len(data))

        # Generate signed URL valid for 7 days
        try:
            from datetime import timedelta
            signed_url = blob.generate_signed_url(
                expiration=timedelta(days=7),
                method="GET",
                version="v4",
            )
            return signed_url, gcs_path
        except Exception:
            # Fallback: public URL (if bucket is public)
            public_url = f"https://storage.googleapis.com/{bucket_name}/{gcs_path}"
            return public_url, gcs_path

    except Exception as exc:
        logger.warning("[IK_ORIGDOC] GCS upload failed for doc_id=%s: %s", doc_id, exc)
        return None, None


# ─── 4. Document Fragments ────────────────────────────────────────────────────

def ik_fetch_docfragment(doc_id: str, query: str) -> Optional[Dict[str, Any]]:
    """
    Fetch document fragments (relevant excerpts) for a doc matching the query.

    Returns dict with:
      - tid, title, formInput, headline (HTML fragment with relevant snippets)
    """
    params = {"formInput": query}
    return _ik_request(f"/docfragment/{doc_id}/", params=params)


# ─── 5. Document Metadata ─────────────────────────────────────────────────────

def ik_fetch_docmeta(doc_id: str) -> Optional[Dict[str, Any]]:
    """
    Fetch lightweight metadata for a document (no full text).

    Returns dict with: tid, title, docsource, publishdate, numcites, etc.
    """
    return _ik_request(f"/docmeta/{doc_id}/")


# ─── Composite: enrich one IK candidate fully ─────────────────────────────────

def ik_enrich_candidate(
    doc_id: str,
    query: str = "",
    fetch_origdoc: bool = True,
    maxcites: int = 10,
    maxcitedby: int = 10,
) -> Dict[str, Any]:
    """
    Fetch ALL IK API data for one document:
      - Full doc (with citeList / citedbyList)
      - Document fragments (relevant to query)
      - Document metadata
      - Original court copy (PDF upload → GCS URL)

    Returns a merged dict that the fetcher / clerk can use.
    """
    enriched: Dict[str, Any] = {
        "doc_id": doc_id,
        "doc_data": None,
        "fragment_data": None,
        "meta_data": None,
        "origdoc_result": None,
    }

    # 1. Full document
    doc_data = ik_fetch_doc(doc_id, maxcites=maxcites, maxcitedby=maxcitedby)
    enriched["doc_data"] = doc_data

    # 2. Document fragments (only if query provided)
    if query:
        fragment_data = ik_fetch_docfragment(doc_id, query)
        enriched["fragment_data"] = fragment_data

    # 3. Metadata
    meta_data = ik_fetch_docmeta(doc_id)
    enriched["meta_data"] = meta_data

    # 4. Original court copy
    if fetch_origdoc:
        orig = ik_fetch_origdoc(doc_id)
        enriched["origdoc_result"] = orig

    return enriched


def _strip_html(html: str) -> str:
    if not html:
        return ""
    text = re.sub(r"<[^>]+>", " ", html)
    return re.sub(r"\s+", " ", text).strip()


def ik_enrich_candidate_cached(
    doc_id: str,
    query: str = "",
    fetch_origdoc: bool = True,
    maxcites: int = 10,
    maxcitedby: int = 10,
    cache_ttl_hours: int = 24,
) -> Dict[str, Any]:
    """
    Like ik_enrich_candidate() but checks ik_document_assets DB cache first.
    If a cached record exists that is newer than cache_ttl_hours, returns cached data
    and skips ALL IK API calls (saves quota and latency).
    Always persists fresh data back to DB after a live fetch.

    Returns enriched dict with extra keys:
      - _cache_hit: True if data came from DB cache
      - _cache_age_hours: hours since last DB update
      - _api_log: list of { endpoint, status, chars/items } for UI display
    """
    from datetime import datetime, timezone, timedelta

    api_log: List[Dict] = []

    # ── 1. Check DB cache ──────────────────────────────────────────────────────
    try:
        from db.client import ik_asset_get
        cached = ik_asset_get(doc_id, increment_hit=False)
    except Exception:
        cached = None

    if cached:
        updated_at = cached.get("updated_at")
        if updated_at:
            if updated_at.tzinfo is None:
                updated_at = updated_at.replace(tzinfo=timezone.utc)
            age_hours = (datetime.now(timezone.utc) - updated_at).total_seconds() / 3600
        else:
            age_hours = 999

        raw_resp = cached.get("raw_api_response") or {}
        cached_char_count = cached.get("doc_char_count") or 0
        if raw_resp and age_hours < cache_ttl_hours and cached_char_count >= 500:
            # Reconstruct enriched dict from cached raw API response
            logger.info("[IK_CACHE] HIT for doc_id=%s (age=%.1fh, chars=%d) — skipping API calls", doc_id, age_hours, cached_char_count)
            api_log.append({"endpoint": "CACHE", "status": "HIT", "age_hours": round(age_hours, 1),
                             "doc_id": doc_id, "title": cached.get("title", "")})
            try:
                from db.client import ik_asset_get as _ik_get
                _ik_get(doc_id, increment_hit=True)
            except Exception:
                pass
            enriched = dict(raw_resp)
            enriched["_cache_hit"] = True
            enriched["_cache_age_hours"] = round(age_hours, 1)
            enriched["_api_log"] = api_log
            return enriched

    # ── 2. Live fetch from all IK endpoints ────────────────────────────────────
    logger.info("[IK_CACHE] MISS for doc_id=%s — calling IK API", doc_id)
    enriched: Dict[str, Any] = {
        "doc_id": doc_id,
        "doc_data": None,
        "fragment_data": None,
        "meta_data": None,
        "origdoc_result": None,
        "_cache_hit": False,
        "_cache_age_hours": None,
        "_api_log": api_log,
    }

    # /doc/<id>/ — full document
    doc_data = ik_fetch_doc(doc_id, maxcites=maxcites, maxcitedby=maxcitedby)
    enriched["doc_data"] = doc_data
    doc_html = (doc_data or {}).get("doc") or ""
    raw_text = _strip_html(doc_html)
    api_log.append({
        "endpoint": f"/doc/{doc_id}/",
        "status": "OK" if doc_data else "FAIL",
        "chars": len(raw_text),
        "cite_count": len((doc_data or {}).get("cites") or (doc_data or {}).get("citeList") or []),
        "citedby_count": len((doc_data or {}).get("citedby") or (doc_data or {}).get("citedbyList") or []),
        "title": (doc_data or {}).get("title", ""),
    })

    # /docfragment/<id>/ — query-relevant fragments
    if query:
        fragment_data = ik_fetch_docfragment(doc_id, query)
        enriched["fragment_data"] = fragment_data
        api_log.append({
            "endpoint": f"/docfragment/{doc_id}/",
            "status": "OK" if fragment_data else "FAIL",
            "has_headline": bool((fragment_data or {}).get("headline")),
        })
    else:
        api_log.append({"endpoint": f"/docfragment/{doc_id}/", "status": "SKIPPED", "reason": "no query"})

    # /docmeta/<id>/ — metadata
    meta_data = ik_fetch_docmeta(doc_id)
    enriched["meta_data"] = meta_data
    api_log.append({
        "endpoint": f"/docmeta/{doc_id}/",
        "status": "OK" if meta_data else "FAIL",
        "publishdate": (meta_data or {}).get("publishdate", ""),
        "numcites": (meta_data or {}).get("numcites"),
    })

    # /origdoc/<id>/ — original court copy
    if fetch_origdoc:
        orig = ik_fetch_origdoc(doc_id)
        enriched["origdoc_result"] = orig
        api_log.append({
            "endpoint": f"/origdoc/{doc_id}/",
            "status": "OK" if (orig and not orig.get("error")) else ("ERROR: " + str((orig or {}).get("error", "fail"))),
            "is_pdf": (orig or {}).get("is_pdf", False),
            "gcs_url": (orig or {}).get("gcs_url", ""),
        })
    else:
        api_log.append({"endpoint": f"/origdoc/{doc_id}/", "status": "SKIPPED", "reason": "fetch_origdoc=False"})

    # ── 3. Persist to DB cache ─────────────────────────────────────────────────
    try:
        from db.client import ik_asset_upsert
        fields = build_ik_report_fields(enriched)
        # Store the full enriched dict as raw_api_response (strip bytes for JSON safety)
        safe_raw = {
            "doc_id":        doc_id,
            "doc_data":      {k: v for k, v in (doc_data or {}).items() if k != "doc"},  # strip huge HTML
            "fragment_data": enriched.get("fragment_data"),
            "meta_data":     enriched.get("meta_data"),
            "origdoc_result": {
                k: v for k, v in (enriched.get("origdoc_result") or {}).items()
                if k not in ("data_bytes", "html_content")  # skip large blobs
            },
        }
        ik_asset_upsert(
            doc_id=doc_id,
            meta=fields.get("ik_doc_meta"),
            fragments={
                "headline":      fields.get("ik_fragment_headline", ""),
                "headline_html": fields.get("ik_fragment_html", ""),
                "form_input":    fields.get("ik_form_input", ""),
            },
            cite_list=fields.get("cite_list"),
            cited_by_list=fields.get("cited_by_list"),
            orig_doc_url=fields.get("original_copy_url") or None,
            orig_doc_gcs_path=fields.get("original_copy_gcs_path") or None,
            orig_doc_content_type="application/pdf" if fields.get("is_original_copy_pdf") else None,
            raw_api_response=safe_raw,
            title=fields.get("title", ""),
            docsource=fields.get("docsource", ""),
            doc_char_count=len(fields.get("raw_content") or ""),
        )
        logger.info("[IK_CACHE] Stored doc_id=%s in ik_document_assets (%d chars)", doc_id, len(fields.get("raw_content") or ""))
    except Exception as exc:
        logger.warning("[IK_CACHE] DB persist failed for doc_id=%s: %s", doc_id, exc)

    enriched["_api_log"] = api_log
    return enriched


def build_ik_report_fields(enriched: Dict[str, Any]) -> Dict[str, Any]:
    """
    Convert the enriched IK data into flat fields for the report and DB storage.

    Returns:
      {
        doc_html, raw_content, title, docsource,
        cite_list, cited_by_list,
        ik_fragment_headline, ik_fragment_html, ik_form_input,
        ik_doc_meta,
        original_copy_url, original_copy_gcs_path, is_original_copy_pdf,
      }
    """
    doc_data      = enriched.get("doc_data") or {}
    fragment_data = enriched.get("fragment_data") or {}
    meta_data     = enriched.get("meta_data") or {}
    origdoc       = enriched.get("origdoc_result") or {}

    doc_html = doc_data.get("doc") or ""
    raw_content = _strip_html(doc_html)

    # IK API returns "cites"/"citedby"; older docs may use "citeList"/"citedbyList"
    cite_list: List[Dict] = doc_data.get("cites") or doc_data.get("citeList") or []
    cited_by_list: List[Dict] = doc_data.get("citedby") or doc_data.get("citedbyList") or []

    return {
        "doc_html":                doc_html,
        "raw_content":             raw_content,
        "title":                   doc_data.get("title") or meta_data.get("title") or "",
        "docsource":               doc_data.get("docsource") or meta_data.get("docsource") or "",
        # Citation network from /doc/
        "cite_list":               cite_list,
        "cited_by_list":           cited_by_list,
        # Fragments from /docfragment/
        "ik_fragment_headline":    _strip_html(fragment_data.get("headline") or ""),
        "ik_fragment_html":        fragment_data.get("headline") or "",
        "ik_form_input":           fragment_data.get("formInput") or "",
        # Full metadata from /docmeta/
        "ik_doc_meta":             meta_data,
        # Original court copy
        "original_copy_url":       origdoc.get("gcs_url") or "",
        "original_copy_gcs_path":  origdoc.get("gcs_path") or "",
        "is_original_copy_pdf":    origdoc.get("is_pdf") or False,
        "origdoc_html_content":    origdoc.get("html_content") or "",
        "origdoc_error":           origdoc.get("error") or "",
    }
