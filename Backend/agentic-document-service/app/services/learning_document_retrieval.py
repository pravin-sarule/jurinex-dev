"""
Document chunk retrieval for Learning Mode (vector + optional neighbor context).

Uses the same DB-backed embeddings path as grounded folder chat.
"""

from __future__ import annotations

import logging
import re
import time
from typing import Any

from app.schemas.contracts import QueryRequest
from app.services.container import get_pipeline_service
from app.services.db import get_db_connection, is_db_available

logger = logging.getLogger("agentic_document_service.learning_document_retrieval")

_CACHE: dict[tuple[Any, ...], tuple[float, list[dict[str, Any]]]] = {}
_CACHE_TTL_S = 45.0
_CACHE_MAX = 48


def _cache_get(key: tuple[Any, ...]) -> list[dict[str, Any]] | None:
    now = time.monotonic()
    hit = _CACHE.get(key)
    if not hit:
        return None
    ts, rows = hit
    if now - ts > _CACHE_TTL_S:
        _CACHE.pop(key, None)
        return None
    return rows


def _cache_set(key: tuple[Any, ...], rows: list[dict[str, Any]]) -> None:
    if len(_CACHE) >= _CACHE_MAX:
        oldest = sorted(_CACHE.items(), key=lambda kv: kv[1][0])[:8]
        for k, _ in oldest:
            _CACHE.pop(k, None)
    _CACHE[key] = (time.monotonic(), rows)


def _rewrite_query_for_embedding(raw: str) -> str:
    text = (raw or "").strip()
    if not text:
        return text
    lower = text.lower()
    marker = "current question:"
    if marker in lower:
        idx = lower.rfind(marker)
        return text[idx + len(marker) :].strip()
    return text


def _neighbor_rows_batch(hits: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Fetch the ±1 neighbours of EVERY hit in ONE query on ONE connection.

    This used to run per hit: with top_k=12 that opened 12 separate psycopg connections to
    the remote DB, and since there is no connection pool each one paid a full TCP+TLS+auth
    handshake — several times the cost of the query itself. The draft path calls retrieval
    dozens of times (per facet, per section), so the handshakes dominated retrieval latency.
    One batched row-constructor IN (...) returns exactly the same rows.
    """
    if not is_db_available():
        return []
    # (file_id, chunk_index±1) pairs, deduped — several hits in one file share neighbours.
    pairs: set[tuple[str, int]] = set()
    for row in hits:
        fid = str(row.get("file_id") or "")
        cidx = row.get("chunk_index")
        if not fid or cidx is None:
            continue
        try:
            ci = int(cidx)
        except (TypeError, ValueError):
            continue
        for nb in (ci - 1, ci + 1):
            if nb >= 0:
                pairs.add((fid, nb))
    if not pairs:
        return []

    ordered = sorted(pairs)
    placeholders = ", ".join(["(%s, %s)"] * len(ordered))
    params: list[Any] = []
    for fid, nb in ordered:
        params.extend((fid, nb))
    try:
        with get_db_connection() as conn, conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT
                  fc.id::text AS chunk_id,
                  fc.content,
                  fc.file_id,
                  COALESCE(uf.originalname, fc.file_id::text) AS document_name,
                  fc.page_start,
                  fc.page_end,
                  COALESCE(fc.heading, '') AS section_title,
                  fc.chunk_index,
                  0.0::float AS similarity
                FROM file_chunks fc
                LEFT JOIN user_files uf ON uf.id::text = fc.file_id::text
                WHERE (fc.file_id::text, fc.chunk_index) IN ({placeholders})
                ORDER BY fc.file_id, fc.chunk_index ASC
                """,
                params,
            )
            return list(cur.fetchall())
    except Exception as exc:
        logger.warning(
            "[learning_document_retrieval] batched neighbor fetch failed (%d pair(s)): %s",
            len(ordered),
            exc,
        )
        return []


