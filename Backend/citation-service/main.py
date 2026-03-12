"""
JuriNex Citation Service — Watchdog → Fetcher → Clerk → Verified Citation Report.

- POST /citation/report — Run full pipeline (query + user_id); returns report in frontend format.
- GET /citation/reports — List user's reports.
- GET /citation/reports/:id — Get one report (same format as HTML/React).
"""

from __future__ import annotations

import logging
import os
import re
import threading
import httpx
from pathlib import Path
from urllib.parse import quote
from typing import Any, Dict, List, Optional
from uuid import UUID

from dotenv import load_dotenv
from fastapi import FastAPI, Body, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware

from citation_agent import run_citation_agent
from claude_proxy import forward_to_claude
from db.client import (
    init_db,
    report_get,
    report_delete,
    report_list_by_user,
    report_list_by_case,
    report_update,
    hitl_queue_list_by_report,
    hitl_queue_update_status,
    hitl_queue_pending_count,
    hitl_queue_insert,
    agent_logs_by_run,
    judgement_get,
    judgement_search_local,
    analytics_get_enterprise_dashboard,
    report_share,
    report_get_shares,
    report_list_firm_shared,
    report_list_shared_with_members,
)
from db.connections import get_qdrant_client, get_neo4j_driver
from pipeline import run_pipeline

logging.basicConfig(level=logging.INFO, format="%(levelname)s [%(name)s] %(message)s")
logger = logging.getLogger(__name__)

_project_root = Path(__file__).resolve().parent
load_dotenv(_project_root / ".env")


def _decode_jwt(request: Request) -> Dict[str, Any]:
    """Decode JWT from Authorization header. Returns payload dict or {}."""
    auth = request.headers.get("authorization") or ""
    if not auth.startswith("Bearer "):
        return {}
    token = auth.split(maxsplit=1)[1]
    secret = os.environ.get("JWT_SECRET")
    if not secret:
        return {}
    try:
        import jwt as pyjwt
        return pyjwt.decode(token, secret, algorithms=["HS256"], options={"verify_exp": True})
    except Exception:
        return {}


def _get_token_account_type(request: Request) -> Optional[str]:
    """Return account_type claim from JWT (uppercased), or None."""
    payload = _decode_jwt(request)
    return str(payload.get("account_type") or "").upper() or None


async def _fetch_firm_members(user_id: int) -> List[Dict[str, Any]]:
    """
    Call auth service internal endpoint to get all firm members (id, email, username).
    Falls back to a single-member list on error.
    """
    auth_url = os.environ.get("AUTH_SERVICE_URL", "http://localhost:5001/api/auth")
    url = f"{auth_url}/internal/user/{user_id}/firm-members"
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            res = await client.get(url)
        if res.status_code == 200:
            return res.json().get("members") or []
    except Exception as exc:
        logger.warning("[AUTH] firm-members fetch failed for user %s: %s", user_id, exc)
    return [{"user_id": user_id, "email": str(user_id), "username": str(user_id), "auth_type": "—", "role": "—"}]


async def _fetch_users_bulk(user_ids: List[int]) -> List[Dict[str, Any]]:
    """
    Call auth service bulk users endpoint to get username, auth_type, role for given user IDs.
    Returns list of {user_id, username, email, auth_type, role}.
    """
    if not user_ids:
        return []
    auth_url = os.environ.get("AUTH_SERVICE_URL", "http://localhost:5001/api/auth")
    ids_str = ",".join(str(x) for x in user_ids)
    url = f"{auth_url}/internal/users/bulk?ids={ids_str}"
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            res = await client.get(url)
        if res.status_code == 200:
            return res.json().get("users") or []
    except Exception as exc:
        logger.warning("[AUTH] users-bulk fetch failed for ids %s: %s", user_ids[:5], exc)
    return []


def _html_to_text(content: str) -> str:
    """
    Best-effort HTML → plain text for full judgments:
    - convert <br> to newlines and </p> to paragraph breaks
    - strip script/style and all remaining tags
    - drop obvious boilerplate / JS lines
    - collapse excessive blank lines
    """
    if not isinstance(content, str):
        return str(content or "").strip()
    if "<" not in content and ">" not in content:
        return content.strip()

    text = content
    # Remove script and style blocks completely
    text = re.sub(r"(?is)<script[^>]*>.*?</script>", " ", text)
    text = re.sub(r"(?is)<style[^>]*>.*?</style>", " ", text)
    # Basic block/line breaks
    text = re.sub(r"(?i)<br\s*/?>", "\n", text)
    text = re.sub(r"(?i)</p\s*>", "\n\n", text)
    # Strip all other tags
    text = re.sub(r"<[^>]+>", "", text)
    # Normalise newlines
    text = re.sub(r"\r\n|\r", "\n", text)
    # Drop obvious boilerplate / JS / navigation lines
    lines = [ln.strip() for ln in text.split("\n")]
    cleaned_lines = []
    for ln in lines:
        if not ln:
            cleaned_lines.append("")
            continue
        low = ln.lower()
        # Skip analytics, navigation, and site chrome / marketing copy
        if any(tok in low for tok in [
            "window.datalayer",
            "gtag(",
            "google analytics",
            "skip to main content",
            "indian kanoon - search engine",
            "search indian laws and judgments",
            "main navigation",
            "mobile navigation",
            "free features",
            "premium features",
            "prism ai",
            "pricing",
            "login",
            "legal document view",
            "tools for analyzing structure",
            "unlock advanced research with prisma",
            "upgrade to premium",
            "document options",
            "get in pdf",
            "print it!",
            "download court copy",
            "know your kanoon",
            "doc gen hub",

            "counter argument",
            "case predict ai",
            "talk with ik doc",
        ]):
            continue
        # Skip lines that look like CSS / JS / config
        css_token_count = ln.count("{") + ln.count("}") + ln.count(";")
        if css_token_count >= 3 or "var(--" in low:
            continue
        if any(tok in low for tok in ["function(", "=>", "console.log", "document.getelementbyid"]):
            continue
        cleaned_lines.append(ln)

    # Collapse multiple blank lines
    out = []
    last_blank = False
    for ln in cleaned_lines:
        is_blank = (ln.strip() == "")
        if is_blank and last_blank:
            continue
        out.append(ln)
        last_blank = is_blank

    return "\n".join(out).strip()


