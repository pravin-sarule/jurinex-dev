"""
Local search utilities: ES/PG keyword search and IK case-name search.

Shared by main.py (manual fetch/keyword search endpoints).
"""
from __future__ import annotations

import logging
import re
from html.parser import HTMLParser
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

_ES_APPROVED_STATUSES = ["APPROVED", "VERIFIED", "VERIFIED_WARN", "GREEN"]
_ES_LOW_HIERARCHY_PHRASES = [
    "district court", "district judge", "sessions court",
    "magistrate", "tribunal", "consumer forum", "consumer commission",
]
_ADMIN_SOURCE_TYPES = [
    "admin", "admin_upload", "admin-upload", "admin uploaded",
    "admin-uploaded", "adminupload", "manual_upload", "manual-upload",
    "judgment_upload", "judgement_upload",
]


def _stable_text(value: Any) -> str:
    return str(value or "").strip().lower()


def _strip_html(html: str) -> str:
    if not html:
        return ""

    class _S(HTMLParser):
        def __init__(self):
            super().__init__()
            self.parts: List[str] = []

        def handle_data(self, data):
            self.parts.append(data)

    s = _S()
    s.feed(html)
    return re.sub(r"\s+", " ", " ".join(s.parts)).strip()


def _plain_text(value: Any) -> str:
    return _strip_html(str(value or "")).strip()


def _clean_report_query_label(text: str) -> str:
    value = _plain_text(text)
    value = re.split(r"```|(?:^|\s)json(?:\s|$)|[{\[]", value, maxsplit=1, flags=re.I)[0]
    value = re.sub(r"\s+", " ", value).strip(" -:\n\t")
    return value[:80]


def _case_name_similarity(searched: str, returned: str) -> float:
    _generic = {
        "state", "union", "india", "government", "central", "national", "republic",
        "maharashtra", "gujarat", "delhi", "kerala", "karnataka", "rajasthan",
        "punjab", "haryana", "uttar", "pradesh", "madhya", "bihar", "odisha",
        "andhra", "telangana", "tamilnadu", "tamil", "bengal", "assam", "goa",
        "authority", "corporation", "board", "department", "ministry", "office",
        "commission", "committee", "council", "company", "limited", "ltd",
        "pvt", "private", "public", "municipal", "development", "housing",
        "finance", "bank", "trust", "society", "institute", "university",
        "another", "others", "anr", "ors", "versus", "vs", "v",
        "and", "of", "in", "the", "a", "an", "by", "for", "with", "on",
        "at", "from", "to", "through", "between", "into", "over", "under",
    }

    def _distinctive(s: str) -> set:
        tokens = re.sub(r'[^a-z0-9\s]', ' ', s.lower()).split()
        return {t for t in tokens if t not in _generic and len(t) > 2}

    sw = _distinctive(searched)
    rw = _distinctive(returned)

    if not sw:
        all_sw = {w for w in re.sub(r'[^a-z\s]', ' ', searched.lower()).split() if len(w) > 1}
        all_rw = {w for w in re.sub(r'[^a-z\s]', ' ', returned.lower()).split() if len(w) > 1}
        return len(all_sw & all_rw) / max(len(all_sw), 1)

    return len(sw & rw) / len(sw)


def _pg_row_to_local_result(r: Dict[str, Any], query: str, es_score: float = 0.0) -> Optional[Dict[str, Any]]:
    cid = str(r.get("canonical_id") or r.get("id") or "").strip()
    if not cid:
        return None
    src_type = str(r.get("source_type") or "").strip().lower()
    is_admin = src_type in _ADMIN_SOURCE_TYPES or src_type.startswith("admin")
    tid = cid[3:] if cid.startswith("ik:") else ""
    full_text = str(
        r.get("full_text") or r.get("raw_content") or
        r.get("merged_text") or r.get("text_content") or ""
    )
    ratio = str(r.get("ratio") or r.get("holding_text") or r.get("summary_text") or "")
    court = str(r.get("court") or r.get("court_code") or r.get("court_name") or "")
    url = (
        str(r.get("source_url") or r.get("official_source_url") or r.get("external_url") or "")
        or (f"https://indiankanoon.org/doc/{tid}/" if tid else "")
    )
    return {
        "tid":           tid,
        "canonical_id":  cid,
        "title":         str(r.get("title") or r.get("case_name") or ""),
        "court":         court,
        "date":          str(r.get("judgment_date") or r.get("date") or ""),
        "snippet":       ratio[:300] or full_text[:300],
        "full_text":     full_text,
        "headnotes":     str(r.get("headnote") or r.get("headnotes") or ratio[:1000]),
        "bench":         str(r.get("bench") or r.get("coram") or ""),
        "ik_citation":   str(r.get("primary_citation") or r.get("ik_citation") or ""),
        "url":           url,
        "source":        "admin_upload" if is_admin else "local_db",
        "_es_score":     es_score,
        "ikCiteList":    [],
        "ikCitedByList": [],
        "_query":        query,
    }


