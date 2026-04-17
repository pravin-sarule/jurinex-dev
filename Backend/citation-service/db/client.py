"""
PostgreSQL + Elasticsearch DB client for citation-service.
Uses canonical_id across systems and stores report snapshots in PostgreSQL.
"""

from __future__ import annotations

import logging
import os
import re
import time
from datetime import date, datetime
from typing import Any, Dict, List, Optional, Tuple

from psycopg2.extras import Json, RealDictCursor

from db.connections import (
    elasticsearch_init_failed,
    get_es_client,
    get_neo4j_driver,
    get_pg_conn,
    get_qdrant_client,
)

logger = logging.getLogger(__name__)
_HITL_PK_CACHE: Optional[str] = None
_qdrant_embed_client = None
_qdrant_embed_available = None
_EMBED_RETRY_ATTEMPTS = 3
_EMBED_RETRY_BASE_DELAY_SECS = 0.75
_ADMIN_UPLOAD_TABLE_CACHE: Optional[str] = None
_ADMIN_UPLOAD_COLS_CACHE: Dict[str, set] = {}


def _resolve_query_embed_model() -> str:
    """
    Model id for query vectors (must match Qdrant `legal_embeddings` index geometry).
    Default: models/gemini-embedding-001 (same family as document chunks in LegalCitationAgent).
    Env GEMINI_QUERY_EMBEDDING_MODEL overrides. Legacy doc name "text-embedding-001" maps here.
    """
    raw = (os.environ.get("GEMINI_QUERY_EMBEDDING_MODEL") or "models/gemini-embedding-001").strip()
    legacy = {
        "text-embedding-001",
        "models/text-embedding-001",
        "gemini-text-embedding-001",
    }
    if raw.lower() in legacy:
        raw = "models/gemini-embedding-001"
    if not raw:
        raw = "models/gemini-embedding-001"
    return raw if raw.startswith("models/") else f"models/{raw}"


def _query_embed_config(model: str) -> Dict[str, Any]:
    """Gemini embedding models use RETRIEVAL_QUERY; text-embedding models omit task_type."""
    dims = int(os.environ.get("CITATION_EMBED_OUTPUT_DIMS", "768"))
    if "gemini-embedding" in model:
        task_type = os.environ.get("CITATION_EMBED_QUERY_TASK_TYPE", "RETRIEVAL_QUERY")
        return {"task_type": task_type, "output_dimensionality": dims}
    return {"output_dimensionality": dims}


def _ensure_query_embed_client() -> bool:
    """Lazily initialise google.genai client for query embeddings. Returns True if usable."""
    global _qdrant_embed_client, _qdrant_embed_available
    if _qdrant_embed_available is None:
        try:
            from dotenv import load_dotenv
            load_dotenv()
        except Exception:
            pass
        try:
            from google import genai
            api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
            if not api_key:
                logger.warning("[QDRANT] GEMINI_API_KEY / GOOGLE_API_KEY not set — semantic search disabled")
                _qdrant_embed_available = False
            else:
                _qdrant_embed_client = genai.Client(api_key=api_key)
                _qdrant_embed_available = True
                logger.info(
                    "[QDRANT] Query embedder initialised (model=%s)",
                    _resolve_query_embed_model(),
                )
        except Exception as e:
            logger.warning("[QDRANT] Embedding client init failed: %s", e)
            _qdrant_embed_available = False
    if not _qdrant_embed_available or _qdrant_embed_client is None:
        logger.info("[QDRANT] Embedding unavailable — skipping semantic query")
        return False
    return True


def _embed_with_retries(model: str, contents: List[str], config: Dict[str, Any], label: str):
    """Retry Gemini embedding calls with exponential backoff."""
    last_exc: Optional[Exception] = None
    for attempt in range(_EMBED_RETRY_ATTEMPTS):
        try:
            return _qdrant_embed_client.models.embed_content(
                model=model,
                contents=contents,
                config=config,
            )
        except Exception as exc:
            last_exc = exc
            if attempt < (_EMBED_RETRY_ATTEMPTS - 1):
                delay = _EMBED_RETRY_BASE_DELAY_SECS * (2 ** attempt)
                logger.warning(
                    "[QDRANT] %s embed failed (attempt %d/%d): %s; retrying in %.2fs",
                    label, attempt + 1, _EMBED_RETRY_ATTEMPTS, exc, delay,
                )
                time.sleep(delay)
            else:
                logger.warning(
                    "[QDRANT] %s embed failed after %d attempts: %s",
                    label, _EMBED_RETRY_ATTEMPTS, exc,
                )
    if last_exc:
        raise last_exc
    raise RuntimeError(f"{label} embed failed without an exception")


def _embed_strings_gemini(strings: List[str]) -> List[List[float]]:
    """Call Gemini embed_content for one or more non-empty strings; returns vectors (same length)."""
    if not strings:
        return []
    if not _ensure_query_embed_client():
        return [[] for _ in strings]
    model = _resolve_query_embed_model()
    config = _query_embed_config(model)
    try:
        resp = _embed_with_retries(model, strings, config, "batch")
    except Exception as exc:
        logger.warning("[QDRANT] batch embed_content failed: %s — retrying per string", exc)
        out: List[List[float]] = []
        for s in strings:
            try:
                resp_one = _embed_with_retries(model, [s], config, "single-string")
                embeds = getattr(resp_one, "embeddings", None) or []
                vals = getattr(embeds[0], "values", None) if embeds else None
                if isinstance(vals, list) and vals:
                    out.append([float(v) for v in vals])
                else:
                    out.append([])
            except Exception as exc2:
                logger.warning("[QDRANT] single-string embed failed after retries: %s", exc2)
                out.append([])
        return out

    embeds = getattr(resp, "embeddings", None) or []
    out_full: List[List[float]] = []
    for emb in embeds:
        vals = getattr(emb, "values", None) or []
        if vals:
            out_full.append([float(v) for v in vals])
        else:
            out_full.append([])
    if len(out_full) < len(strings):
        out_full.extend([[] for _ in range(len(strings) - len(out_full))])
    elif len(out_full) > len(strings):
        out_full = out_full[: len(strings)]
    if any(out_full):
        sample = next((v for v in out_full if v), [])
        logger.info("[QDRANT] Embedding batch OK: %d vector(s), dims=%d", len(out_full), len(sample))
    return out_full


def get_query_embeddings_batch(texts: List[str]) -> List[List[float]]:
    """
    Embed every string in `texts` (e.g. sc_query, hc_query, provision_query per dimension).
    Preserves list length and index alignment; blank strings produce [].
    """
    if not texts:
        return []
    out: List[List[float]] = [[] for _ in texts]
    need_pairs: List[Tuple[int, str]] = [(i, (t or "").strip()) for i, t in enumerate(texts) if (t or "").strip()]
    if not need_pairs:
        return out
    idxs = [p[0] for p in need_pairs]
    batch = [p[1] for p in need_pairs]
    vectors = _embed_strings_gemini(batch)
    for j, i in enumerate(idxs):
        out[i] = vectors[j] if j < len(vectors) else []
    return out


def _get_qdrant_query_embedding(query: str) -> List[float]:
    """Create one embedding vector for semantic local search."""
    text = (query or "").strip()
    if not text:
        return []
    vecs = get_query_embeddings_batch([text])
    v = vecs[0] if vecs else []
    if v:
        logger.info("[QDRANT] Embedding generated: dims=%d for query: %r", len(v), text[:60])
    return v


def get_query_embedding(query: str) -> List[float]:
    """Public wrapper — generate a Gemini embedding vector for `query`.

    Returned vector dimension matches CITATION_EMBED_OUTPUT_DIMS (default 768).
    Returns [] when the Gemini client is unavailable or the API call fails.
    Suitable for use by watchdog and other modules without duplicating init logic.
    """
    return _get_qdrant_query_embedding(query)


def _judgment_citation_data_has_analysis_report(cd: Any) -> bool:
    """True when citation_data already carries a persisted Clerk / analysis payload."""
    if not isinstance(cd, dict):
        return False
    ar = cd.get("analysis_report")
    if ar is None:
        return False
    if isinstance(ar, dict):
        return len(ar) > 0
    if isinstance(ar, str):
        s = ar.strip()
        return bool(s) and s not in ("{}", "null", "None")
    return bool(ar)


def _hydrate_judgment_rows_from_elasticsearch(rows: List[Dict[str, Any]]) -> None:
    """
    Load full judgment text from the ``judgments`` Elasticsearch index.

    Uses each row's ``es_doc_id`` when set (including values taken from
    ``judgment_uploads``), otherwise falls back to ``canonical_id`` / ``id`` as
    the document id (matches the admin upload pipeline).
    """
    if not rows:
        return
    es = get_es_client()
    if not es or elasticsearch_init_failed():
        return
    fetch_ids: List[str] = []
    seen: set = set()
    for row in rows:
        cid = str(row.get("canonical_id") or row.get("id") or "").strip()
        eid = str(row.get("es_doc_id") or "").strip() or cid
        if not eid or eid in seen:
            continue
        seen.add(eid)
        fetch_ids.append(eid)
    if not fetch_ids:
        return
    try:
        mres = es.mget(index="judgments", body={"ids": fetch_ids})
    except Exception as exc:
        logger.warning("[FETCH_BATCH] ES mget full_text hydration failed: %s", exc)
        return
    by_id: Dict[str, Dict[str, Any]] = {}
    for d in (mres.get("docs") or []):
        if not d.get("found"):
            continue
        doc_id = str(d.get("_id") or "").strip()
        src = d.get("_source") or {}
        if not isinstance(src, dict):
            src = {}
        if doc_id:
            by_id[doc_id] = src
        scid = str(src.get("canonical_id") or "").strip()
        if scid and scid != doc_id:
            by_id[scid] = src
    hydrated = 0
    for row in rows:
        cid = str(row.get("canonical_id") or row.get("id") or "").strip()
        eid = str(row.get("es_doc_id") or "").strip() or cid
        src = by_id.get(eid) or by_id.get(cid)
        if not src:
            continue
        ft = str(src.get("full_text") or "").strip()
        if not ft:
            continue
        row["full_text"] = ft
        row["raw_content"] = ft
        row["_full_text_from_es"] = True
        hydrated += 1
    if hydrated:
        logger.info("[FETCH_BATCH] Elasticsearch full_text hydrated for %d judgment row(s)", hydrated)


