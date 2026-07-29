"""
FastAPI transport layer for the judgement-service search pipeline.

Thin by design: request validation, session lookup and background vault
writes live here; all pipeline logic is in agents.py / tools.py. Every
credential comes from .env via config.get_settings().

Run:  python -m uvicorn api:app --host 0.0.0.0 --port 8002
"""

from __future__ import annotations

import asyncio
import logging
import re
from datetime import date
from typing import Any

import httpx
from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from agents import (
    analyze_case,
    generate_citation_analysis,
    run_issue_search,
    run_search_pipeline,
)
from config import get_settings
from schemas import (
    AnalyzeCaseRequest,
    AnalyzeResponse,
    Candidate,
    CaseContext,
    Issue,
    KeywordSet,
    RefinedItem,
    RefineRequest,
    RefineResponse,
    ReportStatusRequest,
    ResultItem,
    RunSearchRequest,
    SearchRequest,
    SearchResponse,
)
from stores import postgres, sessions, store_health
from tools import (
    band_for,
    citation_guardian,
    composite_score,
    embedder,
    cosine,
    fetch_case_pages,
    grounded_good_law_check,
    ik_client,
    normalize_ws,
    parse_document,
    parse_document_pages,
    strip_html,
    year_from_text,
)
from schemas import ScoredResult, SignalSet

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("judgement.api")

settings = get_settings()

app = FastAPI(
    title="Jurinex Judgement Service",
    description="Agent-orchestrated Indian case-law retrieval with closed-world citation safety.",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "service": "judgement-service",
        "port": settings.port,
        "ikTokenConfigured": bool(settings.ik_token),
        "geminiConfigured": bool(settings.google_api_key),
        "scoringPhase": settings.scoring_phase,
        "phaseWeights": settings.phase_weights,
        "relevanceJudge": {
            "enabled": settings.relevance_judge_enabled,
            "weight": settings.relevance_judge_weight,
        },
        "ikDoctypes": settings.ik_doctypes,
        "stores": store_health(),
    }


# ─── Vault write path (flywheel) — async, never blocks the response ─────────

def _vault_write(response: SearchResponse) -> None:
    session = sessions.load(response.sessionId) or {}
    meta_by_issue = {i["id"]: i.get("candidateMeta", {}) for i in session.get("issues", [])}
    rows: list[dict[str, Any]] = []
    seen: set[str] = set()
    for issue in response.issues:
        meta = meta_by_issue.get(issue.id, {})
        for item in issue.results:
            if item.band == "GREEN" and item.docId not in seen:
                seen.add(item.docId)
                m = meta.get(item.docId, {})
                rows.append({
                    "doc_id": item.docId, "title": item.title, "court": item.court,
                    "year": item.year, "headline": m.get("headline", ""),
                    "num_citedby": m.get("numCitedby", 0),
                })
    if rows:
        written = postgres.vault_upsert(rows)
        logger.info("[vault] persisted %d/%d GREEN survivors", written, len(rows))


# ─── Research history (stored in citationTest) ──────────────────────────────

def _tag_session(session_id: str, user_id: str | None, case_title: str | None = None,
                 case_id: str | None = None) -> None:
    """Attach ownership + display title + source case to a stored session
    so history can be listed per user and per case."""
    session = sessions.load(session_id)
    if session is None:
        return
    changed = False
    for key, value in (("userId", user_id), ("caseTitle", case_title), ("caseId", case_id)):
        if value and session.get(key) != value:
            session[key] = value
            changed = True
    if changed:
        sessions.save(session_id, session)


@app.get("/api/v1/sessions")
async def list_sessions(http_request: Request) -> dict[str, Any]:
    """Research history, newest first. Scoped by X-User-Id when present."""
    user_id = http_request.headers.get("x-user-id")
    rows = await asyncio.to_thread(postgres.session_list, user_id)
    return {"sessions": rows}