app = FastAPI(
    title="JuriNex Citation Service",
    description="Watchdog (local DB → Indian Kanoon → Google) → Fetcher → Clerk → Verified Citation Report.",
    version="2.0.0",
)

CORS_ORIGINS = os.environ.get("CORS_ORIGINS", "http://localhost:5173,http://localhost:3000,http://localhost:5000").strip().split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in CORS_ORIGINS if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


async def _fetch_case_context(case_id: str, auth_header: Optional[str]):
    """
    Fetch case file context from document-service.
    Returns (context_items, summary). Always returns something usable:
    - If chunks load → full context items
    - If case data loads but no chunks → stub item with case title so pipeline has a search seed
    - If everything fails → ([], "")
    """
    # Try multiple base URL candidates
    base_url = (
        os.environ.get("DOCUMENT_SERVICE_URL")
        or os.environ.get("GATEWAY_URL", "").rstrip("/") + "/docs"
    )
    if not base_url or base_url == "/docs":
        logger.warning("[CASE_CONTEXT] DOCUMENT_SERVICE_URL not set; skipping case context fetch.")
        return [], ""
    if not auth_header:
        logger.warning("[CASE_CONTEXT] Missing Authorization header; skipping case context fetch.")
        return [], ""

    base_url = base_url.rstrip('/')
    headers = {"Authorization": auth_header}
    case_title_fallback = ""

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            # --- Step 1: fetch case metadata ---
            case_url = f"{base_url}/api/files/cases/{case_id}"
            case_resp = await client.get(case_url, headers=headers)
            if case_resp.status_code != 200:
                logger.warning("[CASE_CONTEXT] Case fetch failed (%s) at %s: %s",
                               case_resp.status_code, case_url, case_resp.text[:200])
                return [], ""
            payload = case_resp.json() or {}
            case_data = payload.get("case") or {}

            # Keep case title as fallback search seed
            case_title_fallback = (
                case_data.get("case_title")
                or case_data.get("name")
                or case_data.get("title")
                or ""
            )

            # --- Step 2: resolve folder name ---
            folder_name = None
            folders = case_data.get("folders") or []
            if folders:
                folder = (folders or [None])[0] or {}
                folder_name = folder.get("folder_path") or folder.get("name") or folder.get("originalname")
            if not folder_name:
                folder_name = case_title_fallback
            if not folder_name:
                logger.warning("[CASE_CONTEXT] No folder name found for case_id=%s; using title stub", case_id)
                # Return a minimal stub so CHECK 1 can still proceed
                if case_title_fallback:
                    return [{"name": "Case", "content": case_title_fallback}], case_title_fallback
                return [], ""

            # --- Step 3: fetch chunks ---
            enc_name = quote(str(folder_name), safe='')
            chunks_url = f"{base_url}/api/files/{enc_name}/chunks"
            chunks_resp = await client.get(chunks_url, headers=headers)
            if chunks_resp.status_code != 200:
                logger.warning("[CASE_CONTEXT] Chunk fetch failed (%s) for folder=%s; using title stub",
                               chunks_resp.status_code, folder_name)
                # Fall back to case title so pipeline is not completely blind
                stub_content = case_title_fallback or folder_name
                return [{"name": "Case", "content": stub_content}], stub_content
            chunks_payload = chunks_resp.json() or {}
            chunks = chunks_payload.get("chunks") or []

            # --- Step 4: optional summary ---
            summary = ""
            summary_url = f"{base_url}/api/files/{enc_name}/summary"
            try:
                summary_resp = await client.get(summary_url, headers=headers)
                if summary_resp.status_code == 200:
                    summary = (summary_resp.json() or {}).get("summary") or ""
            except Exception as exc:
                logger.warning("[CASE_CONTEXT] Summary fetch failed: %s", exc)

    except Exception as exc:
        logger.warning("[CASE_CONTEXT] Fetch failed: %s", exc)
        # Return title stub if we at least have the case title
        if case_title_fallback:
            return [{"name": "Case", "content": case_title_fallback}], case_title_fallback
        return [], ""

    max_chunks = int(os.environ.get("CASE_CONTEXT_MAX_CHUNKS", "200"))
    chunks = chunks[:max_chunks]

    by_file: Dict[str, List[str]] = {}
    for ch in chunks:
        fname = ch.get("filename") or "document"
        content = (ch.get("content") or "").strip()
        if not content:
            continue
        by_file.setdefault(fname, []).append(content)

    context_items = []
    if summary:
        context_items.append({"name": "Case Summary", "content": summary})

    max_item_chars = int(os.environ.get("CASE_CONTEXT_MAX_ITEM_CHARS", "8000"))
    for fname, texts in by_file.items():
        combined = "\n\n".join(texts)
        if not combined:
            continue
        for i in range(0, len(combined), max_item_chars):
            context_items.append({"name": fname, "content": combined[i:i + max_item_chars]})

    # If chunks existed but all were empty content, fall back to title stub
    if not context_items and case_title_fallback:
        context_items = [{"name": "Case", "content": case_title_fallback}]

    logger.info("[CASE_CONTEXT] Loaded %d items from %d chunk(s) for case_id=%s",
                len(context_items), len(chunks), case_id)
    return context_items, summary


@app.on_event("startup")
def startup():
    init_db()

    # Neo4j connectivity test (optional)
    driver = get_neo4j_driver()
    if driver:
        try:
            with driver.session() as session:
                result = session.run("RETURN 'Neo4j Connected' AS message")
                msg = result.single()["message"]
                logger.info("[NEO4J] %s", msg)
        except Exception as exc:
            logger.warning("[NEO4J] Test query failed: %s", exc)
        finally:
            try:
                driver.close()
            except Exception:
                pass

    # Qdrant collection init (optional)
    qdrant = get_qdrant_client()
    if qdrant:
        try:
            from qdrant_client.models import VectorParams, Distance
            if not qdrant.collection_exists(collection_name="legal_embeddings"):
                qdrant.create_collection(
                    collection_name="legal_embeddings",
                    vectors_config=VectorParams(size=768, distance=Distance.COSINE),
                )
                logger.info("[QDRANT] Created collection: legal_embeddings")
            else:
                logger.info("[QDRANT] Collection exists: legal_embeddings")
        except Exception as exc:
            logger.warning("[QDRANT] Init failed: %s", exc)