def judgements_fetch_by_canonical_ids(
    canonical_ids: List[str],
    approved_only: bool = True,
    exclude_low_hierarchy: bool = True,
    judgment_uuids: Optional[List[str]] = None,
) -> List[Dict[str, Any]]:
    """
    Batch-fetch judgment rows from PostgreSQL by canonical_id list.

    Rules:
      - Admin-uploaded judgments (source_type IN ('admin','admin_upload',...)) are
        always included regardless of verification_status.
      - Other judgments are filtered by approved_only when True.
      - Low-hierarchy courts (district / tribunal / forum) are filtered when
        exclude_low_hierarchy is True.
      - Each returned row has is_local_admin (bool) set from source_type.
      - citation_data JSONB is parsed and merged into the row for convenience.
      - ``judgment_uploads.es_doc_id`` overrides ``judgments.es_doc_id`` when both exist.
      - When Elasticsearch is reachable, ``full_text`` / ``raw_content`` are refreshed
        from the ``judgments`` index (complete document body).

    Returns list of enriched dicts keyed by snake_case DB column names.
    """
    ids = [str(i).strip() for i in (canonical_ids or []) if (i or "")]
    extra_juuids = [str(j).strip() for j in (judgment_uuids or []) if (j or "")]
    if not ids and not extra_juuids:
        return []

    _ADMIN_SOURCES = frozenset(
        (
            "admin",
            "admin_upload",
            "admin-upload",
            "admin uploaded",
            "admin-uploaded",
            "adminupload",
            "manual_upload",
            "manual-upload",
            "judgment_upload",
            "judgement_upload",
        )
    )
    _LOW_HIER_KEYWORDS = frozenset(
        ("district", "tribunal", "forum", "commission", "magistrate", "drt", "drat", "itat", "cestat")
    )

    def _is_admin(src: Any) -> bool:
        raw = str(src or "").strip().lower()
        # Accept exact known labels and flexible admin-prefixed variants.
        return (
            raw in _ADMIN_SOURCES
            or raw == "admin"
            or raw.startswith("admin_")
            or raw.startswith("admin-")
            or raw.startswith("admin ")
        )

    def _is_low_hier(court: Any) -> bool:
        c = str(court or "").strip().lower()
        return any(kw in c for kw in _LOW_HIER_KEYWORDS)

    conn = get_pg_conn()
    if not conn:
        logger.warning("[FETCH_BATCH] No DB connection available")
        return []
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT canonical_id, judgment_uuid, es_doc_id, case_name, court_code, source_type,
                       verification_status, citation_data, judgment_date, year
                  FROM judgments
                 WHERE canonical_id = ANY(%s)
                """,
                (ids,),
            )
            rows = cur.fetchall() or []
    except Exception as exc:
        logger.warning("[FETCH_BATCH] DB query failed: %s", exc)
        return []
    finally:
        conn.close()

    import json as _json
    admin_uploaded_cids: set = set()
    admin_uploaded_esids: set = set()
    admin_uploaded_juuids: set = set()
    # Full upload rows keyed by canonical_id — used to build result rows for
    # admin judgments that exist only in judgment_uploads (not in judgments table).
    upload_rows_by_cid: Dict[str, Any] = {}
    upload_table_resolved: str = ""
    try:
        conn_u = get_pg_conn()
        if conn_u:
            try:
                upload_table = _resolve_admin_upload_table(conn_u) or ""
                upload_table_resolved = upload_table
                upload_cols = _get_table_columns(conn_u, upload_table) if upload_table else set()
                if upload_table:
                    es_ids = [
                        str(r.get("es_doc_id") or "").strip()
                        for r in rows
                        if str(r.get("es_doc_id") or "").strip()
                    ]
                    ju_ids = [
                        str(r.get("judgment_uuid") or "").strip()
                        for r in rows
                        if str(r.get("judgment_uuid") or "").strip()
                    ]
                    for _ju in extra_juuids:
                        if _ju and _ju not in ju_ids:
                            ju_ids.append(_ju)
                    clauses: List[str] = []
                    params: List[Any] = []
                    if "canonical_id" in upload_cols and ids:
                        clauses.append("canonical_id = ANY(%s)")
                        params.append(ids)
                    if "es_doc_id" in upload_cols and es_ids:
                        clauses.append("es_doc_id = ANY(%s)")
                        params.append(es_ids)
                    if "judgment_uuid" in upload_cols and ju_ids:
                        clauses.append("judgment_uuid::text = ANY(%s)")
                        params.append(ju_ids)
                    if clauses:
                        # Always fetch merged_text + metadata so we can hydrate
                        # admin-uploaded judgments that are not in the judgments table.
                        sel_cols = ["canonical_id", "judgment_uuid"]
                        for _col in [
                            "document_id",
                            "judgment_uuid",
                            "canonical_id",
                            "original_filename",
                            "source_url",
                            "storage_bucket",
                            "storage_path",
                            "storage_uri",
                            "status",
                            "admin_user_id",
                            "admin_role",
                            "total_pages",
                            "text_pages_count",
                            "ocr_pages_count",
                            "ocr_batches_count",
                            "merged_text",
                            "metadata",
                            "es_doc_id",
                            "qdrant_collection",
                            "last_progress_message",
                            "error_message",
                            "processing_started_at",
                            "processing_completed_at",
                            "created_at",
                            "updated_at",
                            "pipeline_metrics",
                        ]:
                            if _col in upload_cols:
                                sel_cols.append(_col)
                        with conn_u.cursor(cursor_factory=RealDictCursor) as cur_u:
                            cur_u.execute(
                                f"""
                                SELECT {", ".join(sel_cols)}
                                  FROM {upload_table}
                                 WHERE {" OR ".join(clauses)}
                                """,
                                tuple(params),
                            )
                            up_rows = cur_u.fetchall() or []
                        for ur in up_rows:
                            _cid = str(ur.get("canonical_id") or "").strip()
                            _esid = str(ur.get("es_doc_id") or "").strip()
                            _ju = str(ur.get("judgment_uuid") or "").strip()
                            if _cid:
                                admin_uploaded_cids.add(_cid)
                                upload_rows_by_cid[_cid] = dict(ur)
                            if _esid:
                                admin_uploaded_esids.add(_esid)
                            if _ju:
                                admin_uploaded_juuids.add(_ju)
                        logger.info(
                            "[FETCH_BATCH] Admin upload matches (table=%s): canonical=%d/%d es_doc_id=%d judgment_uuid=%d",
                            upload_table,
                            len(admin_uploaded_cids),
                            len(ids),
                            len(admin_uploaded_esids),
                            len(admin_uploaded_juuids),
                        )
            finally:
                conn_u.close()
    except Exception as exc:
        logger.warning("[FETCH_BATCH] Admin upload mapping failed: %s", exc)

    result: List[Dict[str, Any]] = []
    for r in rows:
        src_type = str(r.get("source_type") or "").strip().lower()
        r_cid = str(r.get("canonical_id") or "").strip()
        r_esid = str(r.get("es_doc_id") or "").strip()
        r_ju = str(r.get("judgment_uuid") or "").strip()
        is_admin = (
            _is_admin(src_type)
            or (bool(r_cid) and r_cid in admin_uploaded_cids)
            or (bool(r_esid) and r_esid in admin_uploaded_esids)
            or (bool(r_ju) and r_ju in admin_uploaded_juuids)
        )

        # Approved-only filter — admin judgments bypass it
        if approved_only and not is_admin:
            vs = str(r.get("verification_status") or "").upper()
            if vs not in ("APPROVED", "VERIFIED", "VERIFIED_WARN", "GREEN"):
                continue

        # Hierarchy filter
        if exclude_low_hierarchy and _is_low_hier(r.get("court_code")):
            continue

        # Parse citation_data JSONB
        cd = r.get("citation_data") or {}
        if isinstance(cd, str):
            try:
                cd = _json.loads(cd)
            except Exception:
                cd = {}

        display_source = "admin_upload" if is_admin else (src_type or "local")

        has_ar = _judgment_citation_data_has_analysis_report(cd)

        ju_u = upload_rows_by_cid.get(r_cid) or {}
        upload_es = str(ju_u.get("es_doc_id") or "").strip()
        judgment_es = str(r.get("es_doc_id") or "").strip()
        eff_es = upload_es or judgment_es or ""
        doc_id_u = ju_u.get("document_id")

        result.append({
            "canonical_id":   r.get("canonical_id"),
            "id":             r.get("canonical_id"),
            "judgment_uuid":  r.get("judgment_uuid"),
            "es_doc_id":      eff_es or None,
            "document_id":    doc_id_u,
            "title":          r.get("case_name") or cd.get("case_name") or "",
            "case_name":      r.get("case_name") or cd.get("case_name") or "",
            "court":          r.get("court_code") or cd.get("court_code") or "",
            "court_code":     r.get("court_code") or cd.get("court_code") or "",
            "primary_citation": cd.get("primary_citation") or "",
            "ratio":          cd.get("holding_text") or cd.get("summary_text") or "",
            "source":         display_source,
            "source_type":    src_type,
            "is_local_admin": is_admin,
            "judgment_date":  r.get("judgment_date"),
            "year":           r.get("year"),
            "citation_data":  cd,
            # Expose full content directly for Watchdog/Clerk local-path enrichment.
            "full_text":      cd.get("full_text") or "",
            "raw_content":    cd.get("full_text") or "",
            "has_analysis_report": has_ar,
            # Full upload-lifecycle enrichment from judgment_uploads (when available).
            "original_filename": ju_u.get("original_filename"),
            "source_url": ju_u.get("source_url"),
            "storage_bucket": ju_u.get("storage_bucket"),
            "storage_path": ju_u.get("storage_path"),
            "storage_uri": ju_u.get("storage_uri"),
            "status": ju_u.get("status"),
            "admin_user_id": ju_u.get("admin_user_id"),
            "admin_role": ju_u.get("admin_role"),
            "total_pages": ju_u.get("total_pages"),
            "text_pages_count": ju_u.get("text_pages_count"),
            "ocr_pages_count": ju_u.get("ocr_pages_count"),
            "ocr_batches_count": ju_u.get("ocr_batches_count"),
            "merged_text": ju_u.get("merged_text"),
            "metadata": ju_u.get("metadata"),
            "qdrant_collection": ju_u.get("qdrant_collection"),
            "last_progress_message": ju_u.get("last_progress_message"),
            "error_message": ju_u.get("error_message"),
            "processing_started_at": ju_u.get("processing_started_at"),
            "processing_completed_at": ju_u.get("processing_completed_at"),
            "created_at": ju_u.get("created_at"),
            "updated_at": ju_u.get("updated_at"),
            "pipeline_metrics": ju_u.get("pipeline_metrics"),
        })
    # For admin-uploaded judgments that exist only in judgment_uploads (not in the
    # judgments table), build result rows from upload data using merged_text as full_text.
    found_cids_in_result = {str(x.get("canonical_id") or "").strip() for x in result}
    for cid in ids:
        if cid in found_cids_in_result:
            continue
        ur = upload_rows_by_cid.get(cid)
        if not ur:
            continue
        meta_raw = ur.get("metadata") or {}
        if isinstance(meta_raw, str):
            try:
                meta_raw = _json.loads(meta_raw)
            except Exception:
                meta_raw = {}
        merged_text = str(ur.get("merged_text") or "").strip()
        orig_name = str(ur.get("original_filename") or "").rsplit(".", 1)[0].replace("_", " ").strip()
        case_name = (
            str(meta_raw.get("case_name") or meta_raw.get("caseName") or "").strip()
            or orig_name
        )
        court_code = str(
            meta_raw.get("court_code") or meta_raw.get("courtCode") or meta_raw.get("court") or ""
        ).strip()
        year = meta_raw.get("year") or meta_raw.get("judgment_year")
        primary_citation = str(
            meta_raw.get("primary_citation") or meta_raw.get("citation") or ""
        ).strip()
        _ues = str(ur.get("es_doc_id") or "").strip() or cid
        result.append({
            "canonical_id":        cid,
            "id":                  cid,
            "judgment_uuid":       ur.get("judgment_uuid"),
            "es_doc_id":           _ues,
            "document_id":         ur.get("document_id"),
            "title":               case_name,
            "case_name":           case_name,
            "court":               court_code,
            "court_code":          court_code,
            "primary_citation":    primary_citation,
            "ratio":               merged_text[:500] if merged_text else "",
            "source":              "admin_upload",
            "source_type":         "admin-uploaded",
            "is_local_admin":      True,
            "judgment_date":       None,
            "year":                year,
            "citation_data":       {},
            # merged_text from judgment_uploads until ES hydration runs
            "full_text":           merged_text,
            "raw_content":         merged_text,
            "has_analysis_report": False,
            "_from_judgment_uploads": True,
            "original_filename":   ur.get("original_filename"),
            "source_url":          ur.get("source_url"),
            "storage_bucket":      ur.get("storage_bucket"),
            "storage_path":        ur.get("storage_path"),
            "storage_uri":         ur.get("storage_uri"),
            "status":              ur.get("status"),
            "admin_user_id":       ur.get("admin_user_id"),
            "admin_role":          ur.get("admin_role"),
            "total_pages":         ur.get("total_pages"),
            "text_pages_count":    ur.get("text_pages_count"),
            "ocr_pages_count":     ur.get("ocr_pages_count"),
            "ocr_batches_count":   ur.get("ocr_batches_count"),
            "merged_text":         ur.get("merged_text"),
            "metadata":            ur.get("metadata"),
            "qdrant_collection":   ur.get("qdrant_collection"),
            "last_progress_message": ur.get("last_progress_message"),
            "error_message":       ur.get("error_message"),
            "processing_started_at": ur.get("processing_started_at"),
            "processing_completed_at": ur.get("processing_completed_at"),
            "created_at":          ur.get("created_at"),
            "updated_at":          ur.get("updated_at"),
            "pipeline_metrics":    ur.get("pipeline_metrics"),
        })
        logger.info(
            "[FETCH_BATCH] Admin upload fallback row: canonical_id=%s table=%s merged_text=%d chars",
            cid, upload_table_resolved or "judgment_uploads", len(merged_text),
        )

    _hydrate_judgment_rows_from_elasticsearch(result)

    if result:
        ret_cids = [str(x.get("canonical_id") or "").strip() for x in result if x.get("canonical_id")]
        logger.info(
            "[FETCH_BATCH] Local PG → %d judgment row(s), canonical_id: %s",
            len(ret_cids),
            ", ".join(ret_cids),
        )
    elif ids:
        logger.info(
            "[FETCH_BATCH] Local PG → 0 rows returned (requested %d canonical_id(s); filters may exclude all)",
            len(ids),
        )
    return result


def judgement_merge_citation_data(canonical_id: str, patch: Dict[str, Any]) -> bool:
    """
    Merge keys into judgments.citation_data (JSONB) for an existing canonical_id.
    Used when Clerk re-enriches Qdrant hits without re-ingesting the full judgment row.
    """
    canonical_id = (canonical_id or "").strip()
    if not canonical_id or not patch:
        return False
    conn = get_pg_conn()
    if not conn:
        return False
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE judgments
                   SET citation_data = COALESCE(citation_data, '{}'::jsonb) || %s::jsonb
                 WHERE canonical_id = %s
                """,
                (Json(patch), canonical_id),
            )
            ok = cur.rowcount > 0
        conn.commit()
        return bool(ok)
    except Exception as exc:
        logger.warning("[DB] judgement_merge_citation_data failed for %s: %s", canonical_id, exc)
        try:
            conn.rollback()
        except Exception:
            pass
        return False
    finally:
        conn.close()


def _resolve_hitl_pk_column(conn) -> str:
    """
    Resolve hitl_queue primary id column across schema variants.
    Prefers: id, hitl_id, queue_id.
    """
    global _HITL_PK_CACHE
    if _HITL_PK_CACHE:
        return _HITL_PK_CACHE
    candidates = ("id", "hitl_id", "queue_id")
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT column_name
                  FROM information_schema.columns
                 WHERE table_schema = 'public'
                   AND table_name = 'hitl_queue'
                """
            )
            cols = {str(r[0]).lower() for r in (cur.fetchall() or []) if r and r[0]}
        for c in candidates:
            if c in cols:
                _HITL_PK_CACHE = c
                return c
    except Exception:
        pass
    _HITL_PK_CACHE = "id"
    return _HITL_PK_CACHE


def _fmt_date(value: Any) -> Any:
    if isinstance(value, (datetime, date)):
        return value.strftime("%d %b %Y")
    return value


def _resolve_admin_upload_table(conn) -> Optional[str]:
    """Resolve admin-upload table name across deployment variants."""
    global _ADMIN_UPLOAD_TABLE_CACHE
    if _ADMIN_UPLOAD_TABLE_CACHE:
        return _ADMIN_UPLOAD_TABLE_CACHE
    candidates = (
        "judgment_uploads",
        "judgement_uploads",
        "judgment_documents",
        "judgement_documents",
    )
    try:
        with conn.cursor() as cur:
            for t in candidates:
                cur.execute("SELECT to_regclass(%s) AS t", (f"public.{t}",))
                row = cur.fetchone() or {}
                exists = row[0] if isinstance(row, tuple) else row.get("t")
                if exists:
                    _ADMIN_UPLOAD_TABLE_CACHE = t
                    return t
    except Exception:
        return None
    return None


def _get_table_columns(conn, table_name: str) -> set:
    cols = _ADMIN_UPLOAD_COLS_CACHE.get(table_name)
    if cols is not None:
        return cols
    cols = set()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT column_name
                  FROM information_schema.columns
                 WHERE table_schema='public' AND table_name=%s
                """,
                (table_name,),
            )
            rows = cur.fetchall() or []
        for r in rows:
            if isinstance(r, tuple):
                cols.add(str(r[0]).strip().lower())
            else:
                cols.add(str(r.get("column_name") or "").strip().lower())
    except Exception:
        cols = set()
    _ADMIN_UPLOAD_COLS_CACHE[table_name] = cols
    return cols


def _is_admin_uploaded_record(
    conn,
    canonical_id: str = "",
    es_doc_id: str = "",
    judgment_uuid: str = "",
) -> bool:
    table = _resolve_admin_upload_table(conn)
    if not table:
        return False
    cols = _get_table_columns(conn, table)
    clauses: List[str] = []
    params: List[str] = []
    if canonical_id and "canonical_id" in cols:
        clauses.append("canonical_id = %s")
        params.append(canonical_id)
    if es_doc_id and "es_doc_id" in cols:
        clauses.append("es_doc_id = %s")
        params.append(es_doc_id)
    if judgment_uuid and "judgment_uuid" in cols:
        clauses.append("judgment_uuid = %s")
        params.append(judgment_uuid)
    if not clauses:
        return False
    try:
        with conn.cursor() as cur:
            cur.execute(
                f"SELECT 1 FROM {table} WHERE ({' OR '.join(clauses)}) LIMIT 1",
                tuple(params),
            )
            return cur.fetchone() is not None
    except Exception:
        return False


def _normalize_db_status(status: Any) -> Any:
    """Normalize audit status for DB columns with short VARCHAR limits."""
    if status is None:
        return None
    s = str(status).strip()
    if not s:
        return None
    mapping = {
        'VERIFIED_WITH_WARNINGS': 'VERIFIED_WARN',
        'NEEDS_REVIEW': 'NEEDS_REVIEW',
        'QUARANTINED': 'QUARANTINED',
        'VERIFIED': 'VERIFIED',
    }
    if s in mapping:
        return mapping[s]
    return s[:20]


def _normalize_citation_key(raw: str) -> str:
    """
    Normalize a citation string so blacklist lookups are stable:
    - lowercase
    - expand common abbreviations (AIR -> all india reporter)
    - strip punctuation and collapse whitespace
    """
    s = (raw or "").lower()
    s = s.replace("air", "all india reporter")
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return " ".join(s.split())


def citation_blacklisted(raw: str) -> bool:
    """
    Check if a citation (any textual form) is present in the confirmed-fake blacklist.
    This should be called at Step 0 before running any verification layers.
    """
    key = _normalize_citation_key(raw)
    if not key:
        return False
    conn = get_pg_conn()
    if not conn:
        return False
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM citation_blacklist WHERE normalized_key = %s", (key,))
            return cur.fetchone() is not None
    finally:
        conn.close()