def _enrich_full_text(item: Dict[str, Any]) -> Dict[str, Any]:
    cid = item.get("canonical_id", "")
    tid = item.get("tid", "") or (cid[3:] if cid.startswith("ik:") else "")

    if tid:
        try:
            from db.client import ik_asset_get
            asset = ik_asset_get(tid)
            if asset:
                raw = asset.get("raw_api_response") or {}
                if isinstance(raw, str):
                    import json as _j
                    try:
                        raw = _j.loads(raw)
                    except Exception:
                        raw = {}
                ft = (raw.get("raw_content") or raw.get("full_text") or
                      asset.get("raw_content") or asset.get("full_text") or "")
                if not ft:
                    doc_html = raw.get("doc") or asset.get("doc") or ""
                    ft = _strip_html(doc_html) if doc_html else ""
                if ft:
                    return {**item, "full_text": ft[:15000],
                            "title":  raw.get("title") or item.get("title", ""),
                            "court":  raw.get("docsource") or item.get("court", ""),
                            "date":   raw.get("publishdate") or item.get("date", ""),
                            "ik_citation": raw.get("citation") or item.get("ik_citation", "")}
        except Exception as exc:
            logger.debug("[SEARCH] ik_asset_get fallback failed tid=%s: %s", tid, exc)

    if cid:
        try:
            from db.client import judgements_fetch_by_canonical_ids
            rows = judgements_fetch_by_canonical_ids(
                [cid], approved_only=False, exclude_low_hierarchy=False
            )
            if rows:
                r = rows[0]
                cd = r.get("citation_data") or {}
                ft = (r.get("full_text") or r.get("raw_content") or
                      cd.get("full_text") or r.get("merged_text") or "")
                if ft:
                    return {**item, "full_text": str(ft)[:15000]}
        except Exception as exc:
            logger.debug("[SEARCH] judgements_fetch fallback failed cid=%s: %s", cid, exc)

    return item


def _search_local_one(query: str) -> List[Dict[str, Any]]:
    """ES multi_match keyword search with PG fallback."""
    query = (query or "").strip()
    if not query:
        return []

    try:
        from db.connections import get_es_client, elasticsearch_init_failed
        es = get_es_client()
        if es and not elasticsearch_init_failed():
            resp = es.search(
                index="judgments",
                size=8,
                query={
                    "bool": {
                        "must": [{
                            "multi_match": {
                                "query":     query,
                                "fields":    [
                                    "case_name^4",
                                    "primary_citation^3",
                                    "summary_text^2",
                                    "holding_text^2",
                                    "facts_text",
                                    "full_text",
                                ],
                                "type":      "best_fields",
                                "fuzziness": "AUTO",
                                "operator":  "or",
                            }
                        }],
                        "filter": [{
                            "bool": {
                                "should": [
                                    {"terms": {"verification_status.keyword": _ES_APPROVED_STATUSES}},
                                    {"terms": {"source_type.keyword": _ADMIN_SOURCE_TYPES}},
                                ],
                                "minimum_should_match": 1,
                            }
                        }],
                        "must_not": [
                            {"match_phrase": {"court_code": ph}}
                            for ph in _ES_LOW_HIERARCHY_PHRASES
                        ],
                    }
                },
            )
            hits = resp.get("hits", {}).get("hits", [])
            results = []
            for h in hits:
                src = h.get("_source") or {}
                cid = str(src.get("canonical_id") or h.get("_id") or "").strip()
                if not cid:
                    continue
                src_type = str(src.get("source_type") or "").strip().lower()
                is_admin = src_type in _ADMIN_SOURCE_TYPES or src_type.startswith("admin")
                tid = cid[3:] if cid.startswith("ik:") else ""
                full_text = str(src.get("full_text") or "")
                ratio = str(src.get("holding_text") or src.get("summary_text") or "")
                url = (str(src.get("source_url") or "")
                       or (f"https://indiankanoon.org/doc/{tid}/" if tid else ""))
                item = {
                    "tid":           tid,
                    "canonical_id":  cid,
                    "title":         str(src.get("case_name") or src.get("title") or ""),
                    "court":         str(src.get("court_code") or src.get("court_name") or ""),
                    "date":          str(src.get("judgment_date") or ""),
                    "snippet":       ratio[:300] or full_text[:300],
                    "full_text":     full_text,
                    "headnotes":     ratio[:1000],
                    "bench":         str(src.get("bench") or src.get("coram") or ""),
                    "ik_citation":   str(src.get("primary_citation") or ""),
                    "url":           url,
                    "source":        "admin_upload" if is_admin else "local_db",
                    "_es_score":     float(h.get("_score") or 0.0),
                    "ikCiteList":    [],
                    "ikCitedByList": [],
                    "_query":        query,
                }
                if len(full_text) < 100:
                    item = _enrich_full_text(item)
                results.append(item)

            results.sort(
                key=lambda r: (
                    -(
                        2 if "supreme" in r["court"].lower() else
                        1 if "high" in r["court"].lower() else 0
                    ),
                    -float(r.get("_es_score") or 0.0),
                    _stable_text(r.get("title")),
                    _stable_text(r.get("canonical_id") or r.get("tid") or r.get("url")),
                )
            )
            try:
                from db.client import search_admin_uploads_pg
                admin_hits = search_admin_uploads_pg(query, limit=3)
                seen_cids = {r.get("canonical_id") for r in results if r.get("canonical_id")}
                for ah in admin_hits:
                    if ah.get("canonical_id") not in seen_cids:
                        results.append(ah)
                        seen_cids.add(ah.get("canonical_id"))
            except Exception as _ae:
                logger.debug("[SEARCH] Admin upload supplement failed: %s", _ae)

            return results
    except Exception as exc:
        logger.warning("[SEARCH] ES search failed %r: %s - PG fallback", query[:60], exc)

    try:
        from db.client import judgement_search_local, search_admin_uploads_pg
        rows = judgement_search_local(query, limit=6, approved_only=True,
                                      exclude_low_hierarchy=True)
        results = [r for r in (_pg_row_to_local_result(row, query) for row in rows) if r]
        results = [(_enrich_full_text(r) if len(r.get("full_text", "")) < 100 else r)
                   for r in results]
        try:
            seen_cids = {r.get("canonical_id") for r in results if r.get("canonical_id")}
            for ah in search_admin_uploads_pg(query, limit=3):
                if ah.get("canonical_id") not in seen_cids:
                    results.append(ah)
                    seen_cids.add(ah.get("canonical_id"))
        except Exception as _ae:
            logger.debug("[SEARCH] Admin upload PG fallback failed: %s", _ae)
        results.sort(
            key=lambda r: (
                _stable_text(r.get("title")),
                _stable_text(r.get("canonical_id") or r.get("tid") or r.get("url")),
            )
        )
        return results
    except Exception as exc:
        logger.warning("[SEARCH] PG fallback failed %r: %s", query[:60], exc)
        return []