@app.get("/")
def root() -> Dict[str, Any]:
    return {
        "service": "JuriNex Citation Service",
        "docs": "/docs",
        "report": "POST /citation/report (query, user_id, case_file_context)",
        "reports_list": "GET /citation/reports?user_id=...",
        "report_by_id": "GET /citation/reports/{report_id}",
        "claude_proxy": "POST /api/claude (forward to Anthropic)",
    }


@app.post("/api/claude")
async def claude_proxy(body: Dict[str, Any]) -> Dict[str, Any]:
    """
    Forward request to Anthropic Claude API (same logic as proxy.js).
    Keeps API key server-side and avoids CORS. Body: { model, max_tokens, messages, ... }.
    """
    if not body:
        raise HTTPException(status_code=400, detail="JSON body required")
    try:
        result = forward_to_claude(body)
        return result
    except ValueError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    except Exception as e:
        logger.exception("Claude proxy error: %s", e)
        raise HTTPException(status_code=502, detail="Failed to reach Claude API") from e


@app.get("/citation/cases/{canonical_id}/graph")
async def get_case_citation_graph(canonical_id: str) -> Dict[str, Any]:
    """
    Return citation graph for a judgment (by canonical_id), based on Neo4j CITES/FOLLOWS/DISTINGUISHES/OVERRULES edges.
    Only include nodes that exist in our judgments index (i.e. verified or known in local DB/ES).
    """
    cid = (canonical_id or "").strip()
    if not cid:
        raise HTTPException(status_code=400, detail="canonical_id is required")

    driver = get_neo4j_driver()
    if not driver:
        raise HTTPException(status_code=503, detail="Citation graph unavailable (Neo4j disabled)")

    # Collect center node + neighbours from Neo4j
    try:
        with driver.session() as session:
            cypher = """
                MATCH (c:CitedCase {caseId: $cid})
                OPTIONAL MATCH (c)-[r1]->(out:CitedCase)
                  WHERE type(r1) IN ['CITES','FOLLOWS','DISTINGUISHES','OVERRULES']
                OPTIONAL MATCH (inp:CitedCase)-[r2]->(c)
                  WHERE type(r2) IN ['CITES','FOLLOWS','DISTINGUISHES','OVERRULES']
                RETURN
                  c.caseId AS id,
                  c.caseName AS name,
                  collect(distinct {dir:'out', type:type(r1), to:out.caseId, toName:out.caseName}) AS outgoing,
                  collect(distinct {dir:'in',  type:type(r2), from:inp.caseId, fromName:inp.caseName}) AS incoming
            """
            rec = session.run(cypher, cid=cid).single()
    except Exception as exc:
        logger.warning("[GRAPH] Neo4j query failed for %s: %s", cid, exc)
        raise HTTPException(status_code=502, detail="Failed to fetch citation graph") from exc

    if not rec:
        return {"success": True, "nodes": [], "edges": []}

    # Build raw node/edge sets
    nodes: Dict[str, Dict[str, Any]] = {}
    edges: List[Dict[str, Any]] = []

    def _add_node(node_id: str, label: str, role: str = "related") -> None:
        if not node_id:
            return
        if node_id not in nodes:
            nodes[node_id] = {"id": node_id, "label": label or node_id, "role": role}

    center_id = rec.get("id")
    center_name = rec.get("name") or center_id
    _add_node(center_id, center_name, role="center")

    for out in rec.get("outgoing") or []:
        to_id = out.get("to")
        to_name = out.get("toName") or to_id
        rel_type = (out.get("type") or "").upper()
        _add_node(to_id, to_name)
        if center_id and to_id:
            edges.append({"from": center_id, "to": to_id, "type": rel_type})

    for inc in rec.get("incoming") or []:
        from_id = inc.get("from")
        from_name = inc.get("fromName") or from_id
        rel_type = (inc.get("type") or "").upper()
        _add_node(from_id, from_name)
        if from_id and center_id:
            edges.append({"from": from_id, "to": center_id, "type": rel_type})

    # Show all Neo4j nodes; only exclude QUARANTINED ones that exist in local DB
    filtered_nodes: Dict[str, Dict[str, Any]] = {}
    for nid, meta in nodes.items():
        j = judgement_get(nid)
        if j and str(j.get("audit_status") or "").upper() == "QUARANTINED":
            continue
        filtered_nodes[nid] = meta

    filtered_node_ids = set(filtered_nodes.keys())
    filtered_edges = [e for e in edges if e["from"] in filtered_node_ids and e["to"] in filtered_node_ids]

    return {
        "success": True,
        "nodes": list(filtered_nodes.values()),
        "edges": filtered_edges,
    }