@app.get("/api/v1/search/{session_id}")
async def get_session(session_id: str) -> dict[str, Any]:
    """Reopen a stored research session: case context, suggested issues,
    every fetched citation, and saved approve/reject decisions."""
    session = sessions.load(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Unknown or expired sessionId")
    statuses: dict[str, dict[str, str]] = {}
    for issue in session.get("issues", []):
        reports = issue.get("reports") or {}
        if reports:
            statuses[str(issue["id"])] = {
                doc_id: (entry or {}).get("status", "pending")
                for doc_id, entry in reports.items()
            }
    return {
        "sessionId": session_id,
        "caseTitle": session.get("caseTitle"),
        "caseContext": session.get("caseContext"),
        "suggestedIssues": session.get("suggestedIssues", []),
        "issues": [
            {key: issue.get(key) for key in ("id", "issue", "title", "keywords", "results")}
            for issue in session.get("issues", [])
        ],
        "statuses": statuses,
    }


# ─── Two-phase interactive flow (Citation Research UI) ──────────────────────
# Phase 1: /analyze → case context + system-suggested issues (no IK spend).
# Phase 2: /search/run → retrieval for the issues the user selected and/or
#          typed in their own words.

def _gather_case_text(text: str | None, file_ref: str | None) -> str:
    parts: list[str] = []
    if file_ref:
        try:
            doc_text = parse_document(file_ref)
        except (OSError, ValueError) as exc:
            raise HTTPException(status_code=400, detail=f"Could not read fileRef: {exc}")
        if doc_text:
            parts.append(doc_text)
    if text and text.strip():
        parts.append(text.strip())
    if not parts:
        raise HTTPException(status_code=400,
                            detail="caseInput must include text and/or a readable fileRef")
    return "\n\n---\n\n".join(parts)


@app.post("/api/v1/analyze", response_model=AnalyzeResponse)
async def analyze(request: SearchRequest, http_request: Request) -> AnalyzeResponse:
    raw_text = await asyncio.to_thread(_gather_case_text, request.caseInput.text,
                                       request.caseInput.fileRef)
    session_id, context, issues = await analyze_case(raw_text)
    _tag_session(session_id, http_request.headers.get("x-user-id"))
    return AnalyzeResponse(
        sessionId=session_id, caseContext=context, suggestedIssues=issues,
        needsClarification=context.needs_clarification,
        clarificationQuestion=context.clarification_question,
    )


@app.post("/api/v1/analyze/case", response_model=AnalyzeResponse)
async def analyze_from_case(request: AnalyzeCaseRequest, http_request: Request) -> AnalyzeResponse:
    """Analyze one of the user's existing cases: documents + page-numbered
    chunks are pulled from the agentic document service, so suggested
    issues carry 'file, page N' source references."""
    auth_header = http_request.headers.get("authorization")
    user_id = http_request.headers.get("x-user-id") or request.userId
    try:
        case_title, pages, llm_text, full_text = await fetch_case_pages(
            request.caseId, auth_header, user_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Document service unreachable: {exc}")

    if request.text and request.text.strip():
        note = request.text.strip()
        llm_text = f"{llm_text}\n\n[LAWYER'S INSTRUCTION]\n{note}"
        full_text = f"{full_text}\n\n{note}"

    session_id, context, issues = await analyze_case(llm_text, source_text=full_text, pages=pages)
    _tag_session(session_id, user_id, case_title or None, str(request.caseId))
    return AnalyzeResponse(
        sessionId=session_id, caseContext=context, suggestedIssues=issues,
        needsClarification=context.needs_clarification,
        clarificationQuestion=context.clarification_question,
        caseId=request.caseId, caseTitle=case_title or None,
    )


@app.post("/api/v1/analyze/upload", response_model=AnalyzeResponse)
async def analyze_upload(http_request: Request, file: UploadFile = File(...),
                         text: str = Form(default="")) -> AnalyzeResponse:
    data = await file.read()
    pages = await asyncio.to_thread(parse_document_pages, data, file.filename or "")
    doc_text = "\n\n".join(p.text for p in pages if p.text.strip())
    parts = [p for p in (doc_text, text.strip()) if p]
    if not parts:
        raise HTTPException(status_code=400, detail="Uploaded file produced no readable text")
    session_id, context, issues = await analyze_case("\n\n---\n\n".join(parts), pages=pages)
    _tag_session(session_id, http_request.headers.get("x-user-id"),
                 (file.filename or "").rsplit(".", 1)[0] or None)
    return AnalyzeResponse(
        sessionId=session_id, caseContext=context, suggestedIssues=issues,
        needsClarification=context.needs_clarification,
        clarificationQuestion=context.clarification_question,
    )


@app.post("/api/v1/search/{session_id}/run", response_model=SearchResponse)
async def search_run(session_id: str, request: RunSearchRequest,
                     background: BackgroundTasks, http_request: Request) -> SearchResponse:
    session = sessions.load(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Unknown or expired sessionId — analyze first")
    context = CaseContext.model_validate(session.get("caseContext") or {})
    suggested = [Issue.model_validate(i) for i in session.get("suggestedIssues", [])]

    if request.issueIds is not None:
        wanted = set(request.issueIds)
        chosen = [i for i in suggested if i.id in wanted]
    else:
        chosen = list(suggested)
    next_id = max((i.id for i in suggested), default=0)
    for custom in request.customIssues:
        if custom.strip():
            next_id += 1
            chosen.append(Issue(id=next_id, issue=custom.strip()))
    if not chosen:
        raise HTTPException(status_code=400, detail="No issues selected and none provided")

    # The user explicitly chose what to search — a pending clarification
    # no longer blocks (their own issues ARE the clarification).
    context.needs_clarification = False
    context.clarification_question = None

    response = await run_issue_search(session_id, context, chosen)
    _tag_session(session_id, http_request.headers.get("x-user-id"))
    background.add_task(_vault_write, response)
    return response


# ─── POST /api/v1/search ─────────────────────────────────────────────────────

@app.post("/api/v1/search", response_model=SearchResponse)
async def search(request: SearchRequest, background: BackgroundTasks) -> SearchResponse:
    case = request.caseInput
    parts: list[str] = []
    if case.fileRef:
        try:
            doc_text = await asyncio.to_thread(parse_document, case.fileRef)
        except (OSError, ValueError) as exc:
            raise HTTPException(status_code=400, detail=f"Could not read fileRef: {exc}")
        if doc_text:
            parts.append(doc_text)
    if case.text and case.text.strip():
        parts.append(case.text.strip())
    if not parts:
        raise HTTPException(status_code=400, detail="caseInput must include text and/or a readable fileRef")

    raw_text = "\n\n---\n\n".join(parts)
    response = await run_search_pipeline(raw_text)
    background.add_task(_vault_write, response)
    return response


@app.post("/api/v1/search/upload", response_model=SearchResponse)
async def search_upload(
    background: BackgroundTasks,
    file: UploadFile = File(...),
    text: str = Form(default=""),
) -> SearchResponse:
    """Multipart convenience wrapper: uploaded case file (+ optional typed
    instruction) routed through the same Document Context Service."""
    data = await file.read()
    doc_text = await asyncio.to_thread(parse_document, None, data, file.filename or "")
    parts = [p for p in (doc_text, text.strip()) if p]
    if not parts:
        raise HTTPException(status_code=400, detail="Uploaded file produced no readable text")
    response = await run_search_pipeline("\n\n---\n\n".join(parts))
    background.add_task(_vault_write, response)
    return response


# ─── Per-citation report (VIEW → Report/Document tabs) ──────────────────────

_FACT_STOPWORDS = frozenset(
    "the of and in a to is for under whether not on by with or any that this be as "
    "was were has have had it its at from an are court india".split())


def _factual_relevance(case_facts: str, doc_text: str) -> float:
    """Deterministic: share of the case's distinctive fact terms that appear
    in the judgment text. Never LLM-estimated."""
    fact_tokens = {t for t in re.findall(r"[a-z0-9]+", case_facts.lower())
                   if len(t) > 3 and t not in _FACT_STOPWORDS}
    if not fact_tokens:
        return 0.0
    doc_tokens = set(re.findall(r"[a-z0-9]+", doc_text.lower()))
    return round(len(fact_tokens & doc_tokens) / len(fact_tokens), 4)


_STRENGTH_BY_BAND = {"GREEN": "Strong", "YELLOW": "Moderate", "RED": "Weak"}

# Bench fallback: IK /docmeta bench/author are frequently empty, but the
# judgment text itself names the coram — HC headers ("HON'BLE MR. JUSTICE …",
# "CORAM: …, J.") and SC signature blocks ("………J. (ABHAY S. OKA)").
_JUSTICE_RE = re.compile(
    r"(?i)\bHON[O'U]*RABLE\s+(?:THE\s+)?(?:MR\.?|MRS\.?|MS\.?|DR\.?|SHRI|SMT\.?)?\s*"
    r"(?:CHIEF\s+)?JUSTICE\s+([A-Z][A-Za-z.\-' ]{2,50}?)(?=\s*(?:,|\n|;|AND\b|&|$))")
_HONBLE_RE = re.compile(
    r"(?i)\bHON'?BLE\s+(?:THE\s+)?(?:MR\.?|MRS\.?|MS\.?|DR\.?|SHRI|SMT\.?)?\s*"
    r"(?:CHIEF\s+)?JUSTICE\s+([A-Z][A-Za-z.\-' ]{2,50}?)(?=\s*(?:,|\n|;|AND\b|&|$))")
_CORAM_SUFFIX_RE = re.compile(r"\b([A-Z][A-Za-z.\-' ]{3,50}?),\s*(?:C\.?J\.?I?|JJ?\.)(?=[\s,)\]]|$)")
_SIGNATURE_RE = re.compile(r"JJ?\.?\s*[\(\[]\s*([A-Z][A-Za-z.\-' ]{3,40}?)\s*[\)\]]")


def _bench_from_text(doc_text: str) -> list[str]:
    """Deterministic coram extraction from the judgment's own text — used
    only when /docmeta returns no bench/author. Names are taken verbatim
    from the text, never guessed."""
    names: list[str] = []
    for chunk in (doc_text[:6000], doc_text[-3500:]):
        for pattern in (_JUSTICE_RE, _HONBLE_RE, _CORAM_SUFFIX_RE, _SIGNATURE_RE):
            for m in pattern.finditer(chunk):
                name = re.sub(r"\s+", " ", m.group(1)).strip(" .,-")
                if len(name) >= 4 and all(name.lower() != n.lower() for n in names):
                    names.append(name)
    return names[:6]


@app.get("/api/v1/search/{session_id}/report/{issue_id}/{doc_id}")
async def citation_report(session_id: str, issue_id: int, doc_id: str):
    """Full legal-intelligence report for one surfaced citation. Closed
    world holds: reports exist only for docIds already in this session's
    guardian-verified results. LLM analysis is grounded on the fetched
    judgment text and cached in the session."""
    from schemas import CitationAnalysis, CitationReport

    session = sessions.load(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Unknown or expired sessionId")
    issue = next((i for i in session.get("issues", []) if i["id"] == issue_id), None)
    if issue is None:
        raise HTTPException(status_code=404, detail=f"issueId {issue_id} not in session")
    item = next((r for r in issue.get("results", []) if r["docId"] == doc_id), None)
    if item is None:
        # Never generate a report for a docId that wasn't verified into results.
        raise HTTPException(status_code=404, detail="docId is not part of this issue's verified results")

    doc_text, info = await ik_client.fetch_doc_bundle(doc_id)
    meta = await ik_client.fetch_doc_meta(doc_id)
    context = session.get("caseContext") or {}
    case_facts = f"{context.get('facts', '')} {context.get('raw_case_summary', '')}"

    reports = issue.setdefault("reports", {})
    cached = reports.get(doc_id)
    if cached and cached.get("analysis"):
        analysis = CitationAnalysis.model_validate(cached["analysis"])
    else:
        analysis = await generate_citation_analysis(
            issue.get("issue", ""), context.get("raw_case_summary", ""),
            item.get("title", ""), doc_text or item.get("headline", ""))
        reports[doc_id] = {**(cached or {}), "analysis": analysis.model_dump()}
        sessions.save(session_id, session)

    bench_raw = meta.get("bench") or meta.get("author") or ""
    bench = [b.strip() for b in bench_raw.split(",") if b.strip()][:6]
    if not bench and doc_text:
        # /docmeta gave nothing — read the coram from the judgment itself.
        bench = _bench_from_text(doc_text)

    # Web-grounded good-law check (Google Search grounding) — cached per
    # session; an empty (failed) check is retried on the next view.
    good_law_check = (reports.get(doc_id) or {}).get("goodLawCheck") or {}
    if not good_law_check and settings.good_law_web_check:
        good_law_check = await grounded_good_law_check(
            item.get("title", ""), item.get("court", ""), item.get("year"))
        if good_law_check:
            reports[doc_id] = {**(reports.get(doc_id) or {}), "goodLawCheck": good_law_check}
            sessions.save(session_id, session)

    return CitationReport(
        docId=doc_id,
        issueId=issue_id,
        issue=issue.get("issue", ""),
        title=item.get("title", ""),
        court=item.get("court", ""),
        publishDate=meta.get("publishdate") or info.get("publishdate", ""),
        author=meta.get("author", ""),
        bench=bench,
        url=item.get("url", ""),
        status=(reports.get(doc_id) or {}).get("status", "pending"),
        band=item.get("band", "RED"),
        applicabilityStrength=_STRENGTH_BY_BAND.get(item.get("band"), "Weak"),
        semanticMatch=float((item.get("signals") or {}).get("semantic", 0.0)),
        factualRelevance=_factual_relevance(case_facts, doc_text or ""),
        signals=item.get("signals") or {},
        excerpt=item.get("pinpoint") or item.get("headline") or None,
        matchedTerms=item.get("matchedTerms") or [],
        citesTotal=info.get("citesTotal", 0),
        # /doc sometimes returns an empty citedbyList even when the search
        # index knows the count — fall back to the search-time metadata.
        citedByTotal=info.get("citedByTotal", 0) or int(
            (issue.get("candidateMeta", {}).get(doc_id) or {}).get("numCitedby", 0)),
        casesCitedSample=info.get("casesCitedSample", []),
        citedBySample=info.get("citedBySample", []),
        goodLawCheck=good_law_check,
        analysis=analysis,
        documentText=(doc_text or "")[:400000],
        generatedOn=date.today().isoformat(),
    )


@app.post("/api/v1/search/{session_id}/report/{issue_id}/{doc_id}/status")
async def set_report_status(session_id: str, issue_id: int, doc_id: str,
                            request: ReportStatusRequest):
    session = sessions.load(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Unknown or expired sessionId")
    issue = next((i for i in session.get("issues", []) if i["id"] == issue_id), None)
    if issue is None or not any(r["docId"] == doc_id for r in issue.get("results", [])):
        raise HTTPException(status_code=404, detail="Citation not found in session")
    reports = issue.setdefault("reports", {})
    reports[doc_id] = {**(reports.get(doc_id) or {}), "status": request.status}
    sessions.save(session_id, session)
    return {"docId": doc_id, "issueId": issue_id, "status": request.status}


# ─── POST /api/v1/search/{sessionId}/refine (Section 10) ────────────────────

_AFTER_RE = re.compile(r"(?i)\bafter\s+((?:19|20)\d{2})")
_BEFORE_RE = re.compile(r"(?i)\bbefore\s+((?:19|20)\d{2})")


def _facet_match(item: ResultItem, req: RefineRequest) -> bool:
    court = req.court
    year_from, year_to, band = req.yearFrom, req.yearTo, req.band
    query = req.query or ""
    if court is None:
        for name in ("supreme court", "high court", "district", "tribunal"):
            if name in query.lower():
                court = name
                break
    if year_from is None:
        m = _AFTER_RE.search(query)
        if m:
            year_from = int(m.group(1))
    if year_to is None:
        m = _BEFORE_RE.search(query)
        if m:
            year_to = int(m.group(1))
    if court and court.lower() not in (item.court or "").lower():
        return False
    if year_from and (item.year is None or item.year < year_from):
        return False
    if year_to and (item.year is None or item.year > year_to):
        return False
    if band and item.band != band:
        return False
    return True


def _keyword_match(item: ResultItem, meta: dict[str, Any], query: str) -> bool:
    haystack = normalize_ws(" ".join([
        item.title or "", item.pinpoint or "",
        str(meta.get(item.docId, {}).get("headline", "")),
    ]))
    terms = [t for t in normalize_ws(query).split() if len(t) > 2]
    return bool(terms) and all(t in haystack for t in terms)


async def _semantic_order(items: list[ResultItem], meta: dict[str, Any],
                          query: str) -> dict[str, float]:
    """Cosine against the cached Qdrant embeddings — reuse, don't recompute
    (misses only occur if the cache expired)."""
    query_vec = await embedder.embed_query(query)
    candidates = [
        Candidate(doc_id=item.docId, title=item.title,
                  headline=str(meta.get(item.docId, {}).get("headline", "")))
        for item in items
    ]
    vectors = await embedder.embed_candidates(candidates) if query_vec else {}
    scores: dict[str, float] = {}
    for item in items:
        vec = vectors.get(item.docId)
        scores[item.docId] = max(0.0, cosine(query_vec, vec)) if (query_vec and vec) else 0.0
    return scores


@app.post("/api/v1/search/{session_id}/refine", response_model=RefineResponse)
async def refine(session_id: str, request: RefineRequest) -> RefineResponse:
    session = sessions.load(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Unknown or expired sessionId")
    issue = next((i for i in session.get("issues", []) if i["id"] == request.issueId), None)
    if issue is None:
        raise HTTPException(status_code=404, detail=f"issueId {request.issueId} not in session")

    items = [ResultItem.model_validate(r) for r in issue.get("results", [])]
    meta = issue.get("candidateMeta", {})

    # Escape hatch — the ONLY search-within path allowed to hit IK.
    if request.mode == "ik_escape":
        return await _ik_escape(session_id, request, issue)

    if request.mode == "facet":
        flags = {item.docId: _facet_match(item, request) for item in items}
        ordered = sorted(items, key=lambda i: flags[i.docId], reverse=True)
    elif request.mode == "keyword":
        flags = {item.docId: _keyword_match(item, meta, request.query) for item in items}
        ordered = sorted(items, key=lambda i: flags[i.docId], reverse=True)
    else:  # semantic
        scores = await _semantic_order(items, meta, request.query)
        flags = {item.docId: scores[item.docId] >= 0.5 for item in items}
        ordered = sorted(items, key=lambda i: scores[i.docId], reverse=True)

    # Reorder / de-emphasise — NEVER hard-delete: every result stays in the
    # view; non-matching ones are only demoted.
    refined = [RefinedItem(result=item, matchesRefinement=flags[item.docId],
                           demoted=not flags[item.docId]) for item in ordered]
    matched = sum(1 for f in flags.values() if f)

    escape = None
    if matched == 0:
        escape = {
            "offer": "No cached result matches this refinement. Search all of Indian Kanoon for it?",
            "how": {"mode": "ik_escape", "query": request.query, "issueId": request.issueId},
        }
    return RefineResponse(sessionId=session_id, issueId=request.issueId,
                          mode=request.mode, items=refined,
                          matchedCount=matched, escapeHatch=escape)


async def _ik_escape(session_id: str, request: RefineRequest,
                     issue: dict[str, Any]) -> RefineResponse:
    if not request.query.strip():
        raise HTTPException(status_code=400, detail="ik_escape requires a query")
    docs = await ik_client.search(request.query)
    pool: dict[str, Candidate] = {}
    for doc in docs[:settings.ik_candidate_cap]:
        doc_id = str(doc.get("tid") or "").strip()
        if not doc_id or doc_id in pool:
            continue
        title = strip_html(str(doc.get("title") or "")).strip()
        pool[doc_id] = Candidate(
            doc_id=doc_id, title=title,
            court=str(doc.get("docsource") or "").strip(),
            year=year_from_text(str(doc.get("publishdate") or ""), title),
            headline=strip_html(str(doc.get("headline") or "")).strip(),
            num_citedby=int(doc.get("numcitedby") or 0),
            source_url=f"https://indiankanoon.org/doc/{doc_id}/",
            matched_terms=[request.query],
        )
    candidates = list(pool.values())
    issue_text = str(issue.get("issue", request.query))
    from tools import rerank  # local import avoids cycle at module load
    semantic = await rerank(issue_text, candidates)

    scored: list[ScoredResult] = []
    for cand in candidates:
        sem = semantic.get(cand.doc_id, 0.0)
        signals = SignalSet(semantic_match=round(sem, 4),
                            keyword_match=1.0 if cand.matched_terms else 0.0)
        result = composite_score(signals, settings.phase_weights)
        result.doc_id = cand.doc_id
        result.band = band_for(sem)
        scored.append(result)
    scored.sort(key=lambda r: r.score, reverse=True)

    # Closed-world rule holds here too: guardian verifies against exactly
    # the pool this escape-hatch fetch produced. No bypass, ever.
    clean, _drops = citation_guardian.verify(scored, pool)

    refined = [
        RefinedItem(
            result=ResultItem(
                docId=r.doc_id, title=pool[r.doc_id].title, court=pool[r.doc_id].court,
                year=pool[r.doc_id].year, band=r.band, score=r.score,
                url=pool[r.doc_id].source_url,
                signals={"semantic": r.breakdown.semantic_match},
                chips=[pool[r.doc_id].court or "Court",
                       f"{round(r.breakdown.semantic_match * 100)}% on point"],
            ),
            matchesRefinement=True,
        )
        for r in clean
    ]
    return RefineResponse(sessionId=session_id, issueId=request.issueId,
                          mode="ik_escape", items=refined, matchedCount=len(refined))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("api:app", host=settings.api_host, port=settings.port, reload=settings.debug)