def init_db() -> None:
    """
    Ensure service-local tables exist: citation_reports, citation_pipeline_runs,
    agent_logs, hitl_queue, report_citations.
    Core legal schema tables (judgments, citation_aliases, judges, etc.) are assumed to exist.
    """
    conn = get_pg_conn()
    if not conn:
        return
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS citation_reports (
                    id UUID PRIMARY KEY,
                    user_id VARCHAR,
                    query TEXT,
                    report_format JSONB,
                    dimensions_metadata JSONB,
                    status VARCHAR,
                    case_id VARCHAR,
                    citation_count INTEGER DEFAULT 0,
                    run_id UUID,
                    hitl_pending_count INTEGER DEFAULT 0,
                    hitl_approved_count INTEGER DEFAULT 0,
                    citations_approved_count INTEGER DEFAULT 0,
                    citations_quarantined_count INTEGER DEFAULT 0,
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW()
                )
                """
            )
            # Add new columns if table already existed (ignore errors)
            try:
                cur.execute("ALTER TABLE citation_reports ADD COLUMN IF NOT EXISTS run_id UUID")
                cur.execute("ALTER TABLE citation_reports ADD COLUMN IF NOT EXISTS dimensions_metadata JSONB")
                cur.execute("ALTER TABLE citation_reports ADD COLUMN IF NOT EXISTS hitl_pending_count INTEGER DEFAULT 0")
                cur.execute("ALTER TABLE citation_reports ADD COLUMN IF NOT EXISTS hitl_approved_count INTEGER DEFAULT 0")
                cur.execute("ALTER TABLE citation_reports ADD COLUMN IF NOT EXISTS citations_approved_count INTEGER DEFAULT 0")
                cur.execute("ALTER TABLE citation_reports ADD COLUMN IF NOT EXISTS citations_quarantined_count INTEGER DEFAULT 0")
                cur.execute("ALTER TABLE citation_reports ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()")
                cur.execute("ALTER TABLE citation_reports ADD COLUMN IF NOT EXISTS shared_with JSONB DEFAULT '[]'::jsonb")
            except Exception:
                pass

            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS citation_pipeline_runs (
                    id UUID PRIMARY KEY,
                    user_id VARCHAR NOT NULL,
                    case_id VARCHAR,
                    query TEXT NOT NULL,
                    status VARCHAR NOT NULL DEFAULT 'running',
                    report_id UUID,
                    citations_fetched_count INTEGER DEFAULT 0,
                    citations_approved_count INTEGER DEFAULT 0,
                    citations_quarantined_count INTEGER DEFAULT 0,
                    citations_sent_to_hitl_count INTEGER DEFAULT 0,
                    started_at TIMESTAMP NOT NULL DEFAULT NOW(),
                    completed_at TIMESTAMP,
                    error_message TEXT,
                    created_at TIMESTAMP DEFAULT NOW()
                )
                """
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS agent_logs (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    run_id UUID,
                    report_id UUID,
                    agent_name VARCHAR(64) NOT NULL,
                    stage VARCHAR(64),
                    log_level VARCHAR(16) NOT NULL,
                    message TEXT NOT NULL,
                    metadata JSONB,
                    created_at TIMESTAMP NOT NULL DEFAULT NOW()
                )
                """
            )
            cur.execute("CREATE INDEX IF NOT EXISTS idx_agent_logs_run ON agent_logs(run_id)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_agent_logs_created ON agent_logs(created_at DESC)")

            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS hitl_queue (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    report_id UUID,
                    run_id UUID,
                    canonical_id VARCHAR(128) NOT NULL,
                    citation_string VARCHAR(512),
                    query_context TEXT,
                    web_source_url TEXT,
                    priority_score NUMERIC(4,3) DEFAULT 0.0,
                    case_id VARCHAR,
                    user_id VARCHAR NOT NULL,
                    citation_snapshot JSONB NOT NULL,
                    status VARCHAR(32) NOT NULL DEFAULT 'pending',
                    reason_queued VARCHAR(256),
                    reviewed_at TIMESTAMP,
                    reviewed_by VARCHAR(128),
                    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW()
                )
                """
            )
            # Migrations: add new columns if table existed with older schema
            for _sql in [
                "ALTER TABLE hitl_queue ALTER COLUMN report_id DROP NOT NULL",
                "ALTER TABLE hitl_queue ADD COLUMN IF NOT EXISTS citation_string VARCHAR(512)",
                "ALTER TABLE hitl_queue ADD COLUMN IF NOT EXISTS query_context TEXT",
                "ALTER TABLE hitl_queue ADD COLUMN IF NOT EXISTS web_source_url TEXT",
                "ALTER TABLE hitl_queue ADD COLUMN IF NOT EXISTS priority_score NUMERIC(4,3) DEFAULT 0.0",
                "CREATE INDEX IF NOT EXISTS idx_hitl_report ON hitl_queue(report_id)",
                "CREATE INDEX IF NOT EXISTS idx_hitl_status ON hitl_queue(status)",
                "CREATE INDEX IF NOT EXISTS idx_hitl_priority ON hitl_queue(priority_score DESC)",
            ]:
                try:
                    cur.execute(_sql)
                except Exception:
                    pass

            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS report_citations (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    report_id UUID NOT NULL,
                    canonical_id VARCHAR(128) NOT NULL,
                    status VARCHAR(32) NOT NULL,
                    citation_snapshot JSONB,
                    hitl_queue_id UUID,
                    created_at TIMESTAMP NOT NULL DEFAULT NOW()
                )
                """
            )
            cur.execute("CREATE INDEX IF NOT EXISTS idx_report_citations_report ON report_citations(report_id)")

            # Blacklist of confirmed fake / hallucinated citations (normalized_key)
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS citation_blacklist (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    normalized_key TEXT UNIQUE NOT NULL,
                    reason TEXT,
                    created_at TIMESTAMP NOT NULL DEFAULT NOW()
                )
                """
            )
            cur.execute("CREATE INDEX IF NOT EXISTS idx_citation_blacklist_key ON citation_blacklist(normalized_key)")

            # Daily usage analytics for admin dashboard
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS usage_analytics_daily (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    user_id VARCHAR NOT NULL,
                    usage_date DATE NOT NULL,
                    queries_count INTEGER NOT NULL DEFAULT 0,
                    citations_generated INTEGER NOT NULL DEFAULT 0,
                    time_saved_minutes INTEGER NOT NULL DEFAULT 0,
                    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
                    UNIQUE (user_id, usage_date)
                )
                """
            )
            cur.execute("CREATE INDEX IF NOT EXISTS idx_usage_analytics_date ON usage_analytics_daily(usage_date)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_usage_analytics_user ON usage_analytics_daily(user_id)")

            # Migration: store rich citation fields in PG for ES-free fallback
            try:
                cur.execute("ALTER TABLE judgments ADD COLUMN IF NOT EXISTS citation_data JSONB")
            except Exception:
                pass

            # ── Indian Kanoon enrichment columns on judgments ──────────────
            for _col_sql in [
                "ALTER TABLE judgments ADD COLUMN IF NOT EXISTS ik_orig_doc_url TEXT",
                "ALTER TABLE judgments ADD COLUMN IF NOT EXISTS ik_fragments JSONB",
                "ALTER TABLE judgments ADD COLUMN IF NOT EXISTS ik_cite_list JSONB",
                "ALTER TABLE judgments ADD COLUMN IF NOT EXISTS ik_cited_by_list JSONB",
                "ALTER TABLE judgments ADD COLUMN IF NOT EXISTS ik_doc_meta JSONB",
            ]:
                try:
                    cur.execute(_col_sql)
                except Exception:
                    pass

            # ── ik_document_assets: stores all IK API responses per document ──
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS ik_document_assets (
                    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    doc_id                VARCHAR(64) NOT NULL,
                    canonical_id          VARCHAR(128),
                    meta                  JSONB,
                    fragments             JSONB,
                    cite_list             JSONB,
                    cited_by_list         JSONB,
                    orig_doc_url          TEXT,
                    orig_doc_gcs_path     TEXT,
                    orig_doc_content_type VARCHAR(64),
                    raw_api_response      JSONB,
                    title                 TEXT,
                    docsource             TEXT,
                    doc_char_count        INTEGER,
                    cache_hit_count       INTEGER DEFAULT 0,
                    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    UNIQUE (doc_id)
                )
                """
            )
            # Migrations for existing tables
            for _col in [
                "ALTER TABLE ik_document_assets ADD COLUMN IF NOT EXISTS raw_api_response JSONB",
                "ALTER TABLE ik_document_assets ADD COLUMN IF NOT EXISTS title TEXT",
                "ALTER TABLE ik_document_assets ADD COLUMN IF NOT EXISTS docsource TEXT",
                "ALTER TABLE ik_document_assets ADD COLUMN IF NOT EXISTS doc_char_count INTEGER",
                "ALTER TABLE ik_document_assets ADD COLUMN IF NOT EXISTS cache_hit_count INTEGER DEFAULT 0",
            ]:
                try:
                    cur.execute(_col)
                except Exception:
                    pass
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_ik_assets_doc_id ON ik_document_assets(doc_id)"
            )
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_ik_assets_canonical ON ik_document_assets(canonical_id)"
            )

            # ── citation_service_usage: third-party API usage and cost tracking ──
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS citation_service_usage (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    run_id UUID,
                    user_id VARCHAR NOT NULL,
                    user_display_name VARCHAR(256),
                    username VARCHAR(256),
                    service VARCHAR(32) NOT NULL,
                    operation VARCHAR(64),
                    quantity INTEGER NOT NULL DEFAULT 0,
                    unit VARCHAR(16) DEFAULT 'calls',
                    cost_inr NUMERIC(12,4) DEFAULT 0,
                    cost_usd NUMERIC(12,6) DEFAULT 0,
                    metadata JSONB,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
                """
            )
            try:
                cur.execute(
                    "ALTER TABLE citation_service_usage ADD COLUMN IF NOT EXISTS user_display_name VARCHAR(256)"
                )
                cur.execute("ALTER TABLE citation_service_usage ADD COLUMN IF NOT EXISTS username VARCHAR(256)")
            except Exception:
                pass
            cur.execute("CREATE INDEX IF NOT EXISTS idx_citation_usage_run ON citation_service_usage(run_id)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_citation_usage_user ON citation_service_usage(user_id)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_citation_usage_service ON citation_service_usage(service)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_citation_usage_created ON citation_service_usage(created_at DESC)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_citation_usage_user_created ON citation_service_usage(user_id, created_at DESC)")

        conn.commit()
    finally:
        conn.close()


def judgement_update_validation(
    canonical_id: str,
    librarian_status: str = None,
    librarian_warnings: str = None,
    librarian_issues: str = None,
    area: str = None,
    audit_status: str = None,
    audit_confidence: int = None,
):
    """
    Persist validation results.
    Maps to judgments.verification_status and judgments.confidence_score.
    Also mirrors rich status fields into Elasticsearch for UI/reporting.
    """
    canonical_id = (canonical_id or "").strip()
    if not canonical_id:
        return

    status = audit_status or librarian_status
    score = audit_confidence
    db_status = _normalize_db_status(status)
    # confidence_score column is often NUMERIC(4,3): 0–9.999; auditor sends 0–100
    if score is not None:
        try:
            v = float(score)
            if v > 1:
                v = round(v / 100.0, 3)
            score = min(9.999, max(0.0, v))
        except (TypeError, ValueError):
            score = None

    conn = get_pg_conn()
    if conn:
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE judgments
                       SET verification_status = COALESCE(%s, verification_status),
                           confidence_score    = COALESCE(%s, confidence_score),
                           last_verified_at    = CASE
                                                   WHEN %s IS NULL AND %s IS NULL THEN last_verified_at
                                                   ELSE NOW()
                                                 END
                     WHERE canonical_id = %s
                    """,
                    (db_status, score, db_status, score, canonical_id),
                )
            conn.commit()
        finally:
            conn.close()

    es = get_es_client()
    if es:
        try:
            payload = {
                "doc": {
                    "librarian_status": librarian_status,
                    "librarian_warnings": librarian_warnings,
                    "librarian_issues": librarian_issues,
                    "area": area,
                    "audit_status": audit_status,
                    "audit_confidence": audit_confidence,
                }
            }
            es.update(index="judgments", id=canonical_id, body=payload, doc_as_upsert=True)
        except Exception as exc:
            logger.warning("[ES] status update failed for %s: %s", canonical_id, exc)