@app.get("/citation/judgements/search")
async def search_judgements(
    q: str = "",
    court: str = "",
    area: str = "",
    status: str = "",
    limit: int = 100,
) -> Dict[str, Any]:
    """Full-text search + filter across all indexed judgments."""
    from db.connections import get_pg_conn, get_es_client
    from psycopg2.extras import RealDictCursor

    results = []

    # Try Elasticsearch first
    es = get_es_client()
    if es:
        try:
            must = []
            if q.strip():
                must.append({"multi_match": {"query": q, "fields": ["case_name^4", "primary_citation^3", "holding_text^2", "summary_text^2", "full_text"], "type": "best_fields", "fuzziness": "AUTO"}})
            filters = []
            if court:
                filters.append({"term": {"court_code": court}})
            if area:
                filters.append({"term": {"area": area}})
            if status:
                filters.append({"term": {"audit_status": status}})
            es_query = {"bool": {"must": must or [{"match_all": {}}], "filter": filters}}
            resp = es.search(
                index="judgments",
                size=limit,
                query=es_query,
                _source=[
                    "canonical_id", "case_name", "primary_citation", "court_code", "court_name", "area",
                    "audit_status", "audit_confidence", "year", "judgment_date", "source_type",
                    "coram", "holding_text", "summary_text", "statutes", "excerpt_para", "excerpt_text",
                    "source_url", "official_source_url",
                ],
            )
            for h in resp.get("hits", {}).get("hits", []):
                src = h.get("_source") or {}
                cid = src.get("canonical_id") or h.get("_id")
                score = h.get("_score") or 0
                max_score = resp.get("hits", {}).get("max_score") or 1
                match_pct = int(min(100, (score / max_score) * 100)) if q.strip() else None
                ratio = src.get("holding_text") or src.get("summary_text") or ""
                statutes = src.get("statutes")
                if isinstance(statutes, list):
                    statutes_str = "; ".join(str(s) for s in statutes if s) if statutes else ""
                else:
                    statutes_str = str(statutes or "")
                excerpt = src.get("excerpt_text") or ""
                excerpt_para = src.get("excerpt_para") or ""
                results.append({
                    "canonicalId": cid,
                    "caseName": src.get("case_name") or cid,
                    "primaryCitation": src.get("primary_citation") or "",
                    "court": src.get("court_name") or src.get("court_code") or "",
                    "coram": src.get("coram") or "",
                    "area": src.get("area") or "",
                    "year": src.get("year") or (str(src.get("judgment_date") or "")[:4]),
                    "dateOfJudgment": str(src.get("judgment_date") or ""),
                    "statutes": statutes_str,
                    "ratio": ratio,
                    "excerptPara": excerpt_para,
                    "excerpt": excerpt,
                    "auditStatus": src.get("audit_status") or "not_audited",
                    "confidence": int(src.get("audit_confidence") or 0),
                    "matchPct": match_pct,
                    "source": src.get("source_type") or "local",
                    "sourceUrl": src.get("source_url") or src.get("official_source_url") or "",
                })
            # Enrich results with empty ratio/statutes/excerpt via judgement_get
            for r in results:
                if not (r.get("ratio") or r.get("statutes") or r.get("excerpt")):
                    try:
                        j = judgement_get(r.get("canonicalId") or "")
                        if j:
                            if not r.get("ratio") and j.get("ratio"):
                                r["ratio"] = str(j.get("ratio") or "")
                            if not r.get("statutes"):
                                s = j.get("statutes") or []
                                r["statutes"] = "; ".join(str(x) for x in s) if isinstance(s, list) else str(s or "")
                            if not r.get("excerpt") and j.get("excerpt_text"):
                                r["excerpt"] = str(j.get("excerpt_text") or "")
                            if not r.get("excerptPara") and j.get("excerpt_para"):
                                r["excerptPara"] = str(j.get("excerpt_para") or "")
                            if not r.get("area") and j.get("area"):
                                r["area"] = str(j.get("area") or "")
                    except Exception as exc:
                        logger.debug("[SEARCH] enrich %s: %s", r.get("canonicalId"), exc)
            return {"success": True, "total": len(results), "results": results}
        except Exception as exc:
            logger.warning("[SEARCH] ES failed: %s", exc)

    # Fallback: PostgreSQL (omit 'area' and 'ingested_at' so older schemas work)
    conn = get_pg_conn()
    if not conn:
        return {"success": True, "total": 0, "results": []}
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            where = ["1=1"]
            params: list = []
            if q.strip():
                where.append("case_name ILIKE %s")
                params.append(f"%{q}%")
            if court:
                where.append("court_code = %s")
                params.append(court)
            # Note: 'area' filter omitted so DBs without judgments.area column still work
            params.append(limit)
            cur.execute(
                f"""SELECT canonical_id, case_name, court_code, year, judgment_date,
                           verification_status, confidence_score, source_type
                      FROM judgments WHERE {' AND '.join(where)}
                     ORDER BY year DESC NULLS LAST, judgment_date DESC NULLS LAST LIMIT %s""",
                params,
            )
            for r in cur.fetchall():
                results.append({
                    "canonicalId": r["canonical_id"],
                    "caseName": r["case_name"] or r["canonical_id"],
                    "primaryCitation": "",
                    "court": r["court_code"] or "",
                    "coram": "",
                    "area": r.get("area", "") or "",
                    "year": str(r.get("year") or (r.get("judgment_date") or "")[:4] or ""),
                    "dateOfJudgment": str(r.get("judgment_date") or ""),
                    "statutes": "",
                    "ratio": "",
                    "excerptPara": "",
                    "excerpt": "",
                    "auditStatus": r.get("verification_status") or "not_audited",
                    "confidence": int(r.get("confidence_score") or 0),
                    "matchPct": None,
                    "source": r.get("source_type") or "local",
                    "sourceUrl": "",
                })
            # Enrich PG results via judgement_get
            for r in results:
                if not (r.get("ratio") or r.get("statutes") or r.get("excerpt")):
                    try:
                        j = judgement_get(r.get("canonicalId") or "")
                        if j:
                            if not r.get("ratio") and j.get("ratio"):
                                r["ratio"] = str(j.get("ratio") or "")
                            if not r.get("statutes"):
                                s = j.get("statutes") or []
                                r["statutes"] = "; ".join(str(x) for x in s) if isinstance(s, list) else str(s or "")
                            if not r.get("excerpt") and j.get("excerpt_text"):
                                r["excerpt"] = str(j.get("excerpt_text") or "")
                            if not r.get("excerptPara") and j.get("excerpt_para"):
                                r["excerptPara"] = str(j.get("excerpt_para") or "")
                            if not r.get("area") and j.get("area"):
                                r["area"] = str(j.get("area") or "")
                            if not r.get("sourceUrl"):
                                r["sourceUrl"] = str(j.get("source_url") or j.get("import_source_link") or "")
                    except Exception as exc:
                        logger.debug("[SEARCH] enrich pg %s: %s", r.get("canonicalId"), exc)
        return {"success": True, "total": len(results), "results": results}
    finally:
        conn.close()


@app.get("/health")
def health() -> Dict[str, str]:
    return {"status": "ok"}