def get_relevant_chunks(
    *,
    user_id: str,
    case_id: str,
    query: str,
    file_ids: list[str],
    top_k: int = 5,
    include_surrounding_chunks: bool = True,
    similarity_floor: float = 0.55,
    filter_by_section: str | None = None,
    filter_by_page_range: tuple[int, int] | None = None,
) -> list[dict[str, Any]]:
    """
    Return normalized chunk dicts for agent context.

    Each item:
      chunk_id, source_id, content, page_number (int or None), section_title, metadata, similarity_score
    """
    q = _rewrite_query_for_embedding(query)
    if not q.strip() or not file_ids:
        return []

    cache_key = (
        user_id,
        case_id,
        q[:512],
        tuple(sorted(file_ids))[:40],
        top_k,
        include_surrounding_chunks,
        round(similarity_floor, 2),
        (filter_by_section or "")[:80],
        filter_by_page_range,
    )
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    pipeline = get_pipeline_service()
    req = QueryRequest(user_id=user_id, case_id=case_id, query=q)
    # Ceiling was 12, which silently clamped every caller — a broad/comprehensive chat asks for
    # top_k=30 to fill the model's context budget, but got only 12 primary chunks (~a sliver of a
    # 1,600-chunk case), starving input and answers. Honour the caller's top_k up to 48 (narrow
    # asks and learning mode pass <=12, so they are unchanged). The underlying hybrid retriever
    # respects top_k; the downstream char budget + rerank still cap what reaches the prompt.
    hits = pipeline.retrieve_learning_chunk_hits(
        req,
        file_ids,
        top_k=max(3, min(top_k or 5, 48)),
        similarity_floor=similarity_floor or 0.0,
    )

    section_needle = (filter_by_section or "").strip().lower()
    page_lo, page_hi = filter_by_page_range if filter_by_page_range else (None, None)

    merged: dict[str, dict[str, Any]] = {}
    for row in hits:
        cid = str(row.get("chunk_id") or "")
        if not cid:
            continue
        pstart = row.get("page_start")
        try:
            page_num = int(pstart) if pstart is not None else None
        except (TypeError, ValueError):
            page_num = None
        if page_lo is not None and page_hi is not None and page_num is not None:
            if page_num < page_lo or page_num > page_hi:
                continue
        title = str(row.get("section_title") or "")
        if section_needle and section_needle not in title.lower():
            continue
        sim = float(row.get("_retrieval_score") or row.get("similarity") or row.get("combined_score") or 0.0)
        merged[cid] = {
            "chunk_id": cid,
            "source_id": f"{str(row.get('file_id') or '')}:{cid}",
            "content": str(row.get("content") or "").strip(),
            "page_number": page_num,
            "section_title": title,
            "metadata": {
                "file_id": str(row.get("file_id") or ""),
                "document_name": str(row.get("document_name") or ""),
                "page_end": row.get("page_end"),
                "chunk_index": row.get("chunk_index"),
            },
            "similarity_score": sim,
        }

    if include_surrounding_chunks:
        extras: dict[str, dict[str, Any]] = {}
        for nb in _neighbor_rows_batch(hits):
            cid = str(nb.get("chunk_id") or "")
            if not cid or cid in merged:
                continue
            pstart = nb.get("page_start")
            try:
                page_num = int(pstart) if pstart is not None else None
            except (TypeError, ValueError):
                page_num = None
            extras[cid] = {
                "chunk_id": cid,
                "source_id": f"{str(nb.get('file_id') or '')}:{cid}",
                "content": str(nb.get("content") or "").strip(),
                "page_number": page_num,
                "section_title": str(nb.get("section_title") or ""),
                "metadata": {
                    "file_id": str(nb.get("file_id") or ""),
                    "document_name": str(nb.get("document_name") or ""),
                    "page_end": nb.get("page_end"),
                    "chunk_index": nb.get("chunk_index"),
                    "neighbor": True,
                },
                "similarity_score": 0.0,
            }
        merged.update(extras)

    out = sorted(merged.values(), key=lambda x: float(x.get("similarity_score") or 0.0), reverse=True)
    _cache_set(cache_key, out)
    return out