def judgement_get(canonical_id: str) -> Optional[Dict[str, Any]]:
    canonical_id = (canonical_id or "").strip()
    if not canonical_id:
        return None

    row = None
    uploaded_by_admin = False
    upload_source_url = ""
    conn = get_pg_conn()
    if conn:
        try:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(
                    """
                    SELECT judgment_uuid, canonical_id, case_name, court_code, court_tier,
                           judgment_date, year, bench_size, outcome, source_type,
                           verification_status, confidence_score, citation_frequency,
                           qdrant_vector_id, neo4j_node_id, es_doc_id,
                           ingested_at, last_verified_at, citation_data,
                           ik_orig_doc_url, ik_fragments, ik_cite_list, ik_cited_by_list, ik_doc_meta
                      FROM judgments
                     WHERE canonical_id = %s
                    """,
                    (canonical_id,),
                )
                row = cur.fetchone()
                if row:
                    try:
                        uploaded_by_admin = _is_admin_uploaded_record(
                            conn,
                            canonical_id=canonical_id,
                            es_doc_id=str(row.get("es_doc_id") or ""),
                            judgment_uuid=str(row.get("judgment_uuid") or ""),
                        )
                        if uploaded_by_admin:
                            table = _resolve_admin_upload_table(conn) or ""
                            cols = _get_table_columns(conn, table) if table else set()
                            if table and "source_url" in cols and "canonical_id" in cols:
                                cur.execute(
                                    f"""
                                    SELECT source_url
                                      FROM {table}
                                     WHERE canonical_id = %s
                                     ORDER BY created_at DESC NULLS LAST
                                     LIMIT 1
                                    """,
                                    (canonical_id,),
                                )
                                _up = cur.fetchone() or {}
                                if _up:
                                    if isinstance(_up, tuple):
                                        upload_source_url = str(_up[0] or "")
                                    else:
                                        upload_source_url = str(_up.get("source_url") or "")
                    except Exception:
                        uploaded_by_admin = False
        finally:
            conn.close()

    es_doc = None
    es = get_es_client()
    if es:
        try:
            es_id = str(row.get("es_doc_id") or "").strip() if row else ""
            fetch_ids = [es_id] if es_id else []
            if canonical_id and canonical_id not in fetch_ids:
                fetch_ids.append(canonical_id)
            for _id in fetch_ids:
                try:
                    res = es.get(index="judgments", id=_id)
                    es_doc = res.get("_source") or {}
                    if es_doc:
                        break
                except Exception:
                    continue
        except Exception:
            es_doc = None

    if not row and not es_doc:
        return None

    row = row or {}
    es_doc = es_doc or {}

    # Fall back to PG citation_data JSONB when ES is unavailable
    pg_citation = row.get("citation_data") or {}
    if isinstance(pg_citation, str):
        import json as _json
        try:
            pg_citation = _json.loads(pg_citation)
        except Exception:
            pg_citation = {}

    def _es_or_pg(key: str, pg_key: str = None):
        """Return ES value if available, else fall back to PG citation_data."""
        v = es_doc.get(key)
        if v is not None and v != "" and v != []:
            return v
        return pg_citation.get(pg_key or key)

    def _pg_or_es(row_key: str, es_key: str = None, citation_key: str = None):
        """
        Prefer PostgreSQL metadata first, then PG citation_data, then ES.
        Used for metadata fields so canonical-id hydration stays PG-authoritative.
        """
        rv = row.get(row_key)
        if rv is not None and rv != "" and rv != []:
            return rv
        ck = citation_key or row_key
        cv = pg_citation.get(ck)
        if cv is not None and cv != "" and cv != []:
            return cv
        return es_doc.get(es_key or row_key)

    source_url = _es_or_pg("source_url") or _es_or_pg("official_source_url")
    # Import source link: URL from which this judgment was fetched (Indian Kanoon, Google result, etc.)
    import_source_link = source_url or _es_or_pg("official_source_url") or ""

    # Subsequent treatment: prefer ES cached value; if missing, compute from Neo4j citation graph.
    subsequent_treatment = es_doc.get("subsequent_treatment") or {}
    if not subsequent_treatment:
        driver = get_neo4j_driver()
        if driver:
            try:
                with driver.session() as session:
                    cypher = """
                        MATCH (c:CitedCase {caseId: $cid})<-[r]-(other:CitedCase)
                        WHERE type(r) IN ['FOLLOWS','DISTINGUISHES','OVERRULES']
                        RETURN type(r) AS rel_type, coalesce(other.caseName, other.caseId) AS name
                        LIMIT 100
                    """
                    result = session.run(cypher, cid=canonical_id)
                    followed: List[str] = []
                    distinguished: List[str] = []
                    overruled: List[str] = []
                    for rec in result:
                        rel = (rec.get("rel_type") or "").upper()
                        name = (rec.get("name") or "").strip()
                        if not name:
                            continue
                        if rel == "FOLLOWS":
                            followed.append(name)
                        elif rel == "DISTINGUISHES":
                            distinguished.append(name)
                        elif rel == "OVERRULES":
                            overruled.append(name)
                    if followed or distinguished or overruled:
                        subsequent_treatment = {
                            "followed": followed,
                            "distinguished": distinguished,
                            "overruled": overruled,
                        }
                        # Cache back into ES for future fast reads
                        if es:
                            try:
                                es.update(
                                    index="judgments",
                                    id=canonical_id,
                                    body={"doc": {"subsequent_treatment": subsequent_treatment}},
                                    doc_as_upsert=True,
                                )
                            except Exception as exc:
                                logger.warning("[ES] subsequent_treatment cache failed for %s: %s", canonical_id, exc)
            except Exception as exc:
                logger.warning("[NEO4J] subsequent_treatment fetch failed for %s: %s", canonical_id, exc)
    # Build coram with PG metadata priority, then ES fallbacks.
    _coram = pg_citation.get("bench_name") or pg_citation.get("coram") or es_doc.get("coram") or ""
    _coram = _coram if isinstance(_coram, str) else ""
    if not _coram:
        _judges = _pg_or_es("bench_size", citation_key="judges") or _es_or_pg("judges")
        if isinstance(_judges, list) and _judges:
            _coram = ", ".join(str(j) for j in _judges if j)

    source_key = row.get("source_type") or _es_or_pg("source_type") or "local"
    if uploaded_by_admin and (str(source_key).strip().lower() in ("local", "unknown", "")):
        source_key = "admin_upload"

    _pg_src_type = str(row.get("source_type") or "").strip().lower() if row else ""
    _src_type_resolved = _pg_src_type or str(_es_or_pg("source_type") or "").strip().lower()

    result = {
        "id": canonical_id,
        "canonical_id": canonical_id,
        "title": _pg_or_es("case_name", es_key="case_name"),
        "primary_citation": _es_or_pg("primary_citation"),
        "alternate_citations": _es_or_pg("alternate_citations") or [],
        "court": _pg_or_es("court_code", es_key="court_name", citation_key="court_name")
                 or _pg_or_es("court_code", es_key="court_code"),
        "coram": _coram,
        "bench_type": _es_or_pg("bench_type"),
        "date_judgment": _fmt_date(_pg_or_es("judgment_date", es_key="judgment_date", citation_key="judgment_date")),
        "statutes": _es_or_pg("statutes") or [],
        "ratio": _es_or_pg("holding_text") or _es_or_pg("summary_text") or "",
        "excerpt_para": _es_or_pg("excerpt_para"),
        "excerpt_text": _es_or_pg("excerpt_text"),
        "source_url": source_url or upload_source_url,
        "official_source_url": _es_or_pg("official_source_url") or source_url,
        "import_source_link": import_source_link,
        "subsequent_treatment": subsequent_treatment or {},
        "source": source_key,
        # Full judgment body should come from ES first, then PG JSONB fallback.
        "raw_content": _es_or_pg("full_text") or "",
        "full_text": _es_or_pg("full_text") or "",
        "paragraphs": _es_or_pg("paragraphs") or [],
        "audit_status": es_doc.get("audit_status") or row.get("verification_status"),
        "audit_confidence": es_doc.get("audit_confidence") or row.get("confidence_score"),
        "librarian_status": es_doc.get("librarian_status") or row.get("verification_status"),
        "librarian_warnings": es_doc.get("librarian_warnings"),
        "librarian_issues": es_doc.get("librarian_issues"),
        "area": es_doc.get("area"),
        "refreshed_at": _fmt_date(row.get("last_verified_at") or row.get("ingested_at")),
        # Indian Kanoon enrichment columns (from judgments table)
        "ik_orig_doc_url":    row.get("ik_orig_doc_url") or "",
        "ik_fragments":       row.get("ik_fragments") or {},
        "ik_cite_list":       row.get("ik_cite_list") or [],
        "ik_cited_by_list":   row.get("ik_cited_by_list") or [],
        "ik_doc_meta":        row.get("ik_doc_meta") or {},
        "source_type":        _src_type_resolved or None,
        "citation_data":      pg_citation,
        # Expose local-vector linkage explicitly for Qdrant chunk traceability.
        "qdrant_vector_id":   row.get("qdrant_vector_id"),
        "es_doc_id":          row.get("es_doc_id"),
        "metadata_source":    "postgresql",
        "judgment_text_source": "elasticsearch" if (es_doc.get("full_text") or "") else "postgresql_jsonb",
        "is_local_admin":     _src_type_resolved in (
            "admin",
            "admin_upload",
            "admin-upload",
            "admin uploaded",
            "admin-uploaded",
            "adminupload",
            "manual_upload",
            "manual-upload",
            "judgment_upload",
            "judgement_upload",
        ),
    }

    # ── IK fallback: if judgments IK columns are empty, pull from ik_document_assets ──
    _needs_ik_fallback = (
        not result.get("ik_orig_doc_url")
        and not result.get("ik_cite_list")
        and not result.get("ik_cited_by_list")
        and not result.get("ik_doc_meta")
    )
    if _needs_ik_fallback:
        _ik_conn = get_pg_conn()
        if _ik_conn:
            try:
                with _ik_conn.cursor(cursor_factory=RealDictCursor) as _cur:
                    _cur.execute(
                        """SELECT orig_doc_url, fragments, cite_list, cited_by_list, meta, raw_api_response
                             FROM ik_document_assets
                            WHERE canonical_id = %s
                            ORDER BY updated_at DESC NULLS LAST LIMIT 1""",
                        (canonical_id,),
                    )
                    _ik_row = _cur.fetchone()
                    if _ik_row:
                        result["ik_orig_doc_url"] = _ik_row.get("orig_doc_url") or ""
                        result["ik_fragments"] = _ik_row.get("fragments") or {}
                        result["ik_doc_meta"] = _ik_row.get("meta") or {}
                        # cite_list/cited_by_list may be NULL due to old field-name bug;
                        # fall back to raw_api_response.doc_data.cites / .citedby
                        _cite = _ik_row.get("cite_list") or []
                        _citedby = _ik_row.get("cited_by_list") or []
                        if not _cite or not _citedby:
                            _raw = _ik_row.get("raw_api_response") or {}
                            _doc_data = _raw.get("doc_data") or {}
                            _cite = _cite or _doc_data.get("cites") or _doc_data.get("citeList") or []
                            _citedby = _citedby or _doc_data.get("citedby") or _doc_data.get("citedbyList") or []
                        result["ik_cite_list"] = _cite
                        result["ik_cited_by_list"] = _citedby
            except Exception as _exc:
                logger.warning("[DB] IK fallback from ik_document_assets failed for %s: %s", canonical_id, _exc)
            finally:
                _ik_conn.close()

    return result