@app.post("/citation/report")
async def generate_citation_report(
    query: str = Body(..., embed=True),
    user_id: Optional[str] = Body("anonymous", embed=True),
    case_id: Optional[str] = Body(None, embed=True),
    case_file_context: Optional[List[Dict[str, Any]]] = Body(None, embed=True),
    search_results: Optional[List[Dict[str, Any]]] = Body(None, embed=True),
    use_pipeline: bool = Body(True, embed=True),
    request: Request = None,
) -> Dict[str, Any]:
    """
    Generate a citation report (user-specific, stored in DB).

    If use_pipeline=True (default): runs Watchdog → Fetcher → Clerk → build report in verified
    citation format (same as frontend ALL_CITATIONS). Returns report_format so the React report
    page can render the same UI.

    If use_pipeline=False: uses only the citation agent (query + case_file_context + search_results)
    and returns report (markdown) + citations (simple list).

    **Returns (pipeline):** success, report_id, report_format: { citations: [...], generatedAt }.
    **Returns (agent only):** success, report, citations, confidence.
    """
    query = (query or "").strip()
    # If case_id provided, fetch case context from document-service when missing
    if case_id and not case_file_context:
        auth_header = request.headers.get("authorization") if request else None
        case_file_context, _ = await _fetch_case_context(case_id, auth_header)

    if not query and case_file_context:
        try:
            from agents.root_agent import KeywordExtractorAgent, AgentContext
            ctx = AgentContext(
                query="",
                user_id=user_id or "anonymous",
                case_id=case_id,
                metadata={"case_file_context": case_file_context or []},
            )
            ke = KeywordExtractorAgent()
            res = ke.run(ctx)
            query = (ctx.metadata.get("search_query") or "").strip()
        except Exception as e:
            logger.warning("Keyword extraction failed for empty query: %s", e)
    if not query:
        raise HTTPException(status_code=400, detail="query is required and must be non-empty")

    if use_pipeline:
        try:
            out = run_pipeline(
                query,
                user_id or "anonymous",
                ingest_external=True,
                case_file_context=case_file_context or [],
                case_id=case_id,
            )
        except Exception as e:
            logger.exception("Pipeline failed: %s", e)
            raise HTTPException(status_code=500, detail=str(e)) from e
        if out.get("error"):
            raise HTTPException(status_code=500, detail=out["error"])

        # Auto-queue RED / PENDING citations to HITL table
        report_id_out = out.get("report_id")
        run_id_out = out.get("run_id")
        fmt = out.get("report_format") or {}
        cits = (fmt.get("citations") or []) if isinstance(fmt, dict) else []
        for cit in cits:
            vs = cit.get("verificationStatus", "")
            if vs not in ("RED", "PENDING"):
                continue
            try:
                ps = float(cit.get("priorityScore") or 0)
                reason = "web_unverified" if vs == "PENDING" else "verification_failed"
                cit_string = cit.get("primaryCitation") or cit.get("caseName") or ""
                web_url = (
                    cit.get("importSourceLink")
                    or cit.get("sourceUrl")
                    or cit.get("officialSourceLink")
                    or ""
                )
                ticket_id = hitl_queue_insert(
                    report_id=report_id_out or None,    # nullable — queues even without report_id
                    run_id=run_id_out or None,
                    canonical_id=cit.get("canonicalId") or cit.get("id") or "unknown",
                    user_id=user_id or "anonymous",
                    citation_snapshot={**cit, "priorityScore": ps, "queryContext": query[:300]},
                    reason_queued=reason,
                    case_id=case_id,
                    citation_string=cit_string[:512] if cit_string else None,
                    query_context=query[:2000] if query else None,
                    web_source_url=web_url[:2000] if web_url else None,
                    priority_score=ps,
                )
                cit["hitlTicketId"] = ticket_id
                logger.info("[HITL] Queued %s citation '%s' → ticket %s (priority=%.2f)", vs, cit_string[:40], ticket_id, ps)
            except Exception as hitl_err:
                logger.warning("[HITL] Failed to queue citation: %s", hitl_err)

        return {
            "success": True,
            "report_id": report_id_out,
            "report_format": fmt,
            "case_id": case_id,
            "run_id": run_id_out,
            "status": out.get("status", "completed"),
        }

    # Legacy: agent-only
    payload = {
        "query": query,
        "case_file_context": case_file_context or [],
        "search_results": search_results or [],
    }
    try:
        result = run_citation_agent(payload)
    except Exception as e:
        logger.exception("Citation report failed: %s", e)
        raise HTTPException(status_code=500, detail=str(e)) from e
    if result.get("error"):
        raise HTTPException(status_code=500, detail=result["error"])
    return {
        "success": True,
        "report": result.get("report", ""),
        "citations": result.get("citations", []),
        "confidence": result.get("confidence", "low"),
    }


@app.get("/citation/reports/team")
async def get_team_reports(
    request: Request,
    member_ids: Optional[str] = Query(None, description="Comma-separated firm member user IDs (from frontend)"),
    user_id: Optional[str] = Query(None, description="Caller user ID fallback when JWT secret not configured"),
    account_type: Optional[str] = Query(None, description="Caller account_type fallback when JWT secret not configured"),
    case_id: Optional[str] = Query(None, description="Filter shared reports by case ID (case-specific view)"),
) -> Dict[str, Any]:
    """
    Team shared reports.
    - FIRM_ADMIN (with member_ids): all shared reports owned by any firm member.
    - Other users: only reports explicitly shared with this user.
    member_ids / user_id / account_type are passed from frontend as fallback
    when JWT_SECRET is not configured in the citation service.
    """
    payload = _decode_jwt(request)
    # Use JWT values; fall back to explicit query params when JWT_SECRET is not set
    caller_id = str(payload.get("id") or payload.get("userId") or user_id or "")
    resolved_account_type = str(payload.get("account_type") or account_type or "").upper()
    # Fallback: if member_ids is non-empty, caller likely has firm context (getFirmMembers returned members)
    member_ids_param = (member_ids or "").strip()
    if not resolved_account_type and member_ids_param and caller_id:
        resolved_account_type = "FIRM_ADMIN"

    if resolved_account_type == "FIRM_ADMIN" and caller_id:
        # Use member_ids passed from frontend if available, else try internal fetch
        if member_ids_param:
            ids = [mid.strip() for mid in member_ids_param.split(",") if mid.strip()]
        else:
            try:
                members = await _fetch_firm_members(int(caller_id))
                ids = [str(m.get("user_id")) for m in members if m.get("user_id")]
            except Exception as exc:
                logger.warning("[TEAM] firm-member fetch failed: %s", exc)
                ids = []
        if caller_id not in ids:
            ids.append(caller_id)
        if ids:
            # Reports owned by firm members
            owned = report_list_firm_shared(ids, limit=100, case_id=case_id)
            # Reports shared with any firm member (including by users outside the firm)
            shared_with_us = report_list_shared_with_members(ids, limit=100, case_id=case_id)
            seen = {r["id"] for r in owned}
            for r in shared_with_us:
                if r["id"] not in seen:
                    seen.add(r["id"])
                    owned.append(r)
            reports = sorted(owned, key=lambda x: x.get("created_at") or "", reverse=True)[:100]
        else:
            reports = []
    elif caller_id:
        from db.client import get_pg_conn
        from psycopg2.extras import RealDictCursor as _RDC
        conn = get_pg_conn()
        reports = []
        if conn:
            try:
                with conn.cursor(cursor_factory=_RDC) as cur:
                    # Use EXISTS + jsonb_array_elements so user_id match works for both string/int in stored JSON
                    cur.execute(
                        """
                        SELECT id, user_id, query, created_at, status, case_id, citation_count,
                               hitl_pending_count, shared_with
                          FROM citation_reports r
                         WHERE r.user_id != %s
                           AND r.shared_with IS NOT NULL
                           AND jsonb_array_length(r.shared_with) > 0
                           AND EXISTS (
                             SELECT 1 FROM jsonb_array_elements(r.shared_with) elem
                             WHERE elem->>'user_id' = %s
                           )
                           AND (%s IS NULL OR r.case_id = %s)
                         ORDER BY r.created_at DESC LIMIT 100
                        """,
                        (caller_id, caller_id, case_id, case_id),
                    )
                    reports = cur.fetchall() or []
            finally:
                conn.close()
    else:
        reports = []

    return {"success": True, "reports": [dict(r) for r in reports]}


