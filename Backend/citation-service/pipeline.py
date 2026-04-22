"""
Citation pipeline — proposition-based IK retrieval (ported from citation-service-v1).

Flow:
  1. Fetch case text (3 parallel RAG queries → document service)
  2. PropositionExtractor  — Claude extracts every legal issue from case document
  3. QueryGenerator        — Claude generates IK keyword queries per issue
  4. IK parallel search    — all queries fired in parallel via ThreadPoolExecutor
  5. Full text fetch       — IK /doc/{tid}/ in parallel
  6. DeepValidator         — Claude scores 1-10, extracts ratio/headnote/excerpt
  7. Build + persist report

No Serper. No Elasticsearch. No Qdrant. No validation layers. IK API only.
"""
from __future__ import annotations

import asyncio
import logging
import os
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import quote

from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parent / ".env")

logger = logging.getLogger(__name__)

_DOC_SERVICE_URL = (
    os.environ.get("AGENTIC_DOCUMENT_SERVICE_URL")
    or os.environ.get("DOCUMENT_SERVICE_URL")
    or "http://localhost:5002"
)
_DOC_TIMEOUT = 30.0

_FETCH_QUERIES = [
    "facts parties issue in dispute relief sought prayer",
    "legal arguments statutes sections constitutional rights violated",
    "grounds of challenge legal issues jurisdiction court",
]


async def _fetch_case_chunks_async(case_id: str, user_id: str) -> str:
    """Fetch case text via RAG queries, falling back to files API if vector store has no index."""
    import httpx

    base = _DOC_SERVICE_URL.rstrip("/")
    chunks_seen: set = set()
    all_chunks: List[str] = []

    async def _one(query: str, suppress_404_warning: bool = False) -> Dict[str, Any]:
        try:
            async with httpx.AsyncClient(timeout=_DOC_TIMEOUT) as client:
                resp = await client.post(
                    f"{base}/api/v1/cases/{case_id}/query",
                    json={"user_id": user_id, "case_id": case_id, "query": query, "top_k": 10},
                )
                resp.raise_for_status()
                return resp.json()
        except Exception as exc:
            status_code = getattr(getattr(exc, "response", None), "status_code", None)
            if status_code == 404:
                if not suppress_404_warning:
                    logger.warning(
                        "[PIPELINE] Query endpoint unavailable (404) for case_id=%s; using files API fallback",
                        case_id,
                    )
                return {"_query_endpoint_missing": True}
            logger.warning("[PIPELINE] Doc fetch failed for case_id=%s: %s", case_id, exc)
            return {}

    # Probe query endpoint once. If unavailable, avoid making additional failing calls.
    results: List[Dict[str, Any]] = []
    first_result = await _one(_FETCH_QUERIES[0])
    results.append(first_result)
    if not first_result.get("_query_endpoint_missing"):
        remaining = await asyncio.gather(*[_one(q, suppress_404_warning=True) for q in _FETCH_QUERIES[1:]])
        results.extend(remaining)

    for res in results:
        for chunk in res.get("sources", res.get("raw_chunks", [])):
            cid  = chunk.get("id") or (chunk.get("content", "") or chunk.get("text", ""))[:40]
            text = (chunk.get("content") or chunk.get("text") or "").strip()
            if text and cid not in chunks_seen:
                chunks_seen.add(cid)
                all_chunks.append(text)
        ans = (res.get("answer") or res.get("facts") or "").strip()
        if ans and ans[:40] not in chunks_seen:
            chunks_seen.add(ans[:40])
            all_chunks.insert(0, ans)

    # Fallback: if RAG returned nothing, try files API for raw case/document text
    if not all_chunks:
        try:
            async with httpx.AsyncClient(timeout=_DOC_TIMEOUT) as client:
                # Try case metadata + documents list
                case_resp = await client.get(f"{base}/api/files/cases/{case_id}")
                if case_resp.status_code == 200:
                    payload = case_resp.json()
                    case_data = payload.get("case") or payload
                    title = (case_data.get("case_title") or case_data.get("name") or
                             case_data.get("title") or "")
                    if title:
                        all_chunks.append(f"Case: {title}")
                    # Try fetching documents in the case folder (supports both legacy and flat case payloads).
                    folder_names: List[str] = []
                    folders = case_data.get("folders") or []
                    for folder in folders[:2]:
                        fname = (
                            folder.get("name")
                            or folder.get("originalname")
                            or folder.get("folder_path")
                            or ""
                        )
                        if fname:
                            folder_names.append(str(fname))
                    flat_folder = (
                        case_data.get("folder_name")
                        or case_data.get("folder")
                        or case_data.get("folder_path")
                        or ""
                    )
                    if flat_folder:
                        folder_names.append(str(flat_folder))
                    if not folder_names and title:
                        folder_names.append(str(title))

                    for fname in list(dict.fromkeys(folder_names))[:3]:
                        enc_name = quote(str(fname), safe="")
                        docs_resp = await client.get(f"{base}/api/files/{enc_name}/files")
                        if docs_resp.status_code == 200:
                            docs_data = docs_resp.json()
                            files = docs_data.get("files") or docs_data.get("data") or []
                            for f in files[:5]:
                                text = (
                                    f.get("full_text_content")
                                    or f.get("summary")
                                    or f.get("content")
                                    or f.get("snippet")
                                    or ""
                                ).strip()
                                if text:
                                    all_chunks.append(text[:3000])
                            if files:
                                break
            if all_chunks:
                logger.info("[PIPELINE] Case text from files API fallback: %d chunks (case_id=%s)",
                            len(all_chunks), case_id)
        except Exception as exc:
            logger.warning("[PIPELINE] Files API fallback failed for case_id=%s: %s", case_id, exc)

    case_text = "\n\n".join(filter(None, all_chunks))[:8000]
    logger.info("[PIPELINE] Case text: %d chars from %d chunks (case_id=%s)",
                len(case_text), len(all_chunks), case_id)
    return case_text