def judgement_search_local(
    query: str,
    limit: int = 10,
    case_state: str = "",
    approved_only: bool = True,
    exclude_low_hierarchy: bool = True,
) -> List[Dict[str, Any]]:
    query = (query or "").strip()
    if not query:
        return []

    # Probe ES once: unreachable ES must not abort local search; Qdrant/PG still run.
    es = get_es_client()
    es_unreachable = elasticsearch_init_failed()
    # Do not apply a score_threshold — it blocks all results when ES is down.
    # Rely on cosine similarity ordering and limit instead.
    qdrant_score_threshold: Optional[float] = None

    def _is_approved_status(v: Any) -> bool:
        s = str(v or "").strip().upper()
        return s in {"APPROVED", "VERIFIED", "VERIFIED_WARN", "GREEN"}

    def _is_low_hierarchy_court(v: Any) -> bool:
        c = str(v or "").strip().lower()
        if not c:
            return False
        bad = ("district", "tribunal", "forum", "commission", "magistrate", "drt", "drat", "itat", "cestat", "nclt", "nclat")
        return any(x in c for x in bad)

    def _rank_row(court_value: Any) -> int:
        c = str(court_value or "").strip().lower()
        if "supreme" in c:
            return 300
        if "high" in c:
            score = 200
            st = str(case_state or "").strip().lower()
            if st and st in c:
                score += 25
            if st == "maharashtra" and "bombay high court" in c:
                score += 25
            return score
        return 100

    def _is_admin_source(source_type: Any) -> bool:
        """True when the judgment was uploaded by an admin (not fetched from external API)."""
        raw = str(source_type or "").strip().lower()
        return (
            raw in (
            "admin",
            "admin_upload",
            "admin-upload",
            "admin uploaded",
            "admin-uploaded",
            "adminupload",
            "manual_upload",
            "manual-upload",
            "judgment_upload",
            "judgement_upload",
        )
            or raw.startswith("admin_")
            or raw.startswith("admin-")
            or raw.startswith("admin ")
        )

    def _rows_from_es_hits(hits: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        rows: List[Dict[str, Any]] = []
        for h in hits:
            src = h.get("_source") or {}
            canonical_id = src.get("canonical_id") or h.get("_id")
            src_type = str(src.get("source_type") or "").strip().lower()
            is_admin = _is_admin_source(src_type)
            row = {
                "id": canonical_id,
                "canonical_id": canonical_id,
                "title": src.get("case_name"),
                "primary_citation": src.get("primary_citation"),
                "court": src.get("court_code"),
                "ratio": src.get("holding_text") or src.get("summary_text"),
                "full_text": src.get("full_text") or "",
                "raw_content": src.get("full_text") or "",
                "source": "admin_upload" if is_admin else (src.get("source_type") or "local"),
                "source_type": src_type or (src.get("source_type") or "local"),
                "is_local_admin": is_admin,
            }
            if approved_only and not is_admin and not _is_approved_status(src.get("verification_status")):
                continue
            if exclude_low_hierarchy and _is_low_hierarchy_court(row.get("court")):
                continue
            row["_local_rank"] = _rank_row(row.get("court"))
            rows.append(row)
        rows.sort(key=lambda r: r.get("_local_rank", 0), reverse=True)
        return rows

    def _search_es_fuzzy_text(limit_count: int) -> List[Dict[str, Any]]:
        if not es:
            return []
        try:
            resp = es.search(
                index="judgments",
                size=limit_count,
                query={
                    "bool": {
                        "must": [
                            {
                                "multi_match": {
                                    "query": query,
                                    "fields": [
                                        "case_name^4",
                                        "primary_citation^3",
                                        "summary_text^2",
                                        "holding_text^2",
                                        "facts_text",
                                        "full_text",
                                    ],
                                    "fuzziness": "AUTO",
                                    "operator": "or",
                                }
                            }
                        ],
                        "filter": [
                            {"terms": {"verification_status.keyword": ["APPROVED", "VERIFIED", "VERIFIED_WARN", "GREEN"]}}
                        ] if approved_only else [],
                        "must_not": [
                            {"match_phrase": {"court_code": "district court"}},
                            {"match_phrase": {"court_code": "district judge"}},
                            {"match_phrase": {"court_code": "sessions court"}},
                            {"match_phrase": {"court_code": "magistrate"}},
                            {"match_phrase": {"court_code": "tribunal"}},
                            {"match_phrase": {"court_code": "consumer forum"}},
                            {"match_phrase": {"court_code": "consumer commission"}},
                        ] if exclude_low_hierarchy else [],
                    }
                },
            )
            rows = _rows_from_es_hits(resp.get("hits", {}).get("hits", []))
            logger.info("[ES] fuzzy fallback returned %d result(s) for %r", len(rows), query[:80])
            return rows[:limit_count]
        except Exception as exc:
            logger.warning("[ES] fuzzy fallback failed: %s", exc)
            return []

    def _search_qdrant_semantic(limit_count: int) -> List[Dict[str, Any]]:
        """
        Semantic search via Qdrant vector similarity.
        Each Qdrant chunk payload must have canonical_id.
        Admin-uploaded judgments are always included regardless of verification_status.
        """
        qdr = get_qdrant_client()
        if not qdr:
            logger.info("[QDRANT] Client not available — skipping semantic search")
            return []
        vector: Optional[List[float]] = None
        for attempt in range(3):
            vector = _get_qdrant_query_embedding(query)
            if vector:
                break
            if attempt < 2:
                logger.warning("[QDRANT] Empty embedding for %r - retry %d/2", query[:60], attempt + 1)
        if vector is None:
            vector = []
        if not vector:
            if es_unreachable:
                logger.info("[QDRANT] No embedding vector while ES is unreachable - relying on PG metadata fallback for: %r", query[:60])
                return []
            logger.info("[QDRANT] No embedding vector — skipping semantic search for: %r", query[:60])
            return []
        try:
            qdrant_collection = os.environ.get("QDRANT_COLLECTION", "legal_embeddings_v2").strip() or "legal_embeddings_v2"
            fetch_limit = max(limit_count * 3, 30)
            if qdrant_score_threshold is not None:
                logger.info(
                    "[QDRANT] Querying collection '%s' limit=%d score_threshold=%s for: %r",
                    qdrant_collection, fetch_limit, qdrant_score_threshold, query[:60],
                )
            else:
                logger.info(
                    "[QDRANT] Querying collection '%s' limit=%d for: %r",
                    qdrant_collection, fetch_limit, query[:60]
                )
            points = []
            try:
                _qp_kwargs: Dict[str, Any] = {
                    "collection_name": qdrant_collection,
                    "query": vector,
                    "limit": fetch_limit,
                    "with_payload": True,
                }
                if qdrant_score_threshold is not None:
                    _qp_kwargs["score_threshold"] = qdrant_score_threshold
                try:
                    qp = qdr.query_points(**_qp_kwargs)
                except TypeError:
                    _qp_kwargs.pop("score_threshold", None)
                    qp = qdr.query_points(**_qp_kwargs)
                points = list(getattr(qp, "points", None) or [])
            except Exception as _qp_exc:
                logger.info("[QDRANT] query_points failed (%s), falling back to search()", _qp_exc)
                _s_kwargs: Dict[str, Any] = {
                    "collection_name": qdrant_collection,
                    "query_vector": vector,
                    "limit": fetch_limit,
                    "with_payload": True,
                }
                if qdrant_score_threshold is not None:
                    _s_kwargs["score_threshold"] = qdrant_score_threshold
                try:
                    points = qdr.search(**_s_kwargs) or []
                except TypeError:
                    _s_kwargs.pop("score_threshold", None)
                    points = qdr.search(**_s_kwargs) or []
            logger.info("[QDRANT] Vector search returned %d point(s)", len(points))
            # Extract canonical_ids from chunk payloads, preserving similarity order.
            # Also keep a payload map so we can build results from Qdrant data directly
            # for judgments not yet present in the PG judgments table.
            canonical_ids: List[str] = []
            qdrant_juuids: List[str] = []
            seen: set = set()
            payload_by_cid: Dict[str, Any] = {}
            for p in points:
                payload = getattr(p, "payload", None) or {}
                cid = str(payload.get("canonical_id") or "").strip()
                ju = str(payload.get("judgment_uuid") or "").strip()
                if ju and ju not in qdrant_juuids:
                    qdrant_juuids.append(ju)
                if cid and cid not in seen:
                    seen.add(cid)
                    canonical_ids.append(cid)
                    payload_by_cid[cid] = payload
            logger.info("[QDRANT] Unique canonical_ids from chunks: %d", len(canonical_ids))
            if not canonical_ids and not qdrant_juuids:
                return []

            def _build_from_payload(cid: str) -> Optional[Dict[str, Any]]:
                """Build a result entry directly from Qdrant payload fields."""
                p = payload_by_cid.get(cid, {})
                case_name = str(p.get("case_name") or "").strip()
                court_code = str(p.get("court_code") or "").strip()
                if not case_name and not court_code:
                    return None
                return {
                    "id": cid,
                    "canonical_id": cid,
                    "judgment_uuid": str(p.get("judgment_uuid") or "").strip(),
                    "title": case_name,
                    "case_name": case_name,
                    "primary_citation": "",
                    "court": court_code,
                    "court_code": court_code,
                    "year": p.get("year"),
                    "ratio": str(p.get("chunk_text") or "")[:500],
                    "source": "local",
                    "is_local_admin": False,
                    "_local_rank": _rank_row(court_code),
                    "_from_qdrant": True,
                    "_qdrant_payload_only": True,
                }

            pg_rows_by_cid: Dict[str, Dict[str, Any]] = {}
            es_id_by_cid: Dict[str, str] = {}
            conn2 = get_pg_conn()
            if conn2:
                try:
                    admin_uploaded_cids: set = set()
                    admin_uploaded_esids: set = set()
                    admin_uploaded_juuids: set = set()
                    with conn2.cursor(cursor_factory=RealDictCursor) as cur2:
                        if canonical_ids and qdrant_juuids:
                            cur2.execute(
                                """
                                SELECT j.canonical_id, j.es_doc_id, j.case_name, j.court_code, j.source_type, j.year,
                                       j.citation_data, j.verification_status, j.judgment_uuid, j.judgment_date
                                  FROM judgments j
                                 WHERE j.canonical_id = ANY(%s)
                                    OR j.judgment_uuid::text = ANY(%s)
                                """,
                                (canonical_ids, qdrant_juuids),
                            )
                        elif canonical_ids:
                            cur2.execute(
                                """
                                SELECT j.canonical_id, j.es_doc_id, j.case_name, j.court_code, j.source_type, j.year,
                                       j.citation_data, j.verification_status, j.judgment_uuid, j.judgment_date
                                  FROM judgments j
                                 WHERE j.canonical_id = ANY(%s)
                                """,
                                (canonical_ids,),
                            )
                        else:
                            cur2.execute(
                                """
                                SELECT j.canonical_id, j.es_doc_id, j.case_name, j.court_code, j.source_type, j.year,
                                       j.citation_data, j.verification_status, j.judgment_uuid, j.judgment_date
                                  FROM judgments j
                                 WHERE j.judgment_uuid::text = ANY(%s)
                                """,
                                (qdrant_juuids,),
                            )
                        rows2 = cur2.fetchall() or []
                    # Prefer judgment_uploads.es_doc_id over judgments.es_doc_id for ES mget.
                    upload_es_by_cid: Dict[str, str] = {}
                    try:
                        upload_table = _resolve_admin_upload_table(conn2) or ""
                        upload_cols = _get_table_columns(conn2, upload_table) if upload_table else set()
                        es_ids = [
                            str(r.get("es_doc_id") or "").strip()
                            for r in rows2
                            if str(r.get("es_doc_id") or "").strip()
                        ]
                        ju_ids = [
                            str(r.get("judgment_uuid") or "").strip()
                            for r in rows2
                            if str(r.get("judgment_uuid") or "").strip()
                        ]
                        for _ju in qdrant_juuids:
                            if _ju and _ju not in ju_ids:
                                ju_ids.append(_ju)
                        if upload_table:
                            clauses: List[str] = []
                            params: List[Any] = []
                            if "canonical_id" in upload_cols and canonical_ids:
                                clauses.append("canonical_id = ANY(%s)")
                                params.append(canonical_ids)
                            if "es_doc_id" in upload_cols and es_ids:
                                clauses.append("es_doc_id = ANY(%s)")
                                params.append(es_ids)
                            if "judgment_uuid" in upload_cols and ju_ids:
                                clauses.append("judgment_uuid::text = ANY(%s)")
                                params.append(ju_ids)
                            if not clauses:
                                logger.info(
                                    "[QDRANT] Upload table %s has no usable keys among canonical_id/es_doc_id/judgment_uuid",
                                    upload_table,
                                )
                            else:
                                # Fetch merged_text + metadata so missing-from-judgments
                                # admin uploads can be hydrated from upload data directly.
                                _up_sel = ["canonical_id", "judgment_uuid"]
                                for _uc in [
                                    "document_id",
                                    "judgment_uuid",
                                    "canonical_id",
                                    "original_filename",
                                    "source_url",
                                    "storage_bucket",
                                    "storage_path",
                                    "storage_uri",
                                    "status",
                                    "admin_user_id",
                                    "admin_role",
                                    "total_pages",
                                    "text_pages_count",
                                    "ocr_pages_count",
                                    "ocr_batches_count",
                                    "merged_text",
                                    "metadata",
                                    "es_doc_id",
                                    "qdrant_collection",
                                    "last_progress_message",
                                    "error_message",
                                    "processing_started_at",
                                    "processing_completed_at",
                                    "created_at",
                                    "updated_at",
                                    "pipeline_metrics",
                                ]:
                                    if _uc in upload_cols:
                                        _up_sel.append(_uc)
                                with conn2.cursor(cursor_factory=RealDictCursor) as cur_up:
                                    cur_up.execute(
                                        f"""
                                        SELECT {", ".join(_up_sel)}
                                          FROM {upload_table}
                                         WHERE {" OR ".join(clauses)}
                                        """,
                                        tuple(params),
                                    )
                                    up_rows = cur_up.fetchall() or []
                                for ur in up_rows:
                                    _cid = str(ur.get("canonical_id") or "").strip()
                                    _esid = str(ur.get("es_doc_id") or "").strip()
                                    _ju = str(ur.get("judgment_uuid") or "").strip()
                                    if _cid and _esid:
                                        upload_es_by_cid[_cid] = _esid
                                    if _cid and _cid not in seen:
                                        # Bring in canonical IDs discovered via upload-table
                                        # lookup by judgment_uuid so admin uploads are not missed.
                                        seen.add(_cid)
                                        canonical_ids.append(_cid)
                                    if _cid:
                                        admin_uploaded_cids.add(_cid)
                                        # Store full upload row for later hydration
                                        if _cid not in pg_rows_by_cid:
                                            pg_rows_by_cid[_cid] = {
                                                "canonical_id": _cid,
                                                "es_doc_id": _esid,
                                                "judgment_uuid": _ju,
                                                "document_id": ur.get("document_id"),
                                                "original_filename": str(ur.get("original_filename") or ""),
                                                "source_url": ur.get("source_url"),
                                                "storage_bucket": ur.get("storage_bucket"),
                                                "storage_path": ur.get("storage_path"),
                                                "storage_uri": ur.get("storage_uri"),
                                                "status": ur.get("status"),
                                                "admin_user_id": ur.get("admin_user_id"),
                                                "admin_role": ur.get("admin_role"),
                                                "total_pages": ur.get("total_pages"),
                                                "text_pages_count": ur.get("text_pages_count"),
                                                "ocr_pages_count": ur.get("ocr_pages_count"),
                                                "ocr_batches_count": ur.get("ocr_batches_count"),
                                                "merged_text": str(ur.get("merged_text") or ""),
                                                "metadata": ur.get("metadata") or {},
                                                "qdrant_collection": ur.get("qdrant_collection"),
                                                "last_progress_message": ur.get("last_progress_message"),
                                                "error_message": ur.get("error_message"),
                                                "processing_started_at": ur.get("processing_started_at"),
                                                "processing_completed_at": ur.get("processing_completed_at"),
                                                "created_at": ur.get("created_at"),
                                                "updated_at": ur.get("updated_at"),
                                                "pipeline_metrics": ur.get("pipeline_metrics"),
                                                "uploaded_by_admin": True,
                                                "_from_judgment_uploads": True,
                                            }
                                            es_id_by_cid[_cid] = _esid
                                    if _esid:
                                        admin_uploaded_esids.add(_esid)
                                    if _ju:
                                        admin_uploaded_juuids.add(_ju)
                                logger.info(
                                    "[QDRANT] Admin upload matches (table=%s): canonical=%d/%d es_doc_id=%d judgment_uuid=%d",
                                    upload_table,
                                    len(admin_uploaded_cids),
                                    len(canonical_ids),
                                    len(admin_uploaded_esids),
                                    len(admin_uploaded_juuids),
                                )
                    except Exception as e:
                        logger.warning("[QDRANT] Admin upload canonical mapping failed: %s", e)
                    _row_cids = [str(r.get("canonical_id") or "").strip() for r in rows2 if r.get("canonical_id")]
                    logger.info(
                        "[QDRANT] DB fetch returned %d row(s) for %d canonical_id(s): %s",
                        len(rows2),
                        len(canonical_ids),
                        ", ".join(_row_cids) if _row_cids else "(none)",
                    )
                    for r in rows2:
                        rcid = str(r.get("canonical_id") or "").strip()
                        rju = str(r.get("judgment_uuid") or "").strip()
                        if not rcid and rju:
                            # Ensure UUID-only hits can still participate in the canonical pipeline.
                            rcid = rju
                            r["canonical_id"] = rcid
                        if rcid and rcid not in seen:
                            seen.add(rcid)
                            canonical_ids.append(rcid)
                        if rcid:
                            r_esid = str(r.get("es_doc_id") or "").strip()
                            r_ju = str(r.get("judgment_uuid") or "").strip()
                            r["uploaded_by_admin"] = (
                                (rcid in admin_uploaded_cids)
                                or (bool(r_esid) and r_esid in admin_uploaded_esids)
                                or (bool(r_ju) and r_ju in admin_uploaded_juuids)
                            )
                            pg_rows_by_cid[rcid] = r
                            judgment_es = str(r.get("es_doc_id") or "").strip()
                            es_id_by_cid[rcid] = upload_es_by_cid.get(rcid) or judgment_es
                finally:
                    conn2.close()
            else:
                logger.warning("[QDRANT] DB connection unavailable — metadata fallback to Qdrant payload only")

            # Fetch judgment body from Elasticsearch using es_doc_id from PG first,
            # then canonical_id as fallback.
            es_docs_by_cid: Dict[str, Dict[str, Any]] = {}
            if es:
                try:
                    fetch_ids: List[str] = []
                    seen_ids: set = set()
                    for cid in canonical_ids:
                        esid = es_id_by_cid.get(cid, "")
                        if esid and esid not in seen_ids:
                            fetch_ids.append(esid)
                            seen_ids.add(esid)
                    for cid in canonical_ids:
                        if cid and cid not in seen_ids:
                            fetch_ids.append(cid)
                            seen_ids.add(cid)

                    mres = es.mget(index="judgments", body={"ids": fetch_ids})
                    for d in (mres.get("docs") or []):
                        if not d.get("found"):
                            continue
                        src = d.get("_source") or {}
                        esid = str(d.get("_id") or "").strip()
                        scid = str(src.get("canonical_id") or "").strip()
                        if scid:
                            es_docs_by_cid[scid] = src
                        # If canonical_id missing in source, map via PG es_doc_id relation.
                        elif esid:
                            for cid, mapped_esid in es_id_by_cid.items():
                                if mapped_esid and mapped_esid == esid:
                                    es_docs_by_cid[cid] = src
                                    break
                except Exception as _mexc:
                    logger.warning("[QDRANT] ES mget hydration failed: %s", _mexc)

            scored: List[Dict[str, Any]] = []
            for cid in canonical_ids:
                p = payload_by_cid.get(cid, {}) or {}
                r = pg_rows_by_cid.get(cid, {}) or {}
                esd = es_docs_by_cid.get(cid, {}) or {}

                cd = r.get("citation_data") or {}
                if isinstance(cd, str):
                    try:
                        import json as _json
                        cd = _json.loads(cd)
                    except Exception:
                        cd = {}

                src_type = str(r.get("source_type") or cd.get("source_type") or esd.get("source_type") or "").strip().lower()
                uploaded_by_admin = bool(r.get("uploaded_by_admin")) or bool(r.get("_from_judgment_uploads"))
                is_admin = _is_admin_source(src_type) or uploaded_by_admin
                verification_status = str(
                    r.get("verification_status")
                    or esd.get("verification_status")
                    or cd.get("verification_status")
                    or ""
                ).upper()

                # Admin-uploaded judgments are always included; others require approved status.
                if approved_only and not is_admin:
                    if verification_status not in ("APPROVED", "VERIFIED", "VERIFIED_WARN", "GREEN"):
                        continue

                court_code = (
                    r.get("court_code")
                    or cd.get("court_code")
                    or cd.get("court_name")
                    or esd.get("court_code")
                    or esd.get("court_name")
                    or p.get("court_code")
                )
                if exclude_low_hierarchy and _is_low_hierarchy_court(court_code):
                    continue

                display_source = src_type
                if is_admin:
                    display_source = "admin_upload"
                elif not display_source:
                    display_source = "local"

                # For rows sourced from judgment_uploads, parse metadata JSONB for
                # case_name / court_code / year / primary_citation.
                upload_meta: Dict[str, Any] = {}
                if r.get("_from_judgment_uploads"):
                    _raw_meta = r.get("metadata") or {}
                    if isinstance(_raw_meta, str):
                        try:
                            import json as _json2
                            _raw_meta = _json2.loads(_raw_meta)
                        except Exception:
                            _raw_meta = {}
                    upload_meta = _raw_meta if isinstance(_raw_meta, dict) else {}

                merged_text_fallback = str(r.get("merged_text") or "").strip()

                title = (
                    r.get("case_name")
                    or upload_meta.get("case_name") or upload_meta.get("caseName")
                    or cd.get("case_name")
                    or esd.get("case_name")
                    or p.get("case_name")
                    # Last resort: derive from original filename
                    or str(r.get("original_filename") or "").rsplit(".", 1)[0].replace("_", " ").strip()
                    or ""
                )
                if not court_code:
                    court_code = str(
                        upload_meta.get("court_code") or upload_meta.get("courtCode")
                        or upload_meta.get("court") or ""
                    ).strip() or court_code
                ratio_text = (
                    esd.get("holding_text")
                    or esd.get("summary_text")
                    or cd.get("holding_text")
                    or cd.get("summary_text")
                    or str(esd.get("full_text") or "")[:500]
                    or merged_text_fallback[:500]
                    or str(p.get("chunk_text") or "")[:500]
                )
                primary_citation = (
                    cd.get("primary_citation")
                    or upload_meta.get("primary_citation") or upload_meta.get("citation")
                    or esd.get("primary_citation")
                    or ""
                )
                year_val = (
                    r.get("year")
                    or upload_meta.get("year") or upload_meta.get("judgment_year")
                    or esd.get("year")
                    or p.get("year")
                )

                if not title and not court_code and not ratio_text:
                    entry = _build_from_payload(cid)
                    if entry:
                        scored.append(entry)
                    continue

                full_text_val = (
                    esd.get("full_text")
                    or cd.get("full_text")
                    or merged_text_fallback
                    or ""
                )
                scored.append({
                    "id": cid,
                    "canonical_id": cid,
                    "judgment_uuid": str(r.get("judgment_uuid") or p.get("judgment_uuid") or "").strip(),
                    "document_id": r.get("document_id"),
                    "es_doc_id": str(es_id_by_cid.get(cid) or r.get("es_doc_id") or cid).strip(),
                    "title": title,
                    "case_name": title,
                    "primary_citation": primary_citation,
                    "court": court_code,
                    "court_code": court_code,
                    "year": year_val,
                    "ratio": ratio_text,
                    "source": display_source,
                    "source_type": "admin-uploaded" if is_admin else (src_type or "local"),
                    "is_local_admin": is_admin,
                    "_local_rank": _rank_row(court_code),
                    "_from_qdrant": True,
                    "_hydrated_from_es": bool(esd),
                    "_from_judgment_uploads": bool(r.get("_from_judgment_uploads")),
                    "raw_content": full_text_val,
                    "full_text": full_text_val,
                    "original_filename": r.get("original_filename"),
                    "source_url": r.get("source_url"),
                    "storage_bucket": r.get("storage_bucket"),
                    "storage_path": r.get("storage_path"),
                    "storage_uri": r.get("storage_uri"),
                    "status": r.get("status"),
                    "admin_user_id": r.get("admin_user_id"),
                    "admin_role": r.get("admin_role"),
                    "total_pages": r.get("total_pages"),
                    "text_pages_count": r.get("text_pages_count"),
                    "ocr_pages_count": r.get("ocr_pages_count"),
                    "ocr_batches_count": r.get("ocr_batches_count"),
                    "merged_text": r.get("merged_text"),
                    "metadata": r.get("metadata"),
                    "qdrant_collection": r.get("qdrant_collection"),
                    "last_progress_message": r.get("last_progress_message"),
                    "error_message": r.get("error_message"),
                    "processing_started_at": r.get("processing_started_at"),
                    "processing_completed_at": r.get("processing_completed_at"),
                    "created_at": r.get("created_at"),
                    "updated_at": r.get("updated_at"),
                    "pipeline_metrics": r.get("pipeline_metrics"),
                })
                logger.info(
                    "[QDRANT_CHAIN] canonical_id=%s | judgment_uuid=%s | source_type=%s | admin=%s | es_doc_id=%s",
                    cid or "—",
                    str(r.get("judgment_uuid") or p.get("judgment_uuid") or "").strip() or "—",
                    str(r.get("source_type") or src_type or "local").strip() or "local",
                    bool(is_admin),
                    str(es_id_by_cid.get(cid) or r.get("es_doc_id") or cid).strip() or "—",
                )

            scored.sort(key=lambda r: r.get("_local_rank", 0), reverse=True)
            if scored:
                return scored[:limit_count]
            logger.info("[QDRANT] Semantic search produced 0 hydrated rows - using ES fuzzy fallback")
            return _search_es_fuzzy_text(limit_count)
        except Exception as exc:
            logger.warning("[QDRANT] semantic local search failed: %s", exc)
            return _search_es_fuzzy_text(limit_count)

    es_rows: List[Dict[str, Any]] = []
    if es:
        try:
            resp = es.search(
                index="judgments",
                size=limit,
                query={
                    "bool": {
                        "must": [
                            {
                                "multi_match": {
                                    "query": query,
                                    "type": "cross_fields",
                                    "fields": [
                                        "case_name^3",
                                        "summary_text^2",
                                        "holding_text^2",
                                        "facts_text",
                                        "full_text",
                                    ],
                                }
                            }
                        ],
                        "filter": [
                            {"terms": {"verification_status.keyword": ["APPROVED", "VERIFIED", "VERIFIED_WARN", "GREEN"]}}
                        ] if approved_only else [],
                        "must_not": [
                            {"match_phrase": {"court_code": "district court"}},
                            {"match_phrase": {"court_code": "district judge"}},
                            {"match_phrase": {"court_code": "sessions court"}},
                            {"match_phrase": {"court_code": "magistrate"}},
                            {"match_phrase": {"court_code": "tribunal"}},
                            {"match_phrase": {"court_code": "consumer forum"}},
                            {"match_phrase": {"court_code": "consumer commission"}},
                        ] if exclude_low_hierarchy else [],
                    }
                },
            )
            hits = resp.get("hits", {}).get("hits", [])
            es_rows = _rows_from_es_hits(hits)[:limit]
        except Exception as exc:
            logger.warning("[ES] search failed: %s", exc)

    # ── Qdrant semantic search — runs independently of PG/ES ──────────────────
    # Runs first so its results are available even when PG query fails.
    # Finds judgments by vector similarity using canonical_id from chunk payloads.
    logger.info("[LOCAL_SEARCH] Running Qdrant semantic search for: %r", query[:80])
    qdrant_rows = _search_qdrant_semantic(limit)
    logger.info("[LOCAL_SEARCH] Qdrant returned %d result(s)", len(qdrant_rows))

    conn = get_pg_conn()
    if not conn:
        # No DB — return whatever Qdrant + ES found
        combined = es_rows + qdrant_rows
        seen: Dict[str, Dict[str, Any]] = {}
        for r in combined:
            k = str(r.get("canonical_id") or r.get("id") or "").strip()
            if k and k not in seen:
                seen[k] = r
        return list(seen.values())[:limit]

    pg_rows: List[Dict[str, Any]] = []
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            q_like = f"%{query}%"
            # Local DB fallback should handle older DB schemas safely.
            cur.execute(
                """
                SELECT column_name
                  FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'judgments'
                """
            )
            available_cols = {str(r.get("column_name") or "").strip().lower() for r in (cur.fetchall() or [])}
            has_primary = "primary_citation" in available_cols
            has_holding = "holding_text" in available_cols
            has_summary = "summary_text" in available_cols
            has_full = "full_text" in available_cols
            has_verification = "verification_status" in available_cols

            select_primary = "primary_citation" if has_primary else "NULL::text AS primary_citation"
            select_holding = "holding_text" if has_holding else "NULL::text AS holding_text"
            select_summary = "summary_text" if has_summary else "NULL::text AS summary_text"
            select_verification = "verification_status" if has_verification else "NULL::text AS verification_status"

            search_parts = ["case_name ILIKE %s"]
            params = [q_like]
            if has_primary:
                search_parts.append("primary_citation ILIKE %s")
                params.append(q_like)
            if has_summary:
                search_parts.append("COALESCE(summary_text, '') ILIKE %s")
                params.append(q_like)
            if has_holding:
                search_parts.append("COALESCE(holding_text, '') ILIKE %s")
                params.append(q_like)
            if has_full:
                search_parts.append("COALESCE(full_text, '') ILIKE %s")
                params.append(q_like)
            hard_filters = []
            if approved_only and has_verification:
                # Always include admin-uploaded judgments regardless of verification status
                hard_filters.append(
                    "(COALESCE(verification_status, '') IN ('APPROVED','VERIFIED','VERIFIED_WARN','GREEN')"
                    " OR LOWER(COALESCE(source_type,'')) IN ('admin','admin_upload','admin-upload','admin uploaded','admin-uploaded','adminupload','manual_upload','manual-upload','judgment_upload','judgement_upload'))"
                )
            if exclude_low_hierarchy:
                hard_filters.append(
                    "LOWER(COALESCE(court_code,'')) NOT LIKE %s "
                    "AND LOWER(COALESCE(court_code,'')) NOT LIKE %s "
                    "AND LOWER(COALESCE(court_code,'')) NOT LIKE %s "
                    "AND LOWER(COALESCE(court_code,'')) NOT LIKE %s"
                )
                params.extend(["%district%", "%tribunal%", "%forum%", "%commission%"])

            order_case = "CASE WHEN case_name ILIKE %s THEN 0"
            order_params = [q_like]
            if has_primary:
                order_case += " WHEN primary_citation ILIKE %s THEN 1"
                order_params.append(q_like)
            order_case += " ELSE 2 END"

            sql_query = f"""
                SELECT canonical_id, case_name, court_code, judgment_date, year, source_type,
                       {select_primary}, {select_holding}, {select_summary}, {select_verification}
                  FROM judgments
                 WHERE ({" OR ".join(search_parts)})
                   {"AND " + " AND ".join(hard_filters) if hard_filters else ""}
                 ORDER BY {order_case}, ingested_at DESC NULLS LAST
                 LIMIT %s
            """
            params.extend(order_params)
            params.append(limit)
            cur.execute(sql_query, tuple(params))
            rows = cur.fetchall()
            for r in rows:
                src_raw = str(r.get("source_type") or "").strip().lower()
                display_src = "admin_upload" if _is_admin_source(src_raw) else (src_raw or "local")
                pg_rows.append({
                    "id": r.get("canonical_id"),
                    "canonical_id": r.get("canonical_id"),
                    "title": r.get("case_name"),
                    "primary_citation": r.get("primary_citation"),
                    "court": r.get("court_code"),
                    "ratio": r.get("holding_text") or r.get("summary_text") or "",
                    "source": display_src,
                    "is_local_admin": _is_admin_source(src_raw),
                    "_local_rank": _rank_row(r.get("court_code")),
                })
            pg_rows.sort(key=lambda r: r.get("_local_rank", 0), reverse=True)
            logger.info("[LOCAL_SEARCH] PG text search returned %d result(s)", len(pg_rows))
    except Exception as exc:
        logger.warning("[PG] local search broad query failed: %s", exc)
        try:
            conn.rollback()
        except Exception:
            pass
        # Try narrow case-name fallback
        try:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(
                    """
                    SELECT canonical_id, case_name, court_code, source_type
                      FROM judgments
                     WHERE case_name ILIKE %s
                     ORDER BY ingested_at DESC NULLS LAST
                     LIMIT %s
                    """,
                    (f"%{query}%", limit),
                )
                for r in (cur.fetchall() or []):
                    src_raw = str(r.get("source_type") or "").strip().lower()
                    pg_rows.append({
                        "id": r.get("canonical_id"),
                        "canonical_id": r.get("canonical_id"),
                        "title": r.get("case_name"),
                        "primary_citation": None,
                        "court": r.get("court_code"),
                        "ratio": "",
                        "source": "admin_upload" if _is_admin_source(src_raw) else (src_raw or "local"),
                        "is_local_admin": _is_admin_source(src_raw),
                    })
        except Exception as inner_exc:
            logger.warning("[PG] local search fallback failed: %s", inner_exc)
    finally:
        conn.close()

    # ── Merge ES + PG + Qdrant by canonical_id, preserving best rank ──────────
    merged: Dict[str, Dict[str, Any]] = {}
    for r in (es_rows + pg_rows + qdrant_rows):
        key = str(r.get("canonical_id") or r.get("id") or "").strip()
        if not key:
            key = f"{str(r.get('title') or '').strip()}::{str(r.get('court') or '').strip()}"
        if not key:
            continue
        if key not in merged:
            merged[key] = r
            continue
        existing = merged[key]
        # Prefer higher hierarchy rank; for equal rank prefer Qdrant (semantic match)
        if (r.get("_local_rank") or 0) > (existing.get("_local_rank") or 0):
            merged[key] = r
        elif (r.get("_local_rank") or 0) == (existing.get("_local_rank") or 0) and r.get("_from_qdrant"):
            merged[key] = r
    final_rows = list(merged.values())
    final_rows.sort(key=lambda r: r.get("_local_rank", 0), reverse=True)
    logger.info(
        "[LOCAL_SEARCH] Final merged: %d result(s) [PG=%d, ES=%d, Qdrant=%d]",
        len(final_rows), len(pg_rows), len(es_rows), len(qdrant_rows),
    )
    return final_rows[:limit]


# --- Citation reports (user-specific) ---

def report_insert(
    report_id: str,
    user_id: str,
    query: str,
    report_format: Dict[str, Any],
    status: str = "completed",
    case_id: Optional[str] = None,
    run_id: Optional[str] = None,
    hitl_pending_count: int = 0,
    hitl_approved_count: int = 0,
    citations_approved_count: int = 0,
    citations_quarantined_count: int = 0,
    dimensions_metadata: Optional[List[Dict[str, Any]]] = None,
) -> Optional[str]:
    """Persist report snapshot. Returns report_id on success, None if PostgreSQL is unavailable."""
    conn = get_pg_conn()
    if not conn:
        logger.warning("[report_insert] PostgreSQL unavailable — skipping persist (report_id=%s)", report_id)
        return None
    cit_count = len(report_format.get("citations", [])) if isinstance(report_format, dict) else 0
    dims_meta = dimensions_metadata if dimensions_metadata is not None else (
        (report_format.get("dimensions") or []) if isinstance(report_format, dict) else []
    )
    try:
        with conn.cursor() as cur:
            # Store main report row
            cur.execute(
                """
                INSERT INTO citation_reports (
                    id, user_id, query, report_format, dimensions_metadata, status, case_id, citation_count,
                    run_id, hitl_pending_count, hitl_approved_count,
                    citations_approved_count, citations_quarantined_count
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    report_id, user_id, query, Json(report_format), Json(dims_meta), status, case_id, cit_count,
                    run_id, hitl_pending_count, hitl_approved_count,
                    citations_approved_count, citations_quarantined_count,
                ),
            )

            # Increment daily usage analytics for this user
            from datetime import date

            today = date.today()
            # Simple heuristic: assume each verified citation saves ~5 minutes of manual research
            est_minutes_saved = int(max(0, cit_count) * 5)
            cur.execute(
                """
                INSERT INTO usage_analytics_daily (
                    user_id, usage_date, queries_count, citations_generated, time_saved_minutes
                )
                VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT (user_id, usage_date)
                DO UPDATE SET
                    queries_count = usage_analytics_daily.queries_count + EXCLUDED.queries_count,
                    citations_generated = usage_analytics_daily.citations_generated + EXCLUDED.citations_generated,
                    time_saved_minutes = usage_analytics_daily.time_saved_minutes + EXCLUDED.time_saved_minutes,
                    updated_at = NOW()
                """,
                (user_id or "anonymous", today, 1, cit_count, est_minutes_saved),
            )

        conn.commit()
        return report_id
    except Exception as exc:
        logger.warning("[report_insert] failed: %s", exc)
        return None
    finally:
        conn.close()


def analytics_get_enterprise_dashboard(
    days_window: int = 30,
    months: int = 6,
    member_ids: Optional[List[str]] = None,
    user_info_map: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Aggregate enterprise analytics for admin dashboard.
    - Summary for the last `days_window` days
    - Volume trend for the last `months` months
    - Team activity for the last `days_window` days (all firm members, 0 for inactive)

    member_ids: restrict queries to these user IDs; if None, shows all
    user_info_map: {user_id_str -> {display_name, username, auth_type, role} or str} for the team activity table
    """
    conn = get_pg_conn()
    _empty = {
        "summary": {"total_queries": 0, "total_citations": 0, "total_time_saved_minutes": 0, "active_users": 0},
        "volume_trend": [],
        "team_activity": [],
    }
    if not conn:
        return _empty
    days_window = max(1, min(int(days_window or 30), 365))
    months = max(1, min(int(months or 6), 24))
    user_info_map = user_info_map or {}

    def _user_info(uid_str: str) -> Dict[str, Any]:
        raw = user_info_map.get(str(uid_str))
        if isinstance(raw, dict):
            return {
                "display_name": raw.get("display_name") or raw.get("username") or uid_str,
                "username": raw.get("username") or raw.get("display_name") or uid_str,
                "auth_type": raw.get("auth_type") or "—",
                "role": raw.get("role") or "—",
            }
        display = str(raw) if raw else uid_str
        return {"display_name": display, "username": display, "auth_type": "—", "role": "—"}

    # Build optional WHERE fragment to scope to firm members
    def _member_filter(alias: str = "") -> tuple:
        """Returns (extra_where_clause, params_list). alias e.g. 'u.' """
        col = f"{alias}user_id"
        if member_ids:
            placeholders = ",".join(["%s"] * len(member_ids))
            return f"AND {col} = ANY(ARRAY[{placeholders}]::text[])", list(member_ids)
        return "", []

    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            mf, mp = _member_filter()

            # Summary (last N days)
            cur.execute(
                f"""
                SELECT
                    COALESCE(SUM(queries_count), 0) AS total_queries,
                    COALESCE(SUM(citations_generated), 0) AS total_citations,
                    COALESCE(SUM(time_saved_minutes), 0) AS total_time_saved_minutes,
                    COUNT(DISTINCT user_id) AS active_users
                FROM usage_analytics_daily
                WHERE usage_date >= CURRENT_DATE - (%s::int - 1) * INTERVAL '1 day'
                {mf}
                """,
                [days_window] + mp,
            )
            summary = cur.fetchone() or _empty["summary"]

            # Volume trend (last N months)
            cur.execute(
                f"""
                SELECT
                    DATE_TRUNC('month', usage_date)::date AS month_start,
                    SUM(queries_count) AS queries,
                    SUM(citations_generated) AS citations
                FROM usage_analytics_daily
                WHERE usage_date >= (DATE_TRUNC('month', CURRENT_DATE) - (%s::int - 1) * INTERVAL '1 month')
                {mf}
                GROUP BY month_start
                ORDER BY month_start
                """,
                [months] + mp,
            )
            volume_rows = cur.fetchall() or []
            volume_trend: List[Dict[str, Any]] = []
            for r in volume_rows:
                month_start = r["month_start"]
                volume_trend.append({
                    "month_start": month_start.isoformat(),
                    "label": month_start.strftime("%b"),
                    "queries": int(r["queries"] or 0),
                    "citations": int(r["citations"] or 0),
                })

            # Team activity — aggregate activity rows
            cur.execute(
                f"""
                SELECT
                    user_id,
                    SUM(queries_count) AS queries,
                    SUM(citations_generated) AS citations,
                    SUM(time_saved_minutes) AS time_saved_minutes
                FROM usage_analytics_daily
                WHERE usage_date >= CURRENT_DATE - (%s::int - 1) * INTERVAL '1 day'
                {mf}
                GROUP BY user_id
                ORDER BY SUM(queries_count) DESC
                LIMIT 100
                """,
                [days_window] + mp,
            )
            activity_rows = {r["user_id"]: r for r in (cur.fetchall() or [])}

            # Build final team_activity: include ALL firm members, 0 for those with no activity
            team_activity: List[Dict[str, Any]] = []
            seen_ids = set()

            # First, fill from activity rows (has real data)
            for uid_str, r in activity_rows.items():
                seen_ids.add(str(uid_str))
                info = _user_info(str(uid_str))
                team_activity.append({
                    "user_id": str(uid_str),
                    "display_name": info["display_name"],
                    "username": info["username"],
                    "auth_type": info["auth_type"],
                    "role": info["role"],
                    "queries": int(r["queries"] or 0),
                    "citations": int(r["citations"] or 0),
                    "time_saved_minutes": int(r["time_saved_minutes"] or 0),
                })

            # Then, add members with zero activity (only if member_ids provided)
            for mid in (member_ids or []):
                if str(mid) not in seen_ids:
                    info = _user_info(str(mid))
                    team_activity.append({
                        "user_id": str(mid),
                        "display_name": info["display_name"],
                        "username": info["username"],
                        "auth_type": info["auth_type"],
                        "role": info["role"],
                        "queries": 0,
                        "citations": 0,
                        "time_saved_minutes": 0,
                    })

            # Sort: active users first, then alphabetically by display_name
            team_activity.sort(key=lambda x: (-x["queries"], (x["display_name"] or "").lower()))

        return {
            "summary": summary,
            "volume_trend": volume_trend,
            "team_activity": team_activity,
        }
    finally:
        conn.close()


def report_update(
    report_id: str,
    report_format: Optional[Dict[str, Any]] = None,
    status: Optional[str] = None,
    hitl_pending_count: Optional[int] = None,
    hitl_approved_count: Optional[int] = None,
    dimensions_metadata: Optional[List[Dict[str, Any]]] = None,
) -> None:
    """Update report after HITL approvals or status change."""
    conn = get_pg_conn()
    if not conn:
        return
    try:
        with conn.cursor() as cur:
            updates, vals = [], []
            if report_format is not None:
                updates.append("report_format = %s"); vals.append(Json(report_format))
            if dimensions_metadata is not None:
                updates.append("dimensions_metadata = %s"); vals.append(Json(dimensions_metadata))
            if status is not None:
                updates.append("status = %s"); vals.append(status)
            if hitl_pending_count is not None:
                updates.append("hitl_pending_count = %s"); vals.append(hitl_pending_count)
            if hitl_approved_count is not None:
                updates.append("hitl_approved_count = %s"); vals.append(hitl_approved_count)
            if not updates:
                return
            updates.append("updated_at = NOW()")
            vals.append(report_id)
            cur.execute(
                f"UPDATE citation_reports SET {', '.join(updates)} WHERE id = %s",
                vals,
            )
        conn.commit()
    finally:
        conn.close()


def report_get(report_id: str) -> Optional[Dict[str, Any]]:
    conn = get_pg_conn()
    if not conn:
        return None
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT id, user_id, query, report_format, created_at, status, case_id, citation_count,
                       dimensions_metadata, run_id, hitl_pending_count, hitl_approved_count, citations_approved_count,
                       citations_quarantined_count, updated_at, shared_with
                  FROM citation_reports
                 WHERE id = %s
                """,
                (report_id,),
            )
            row = cur.fetchone()
            return dict(row) if row else None
    finally:
        conn.close()


def report_delete(report_id: str, user_id: Optional[str] = None) -> bool:
    """
    Delete a citation report and its related rows (report_citations, hitl_queue).
    If user_id is provided, only deletes when the report belongs to that user.
    Returns True if deleted, False if not found or ownership check failed.
    """
    conn = get_pg_conn()
    if not conn:
        return False
    try:
        with conn.cursor() as cur:
            if user_id is not None:
                cur.execute("SELECT id FROM citation_reports WHERE id = %s AND user_id = %s", (report_id, user_id))
                if not cur.fetchone():
                    return False
            cur.execute("DELETE FROM report_citations WHERE report_id = %s", (report_id,))
            cur.execute("DELETE FROM hitl_queue WHERE report_id = %s", (report_id,))
            cur.execute("DELETE FROM citation_reports WHERE id = %s", (report_id,))
            deleted = cur.rowcount
        conn.commit()
        return deleted > 0
    finally:
        conn.close()


def report_share(report_id: str, shared_with: List[Dict[str, Any]]) -> bool:
    """
    Overwrite the shared_with list for a report.
    Each entry: {user_id, email, username, shared_at}.
    Returns True on success.
    """
    import json as _json
    conn = get_pg_conn()
    if not conn:
        return False
    try:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE citation_reports SET shared_with = %s WHERE id = %s",
                (_json.dumps(shared_with), report_id),
            )
            updated = cur.rowcount
        conn.commit()
        return updated > 0
    finally:
        conn.close()


def report_get_shares(report_id: str) -> List[Dict[str, Any]]:
    """Return the shared_with list for a report."""
    conn = get_pg_conn()
    if not conn:
        return []
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                "SELECT shared_with FROM citation_reports WHERE id = %s",
                (report_id,),
            )
            row = cur.fetchone()
            if not row:
                return []
            return row["shared_with"] or []
    finally:
        conn.close()


def report_list_by_user(user_id: str, limit: int = 50) -> List[Dict[str, Any]]:
    import json as _json
    conn = get_pg_conn()
    if not conn:
        return []
    # Build JSONB containment filter to also find reports shared with this user
    shared_filter = _json.dumps([{"user_id": str(user_id)}])
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT id, user_id, query, created_at, status, case_id, citation_count,
                       hitl_pending_count, shared_with
                  FROM citation_reports
                 WHERE user_id = %s
                    OR (shared_with IS NOT NULL AND shared_with @> %s::jsonb)
                 ORDER BY created_at DESC
                 LIMIT %s
                """,
                (user_id, shared_filter, limit),
            )
            return cur.fetchall()
    finally:
        conn.close()


def report_list_firm_shared(member_ids: List[str], limit: int = 100, case_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """
    FIRM_ADMIN only: returns all reports from firm members that have been shared with anyone.
    Scoped to reports owned by any of the given member_ids.
    If case_id provided, filter to reports for that case.
    """
    conn = get_pg_conn()
    if not conn:
        return []
    if not member_ids:
        return []
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            placeholders = ",".join(["%s"] * len(member_ids))
            case_filter = " AND case_id = %s" if case_id else ""
            params = list(member_ids) + ([case_id] if case_id else []) + [limit]
            cur.execute(
                f"""
                SELECT id, user_id, query, created_at, status, case_id, citation_count,
                       hitl_pending_count, shared_with
                  FROM citation_reports
                 WHERE user_id = ANY(ARRAY[{placeholders}]::text[])
                   AND shared_with IS NOT NULL
                   AND jsonb_array_length(shared_with) > 0
                   {case_filter}
                 ORDER BY created_at DESC
                 LIMIT %s
                """,
                params,
            )
            return cur.fetchall()
    finally:
        conn.close()


def report_list_shared_with_members(
    member_ids: List[str], limit: int = 100, case_id: Optional[str] = None
) -> List[Dict[str, Any]]:
    """
    Returns reports shared with any of the given member_ids (even if owner is outside the firm).
    Uses EXISTS + jsonb_array_elements for reliable string/int user_id matching.
    If case_id provided, filter to reports for that case.
    """
    conn = get_pg_conn()
    if not conn:
        return []
    if not member_ids:
        return []
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            # Use EXISTS with OR to match any member (avoids JSONB containment type mismatch)
            case_filter = " AND r.case_id = %s" if case_id else ""
            params = list(member_ids) + ([case_id] if case_id else []) + [limit]
            placeholders = ",".join(["%s"] * len(member_ids))
            cur.execute(
                f"""
                SELECT r.id, r.user_id, r.query, r.created_at, r.status, r.case_id, r.citation_count,
                       r.hitl_pending_count, r.shared_with
                  FROM citation_reports r
                 WHERE r.shared_with IS NOT NULL
                   AND jsonb_array_length(r.shared_with) > 0
                   AND EXISTS (
                     SELECT 1 FROM jsonb_array_elements(r.shared_with) elem
                     WHERE elem->>'user_id' = ANY(ARRAY[{placeholders}]::text[])
                   )
                   {case_filter}
                 ORDER BY r.created_at DESC
                 LIMIT %s
                """,
                params,
            )
            return cur.fetchall()
    finally:
        conn.close()


def report_list_by_case(case_id: str, user_id: Optional[str] = None, limit: int = 50) -> List[Dict[str, Any]]:
    """
    List citation reports for a case. When user_id is provided, returns:
    - Reports owned by that user for this case
    - Reports shared with that user for this case
    """
    import json as _json
    conn = get_pg_conn()
    if not conn:
        return []
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            if user_id:
                shared_filter = _json.dumps([{"user_id": str(user_id)}])
                cur.execute(
                    """
                    SELECT id, user_id, query, created_at, status, case_id, citation_count, hitl_pending_count, shared_with
                      FROM citation_reports
                     WHERE case_id = %s
                       AND (user_id = %s OR (shared_with IS NOT NULL AND shared_with @> %s::jsonb))
                     ORDER BY created_at DESC
                     LIMIT %s
                    """,
                    (case_id, user_id, shared_filter, limit),
                )
            else:
                cur.execute(
                    """
                    SELECT id, user_id, query, created_at, status, case_id, citation_count, hitl_pending_count
                      FROM citation_reports
                     WHERE case_id = %s
                     ORDER BY created_at DESC
                     LIMIT %s
                    """,
                    (case_id, limit),
                )
            return cur.fetchall()
    finally:
        conn.close()


# --- Pipeline runs ---

def pipeline_run_insert(
    run_id: str,
    user_id: str,
    query: str,
    case_id: Optional[str] = None,
) -> str:
    conn = get_pg_conn()
    if not conn:
        raise RuntimeError("PostgreSQL unavailable for pipeline_run_insert")
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO citation_pipeline_runs (id, user_id, case_id, query, status)
                VALUES (%s, %s, %s, %s, 'running')
                """,
                (run_id, user_id, case_id, query),
            )
        conn.commit()
        return run_id
    finally:
        conn.close()


def pipeline_run_update(
    run_id: str,
    status: str,
    report_id: Optional[str] = None,
    citations_fetched_count: Optional[int] = None,
    citations_approved_count: Optional[int] = None,
    citations_quarantined_count: Optional[int] = None,
    citations_sent_to_hitl_count: Optional[int] = None,
    error_message: Optional[str] = None,
) -> None:
    conn = get_pg_conn()
    if not conn:
        return
    try:
        with conn.cursor() as cur:
            updates = ["status = %s", "completed_at = NOW()"]
            vals = [status]
            if report_id is not None:
                updates.append("report_id = %s"); vals.append(report_id)
            if citations_fetched_count is not None:
                updates.append("citations_fetched_count = %s"); vals.append(citations_fetched_count)
            if citations_approved_count is not None:
                updates.append("citations_approved_count = %s"); vals.append(citations_approved_count)
            if citations_quarantined_count is not None:
                updates.append("citations_quarantined_count = %s"); vals.append(citations_quarantined_count)
            if citations_sent_to_hitl_count is not None:
                updates.append("citations_sent_to_hitl_count = %s"); vals.append(citations_sent_to_hitl_count)
            if error_message is not None:
                updates.append("error_message = %s"); vals.append(error_message)
            vals.append(run_id)
            cur.execute(f"UPDATE citation_pipeline_runs SET {', '.join(updates)} WHERE id = %s", vals)
        conn.commit()
    finally:
        conn.close()


def pipeline_run_get_user_id(run_id: str) -> Optional[str]:
    """Return user_id for a pipeline run (for admin access checks)."""
    conn = get_pg_conn()
    if not conn:
        return None
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT user_id FROM citation_pipeline_runs WHERE id = %s LIMIT 1",
                (run_id,),
            )
            row = cur.fetchone()
            if row and row[0] is not None:
                return str(row[0])
    except Exception:
        pass
    finally:
        conn.close()
    return None


# --- Citation service usage tracking ---

def usage_record_insert(
    run_id: Optional[str],
    user_id: str,
    service: str,
    operation: str,
    quantity: int,
    unit: str = "calls",
    cost_inr: float = 0,
    cost_usd: float = 0,
    metadata: Optional[Dict[str, Any]] = None,
    user_display_name: Optional[str] = None,
    username: Optional[str] = None,
) -> None:
    conn = get_pg_conn()
    if not conn:
        return
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO citation_service_usage
                  (run_id, user_id, user_display_name, username, service, operation, quantity, unit, cost_inr, cost_usd, metadata)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    run_id,
                    user_id or "anonymous",
                    user_display_name if (user_display_name and str(user_display_name).strip()) else None,
                    username if (username and str(username).strip()) else None,
                    service,
                    operation or "",
                    quantity,
                    unit,
                    cost_inr,
                    cost_usd,
                    Json(metadata) if metadata else None,
                ),
            )
        conn.commit()
    except Exception as exc:
        logger.warning("[USAGE] usage_record_insert failed: %s", exc)
    finally:
        conn.close()


def usage_get_by_run(run_id: str) -> List[Dict[str, Any]]:
    conn = get_pg_conn()
    if not conn:
        return []
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT id, run_id, user_id, user_display_name, username, service, operation, quantity, unit, cost_inr, cost_usd, metadata, created_at
                  FROM citation_service_usage
                 WHERE run_id = %s
                 ORDER BY created_at ASC
                """,
                (run_id,),
            )
            rows = cur.fetchall()
            return [dict(r) for r in rows]
    finally:
        conn.close()


def usage_get_aggregate(
    days: int = 30,
    user_ids: Optional[List[str]] = None,
    service_filter: Optional[str] = None,
) -> Dict[str, Any]:
    conn = get_pg_conn()
    _empty = {
        "total_cost_inr": 0,
        "total_cost_usd": 0,
        "total_queries": 0,
        "by_service": {},
    }
    if not conn:
        return _empty
    days = max(1, min(int(days or 30), 365))
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            mf = ""
            mp = [days]
            if user_ids:
                placeholders = ",".join(["%s"] * len(user_ids))
                mf = f" AND user_id = ANY(ARRAY[{placeholders}]::text[])"
                mp.extend(user_ids)
            if service_filter:
                mf += " AND service = %s"
                mp.append(service_filter)

            cur.execute(
                f"""
                SELECT
                    COALESCE(SUM(cost_inr), 0) AS total_cost_inr,
                    COALESCE(SUM(cost_usd), 0) AS total_cost_usd,
                    COUNT(DISTINCT run_id) FILTER (WHERE run_id IS NOT NULL) AS total_runs
                  FROM citation_service_usage
                 WHERE created_at >= NOW() - (%s::int * INTERVAL '1 day')
                 {mf}
                """,
                mp,
            )
            row = cur.fetchone() or {}
            total_cost_inr = float(row.get("total_cost_inr") or 0)
            total_cost_usd = float(row.get("total_cost_usd") or 0)
            total_runs = int(row.get("total_runs") or 0)

            cur.execute(
                f"""
                SELECT service,
                       COALESCE(SUM(quantity), 0) AS total_quantity,
                       COALESCE(SUM(cost_inr), 0) AS cost_inr,
                       COALESCE(SUM(cost_usd), 0) AS cost_usd,
                       COUNT(*) AS record_count
                  FROM citation_service_usage
                 WHERE created_at >= NOW() - (%s::int * INTERVAL '1 day')
                 {mf}
                 GROUP BY service
                """,
                mp,
            )
            by_service = {}
            for r in cur.fetchall() or []:
                svc = r.get("service") or "unknown"
                by_service[svc] = {
                    "total_quantity": int(r.get("total_quantity") or 0),
                    "cost_inr": float(r.get("cost_inr") or 0),
                    "cost_usd": float(r.get("cost_usd") or 0),
                    "record_count": int(r.get("record_count") or 0),
                }

            return {
                "total_cost_inr": total_cost_inr,
                "total_cost_usd": total_cost_usd,
                "total_queries": total_runs,
                "by_service": by_service,
            }
    finally:
        conn.close()


def usage_get_user_breakdown(
    days: int = 30,
    user_ids: Optional[List[str]] = None,
) -> List[Dict[str, Any]]:
    conn = get_pg_conn()
    if not conn:
        return []
    days = max(1, min(int(days or 30), 365))
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            mf = ""
            mp = [days]
            if user_ids:
                placeholders = ",".join(["%s"] * len(user_ids))
                mf = f" AND user_id = ANY(ARRAY[{placeholders}]::text[])"
                mp.extend(user_ids)

            cur.execute(
                f"""
                SELECT user_id,
                       MAX(NULLIF(TRIM(user_display_name), '')) AS user_display_name,
                       MAX(NULLIF(TRIM(username), '')) AS username,
                       COALESCE(SUM(cost_inr), 0) AS total_cost_inr,
                       COALESCE(SUM(cost_usd), 0) AS total_cost_usd,
                       COUNT(DISTINCT run_id) FILTER (WHERE run_id IS NOT NULL) AS runs
                  FROM citation_service_usage
                 WHERE created_at >= NOW() - (%s::int * INTERVAL '1 day')
                 {mf}
                 GROUP BY user_id
                 ORDER BY SUM(cost_inr) DESC
                 LIMIT 200
                """,
                mp,
            )
            rows = cur.fetchall() or []

            result = []
            for r in rows:
                uid = r.get("user_id") or "unknown"
                by_svc_sql = """
                    SELECT service,
                           COALESCE(SUM(cost_inr), 0) AS cost_inr,
                           COALESCE(SUM(cost_usd), 0) AS cost_usd,
                           COALESCE(SUM(quantity), 0) AS quantity
                      FROM citation_service_usage
                     WHERE created_at >= NOW() - (%s::int * INTERVAL '1 day') AND user_id = %s
                     GROUP BY service
                """
                cur.execute(by_svc_sql, (days, uid))
                by_service = {
                    (srow.get("service") or "unknown"): {
                        "cost_inr": float(srow.get("cost_inr") or 0),
                        "cost_usd": float(srow.get("cost_usd") or 0),
                        "quantity": int(srow.get("quantity") or 0),
                    }
                    for srow in (cur.fetchall() or [])
                }
                result.append({
                    "user_id": uid,
                    "user_display_name": r.get("user_display_name") or "",
                    "username": r.get("username") or "",
                    "total_cost_inr": float(r.get("total_cost_inr") or 0),
                    "total_cost_usd": float(r.get("total_cost_usd") or 0),
                    "runs": int(r.get("runs") or 0),
                    "by_service": by_service,
                })
            return result
    finally:
        conn.close()


# --- Agent logs ---

def agent_log_insert(
    run_id: Optional[str],
    report_id: Optional[str],
    agent_name: str,
    stage: str,
    log_level: str,
    message: str,
    metadata: Optional[Dict[str, Any]] = None,
) -> None:
    conn = get_pg_conn()
    if not conn:
        return
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO agent_logs (run_id, report_id, agent_name, stage, log_level, message, metadata)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                """,
                (run_id, report_id, agent_name, stage, log_level, message[:10000], Json(metadata) if metadata else None),
            )
        conn.commit()
    finally:
        conn.close()


def agent_logs_by_run(run_id: str, limit: int = 500) -> List[Dict[str, Any]]:
    conn = get_pg_conn()
    if not conn:
        return []
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT id, run_id, report_id, agent_name, stage, log_level, message, metadata, created_at
                  FROM agent_logs
                 WHERE run_id = %s
                 ORDER BY created_at ASC
                 LIMIT %s
                """,
                (run_id, limit),
            )
            return cur.fetchall()
    finally:
        conn.close()