@app.get("/citation/reports")
async def list_reports(
    user_id: str = Query(..., description="User ID"),
    case_id: Optional[str] = Query(None, description="Filter by case ID"),
) -> Dict[str, Any]:
    """List citation reports. If case_id provided, returns reports for that specific case."""
    if case_id:
        reports = report_list_by_case(case_id, user_id=user_id, limit=50)
    else:
        reports = report_list_by_user(user_id, limit=50)
    return {"success": True, "reports": reports}


@app.delete("/citation/reports/{report_id}")
async def delete_report(
    report_id: str,
    user_id: Optional[str] = Query(None, description="Optional: only allow delete if report belongs to this user"),
) -> Dict[str, Any]:
    """Delete a generated citation report. Optionally pass user_id to restrict to own reports."""
    deleted = report_delete(report_id, user_id=user_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Report not found or not owned by user")
    return {"success": True, "message": "Report deleted", "report_id": report_id}


@app.get("/citation/firm-members")
async def get_firm_members_for_share(request: Request) -> Dict[str, Any]:
    """Return all firm members for the calling JWT user. Used by the share-report dialog."""
    payload = _decode_jwt(request)
    caller_id = payload.get("id") or payload.get("userId")
    if not caller_id:
        return {"success": True, "members": []}
    try:
        members = await _fetch_firm_members(int(caller_id))
        return {"success": True, "members": members}
    except Exception as exc:
        logger.warning("[SHARE] firm-members fetch failed: %s", exc)
        return {"success": True, "members": []}


@app.get("/citation/reports/{report_id}/shares")
async def get_report_shares_endpoint(report_id: str) -> Dict[str, Any]:
    """Get current shared_with list for a report."""
    shares = report_get_shares(report_id)
    return {"success": True, "shared_with": shares}


@app.post("/citation/reports/{report_id}/share")
async def share_report_endpoint(request: Request, report_id: str, body: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
    """
    Share a citation report with firm members.
    Body: { shared_with: [{user_id, email, username, shared_at}] }
    Only the report owner can share. user_id in entries is normalized to string for JSONB matching.
    """
    import datetime as _dt
    payload = _decode_jwt(request)
    caller_id = str(payload.get("id") or payload.get("userId") or "")

    report = report_get(report_id)
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    report_owner = str(report.get("user_id") or "")
    if report_owner and caller_id and report_owner != caller_id:
        raise HTTPException(status_code=403, detail="Only the report owner can share this report")

    shared_entries = body.get("shared_with") or []
    now_iso = _dt.datetime.utcnow().isoformat()
    normalized = []
    for entry in shared_entries:
        e = dict(entry)
        if not e.get("shared_at"):
            e["shared_at"] = now_iso
        if "user_id" in e and e["user_id"] is not None:
            e["user_id"] = str(e["user_id"])
        normalized.append(e)
    ok = report_share(report_id, normalized)
    if not ok:
        raise HTTPException(status_code=404, detail="Report not found")
    return {"success": True, "shared_with": normalized}


@app.get("/citation/judgements/{canonical_id}/full-text")
async def get_judgement_full_text(canonical_id: str) -> Dict[str, Any]:
    """Return the complete judgment text for a citation (by canonical_id). Used when user clicks 'View complete judgment'."""
    j = judgement_get(canonical_id)
    if not j:
        raise HTTPException(status_code=404, detail="Judgment not found")
    raw_full = j.get("full_text") or j.get("raw_content") or ""
    full_text = _html_to_text(raw_full)
    return {
        "success": True,
        "canonical_id": canonical_id,
        "case_name": j.get("title") or j.get("case_name") or "Judgment",
        "full_text": full_text,
        "source_url": j.get("source_url") or j.get("official_source_url") or j.get("import_source_link") or "",
    }


@app.get("/citation/reports/{report_id}")
async def get_report(report_id: str) -> Dict[str, Any]:
    """
    Get one report by ID. Returns report_format (citations + generatedAt) for the frontend.
    If status is pending_hitl, report_format includes pendingMessage and approved citations only;
    after HITL approval, status becomes completed and full report is returned.
    """
    # Guard against invalid UUIDs (e.g. placeholder "—") to avoid DB errors
    try:
        UUID(str(report_id))
    except Exception:
        raise HTTPException(status_code=404, detail="Report not found")

    report = report_get(report_id)
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    fmt = report.get("report_format")
    if isinstance(fmt, str):
        import json
        try:
            fmt = json.loads(fmt)
        except Exception:
            fmt = {"citations": [], "generatedAt": ""}
    return {
        "success": True,
        "report_id": report_id,
        "user_id": report.get("user_id"),
        "query": report.get("query"),
        "created_at": report.get("created_at"),
        "status": report.get("status", "completed"),
        "report_format": fmt,
        "hitl_pending_count": report.get("hitl_pending_count") or 0,
    }


@app.get("/citation/hitl/queue")
async def hitl_list(
    report_id: Optional[str] = Query(None),
    user_id: Optional[str] = Query(None),
    status: Optional[str] = Query("pending"),
) -> Dict[str, Any]:
    """List HITL queue items (pending citations for human verification). Filter by report_id or user_id."""
    from db.client import hitl_queue_list_by_report
    if report_id:
        items = hitl_queue_list_by_report(report_id, status=status)
    else:
        items = []  # TODO: hitl_queue_list_by_user if needed
    return {"success": True, "items": items}


@app.post("/citation/hitl/approve")
async def hitl_approve(
    report_id: str = Body(..., embed=True),
    hitl_ids: Optional[list] = Body(None, embed=True),
    approved: bool = Body(True, embed=True),
    reviewed_by: Optional[str] = Body(None, embed=True),
) -> Dict[str, Any]:
    """
    Approve or reject HITL items. If hitl_ids omitted, all pending items for report_id are updated.
    When all pending items for a report are approved, the report is rebuilt (approved + HITL-approved)
    and status set to completed so the user gets the full citation report.
    """
    from report_builder import build_report_from_judgements
    from db.client import report_get
    pending = hitl_queue_list_by_report(report_id, status="pending")
    if not pending:
        return {"success": True, "message": "No pending HITL items for this report", "report_status": report_get(report_id) or {}}
    to_update = [h for h in pending if not hitl_ids or str(h.get("id")) in [str(i) for i in hitl_ids]]
    new_status = "approved" if approved else "rejected"
    for h in to_update:
        hitl_queue_update_status(str(h["id"]), new_status, reviewed_by=reviewed_by)
    remaining = hitl_queue_pending_count(report_id)
    if remaining == 0:
        # Rebuild full report: approved citations + HITL-approved citation_snapshots
        report = report_get(report_id)
        if not report:
            raise HTTPException(status_code=404, detail="Report not found")
        fmt = report.get("report_format") or {}
        if isinstance(fmt, str):
            import json
            try:
                fmt = json.loads(fmt)
            except Exception:
                fmt = {}
        approved_items = hitl_queue_list_by_report(report_id, status="approved")
        citations = list(fmt.get("citations") or [])
        seen_ids = {c.get("canonicalId") or c.get("id") for c in citations}
        for h in approved_items:
            snap = h.get("citation_snapshot") or {}
            if not snap:
                continue
            cid = snap.get("canonicalId") or snap.get("id")
            if cid and cid not in seen_ids:
                citations.append(snap)
                seen_ids.add(cid)
        fmt["citations"] = citations
        fmt["status"] = "completed"
        fmt.pop("pendingHITLCount", None)
        fmt.pop("pendingMessage", None)
        report_update(report_id, report_format=fmt, status="completed", hitl_pending_count=0, hitl_approved_count=len(approved_items))
    return {
        "success": True,
        "updated": len(to_update),
        "remaining_pending": remaining,
        "report_id": report_id,
        "report_status": "completed" if remaining == 0 else "pending_hitl",
    }


@app.post("/citation/hitl/{ticket_id}/notify")
async def hitl_notify_me(
    ticket_id: str,
    user_id: str = Body(..., embed=True),
) -> Dict[str, Any]:
    """
    Register a user to be notified when HITL ticket is resolved.
    Stores user_id against the ticket so a notification can be pushed on resolution.
    """
    from db.connections import get_pg_conn
    conn = get_pg_conn()
    if not conn:
        return {"success": False, "error": "Database unavailable"}
    try:
        with conn.cursor() as cur:
            # Store notify subscribers as a JSONB array in hitl_queue
            cur.execute(
                """
                UPDATE hitl_queue
                SET citation_snapshot = jsonb_set(
                    COALESCE(citation_snapshot, '{}'::jsonb),
                    '{notify_users}',
                    COALESCE(citation_snapshot->'notify_users', '[]'::jsonb) || to_jsonb(%s::text),
                    true
                )
                WHERE id = %s
                """,
                (user_id, ticket_id),
            )
        conn.commit()
        logger.info("[HITL] Notify-me registered: user=%s ticket=%s", user_id, ticket_id)
        return {"success": True, "ticket_id": ticket_id, "message": "You will be notified when this citation is verified."}
    except Exception as e:
        logger.warning("[HITL] notify_me failed: %s", e)
        return {"success": False, "error": str(e)}
    finally:
        conn.close()


@app.get("/citation/runs/{run_id}/logs")
async def get_run_logs(
    run_id: str,
    limit: int = Query(200, le=2000),
    since_time: str = Query("", description="ISO timestamp — return only logs created after this time (for polling)"),
) -> Dict[str, Any]:
    """Return agent logs for a pipeline run. Use since_time for incremental polling.

    Timestamps are converted to Asia/Kolkata (IST) so the frontend can display
    user-facing times without having to guess server timezone.
    """
    from db.connections import get_pg_conn
    from psycopg2.extras import RealDictCursor
    conn = get_pg_conn()
    if not conn:
        return {"success": True, "run_id": run_id, "logs": [], "count": 0}
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            if since_time:
                cur.execute(
                    """SELECT id, run_id, report_id, agent_name, stage, log_level, message, metadata, created_at
                         FROM agent_logs
                        WHERE run_id = %s AND created_at > %s::timestamptz
                        ORDER BY created_at ASC LIMIT %s""",
                    (run_id, since_time, limit),
                )
            else:
                cur.execute(
                    """SELECT id, run_id, report_id, agent_name, stage, log_level, message, metadata, created_at
                         FROM agent_logs
                        WHERE run_id = %s
                        ORDER BY created_at ASC LIMIT %s""",
                    (run_id, limit),
                )
            rows = cur.fetchall()
        logs = [dict(r) for r in rows]
        from datetime import timezone, timedelta

        ist = timezone(timedelta(hours=5, minutes=30))
        for l in logs:
            ts = l.get("created_at")
            if not ts:
                continue
            # Database often stores naive UTC timestamps; normalize to UTC first if needed.
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=timezone.utc)
            l["created_at"] = ts.astimezone(ist).isoformat()
            
            # psycopg2 returns jsonb as strings if register_json() isn't called
            meta = l.get("metadata")
            if isinstance(meta, str):
                import json
                try:
                    l["metadata"] = json.loads(meta)
                except Exception:
                    pass

        return {"success": True, "run_id": run_id, "logs": logs, "count": len(logs)}
    finally:
        conn.close()


@app.get("/citation/analytics/enterprise")
async def get_enterprise_analytics(
    request: Request,
    days: int = Query(30, ge=1, le=365, description="Number of days for summary and team activity"),
    months: int = Query(6, ge=1, le=24, description="Number of months for volume trend"),
) -> Dict[str, Any]:
    """
    Enterprise usage analytics — restricted to FIRM_ADMIN users.

    Aggregates:
    - summary: total queries / citations / time saved / active users (last N days)
    - volume_trend: monthly queries + citations (last N months)
    - team_activity: per-user stats (last N days)
    """
    payload = _decode_jwt(request)
    account_type = str(payload.get("account_type") or "").upper() or None
    if account_type and account_type != "FIRM_ADMIN":
        raise HTTPException(status_code=403, detail="Access restricted to firm administrators.")

    # Fetch all firm members (id + email + username + auth_type + role) for the calling user
    caller_id = payload.get("id") or payload.get("userId")
    members: List[Dict[str, Any]] = []
    if caller_id:
        try:
            caller_id = int(caller_id)
            members = await _fetch_firm_members(caller_id)
            # If firm-members returned fallback (username same as user_id), try bulk lookup to get real info
            if members and str(members[0].get("username")) == str(members[0].get("user_id", "")):
                bulk_users = await _fetch_users_bulk([int(m.get("user_id")) for m in members if m.get("user_id")])
                if bulk_users:
                    members = bulk_users
        except Exception as exc:
            logger.warning("[ANALYTICS] firm-members fetch failed: %s", exc)

    # Build user_id → {display_name, username, auth_type, role} map for team activity table
    user_info_map: Dict[str, Dict[str, Any]] = {}
    member_ids: List[str] = []
    for m in members:
        uid_str = str(m.get("user_id", ""))
        if uid_str:
            member_ids.append(uid_str)
            display = m.get("username") or m.get("email") or uid_str
            user_info_map[uid_str] = {
                "display_name": display,
                "username": m.get("username") or m.get("email") or uid_str,
                "auth_type": m.get("auth_type") or "—",
                "role": m.get("role") or "—",
            }

    data = analytics_get_enterprise_dashboard(
        days_window=days,
        months=months,
        member_ids=member_ids if member_ids else None,
        user_info_map=user_info_map if user_info_map else None,
    )

    # Post-process: bulk lookup any team_activity rows that still show user_id (username/display_name == user_id)
    team_activity = data.get("team_activity") or []
    ids_to_lookup = []
    for row in team_activity:
        uid = row.get("user_id", "")
        un = row.get("username") or row.get("display_name") or ""
        if uid and str(un) == str(uid) and uid not in ("anonymous", "Anonymous"):
            try:
                nid = int(uid)
                if nid > 0:
                    ids_to_lookup.append(nid)
            except (ValueError, TypeError):
                pass
    if ids_to_lookup:
        bulk_users = await _fetch_users_bulk(list(set(ids_to_lookup)))
        bulk_map = {str(u.get("user_id")): u for u in bulk_users if u.get("user_id")}
        for row in team_activity:
            uid_str = str(row.get("user_id", ""))
            if uid_str in bulk_map:
                u = bulk_map[uid_str]
                row["username"] = u.get("username") or u.get("email") or row.get("username")
                row["display_name"] = u.get("email") or u.get("username") or row.get("display_name")
                row["auth_type"] = u.get("auth_type") or row.get("auth_type")
                row["role"] = u.get("role") or row.get("role")

    return {"success": True, **data}


# In-memory run state: run_id → {status, report_id, report_format, error}
_run_state: Dict[str, Dict[str, Any]] = {}

@app.post("/citation/report/start")
async def start_citation_report(
    request: Request,
    query: str = Body("", embed=True),
    user_id: Optional[str] = Body("anonymous", embed=True),
    case_id: Optional[str] = Body(None, embed=True),
    case_file_context: Optional[List[Dict[str, Any]]] = Body(None, embed=True),
    use_pipeline: bool = Body(True, embed=True),
) -> Dict[str, Any]:
    """Start citation report pipeline in background. Returns run_id immediately for log polling."""
    import uuid as _uuid
    from db.client import pipeline_run_insert, agent_log_insert
    from db.connections import get_pg_conn

    query = (query or "").strip()
    user_id = (user_id or "anonymous").strip()

    # Fetch case context from document-service when case_id is provided but context is missing.
    # Must be done here (async handler) before spawning the sync background thread.
    if case_id and not case_file_context:
        auth_header_pre = request.headers.get("authorization")
        case_file_context, _ = await _fetch_case_context(case_id, auth_header_pre)

    # Pre-generate run_id so frontend can start polling before pipeline creates it
    run_id = str(_uuid.uuid4())
    _run_state[run_id] = {"status": "running", "report_id": None, "report_format": None, "error": None}

    # Seed a first log immediately so frontend sees something
    try:
        pipeline_run_insert(run_id, user_id, query, case_id=case_id)
        agent_log_insert(run_id, None, "root", "start", "INFO",
                         f"Pipeline started — query: {query[:120]}", {"query": query[:500]})
    except Exception as exc:
        logger.warning("[START] DB seed failed: %s", exc)

    auth_header = request.headers.get("authorization")

    def _run_bg():
        try:
            from agents.root_agent import CitationRootAgent, AgentContext
            context = AgentContext(
                query=query, user_id=user_id, case_id=case_id,
                metadata={"case_file_context": case_file_context or [], "ingest_external": True, "run_id": run_id},
            )
            root = CitationRootAgent()
            result = root.run(context)
            if result.success:
                _run_state[run_id] = {
                    "status": "completed",
                    "report_id": result.data.get("report_id"),
                    "report_format": result.data.get("report_format"),
                    "error": None,
                }
            else:
                _run_state[run_id] = {"status": "failed", "report_id": None, "report_format": None, "error": result.error}
        except Exception as exc:
            logger.exception("[BG_PIPELINE] crashed: %s", exc)
            _run_state[run_id] = {"status": "failed", "report_id": None, "report_format": None, "error": str(exc)}

    threading.Thread(target=_run_bg, daemon=True).start()
    return {"success": True, "run_id": run_id, "status": "running"}


@app.get("/citation/runs/{run_id}/status")
async def get_run_status(run_id: str) -> Dict[str, Any]:
    """Poll for pipeline run completion. Returns status + report when done."""
    state = _run_state.get(run_id)
    if state:
        return {"success": True, "run_id": run_id, **state}
    # Fallback: check DB citation_pipeline_runs table
    from db.connections import get_pg_conn
    from psycopg2.extras import RealDictCursor
    conn = get_pg_conn()
    if conn:
        try:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("SELECT status, report_id FROM citation_pipeline_runs WHERE id=%s", (run_id,))
                row = cur.fetchone()
            if row:
                return {"success": True, "run_id": run_id, "status": row["status"], "report_id": row["report_id"], "report_format": None, "error": None}
        finally:
            conn.close()
    return {"success": False, "run_id": run_id, "status": "unknown"}