def _ik_search_by_case_name(case_name: str, top_n: int = 1) -> List[Dict[str, Any]]:
    """Search IK by case name using title= for precision."""
    from services.indiankanoon_client import ik_search

    name_no_year = re.sub(r'\s*\(\d{4}\)\s*$', '', case_name.strip()).strip()
    _v_split = re.split(r'\s+(?:v\.?s?\.?|versus)\s+', name_no_year, maxsplit=1, flags=re.I)
    first_party = _v_split[0].strip()[:60] if _v_split else name_no_year[:60]

    def _make_result(d: Dict, sim: float = 0.0) -> Optional[Dict]:
        tid = str(d.get("tid", "")).strip()
        if not tid:
            return None
        return {
            "tid":     tid,
            "title":   _plain_text(d.get("title", "")),
            "snippet": _plain_text(d.get("headline", "")),
            "court":   d.get("docsource", ""),
            "date":    d.get("publishdate", ""),
            "url":     f"https://indiankanoon.org/doc/{tid}/",
            "source":  "indian_kanoon",
            "sim":     sim,
            "_query":  _clean_report_query_label(f"[case_name] {case_name}"),
            "_page":   0,
        }

    def _search_best(title_param: Optional[str]) -> Optional[tuple]:
        try:
            resp = ik_search(
                query=name_no_year,
                title=title_param,
                doctypes="judgments",
                pagenum=0,
            )
            docs = (resp or {}).get("docs") or []
            best_r, best_sim = None, -1.0
            for d in docs[:10]:
                r = _make_result(d)
                if not r:
                    continue
                sim = _case_name_similarity(name_no_year, r["title"])
                if sim > best_sim:
                    best_sim, best_r = sim, r
            return (best_r, best_sim) if best_r else None
        except Exception as exc:
            logger.warning("[SEARCH] IK search failed (title=%r): %s", title_param, exc)
            return None

    candidates = []
    for label, title_param in [
        ("full-title",  name_no_year[:120]),
        ("party-title", first_party),
        ("keyword-only", None),
    ]:
        hit = _search_best(title_param)
        if hit:
            candidates.append((label, hit[0], hit[1]))

    if not candidates:
        logger.warning("[SEARCH] IK returned no docs at all for case name %r", case_name)
        return []

    best_label, best_result, best_sim = max(candidates, key=lambda x: x[2])

    if best_sim < 0.2:
        logger.warning(
            "[SEARCH] IK case name %r - best match too dissimilar (sim=%.2f title=%r); skipping",
            case_name, best_sim, best_result.get("title", ""),
        )
        return []

    best_result["sim"] = best_sim
    logger.info("[SEARCH] IK case name (%s) %r -> sim=%.2f title=%r",
                best_label, case_name, best_sim, best_result.get("title", ""))
    return [best_result]