# --- HITL queue ---

def hitl_queue_insert(
    report_id: Optional[str],
    run_id: Optional[str],
    canonical_id: str,
    user_id: str,
    citation_snapshot: Dict[str, Any],
    reason_queued: str = "unverified",
    case_id: Optional[str] = None,
    citation_string: Optional[str] = None,
    query_context: Optional[str] = None,
    web_source_url: Optional[str] = None,
    priority_score: float = 0.0,
) -> Optional[str]:
    """Insert one HITL row. Returns new row id, or None if PostgreSQL is unavailable or insert failed."""
    conn = get_pg_conn()
    if not conn:
        logger.warning("[hitl_queue_insert] PostgreSQL unavailable — skipping (canonical_id=%s)", canonical_id)
        return None
    try:
        pk_col = _resolve_hitl_pk_column(conn)
        with conn.cursor() as cur:
            cur.execute(
                f"""
                INSERT INTO hitl_queue (
                    report_id, run_id, canonical_id, user_id,
                    citation_snapshot, reason_queued, case_id,
                    citation_string, query_context, web_source_url, priority_score
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING {pk_col}
                """,
                (
                    report_id or None, run_id, canonical_id, user_id,
                    Json(citation_snapshot), reason_queued, case_id,
                    citation_string, query_context, web_source_url, round(float(priority_score or 0), 3),
                ),
            )
            row = cur.fetchone()
        conn.commit()
        return str(row[0]) if row else None
    except Exception as exc:
        logger.warning("[hitl_queue_insert] failed (canonical_id=%s): %s", canonical_id, exc)
        return None
    finally:
        conn.close()