def format_chunks_for_prompt(chunks: list[dict[str, Any]], *, max_chars: int = 12000) -> str:
    parts: list[str] = []
    used = 0
    for i, ch in enumerate(chunks, start=1):
        title = ch.get("section_title") or "Section"
        page = ch.get("page_number")
        page_bit = f"p.{page}" if page is not None else "p.?"
        doc_name = _chunk_get_document_name(ch) or "document"
        block = f"[{i}] {doc_name} {page_bit} — {title}\n{ch.get('content', '')}"
        if used + len(block) > max_chars:
            break
        parts.append(block.strip())
        used += len(block)
    return "\n\n---\n\n".join(parts)


def _chunk_get_document_name(ch: dict[str, Any]) -> str:
    meta = ch.get("metadata") or {}
    return str(meta.get("document_name") or "")


def analyze_relationships(chunks: list[dict[str, Any]], *, max_pairs: int = 12) -> dict[str, Any]:
    """
    Lightweight relationship map for learning mode:
    - conflicting factual hints across docs
    - key date mentions
    - statutory requirement mentions
    """
    conflicts: list[dict[str, Any]] = []
    key_dates: list[dict[str, Any]] = []
    statutory_requirements: list[dict[str, Any]] = []

    seen_conflicts: set[tuple[str, str, str]] = set()
    date_re = r"\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b"
    section_re = r"\b(?:section|sec\.?|u/s)\s*\d+[a-zA-Z0-9()/-]*\b"

    for ch in chunks:
        content = str(ch.get("content") or "")
        if not content:
            continue
        for m in re.finditer(date_re, content, flags=re.IGNORECASE):
            key_dates.append(
                {
                    "source_id": ch.get("source_id"),
                    "doc_id": _chunk_get_document_name(ch),
                    "page": ch.get("page_number"),
                    "date_text": m.group(0),
                }
            )
        for m in re.finditer(section_re, content, flags=re.IGNORECASE):
            statutory_requirements.append(
                {
                    "source_id": ch.get("source_id"),
                    "doc_id": _chunk_get_document_name(ch),
                    "page": ch.get("page_number"),
                    "requirement": m.group(0),
                }
            )

    for i, left in enumerate(chunks):
        ldoc = _chunk_get_document_name(left)
        ltxt = str(left.get("content") or "").lower()
        if not ltxt:
            continue
        for right in chunks[i + 1 :]:
            rdoc = _chunk_get_document_name(right)
            if not rdoc or rdoc == ldoc:
                continue
            rtxt = str(right.get("content") or "").lower()
            if not rtxt:
                continue
            # simple contradiction heuristic around visibility/light facts
            has_light_conflict = ("light was red" in ltxt and "light was green" in rtxt) or (
                "light was green" in ltxt and "light was red" in rtxt
            )
            has_visibility_conflict = ("visibility was zero" in ltxt and "clearly saw" in rtxt) or (
                "visibility was zero" in rtxt and "clearly saw" in ltxt
            )
            if not (has_light_conflict or has_visibility_conflict):
                continue
            lid, rid = sorted([str(left.get("source_id")), str(right.get("source_id"))])
            key = (lid, rid, "fact_conflict")
            if key in seen_conflicts:
                continue
            seen_conflicts.add(key)
            conflicts.append(
                {
                    "type": "fact_conflict",
                    "left": {
                        "source_id": left.get("source_id"),
                        "doc_id": ldoc,
                        "page": left.get("page_number"),
                        "snippet": str(left.get("content") or "")[:240],
                    },
                    "right": {
                        "source_id": right.get("source_id"),
                        "doc_id": rdoc,
                        "page": right.get("page_number"),
                        "snippet": str(right.get("content") or "")[:240],
                    },
                }
            )
            if len(conflicts) >= max_pairs:
                break
        if len(conflicts) >= max_pairs:
            break

    return {
        "conflicting_facts": conflicts,
        "key_dates": key_dates[:40],
        "statutory_requirements": statutory_requirements[:40],
    }