def _fetch_case_chunks_sync(case_id: str, user_id: str) -> str:
    """Sync wrapper for _fetch_case_chunks_async."""
    try:
        loop = asyncio.new_event_loop()
        return loop.run_until_complete(_fetch_case_chunks_async(case_id, user_id))
    except Exception as exc:
        logger.warning("[PIPELINE] Chunk fetch sync wrapper failed: %s", exc)
        return ""
    finally:
        loop.close()


def run_pipeline(
    query: str,
    user_id: str,
    ingest_external: bool = True,
    case_file_context: Optional[List[Dict[str, Any]]] = None,
    case_id: Optional[str] = None,
    retrieval_method: str = "indiankanoon",
) -> Dict[str, Any]:
    """
    Run the proposition-based citation pipeline (sync — called via asyncio.to_thread).

    Returns: { report_id, report_format, run_id, status, error }
    """
    from agents.proposition_pipeline import run_proposition_pipeline
    from db.client import pipeline_run_insert, pipeline_run_update, report_insert

    user_id = (user_id or "anonymous").strip()
    query   = (query or "").strip()
    if not query:
        return {"error": "query is required", "report_id": None,
                "report_format": None, "run_id": None, "status": None}

    run_id = str(uuid.uuid4())
    try:
        pipeline_run_insert(run_id, user_id, query, case_id=case_id)
    except Exception as exc:
        logger.warning("[PIPELINE] pipeline_run_insert failed: %s", exc)

    # Build case_file_context from fetched chunks if not provided
    case_context = ""
    if case_file_context:
        parts = []
        for f in case_file_context[:5]:
            text = (f.get("content") or f.get("snippet") or "").strip()
            if text:
                parts.append(text)
        case_context = "\n\n".join(parts)[:8000]
    elif case_id:
        case_text = _fetch_case_chunks_sync(case_id, user_id)
        case_context = case_text

    try:
        report_format = run_proposition_pipeline(
            query=query,
            case_context=case_context,
            run_id=run_id,
            perspective="all",
            user_id=user_id,
            case_id=case_id,
        )
    except Exception as exc:
        logger.exception("[PIPELINE] Proposition pipeline crashed: %s", exc)
        try:
            pipeline_run_update(run_id, "failed", error_message=str(exc)[:2000])
        except Exception:
            pass
        return {"error": str(exc), "report_id": None, "report_format": None,
                "run_id": run_id, "status": "failed"}

    # Persist report
    report_id = str(uuid.uuid4())
    citation_count = len((report_format or {}).get("citations", []))
    try:
        report_insert(
            report_id,
            user_id,
            query,
            report_format,
            "completed",
            case_id=case_id,
            run_id=run_id,
            citations_approved_count=citation_count,
        )
    except Exception as exc:
        logger.warning("[PIPELINE] report_insert failed: %s", exc)
    try:
        pipeline_run_update(
            run_id, "completed",
            report_id=report_id,
            citations_approved_count=citation_count,
        )
    except Exception as exc:
        logger.warning("[PIPELINE] pipeline_run_update failed: %s", exc)

    logger.info("[PIPELINE] Done — report_id=%s citations=%d", report_id, citation_count)
    return {
        "report_id":     report_id,
        "report_format": report_format,
        "run_id":        run_id,
        "status":        "completed",
        "error":         None,
    }