def hitl_enqueue_citations_from_report(
    report_id: Optional[str],
    run_id: Optional[str],
    user_id: str,
    report_format: Dict[str, Any],
    query: str,
    case_id: Optional[str] = None,
) -> int:
    """
    For each citation in report_format that is not fully auto-validated, insert hitl_queue.
    Mutates citation dicts in-place with hitlTicketId when a row is created.
    Returns number of rows inserted.
    """
    if not isinstance(report_format, dict):
        return 0
    cits = report_format.get("citations") or []
    if not cits:
        return 0
    inserted = 0
    UNVERIFIED = frozenset({"RED", "YELLOW", "PENDING", "STALE"})
    for cit in cits:
        if not isinstance(cit, dict):
            continue
        vs = (cit.get("verificationStatus") or "").strip()
        if vs not in UNVERIFIED:
            continue
        if cit.get("hitlTicketId"):
            continue
        ps = float(cit.get("priorityScore") or 0)
        if vs == "PENDING":
            reason = "web_unverified"
        elif vs == "YELLOW":
            reason = "needs_review"
        elif vs == "STALE":
            reason = "stale_or_outdated"
        else:
            reason = "verification_failed"
        cit_string = cit.get("primaryCitation") or cit.get("caseName") or ""
        web_url = (
            cit.get("importSourceLink")
            or cit.get("sourceUrl")
            or cit.get("officialSourceLink")
            or ""
        )
        try:
            tid = hitl_queue_insert(
                report_id=report_id or None,
                run_id=run_id,
                canonical_id=str(cit.get("canonicalId") or cit.get("id") or "unknown"),
                user_id=user_id or "anonymous",
                citation_snapshot={
                    **cit,
                    "priorityScore": ps,
                    "queryContext": (query or "")[:300],
                    "requestUserId": user_id or "anonymous",
                },
                reason_queued=reason,
                case_id=case_id,
                citation_string=cit_string[:512] if cit_string else None,
                query_context=(query or "")[:2000] if query else None,
                web_source_url=web_url[:2000] if web_url else None,
                priority_score=ps,
            )
            if tid:
                cit["hitlTicketId"] = tid
                inserted += 1
        except Exception as exc:
            logger.warning("[hitl_enqueue_citations_from_report] row failed: %s", exc)
    return inserted


def hitl_queue_list_by_report(report_id: str, status: Optional[str] = None) -> List[Dict[str, Any]]:
    conn = get_pg_conn()
    if not conn:
        return []
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            if status:
                cur.execute(
                    "SELECT * FROM hitl_queue WHERE report_id = %s AND status = %s ORDER BY created_at",
                    (report_id, status),
                )
            else:
                cur.execute("SELECT * FROM hitl_queue WHERE report_id = %s ORDER BY created_at", (report_id,))
            return cur.fetchall()
    finally:
        conn.close()


def hitl_queue_pending_count(report_id: str) -> int:
    conn = get_pg_conn()
    if not conn:
        return 0
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM hitl_queue WHERE report_id = %s AND status = 'pending'", (report_id,))
            return cur.fetchone()[0] or 0
    finally:
        conn.close()


def hitl_queue_update_status(
    hitl_id: str,
    status: str,
    reviewed_by: Optional[str] = None,
) -> None:
    conn = get_pg_conn()
    if not conn:
        return
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE hitl_queue SET status = %s, reviewed_at = NOW(), reviewed_by = %s, updated_at = NOW()
                WHERE id = %s
                """,
                (status, reviewed_by, hitl_id),
            )
        conn.commit()
    finally:
        conn.close()


def hitl_queue_get_report_id(hitl_id: str) -> Optional[str]:
    conn = get_pg_conn()
    if not conn:
        return None
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT report_id FROM hitl_queue WHERE id = %s", (hitl_id,))
            row = cur.fetchone()
            return str(row[0]) if row else None
    finally:
        conn.close()


# --- Report citations (per-citation tracking) ---

def report_citation_insert(
    report_id: str,
    canonical_id: str,
    status: str,
    citation_snapshot: Optional[Dict[str, Any]] = None,
    hitl_queue_id: Optional[str] = None,
) -> None:
    conn = get_pg_conn()
    if not conn:
        return
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO report_citations (report_id, canonical_id, status, citation_snapshot, hitl_queue_id)
                VALUES (%s, %s, %s, %s, %s)
                """,
                (report_id, canonical_id, status, Json(citation_snapshot) if citation_snapshot else None, hitl_queue_id),
            )
        conn.commit()
    finally:
        conn.close()


# ─── Indian Kanoon document assets ────────────────────────────────────────────

def ik_asset_upsert(
    doc_id: str,
    canonical_id: Optional[str] = None,
    meta: Optional[Dict] = None,
    fragments: Optional[Dict] = None,
    cite_list: Optional[List] = None,
    cited_by_list: Optional[List] = None,
    orig_doc_url: Optional[str] = None,
    orig_doc_gcs_path: Optional[str] = None,
    orig_doc_content_type: Optional[str] = None,
    raw_api_response: Optional[Dict] = None,
    title: Optional[str] = None,
    docsource: Optional[str] = None,
    doc_char_count: Optional[int] = None,
) -> None:
    """
    Insert or update the IK asset record for a given doc_id.
    Stores ALL IK API responses (doc, fragment, meta, origdoc) in raw_api_response JSONB
    for cache reuse on subsequent queries.
    Also mirrors orig_doc_url, ik_fragments, ik_cite_list, ik_cited_by_list,
    and ik_doc_meta into the judgments row (by canonical_id) for report builder access.
    """
    doc_id = (doc_id or "").strip()
    if not doc_id:
        return
    conn = get_pg_conn()
    if not conn:
        return
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO ik_document_assets
                    (doc_id, canonical_id, meta, fragments, cite_list, cited_by_list,
                     orig_doc_url, orig_doc_gcs_path, orig_doc_content_type,
                     raw_api_response, title, docsource, doc_char_count, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
                ON CONFLICT (doc_id) DO UPDATE SET
                    canonical_id          = COALESCE(EXCLUDED.canonical_id, ik_document_assets.canonical_id),
                    meta                  = COALESCE(EXCLUDED.meta, ik_document_assets.meta),
                    fragments             = COALESCE(EXCLUDED.fragments, ik_document_assets.fragments),
                    cite_list             = COALESCE(EXCLUDED.cite_list, ik_document_assets.cite_list),
                    cited_by_list         = COALESCE(EXCLUDED.cited_by_list, ik_document_assets.cited_by_list),
                    orig_doc_url          = COALESCE(EXCLUDED.orig_doc_url, ik_document_assets.orig_doc_url),
                    orig_doc_gcs_path     = COALESCE(EXCLUDED.orig_doc_gcs_path, ik_document_assets.orig_doc_gcs_path),
                    orig_doc_content_type = COALESCE(EXCLUDED.orig_doc_content_type, ik_document_assets.orig_doc_content_type),
                    raw_api_response      = COALESCE(EXCLUDED.raw_api_response, ik_document_assets.raw_api_response),
                    title                 = COALESCE(EXCLUDED.title, ik_document_assets.title),
                    docsource             = COALESCE(EXCLUDED.docsource, ik_document_assets.docsource),
                    doc_char_count        = COALESCE(EXCLUDED.doc_char_count, ik_document_assets.doc_char_count),
                    updated_at            = NOW()
                """,
                (
                    doc_id,
                    canonical_id,
                    Json(meta) if meta else None,
                    Json(fragments) if fragments else None,
                    Json(cite_list) if cite_list else None,
                    Json(cited_by_list) if cited_by_list else None,
                    orig_doc_url or None,
                    orig_doc_gcs_path or None,
                    orig_doc_content_type or None,
                    Json(raw_api_response) if raw_api_response else None,
                    title or None,
                    docsource or None,
                    doc_char_count or None,
                ),
            )
            # Mirror to judgments table if canonical_id provided
            if canonical_id:
                cur.execute(
                    """
                    UPDATE judgments SET
                        ik_orig_doc_url    = COALESCE(%s, ik_orig_doc_url),
                        ik_fragments       = COALESCE(%s, ik_fragments),
                        ik_cite_list       = COALESCE(%s, ik_cite_list),
                        ik_cited_by_list   = COALESCE(%s, ik_cited_by_list),
                        ik_doc_meta        = COALESCE(%s, ik_doc_meta)
                    WHERE canonical_id = %s
                    """,
                    (
                        orig_doc_url or None,
                        Json(fragments) if fragments else None,
                        Json(cite_list) if cite_list else None,
                        Json(cited_by_list) if cited_by_list else None,
                        Json(meta) if meta else None,
                        canonical_id,
                    ),
                )
        conn.commit()
    except Exception as exc:
        logger.warning("[DB] ik_asset_upsert failed for doc_id=%s: %s", doc_id, exc)
        try:
            conn.rollback()
        except Exception:
            pass
    finally:
        conn.close()


def ik_asset_get(doc_id: str, increment_hit: bool = False) -> Optional[Dict]:
    """Retrieve stored IK asset for a doc_id. Optionally increments cache_hit_count."""
    doc_id = (doc_id or "").strip()
    if not doc_id:
        return None
    conn = get_pg_conn()
    if not conn:
        return None
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                "SELECT * FROM ik_document_assets WHERE doc_id = %s LIMIT 1",
                (doc_id,),
            )
            row = cur.fetchone()
            if row and increment_hit:
                try:
                    cur.execute(
                        "UPDATE ik_document_assets SET cache_hit_count = COALESCE(cache_hit_count,0) + 1 WHERE doc_id = %s",
                        (doc_id,),
                    )
                    conn.commit()
                except Exception:
                    pass
            return dict(row) if row else None
    finally:
        conn.close()


def ik_asset_list_recent(limit: int = 50) -> List[Dict]:
    """List recently stored IK assets for admin/debug view."""
    conn = get_pg_conn()
    if not conn:
        return []
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """SELECT doc_id, canonical_id, title, docsource, doc_char_count,
                          orig_doc_url, cache_hit_count, created_at, updated_at
                     FROM ik_document_assets
                    ORDER BY updated_at DESC NULLS LAST
                    LIMIT %s""",
                (limit,),
            )
            return [dict(r) for r in cur.fetchall()]
    finally:
        conn.close()
