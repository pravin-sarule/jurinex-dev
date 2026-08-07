"""
Deterministic tools for the judgement-service pipeline.

Everything in this file is plain Python — no LLM calls except the
embedding requests in EmbeddingTool. The load-bearing safety component,
CitationGuardian, lives here: pure code, runs on every response, no
bypass. Indian Kanoon does the lexical fetch; we do the semantics; we
never originate a citation.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import math
import re
from collections import Counter
from typing import Any

import httpx

from config import get_settings
from schemas import (
    Candidate,
    CaseContext,
    CaseContextDraft,
    Issue,
    JudgmentVerification,
    KeywordSet,
    ScoredResult,
    SignalSet,
    SourcePage,
)
from stores import cache, neo4j_store, qdrant

logger = logging.getLogger(__name__)

IK_BASE = "https://api.indiankanoon.org"


# ─── Text helpers ─────────────────────────────────────────────────────────────

_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"\s+")


def strip_html(text: str) -> str:
    return _TAG_RE.sub(" ", text or "")


def normalize_ws(text: str) -> str:
    return _WS_RE.sub(" ", (text or "")).strip().lower()


def _tokens(text: str) -> list[str]:
    return re.findall(r"[a-z0-9]+", (text or "").lower())


def tf_cosine(a: str, b: str) -> float:
    """Lexical cosine over term frequencies — degraded fallback used only
    when the embedding backend is unavailable."""
    ta, tb = Counter(_tokens(a)), Counter(_tokens(b))
    if not ta or not tb:
        return 0.0
    dot = sum(ta[t] * tb[t] for t in ta if t in tb)
    na = math.sqrt(sum(v * v for v in ta.values()))
    nb = math.sqrt(sum(v * v for v in tb.values()))
    return dot / (na * nb) if na and nb else 0.0


def cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(x * x for x in b))
    return dot / (na * nb) if na and nb else 0.0


def year_from_text(*candidates: str) -> int | None:
    for text in candidates:
        m = re.search(r"\b(18|19|20)\d{2}\b", text or "")
        if m:
            return int(m.group(0))
    return None


# ─── Document parser (Section 5, step 1 — no model call) ────────────────────

def parse_document(file_path: str | None = None, file_bytes: bytes | None = None,
                   filename: str = "") -> str:
    """Extract raw text from PDF/DOCX/TXT. OCR fallback (Document AI) fires
    only when a PDF yields near-empty text and credentials are configured."""
    name = (filename or file_path or "").lower()
    data = file_bytes
    if data is None and file_path:
        with open(file_path, "rb") as fh:
            data = fh.read()
    if data is None:
        return ""

    text = ""
    if name.endswith(".pdf") or data[:5] == b"%PDF-":
        text = _parse_pdf(data)
        if len(text.strip()) < 200:  # likely scanned — try OCR fallback
            ocr = _ocr_document_ai(data)
            if ocr and len(ocr.strip()) > len(text.strip()):
                text = ocr
    elif name.endswith(".docx"):
        text = _parse_docx(data)
    else:
        try:
            text = data.decode("utf-8", errors="replace")
        except Exception:
            text = ""
    return text.strip()


def parse_document_pages(file_bytes: bytes, filename: str = "") -> list[SourcePage]:
    """Per-page extraction (PDF) so issues can carry 'file, page N' source
    references. Non-PDF inputs become a single page 1."""
    name = (filename or "").lower()
    label = filename or "document"
    if name.endswith(".pdf") or file_bytes[:5] == b"%PDF-":
        try:
            import io
            from pypdf import PdfReader
            reader = PdfReader(io.BytesIO(file_bytes))
            pages = [SourcePage(file=label, page=idx + 1, text=(page.extract_text() or ""))
                     for idx, page in enumerate(reader.pages)]
            if any(p.text.strip() for p in pages):
                return pages
        except Exception as exc:
            logger.warning("[parser] per-page pdf parse failed (%s)", exc)
    text = parse_document(file_bytes=file_bytes, filename=filename)
    return [SourcePage(file=label, page=1, text=text)] if text else []


_ISSUE_STOPWORDS = frozenset(
    "the of and in a to is for under whether not on by with or any that this be as".split())


def attribute_issue_sources(issues: list[Issue], pages: list[SourcePage]) -> None:
    """Deterministically tag each issue with the source page that best
    supports it ('file, page N'), by token overlap — the LLM never writes
    these references, so they can never be invented. Issues with no page
    scoring above a floor keep source=None rather than a guessed ref."""
    if not pages:
        return
    page_tokens = [(p, set(_tokens(p.text)) - _ISSUE_STOPWORDS) for p in pages if p.text.strip()]
    for issue in issues:
        tokens = set(_tokens(issue.issue)) - _ISSUE_STOPWORDS
        if not tokens:
            continue
        best, best_score = None, 0.0
        for page, ptokens in page_tokens:
            if not ptokens:
                continue
            score = len(tokens & ptokens) / len(tokens)
            if score > best_score:
                best, best_score = page, score
        if best is not None and best_score >= 0.35:
            # page 0 = "page unknown" (no chunk metadata) → cite file only
            issue.source = f"{best.file}, page {best.page}" if best.page > 0 else best.file


def _parse_pdf(data: bytes) -> str:
    try:
        import io
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(data))
        return "\n\n".join((page.extract_text() or "") for page in reader.pages)
    except Exception as exc:
        logger.warning("[parser] pypdf failed (%s)", exc)
        return ""


def _parse_docx(data: bytes) -> str:
    try:
        import io
        from docx import Document
        doc = Document(io.BytesIO(data))
        return "\n\n".join(p.text for p in doc.paragraphs if p.text)
    except Exception as exc:
        logger.warning("[parser] python-docx failed (%s)", exc)
        return ""


def _ocr_document_ai(data: bytes) -> str:
    """Google Document AI OCR fallback for scanned PDFs. Optional — returns
    "" when credentials are not configured or the call fails."""
    settings = get_settings()
    if not (settings.gcs_key_base64 and settings.document_ai_processor_id and settings.gcloud_project_id):
        return ""
    try:
        import base64
        import json as _json
        from google.oauth2 import service_account  # type: ignore
        import google.auth.transport.requests  # type: ignore

        info = _json.loads(base64.b64decode(settings.gcs_key_base64))
        creds = service_account.Credentials.from_service_account_info(
            info, scopes=["https://www.googleapis.com/auth/cloud-platform"])
        creds.refresh(google.auth.transport.requests.Request())
        endpoint = (
            f"https://{settings.document_ai_location}-documentai.googleapis.com/v1/"
            f"projects/{settings.gcloud_project_id}/locations/{settings.document_ai_location}/"
            f"processors/{settings.document_ai_processor_id}:process"
        )
        body = {"rawDocument": {"content": base64.b64encode(data).decode(), "mimeType": "application/pdf"}}
        resp = httpx.post(endpoint, json=body, timeout=120,
                          headers={"Authorization": f"Bearer {creds.token}"})
        resp.raise_for_status()
        return resp.json().get("document", {}).get("text", "")
    except Exception as exc:
        logger.warning("[parser] Document AI OCR failed (%s)", exc)
        return ""


# ─── Anti-invention guard (Section 5, step 5 — deterministic) ────────────────

_SECTION_RE = re.compile(r"(?i)\bsections?\s+(\d+[A-Za-z]{0,2})")
_ACT_RE = re.compile(r"\b([A-Z][A-Za-z.&' ]{2,60}?\s+(?:Act|Code|Sanhita|Adhiniyam))\b")
_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.;])\s+")


def verify_context_against_source(draft: CaseContextDraft, source_text: str,
                                  document_type: str) -> CaseContext:
    """Never let a model add facts that weren't there. Section numbers and
    statute names appearing in the extracted facts/procedural history must
    exist in the source text; sentences carrying unsupported ones are
    excised and confidence is downgraded. Same philosophy as the citation
    guardian, one stage earlier."""
    norm_source = normalize_ws(source_text)
    violations: list[str] = []

    def _clean(field_text: str) -> str:
        kept: list[str] = []
        for sentence in _SENTENCE_SPLIT_RE.split(field_text or ""):
            bad = False
            for m in _SECTION_RE.finditer(sentence):
                if normalize_ws(f"section {m.group(1)}") not in norm_source and \
                        normalize_ws(m.group(1)) not in norm_source:
                    violations.append(f"section {m.group(1)}")
                    bad = True
            for m in _ACT_RE.finditer(sentence):
                act = normalize_ws(m.group(1))
                # allow partial match on the act's distinctive words
                head = " ".join(act.split()[-4:])
                if act not in norm_source and head not in norm_source:
                    violations.append(m.group(1))
                    bad = True
            if not bad and sentence.strip():
                kept.append(sentence.strip())
        return " ".join(kept)

    facts = _clean(draft.facts)
    history = _clean(draft.procedural_history)
    if violations:
        logger.warning("[anti-invention] excised unsupported entities: %s", sorted(set(violations)))

    confidence = "high" if not violations else ("medium" if len(violations) <= 2 else "low")

    # Completeness check (rule-based): never silently guess.
    needs_clarification = False
    question: str | None = None
    if len(facts.strip()) < 40:
        needs_clarification = True
        question = ("The factual background is too thin to search reliably. "
                    "Please describe what happened — who did what, under which "
                    "statute/section, and what stage the matter is at.")
    elif not draft.relief_sought.strip():
        needs_clarification = True
        question = ("What outcome does your client want (e.g. quashing of the FIR, "
                    "bail, setting aside the order, maintenance)?")

    summary = draft.raw_case_summary.strip() or " ".join(
        part for part in (facts, history, draft.relief_sought) if part
    )

    return CaseContext(
        document_type=document_type if document_type in
        ("petition", "judgment", "brief", "note", "mixed") else "mixed",
        parties={p.role: p.name for p in draft.parties if p.role},
        facts=facts,
        procedural_history=history,
        relief_sought=draft.relief_sought.strip(),
        raw_case_summary=summary,
        needs_clarification=needs_clarification,
        clarification_question=question,
        source_confidence=confidence,
    )


def verify_issues_against_source(issues: list, source_text: str) -> list[str]:
    """Anti-invention guard for the ISSUES/GROUNDS stage — same philosophy as
    verify_context_against_source, one stage later: no extractor may attach a
    provision or authority the case material does not contain.

    High-precision, one-way: a reference is struck ONLY when a parseable
    section/act in it is POSITIVELY absent from the source (roman-numeral or
    unparseable references are kept — false strikes would delete real law).
    - statutory_hook: blanked when unsupported (the legal question survives;
      only the unverifiable citation goes).
    - legal_framework: unsupported entries dropped.
    - case_law_cited: authorities whose lead party name never appears in the
      material are dropped — extractors must not introduce case law the
      papers do not cite.
    Mutates issues in place; returns human-readable notes for the UI."""
    norm_source = normalize_ws(source_text or "")
    notes: list[str] = []
    if not norm_source:
        return notes
    # OCR-tolerant view: '260 A (2)(a)' and '260A(2)(a)' must compare equal —
    # section presence is checked against an alphanumeric-squashed source too.
    squashed_source = re.sub(r"[^a-z0-9]+", "", norm_source)

    def _positively_absent(ref: str) -> bool:
        sections = list(_SECTION_RE.finditer(ref or ""))
        if sections:
            # The SECTION NUMBER is the primary key: drafts abbreviate act
            # names ('B.N.S.S.', 'Cr.P.C.') and spellings vary ('Nagarik' /
            # 'Nagrik'), so an unmatchable act name must never strike a ref
            # whose section number the material plainly contains.
            for m in sections:
                num_squashed = re.sub(r"[^a-z0-9]+", "", m.group(1).lower())
                if (normalize_ws(f"section {m.group(1)}") in norm_source
                        or normalize_ws(m.group(1)) in norm_source
                        or (num_squashed and num_squashed in squashed_source)):
                    return False
            return True  # every section number in the ref is absent
        absent = False
        for m in _ACT_RE.finditer(ref or ""):
            act = normalize_ws(m.group(1))
            head = " ".join(act.split()[-4:])
            # Acronym tolerance: 'Bharatiya Nagarik Suraksha Sanhita' matches
            # a source that only ever writes 'BNSS' / 'B.N.S.S.'.
            acronym = "".join(w[0] for w in re.findall(r"[a-z]+", act)
                              if w not in ("of", "the", "and"))
            if (act in norm_source or head in norm_source
                    or re.sub(r"[^a-z0-9]+", "", act) in squashed_source
                    or (len(acronym) >= 3 and acronym in squashed_source)):
                continue
            absent = True
        return absent

    for issue in issues:
        label = issue.title or (issue.issue or "")[:60]
        if issue.statutory_hook and _positively_absent(issue.statutory_hook):
            notes.append(f"Removed unverifiable provision '{issue.statutory_hook}' "
                         f"from '{label}' — it does not appear in the case material.")
            issue.statutory_hook = None
        if getattr(issue, "legal_framework", None):
            kept = [ref for ref in issue.legal_framework if not _positively_absent(ref)]
            for ref in set(issue.legal_framework) - set(kept):
                note = f"Removed unverifiable provision '{ref}' from '{label}'."
                # One note per provision per issue — the hook strike above may
                # already have reported the same reference.
                if not any(f"'{ref}'" in n and f"'{label}'" in n for n in notes):
                    notes.append(note)
            issue.legal_framework = kept
        if getattr(issue, "case_law_cited", None):
            kept_cases = []
            for case_name in issue.case_law_cited:
                lead = normalize_ws(re.split(r"\s+v(?:s|ersus)?\.?\s+", case_name, 1)[0])
                lead = " ".join(lead.split()[:4])
                if lead and lead in norm_source:
                    kept_cases.append(case_name)
                else:
                    notes.append(f"Removed case law '{case_name}' from '{label}' — "
                                 f"not cited in the case material.")
            issue.case_law_cited = kept_cases
    if notes:
        logger.warning("[anti-invention] issues/grounds guard: %d reference(s) struck", len(notes))
    return notes


# ─── Case fetcher (agentic document service) ─────────────────────────────────

_MAX_FILE_TEXT = 120_000       # per-file cap for the anti-invention source text


async def fetch_case_pages(case_id: str, auth_header: str | None = None,
                           user_id: str | None = None,
                           ) -> tuple[str, list[SourcePage], str, str]:
    """Resolve a case from the agentic document service into:
      (case_title, pages, llm_text, full_text)

    - HTTP flow mirrors citation-service's _fetch_case_context:
      GET /api/files/cases/{id} → folder names, then GET /api/files/{folder}/files
      → per-file extracted text (full_text_content → summary → content → snippet).
    - When Document_DB is reachable, each file is replaced by its page-numbered
      file_chunks so issues can cite 'file, page N'; otherwise the whole file
      becomes one page-unknown SourcePage.
    - llm_text is a budgeted digest (per-file slices) for the LLM stages;
      full_text is the uncapped-per-file source for the anti-invention guard.
    """
    from stores import doc_db  # local import: stores must stay import-light

    settings = get_settings()
    base = settings.agentic_document_service_url.rstrip("/")
    headers = {"Accept": "application/json"}
    if auth_header:
        headers["Authorization"] = auth_header
    if user_id:
        # The document service scopes folder/file listings by X-User-Id.
        headers["X-User-Id"] = str(user_id)

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(f"{base}/api/files/cases/{case_id}", headers=headers)
        if resp.status_code >= 400:
            raise LookupError(f"case {case_id} not found ({resp.status_code})")
        case = resp.json() or {}
        if isinstance(case.get("case"), dict):
            case = case["case"]
        case_title = str(case.get("case_title") or case.get("title") or case.get("name") or "").strip()

        folder_names: list[str] = []
        for folder in (case.get("folders") or []):
            if isinstance(folder, dict):
                name = folder.get("name") or folder.get("originalname") or folder.get("folder_path")
                if name:
                    folder_names.append(str(name))
        for key in ("folder_name", "folder", "folder_path", "name"):
            value = case.get(key)
            if isinstance(value, str) and value.strip() and value not in folder_names:
                folder_names.append(value.strip())

        files: list[dict[str, Any]] = []
        for folder in folder_names:
            from urllib.parse import quote
            fresp = await client.get(f"{base}/api/files/{quote(folder, safe='')}/files",
                                     headers=headers)
            if fresp.status_code >= 400:
                continue
            payload = fresp.json() or {}
            items = payload.get("files") or payload.get("data") or payload.get("documents") or []
            if isinstance(items, list):
                files.extend(i for i in items if isinstance(i, dict))
            if files:
                break

    if not files:
        raise LookupError(f"case {case_id} has no readable documents")

    pages: list[SourcePage] = []
    file_texts: list[tuple[str, str]] = []  # (filename, text)
    for item in files:
        name = str(item.get("originalname") or item.get("name") or "document").strip()
        text = str(item.get("full_text_content") or item.get("summary")
                   or item.get("content") or item.get("snippet") or "").strip()
        file_id = str(item.get("id") or item.get("file_id") or "").strip()
        chunks = await asyncio.to_thread(doc_db.chunks_for_file, file_id) if file_id else None
        if chunks:
            pages.extend(SourcePage(file=name, page=page, text=content)
                         for content, page in chunks if content.strip())
            if not text:
                text = "\n\n".join(content for content, _ in chunks)
        elif text:
            pages.append(SourcePage(file=name, page=0, text=text[:_MAX_FILE_TEXT]))
        if text:
            file_texts.append((name, text[:_MAX_FILE_TEXT]))

    if not file_texts:
        raise LookupError(f"case {case_id} documents have no extracted text yet")

    full_text = "\n\n".join(text for _, text in file_texts)
    # Spread the configurable LLM budget across files so EVERY document
    # contributes to issue spotting (the old fixed 28k gave an 18-file case
    # half a page per document).
    per_file_budget = max(2000, get_settings().max_llm_input_chars // len(file_texts))
    llm_text = "\n\n".join(
        f"[FILE: {name}]\n{text[:per_file_budget]}" for name, text in file_texts
    )
    return case_title, pages, llm_text, full_text


# ─── Indian Kanoon client (Section 7) ────────────────────────────────────────

_QUOTED_SEG_RE = re.compile(r'("[^"]*")')
_IK_OP_MAP = {"AND": "ANDD", "OR": "ORR", "NOT": "NOTT"}


def to_ik_operators(query: str) -> str:
    """Indian Kanoon's Boolean operators are ANDD / ORR / NOTT — case
    sensitive, space delimited (official API docs; AND/OR/NOT are treated as
    ordinary words). Queries are authored and DISPLAYED in the readable
    AND / OR / NOT form; this translates them to the wire format at fetch
    time. Quoted phrases are never touched (a phrase may legitimately
    contain 'AND'), lowercase words stay words, and parentheses — which the
    IK docs do not document — are dropped so they never reach the engine as
    junk tokens (ANDD is implicit between terms, so precedence degrades
    gracefully)."""
    parts = _QUOTED_SEG_RE.split(query or "")
    out: list[str] = []
    for i, part in enumerate(parts):
        if i % 2 == 1:  # quoted phrase — verbatim
            out.append(part)
            continue
        part = part.replace("(", " ").replace(")", " ")
        part = re.sub(r"\b(AND|OR|NOT)\b", lambda m: _IK_OP_MAP[m.group(1)], part)
        out.append(part)
    return re.sub(r"\s+", " ", "".join(out)).strip()


def build_ik_query(term: str, exact: bool = False, doctypes: str | None = None) -> str:
    """Decorate one search term into a precise IK query.

    - Boolean operators are translated to IK's wire format (AND→ANDD,
      OR→ORR, NOT→NOTT) — display keeps the readable form.
    - exact=True wraps a multi-word term in double quotes so IK matches the
      phrase verbatim instead of ANDing the words anywhere in the document
      (terms that already carry their own quotes are left alone).
    - Every query gets the configured `doctypes:` filter so statute pages,
      law-commission reports and district-court noise never enter the
      candidate pool. Empty IK_DOCTYPES disables the filter.
    """
    query = to_ik_operators(term.strip())
    if exact and " " in query and '"' not in query:
        query = f'"{query}"'
    dt = get_settings().ik_doctypes if doctypes is None else doctypes
    if dt and "doctypes:" not in query:
        query = f"{query} doctypes:{dt}"
    return query


class IndianKanoonClient:
    """Resilient async IK client. All endpoints are POST with
    `Authorization: Token <token>`. Search responses are cached in
    Redis/memory keyed by normalized query so repeated terms across
    issues/sessions never re-hit IK."""

    def __init__(self) -> None:
        settings = get_settings()
        self._semaphore = asyncio.Semaphore(settings.ik_max_concurrency)
        self._http: httpx.AsyncClient | None = None
        # Set on HTTP 401/403 — the token was REJECTED (prepaid balance out /
        # token expired). Surfaced to the UI so an auth failure never
        # masquerades as an honest "0 citations". Cleared by the next 200.
        self.auth_failed = False

    @property
    def _token(self) -> str | None:
        return get_settings().ik_token

    def _client(self) -> httpx.AsyncClient:
        """Shared keep-alive connection pool. A per-call AsyncClient paid a
        fresh TCP+TLS handshake on EVERY search/doc call — across the
        ~20 queries + 12 doc fetches of one issue that handshake tax was
        the biggest avoidable slice of IK wall time."""
        if self._http is None or self._http.is_closed:
            settings = get_settings()
            self._http = httpx.AsyncClient(
                timeout=settings.ik_timeout_seconds,
                limits=httpx.Limits(
                    max_connections=settings.ik_max_concurrency * 2,
                    max_keepalive_connections=settings.ik_max_concurrency,
                ),
            )
        return self._http

    async def aclose(self) -> None:
        if self._http is not None and not self._http.is_closed:
            await self._http.aclose()

    async def _request(self, path: str, params: dict[str, Any] | None = None) -> Any | None:
        token = self._token
        if not token:
            logger.warning("[IK] token not configured — skipping %s", path)
            return None
        settings = get_settings()
        url = IK_BASE + path
        headers = {
            "Authorization": f"Token {token}",
            "Accept": "application/json",
            "User-Agent": "Mozilla/5.0 (compatible; JurinexJudgement/1.0)",
        }
        for attempt in range(1, settings.ik_max_retries + 1):
            try:
                async with self._semaphore:
                    resp = await self._client().post(url, params=params or {}, headers=headers)
                if resp.status_code in (401, 403):
                    self.auth_failed = True
                    logger.error("[IK] token REJECTED (HTTP %s) for %s — the Indian "
                                 "Kanoon prepaid account is likely out of balance or "
                                 "the token expired; every search returns empty until "
                                 "it is recharged", resp.status_code, path)
                    return None
                if resp.status_code == 429 or resp.status_code >= 500:
                    # Throttling / transient server errors are RETRIED with
                    # backoff — at a 24-wide burst, dropping the call would
                    # silently lose candidates.
                    if attempt < settings.ik_max_retries:
                        delay = 0.5 * (2 ** (attempt - 1))
                        logger.warning("[IK] HTTP %s for %s — retry in %.1fs",
                                       resp.status_code, path, delay)
                        await asyncio.sleep(delay)
                        continue
                    logger.error("[IK] HTTP %s for %s after %d attempts",
                                 resp.status_code, path, attempt)
                    return None
                if resp.status_code >= 400:
                    logger.warning("[IK] HTTP %s for %s: %s", resp.status_code, path, resp.text[:200])
                    return None
                self.auth_failed = False
                return resp.json()
            except (httpx.TransportError, httpx.TimeoutException) as exc:
                if attempt < settings.ik_max_retries:
                    delay = 0.5 * (2 ** (attempt - 1))
                    logger.warning("[IK] %s attempt %d failed (%s) — retry in %.1fs",
                                   path, attempt, exc, delay)
                    await asyncio.sleep(delay)
                else:
                    logger.error("[IK] %s failed after %d attempts (%s)", path, attempt, exc)
            except Exception as exc:
                logger.error("[IK] unexpected error for %s: %s", path, exc)
                return None
        return None

    async def search(self, query: str, pagenum: int = 0) -> list[dict[str, Any]]:
        norm = normalize_ws(query)
        cache_key = f"ik:search:{hashlib.sha1(norm.encode()).hexdigest()}:{pagenum}"
        cached = cache.get_json(cache_key)
        if cached is not None:
            return cached
        data = await self._request("/search/", {"formInput": query, "pagenum": pagenum})
        docs = (data or {}).get("docs") or []
        cache.set_json(cache_key, docs, ttl=86400)
        return docs

    async def fetch_doc_bundle(self, doc_id: str) -> tuple[str | None, dict[str, Any]]:
        """One /doc call → (full text, info). info carries publish date and
        cite/citedby samples+totals for the report's citation-context
        section. Both parts cached 7 days so a report view after a search
        never re-bills the document."""
        text = cache.get(f"ik:doc:{doc_id}")
        # v2 cache key: samples carry docId dicts, not bare title strings.
        info = cache.get_json(f"ik:docinfo2:{doc_id}")
        if text is not None and info is not None:
            return text or None, info
        # maxcites/maxcitedby are REQUIRED for IK to include citeList /
        # citedbyList in the response — without them both come back empty.
        data = await self._request(f"/doc/{doc_id}/", {"maxcites": 20, "maxcitedby": 20})
        if not data:
            return text or None, info or {}
        full_text = re.sub(r"[ \t]+", " ", strip_html(str(data.get("doc") or "")))

        def _extract_samples(items: Any) -> list[dict[str, str]]:
            out = []
            for item in items if isinstance(items, list) else []:
                title = strip_html(str((item or {}).get("title") or "")).strip()
                tid = str((item or {}).get("tid") or "").strip()
                if title:
                    out.append({"title": title, "docId": tid})
            return out

        # modern IK returns "cites"/"citedby"; older responses "citeList"/"citedbyList"
        cite_list = data.get("cites") or data.get("citeList") or []
        citedby_list = data.get("citedby") or data.get("citedbyList") or []
        info = {
            "title": strip_html(str(data.get("title") or "")).strip(),
            "publishdate": str(data.get("publishdate") or ""),
            "citesTotal": len(cite_list) if isinstance(cite_list, list) else 0,
            "citedByTotal": len(citedby_list) if isinstance(citedby_list, list) else 0,
            "casesCitedSample": _extract_samples(cite_list)[:20],
            "citedBySample": _extract_samples(citedby_list)[:20],
        }
        cache.set(f"ik:doc:{doc_id}", full_text, ttl=7 * 86400)
        cache.set_json(f"ik:docinfo2:{doc_id}", info, ttl=7 * 86400)
        return full_text or None, info

    async def fetch_doc_text(self, doc_id: str) -> str | None:
        """Full judgment text (HTML stripped). Cached 7 days."""
        text, _info = await self.fetch_doc_bundle(doc_id)
        return text

    async def fetch_doc_meta(self, doc_id: str) -> dict[str, Any]:
        """/docmeta/ — cheap metadata call (author, bench, publish date).
        Cached 7 days; returns {} when unavailable."""
        cache_key = f"ik:docmeta:{doc_id}"
        cached = cache.get_json(cache_key)
        if cached is not None:
            return cached
        data = await self._request(f"/docmeta/{doc_id}/") or {}
        meta = {k: strip_html(str(v)).strip() for k, v in data.items()
                if isinstance(v, (str, int, float)) and k in
                ("title", "publishdate", "author", "bench", "docsource", "doctype")}
        cache.set_json(cache_key, meta, ttl=7 * 86400)
        return meta

    async def fanout_and_fetch(self, keywords: KeywordSet, cap: int | None = None,
                               exclude: set[str] | None = None,
                               forum_doctype: str | None = None,
                               anchors_only: bool = False) -> list[Candidate]:
        """Anchor queries first (full precision queries, double weight,
        deeper take), then one IK query per axis term — doctrinal/outcome
        phrases exact-quoted, statutory/factual left as AND-of-words. Union
        results, dedupe by docId, cap the pool. Candidates that matched more
        distinct queries rank earlier (they survive the cap first).
        `exclude`: docIds already tried in a previous round (reformulation
        retries never re-fetch what was already rejected).
        `forum_doctype`: the client's own High Court's IK doctype — anchor
        queries are ALSO run restricted to that court, so its (binding)
        judgments enter the pool even when nationwide recall would have
        crowded them out.
        `anchors_only`: the user hand-picked this issue's queries — fetch
        with EXACTLY those (plus their forum-restricted re-run); contra and
        axis-term queries are NOT sent (axis terms still score/pinpoint)."""
        settings = get_settings()
        cap = cap or settings.ik_candidate_cap
        per_query = settings.ik_results_per_query
        exclude = exclude or set()

        exact_terms = {t.strip().lower() for t in (keywords.doctrinal + keywords.outcome)}
        # (label kept as the raw term for matched_terms/keyword_signal,
        #  wire = decorated query actually sent, weight, take)
        queries: list[tuple[str, str, float, int]] = []
        seen_wire: set[str] = set()
        for anchor in keywords.anchor_queries[:4]:
            if not anchor.strip():
                continue
            wire = build_ik_query(anchor)
            if wire not in seen_wire:
                seen_wire.add(wire)
                queries.append((anchor.strip(), wire, 2.0, per_query + 5))
        if forum_doctype:
            # Forum focus: same anchors, restricted to the client's own High
            # Court. Highest weight — these are the keep-it-top candidates.
            for anchor in keywords.anchor_queries[:4]:
                if not anchor.strip():
                    continue
                wire = build_ik_query(anchor, doctypes=forum_doctype)
                if wire not in seen_wire:
                    seen_wire.add(wire)
                    queries.append((anchor.strip(), wire, 2.5, per_query + 5))
        if not anchors_only:
            # Contra queries widen the pool with the adverse line of
            # authority; a result's final side comes from its VERIFIED
            # outcome, not from which query found it.
            for contra in keywords.contra_queries[:2]:
                if not contra.strip():
                    continue
                wire = build_ik_query(contra)
                if wire not in seen_wire:
                    seen_wire.add(wire)
                    queries.append((contra.strip(), wire, 1.0, per_query))
            for term in keywords.all_terms():
                wire = build_ik_query(term, exact=term.strip().lower() in exact_terms)
                if wire not in seen_wire:
                    seen_wire.add(wire)
                    queries.append((term, wire, 1.0, per_query))
        if not queries:
            return []

        results = await asyncio.gather(*(self.search(wire) for _, wire, _, _ in queries))

        by_id: dict[str, Candidate] = {}
        hits: Counter[str] = Counter()
        for (label, _wire, weight, take), docs in zip(queries, results):
            for rank, doc in enumerate(docs[:take]):
                doc_id = str(doc.get("tid") or "").strip()
                if not doc_id or doc_id in exclude:
                    continue
                hits[doc_id] += weight * max(1, 10 - rank)  # earlier IK rank → more weight
                if doc_id in by_id:
                    if label not in by_id[doc_id].matched_terms:
                        by_id[doc_id].matched_terms.append(label)
                    continue
                title = strip_html(str(doc.get("title") or "")).strip()
                headline = strip_html(str(doc.get("headline") or "")).strip()
                by_id[doc_id] = Candidate(
                    doc_id=doc_id,
                    title=title,
                    court=str(doc.get("docsource") or "").strip(),
                    year=year_from_text(str(doc.get("publishdate") or ""), title),
                    headline=headline,
                    num_citedby=int(doc.get("numcitedby") or 0),
                    source_url=f"https://indiankanoon.org/doc/{doc_id}/",
                    matched_terms=[label],
                )
        pool = sorted(by_id.values(),
                      key=lambda c: (len(c.matched_terms), hits[c.doc_id]), reverse=True)
        return pool[:cap]


ik_client = IndianKanoonClient()


# ─── Embeddings + re-rank (Section 6) ────────────────────────────────────────

class EmbeddingTool:
    """Gemini embeddings (768-dim, L2-normalized) with a Qdrant cache keyed
    by docId — the flywheel: repeat appearances are free. Falls back to
    lexical TF-cosine when the embedding backend is unavailable."""

    def __init__(self) -> None:
        self._client = None
        self._failed = False
        self._local: dict[str, list[float]] = {}

    def _genai(self):
        if self._client is not None or self._failed:
            return self._client
        try:
            from google import genai
            self._client = genai.Client(api_key=get_settings().google_api_key)
        except Exception as exc:
            logger.error("[embed] google-genai unavailable (%s) — lexical fallback", exc)
            self._failed = True
        return self._client

    @staticmethod
    def _l2(vec: list[float]) -> list[float]:
        norm = math.sqrt(sum(v * v for v in vec))
        return [v / norm for v in vec] if norm else vec

    def _embed_batch(self, texts: list[str], task_type: str) -> list[list[float]] | None:
        client = self._genai()
        if client is None or not texts:
            return None
        settings = get_settings()
        try:
            from google.genai import types as genai_types
            result = client.models.embed_content(
                model=settings.gemini_embedding_model,
                contents=texts,
                config=genai_types.EmbedContentConfig(
                    task_type=task_type,
                    output_dimensionality=settings.embedding_dim,
                ),
            )
            return [self._l2(list(e.values)) for e in result.embeddings]
        except Exception as exc:
            logger.error("[embed] embedding call failed (%s)", exc)
            return None

    async def embed_query(self, text: str) -> list[float] | None:
        vectors = await asyncio.to_thread(self._embed_batch, [text], "RETRIEVAL_QUERY")
        return vectors[0] if vectors else None

    async def embed_candidates(self, candidates: list[Candidate]) -> dict[str, list[float]]:
        """Segment-level embeddings (headnote/top snippet — never the whole
        judgment). Qdrant cache first; only misses hit the embedding API.
        Cache lookups and write-backs run concurrently — sequential remote
        round-trips here used to add a full pool-size × latency wait."""
        out: dict[str, list[float]] = {}
        unknown: list[Candidate] = []
        for cand in candidates:
            vec = self._local.get(cand.doc_id)
            if vec is not None:
                out[cand.doc_id] = vec
            else:
                unknown.append(cand)

        misses: list[Candidate] = []
        if unknown:
            cached = await asyncio.gather(
                *(asyncio.to_thread(qdrant.get_vector, c.doc_id) for c in unknown))
            for cand, vec in zip(unknown, cached):
                if vec is not None:
                    self._local[cand.doc_id] = vec
                    out[cand.doc_id] = vec
                else:
                    misses.append(cand)

        if misses:
            segments = [f"{c.title}. {c.headline}"[:1500] for c in misses]
            vectors = await asyncio.to_thread(self._embed_batch, segments, "RETRIEVAL_DOCUMENT")
            if vectors:
                for cand, vec in zip(misses, vectors):
                    out[cand.doc_id] = vec
                    self._local[cand.doc_id] = vec
                await asyncio.gather(*(
                    asyncio.to_thread(
                        qdrant.put_vector, cand.doc_id, vec,
                        {"title": cand.title, "court": cand.court, "year": cand.year})
                    for cand, vec in zip(misses, vectors)))
        return out


embedder = EmbeddingTool()


def band_for(score: float) -> str:
    settings = get_settings()
    if score >= settings.band_green_min:
        return "GREEN"
    if score >= settings.band_yellow_min:
        return "YELLOW"
    return "RED"


def verify_outcome_evidence(outcome: str, evidence: str, doc_text: str | None
                            ) -> tuple[str, str]:
    """Anti-invention for the outcome classifier: the verbatim disposal
    phrase must actually appear in the fetched judgment text. If it does
    not, both the evidence AND the outcome are discarded (→ 'unclear') —
    an unproven outcome must never re-tag a result support/contra."""
    evidence = (evidence or "").strip()
    if outcome == "unclear" or not evidence:
        return ("unclear" if not evidence else outcome), ""
    if not doc_text or normalize_ws(evidence) not in normalize_ws(doc_text):
        return "unclear", ""
    return outcome, evidence


def side_for_outcome(outcome: str, client_seeks_relief: bool) -> str | None:
    """support / contra / interim / None from the VERIFIED outcome and the
    client's perspective (a relief-seeker wants relief granted). The query
    role that found the document is deliberately ignored — a 'support'
    query that surfaces a dismissal yields a contra authority, and vice
    versa. Ambiguous outcomes ('partly', 'unclear') take no side."""
    if outcome == "interim_only":
        return "interim"
    if not client_seeks_relief:
        return None
    if outcome == "relief_granted":
        return "support"
    if outcome == "relief_refused":
        return "contra"
    return None


_ROMAN_VALS = [(50, "l"), (40, "xl"), (10, "x"), (9, "ix"), (5, "v"), (4, "iv"), (1, "i")]


def _to_roman(num: int) -> str:
    out = []
    for value, sym in _ROMAN_VALS:
        while num >= value:
            out.append(sym)
            num -= value
    return "".join(out)


def _from_roman(roman: str) -> int | None:
    vals = {"i": 1, "v": 5, "x": 10, "l": 50}
    total, prev = 0, 0
    for ch in reversed(roman.lower()):
        val = vals.get(ch)
        if val is None:
            return None
        total += val if val >= prev else -val
        prev = max(prev, val)
    return total


_STAT_PREFIX_RE = re.compile(
    r"(?i)\b(section|sections|order|article|rule)\s+([0-9]+[a-z]{0,2}|[ivxlc]{1,7})\b")


def statutory_shelf_patterns(hook: str | None, statutory_terms: list[str]) -> list[str]:
    """Normalized 'section 138' / 'order 37' / 'order xxxvii' patterns from
    the issue's statutory hook + the statutory query axis (which already
    carries old/new-code equivalents). Roman and arabic numbering both
    generated, so 'Order XXXVII CPC' matches a judgment writing 'Order 37'."""
    patterns: set[str] = set()
    for term in ([hook] if hook else []) + list(statutory_terms or []):
        for m in _STAT_PREFIX_RE.finditer(term or ""):
            kind = m.group(1).lower().rstrip("s") if m.group(1).lower() == "sections" \
                else m.group(1).lower()
            num = m.group(2).lower()
            numbers = {num}
            if num.isdigit() and int(num) <= 50:
                numbers.add(_to_roman(int(num)))
            elif not num.isdigit():
                arabic = _from_roman(num)
                if arabic:
                    numbers.add(str(arabic))
            for n in numbers:
                patterns.add(f"{kind} {n}")
    return sorted(patterns)


def shelf_present(doc_text: str | None, patterns: list[str]) -> bool:
    """True when the judgment text contains ANY of the issue's statutory
    anchors. Empty patterns (pure-doctrine issue) → gate stays open."""
    if not patterns:
        return True
    norm = " " + normalize_ws(doc_text or "") + " "
    return any(re.search(rf"\b{re.escape(p)}\b", norm) for p in patterns)


def side_for_verified_outcome(outcome: str, perspective: str | None) -> str | None:
    """Side from the VERIFIED outcome and the ISSUE's perspective. A
    petitioner-perspective issue is supported by relief_granted; a
    respondent-perspective issue by relief_refused. Ambiguous outcomes
    ('partly', 'unclear') take no side; interim orders are flagged."""
    if outcome == "interim_only":
        return "interim"
    if outcome not in ("relief_granted", "relief_refused"):
        return None
    wants_relief = (perspective or "petitioner").strip().lower() != "respondent"
    granted = outcome == "relief_granted"
    return "support" if granted == wants_relief else "contra"


# v3 abstraction-ladder stop-list: a trigger "match" justified only by one of
# these genus phrases is spurious (K5) — deterministically rejected.
_ABSTRACTION_GENUS = (
    "breach of contract", "abuse of process", "natural justice",
    "maintainability", "damages", "interpretation of the agreement",
    "principles of equity",
)

# Adverse subsequent-history markers in currency_note (cap 60). The standard
# "could not be verified from this text" boilerplate must NOT match.
_CURRENCY_DOUBT_RE = re.compile(
    r"(?i)\b(stay(?:ed)?\b|doubt(?:ed)?\b|overrul|larger bench|appeal\s+(?:is\s+)?pending|"
    r"slp\s+pending|reversed|set aside in appeal)")


def _v3_recompute_score(out: JudgmentVerification) -> int:
    """v3 scoring arithmetic, recomputed deterministically from the verified
    fields — the model's own final_score never stands unchecked. Components
    then caps; the 90+ ceiling requires a binding forum and a full match."""
    sb = out.score_breakdown
    forum_pts = max(0, min(10, sb.forum_points))
    has_ratio = bool(out.ratio_para or out.ratio_summary)
    components = (
        (30 if out.trigger_match else 0)
        + (15 if out.lens_match else 0)
        + (10 if out.relief_head_match else 0)
        + (10 if out.doctrine_link.strip() else 0)
        + (15 if (has_ratio and out.load_bearing) else 0)
        + (10 if out.stage_match else 0)
        + forum_pts
    )
    caps: list[tuple[str, int]] = []
    if forum_pts <= 3:
        caps.append(("persuasive forum", 70))
    if not out.stage_match:
        caps.append(("stage mismatch", 65))
    if not out.lens_match:
        caps.append(("decisional lens mismatch", 45))
    if not out.load_bearing:
        caps.append(("obiter (not load-bearing)", 40))
    if not has_ratio:
        caps.append(("no ratio locatable", 30))
    adverse_currency = bool(_CURRENCY_DOUBT_RE.search(out.currency_note or ""))
    if adverse_currency:
        caps.append(("currency doubt", 60))
    final = min([components] + [c for _, c in caps])
    if final >= 90 and not (forum_pts >= 7 and out.trigger_match
                            and out.relief_head_match and out.stage_match
                            and out.load_bearing and not adverse_currency):
        final = 89  # 90+ is reserved for binding, fully-matched authority
    sb.component_sum = components
    sb.caps_applied = [name for name, _ in caps]
    sb.final_score = final
    return final


def enforce_verifier_rules(v: JudgmentVerification, doc_text: str | None,
                           perspective: str | None,
                           shelf_patterns: list[str] | None = None) -> JudgmentVerification:
    """Deterministic enforcement of the verifier spec (v3) — the model's
    claims never stand unchecked:
    1. outcome_evidence must be a VERBATIM substring of the fetched text;
       otherwise the outcome is unproven → unclear.
    2. OUTCOME KILL: outcome unclear → reject.
    K2. LENS KILL: lens_match=False → reject (a deferential-review judgment
       is not authority on a first-instance substantive question).
    K3. SHELF KILL: no named doctrine_link → reject; and when the issue has
       statutory anchors, a judgment whose FULL TEXT never mentions any of
       them is on a different shelf → reject.
    K4. RELIEF-HEAD KILL: relief_head_match=False → reject, naming both heads.
    K5. TRIGGER KILL: trigger_match=False → reject; an abstraction_test_phrase
       from the genus stop-list ("breach of contract", "abuse of process", …)
       is a spurious match → reject.
    K6. PARASITIC KILL — INDEPENDENT of K5: parasitic=True → reject, naming
       the quoted authority to cite directly instead.
    SCORE: recomputed from components (trigger 30, lens 15, relief head 10,
       shelf 10, load-bearing ratio 15, stage 10, forum ≤10) then caps
       (persuasive 70 / stage 65 / lens 45 / obiter 40 / no-ratio 30 /
       currency 60); <60 → reject; 90+ needs binding forum + full match.
    SIDE re-derived from verified outcome + issue perspective; reject ⇒
       score 0 and include_in_output False."""
    out = v.model_copy(deep=True)
    out.outcome, out.outcome_evidence = verify_outcome_evidence(
        out.outcome, out.outcome_evidence, doc_text)
    if out.verdict != "reject":
        if out.outcome == "unclear":
            out.verdict, out.reject_reason = "reject", (
                out.reject_reason or "outcome unclear / operative line not verifiable")
        elif not out.lens_match:
            lens = (out.judgment_profile.decisional_lens or "unknown").strip()
            out.verdict, out.reject_reason = "reject", (
                out.reject_reason or
                f"decisional-lens mismatch: the judgment decided through a "
                f"'{lens}' lens, not the issue's own standard")
        elif not out.doctrine_link.strip():
            out.verdict, out.reject_reason = "reject", (
                out.reject_reason or "no doctrinal link named (shelf check)")
        elif not out.relief_head_match:
            head = (out.judgment_profile.relief_head or "unknown").strip()
            issue_head = (out.issue_relief_head or "the issue's relief head").strip()
            out.verdict, out.reject_reason = "reject", (
                out.reject_reason or
                f"relief-head mismatch: the judgment is on '{head}', "
                f"not '{issue_head}'")
        elif not out.trigger_match:
            out.verdict, out.reject_reason = "reject", (
                out.reject_reason or
                f"sub-doctrine mismatch: the judgment's trigger is "
                f"'{out.trigger_condition or 'unknown'}', not the issue's")
        elif ((out.abstraction_test_phrase or "").strip().lower().strip('".')
              in _ABSTRACTION_GENUS):
            out.verdict, out.reject_reason = "reject", (
                f"trigger match rests on the genus phrase "
                f"'{out.abstraction_test_phrase.strip()}' — spurious "
                f"(abstraction-ladder rule)")
        elif out.parasitic:
            cited = (out.cite_source_instead or "the quoted authority").strip()
            out.verdict, out.reject_reason = "reject", (
                out.reject_reason or
                f"on-point language is quoted from {cited}; cite that "
                f"authority directly")
        elif not shelf_present(doc_text, shelf_patterns or []):
            out.verdict, out.reject_reason = "reject", (
                "issue's statutory anchors never appear in the judgment text "
                "(different shelf)")
    if out.verdict != "reject":
        final = _v3_recompute_score(out)
        out.score = final
        if final < 60:
            out.verdict, out.reject_reason = "reject", (
                out.reject_reason or
                f"final score {final} below the 60 citation threshold")
    if out.verdict == "reject":
        # Output discipline: rejects carry no score and never surface.
        out.score = 0
        out.include_in_output = False
        return out
    out.include_in_output = True
    derived = side_for_verified_outcome(out.outcome, perspective)
    # 'partly' derives no side — keep the model's verdict (it read which
    # part of the split outcome bears on this issue). Everything else is
    # re-derived from the verified outcome.
    if derived is not None:
        out.verdict = derived
    return out


def judged_band(band: str, ai_relevance: float | None, judge_ran: bool) -> str:
    """Band policy once the relevance judge has run. Two hard rules:
    1. A judged document the judge scored clearly off-point (< 0.40) is RED
       no matter how high its embedding similarity — shared surface words
       ('deposit', 'interest', 'cheque') are exactly the false-positive
       this guards against.
    2. An UNjudged document can reach at most YELLOW — GREEN is reserved
       for judgments whose text was actually read and verified."""
    if ai_relevance is not None and ai_relevance < 0.40:
        return "RED"
    if judge_ran and ai_relevance is None and band == "GREEN":
        return "YELLOW"
    return band


async def rerank(issue_text: str, candidates: list[Candidate]) -> dict[str, float]:
    """Semantic closeness of each candidate segment to THIS issue (never the
    whole case; cross-issue precedents never compete). Returns doc_id →
    cosine in [0, 1]."""
    if not candidates:
        return {}
    issue_vec = await embedder.embed_query(issue_text)
    vectors = await embedder.embed_candidates(candidates) if issue_vec else {}
    scores: dict[str, float] = {}
    for cand in candidates:
        vec = vectors.get(cand.doc_id)
        if issue_vec is not None and vec is not None:
            scores[cand.doc_id] = max(0.0, cosine(issue_vec, vec))
        else:
            # degraded lexical fallback — logged once per request by caller
            scores[cand.doc_id] = tf_cosine(issue_text, f"{cand.title}. {cand.headline}")
    return scores


def keyword_signal(candidate: Candidate, keywords: KeywordSet) -> float:
    """Deterministic lexical-fit signal: how many search terms hit this
    candidate, across how many of the four axes, plus a bonus when a
    high-precision anchor query (statute + doctrine combo) found it."""
    matched = {t.lower() for t in candidate.matched_terms}
    axes = [keywords.doctrinal, keywords.statutory, keywords.factual, keywords.outcome]
    axes_hit = sum(1 for axis in axes if any(t.lower() in matched for t in axis))
    total = len(keywords.all_terms()) or 1
    coverage = min(1.0, len(matched) / min(6, total))
    anchor_hit = any(a.strip().lower() in matched for a in keywords.anchor_queries)
    score = 0.5 * (axes_hit / 4) + 0.35 * coverage + (0.15 if anchor_hit else 0.0)
    return round(min(1.0, score), 4)


# ─── Precision layers (Section 9, Phase A/B) ─────────────────────────────────

_COURT_TIERS = (
    (re.compile(r"(?i)supreme court"), 1.0, "Supreme Court"),
    (re.compile(r"(?i)privy council"), 0.85, "Privy Council"),
    (re.compile(r"(?i)high court"), 0.7, "High Court"),
    (re.compile(r"(?i)tribunal|appellate|commission|cestat|itat|nclt|nclat"), 0.45, "Tribunal"),
    (re.compile(r"(?i)district|sessions|magistrate"), 0.4, "District Court"),
)


def court_rank(court: str) -> int:
    """Bench-wise ordering rank: Supreme Court first, then Privy Council,
    High Courts, tribunals, district courts, everything else last."""
    for idx, (pattern, _value, _name) in enumerate(_COURT_TIERS):
        if pattern.search(court or ""):
            return idx
    return len(_COURT_TIERS)


# ─── Forum-state High Court focus ────────────────────────────────────────────
# The client's own High Court BINDS the forum (a Maharashtra matter answers
# to the Bombay High Court), so its judgments get retrieval focus and top
# placement. Each profile: (forum keywords → detection), IK doctypes value
# (targeted search), docsource tokens (recognise that HC in results), label.

_HC_PROFILES: tuple[tuple[tuple[str, ...], str, tuple[str, ...], str], ...] = (
    (("bombay", "mumbai", "maharashtra", "aurangabad", "nagpur", "goa", "panaji"),
     "bombay", ("bombay",), "Bombay High Court"),
    (("delhi",), "delhi", ("delhi",), "Delhi High Court"),
    (("calcutta", "kolkata", "west bengal"), "kolkata", ("calcutta",), "Calcutta High Court"),
    (("madras", "chennai", "tamil nadu"), "chennai", ("madras",), "Madras High Court"),
    (("allahabad", "uttar pradesh", "lucknow", "prayagraj"),
     "allahabad", ("allahabad",), "Allahabad High Court"),
    (("punjab", "haryana", "chandigarh"), "punjab", ("punjab",), "Punjab & Haryana High Court"),
    (("karnataka", "bengaluru", "bangalore"), "karnataka", ("karnataka",), "Karnataka High Court"),
    (("kerala", "ernakulam", "kochi"), "kerala", ("kerala",), "Kerala High Court"),
    (("gujarat", "ahmedabad"), "gujarat", ("gujarat",), "Gujarat High Court"),
    (("rajasthan", "jodhpur", "jaipur"), "rajasthan", ("rajasthan",), "Rajasthan High Court"),
    (("madhya pradesh", "jabalpur", "indore", "gwalior"),
     "madhyapradesh", ("madhya pradesh",), "Madhya Pradesh High Court"),
    (("patna", "bihar"), "patna", ("patna",), "Patna High Court"),
    (("orissa", "odisha", "cuttack"), "orissa", ("orissa",), "Orissa High Court"),
    (("gauhati", "guwahati", "assam"), "gauhati", ("gauhati",), "Gauhati High Court"),
    (("telangana", "hyderabad"), "telangana", ("telangana", "hyderabad"), "Telangana High Court"),
    (("andhra pradesh", "amaravati", "andhra"), "andhra", ("andhra",), "Andhra Pradesh High Court"),
    (("jharkhand", "ranchi"), "jharkhand", ("jharkhand",), "Jharkhand High Court"),
    # 'hattisgarh' matches both the Chhattisgarh and IK's Chattisgarh spelling.
    (("chhattisgarh", "chattisgarh", "bilaspur"), "chattisgarh", ("hattisgarh",), "Chattisgarh High Court"),
    (("uttarakhand", "uttaranchal", "nainital"),
     "uttaranchal", ("uttarakhand", "uttaranchal"), "Uttarakhand High Court"),
    (("himachal", "shimla"), "himachal_pradesh", ("himachal",), "Himachal Pradesh High Court"),
    (("jammu", "kashmir", "srinagar"), "jammu", ("jammu", "kashmir"), "Jammu & Kashmir High Court"),
    (("sikkim", "gangtok"), "sikkim", ("sikkim",), "Sikkim High Court"),
    (("tripura", "agartala"), "tripura", ("tripura",), "Tripura High Court"),
    (("meghalaya", "shillong"), "meghalaya", ("meghalaya",), "Meghalaya High Court"),
    (("manipur", "imphal"), "manipur", ("manipur",), "Manipur High Court"),
)


def forum_court_profile(forum: str | None) -> dict[str, Any] | None:
    """Infer the client's own High Court from the forum text ('Bombay High
    Court, Aurangabad Bench', 'Sessions Court, Pune', 'Maharashtra'…).
    None when nothing can be inferred, or the forum IS the Supreme Court
    (no state focus applies there)."""
    text = (forum or "").lower()
    if not text.strip() or "supreme court" in text:
        return None
    for keywords, doctype, match_tokens, label in _HC_PROFILES:
        if any(k in text for k in keywords):
            return {"doctype": doctype, "match": match_tokens, "label": label}
    return None


def case_court_profile(forum: str | None, case_text: str | None = None) -> dict[str, Any] | None:
    """The court the CASE ITSELF points at: the extracted forum field when
    it resolves, else the High Court (or its state/bench city) mentioned
    EARLIEST in the case material — cause titles and procedural history
    name the forum up front, while other states' courts appear later as
    cited precedents. A 'supreme court' mention that precedes every HC hit
    means the matter is before the SC → no state focus."""
    profile = forum_court_profile(forum)
    if profile or not (case_text or "").strip():
        return profile
    text = case_text[:4000].lower()
    best: tuple[int, dict[str, Any]] | None = None
    for keywords, doctype, match_tokens, label in _HC_PROFILES:
        positions = [p for p in (text.find(k) for k in keywords) if p >= 0]
        if positions and (best is None or min(positions) < best[0]):
            best = (min(positions),
                    {"doctype": doctype, "match": match_tokens, "label": label})
    if best is None:
        return None
    sc_pos = text.find("supreme court")
    return best[1] if sc_pos == -1 or best[0] < sc_pos else None


def is_forum_high_court(court: str | None, profile: dict[str, Any] | None) -> bool:
    """Is this result FROM the client's own High Court? Requires 'high
    court' in the docsource so a same-state district court never matches."""
    if not profile:
        return False
    c = (court or "").lower()
    return "high court" in c and any(t in c for t in profile["match"])


def forum_court_rank(court: str, profile: dict[str, Any] | None) -> int:
    """Bench ordering with forum focus: the client's own High Court ranks
    0 (binding at the forum — kept on top, per user request even above the
    Supreme Court), then the normal tiers shifted by one. With no profile
    the relative order is exactly the classic bench order."""
    if is_forum_high_court(court, profile):
        return 0
    return 1 + court_rank(court)


def authority_signal(candidate: Candidate) -> tuple[float, str]:
    """Court tier blended with citation-count-as-influence proxy. This is a
    reordering weight, never a filter — it can rank a strong lower-court
    match appropriately but can never bury it."""
    tier, label = 0.3, (candidate.court or "Court")
    for pattern, value, name in _COURT_TIERS:
        if pattern.search(candidate.court or ""):
            tier, label = value, name
            break
    influence = min(1.0, math.log10(1 + max(0, candidate.num_citedby)) / 3.0)
    return round(0.7 * tier + 0.3 * influence, 4), label


_WIN_PATTERNS = re.compile(
    r"(?i)\b(appeal is allowed|appeal allowed|petition is allowed|petition allowed|"
    r"fir is quashed|proceedings are quashed|order is quashed|impugned order is set aside|"
    r"conviction is set aside|bail is granted|application is allowed)\b")
_LOSE_PATTERNS = re.compile(
    r"(?i)\b(appeal is dismissed|appeal dismissed|petition is dismissed|petition dismissed|"
    r"appeal fails|conviction is upheld|bail is rejected|application is dismissed|"
    r"petition is rejected)\b")


def party_perspective(candidate: Candidate, context: CaseContext) -> tuple[float | None, str | None]:
    """Which party prevailed, and does that align with the client's implied
    position (a relief-seeker searching precedent wants relief granted)?
    On complex/split/ambiguous outcomes: return None — never guess."""
    text = candidate.doc_text
    if not text:
        return None, None
    tail = text[-6000:]
    wins = len(_WIN_PATTERNS.findall(tail))
    losses = len(_LOSE_PATTERNS.findall(tail))
    if wins == 0 and losses == 0:
        return None, None
    if wins > 0 and losses > 0:
        return None, None  # split/multi-party outcome — show raw, don't guess
    client_seeks_relief = bool(context.relief_sought.strip())
    if not client_seeks_relief:
        return 0.5, "neutral"
    if wins > 0:
        return 1.0, "favourable"
    return 0.0, "adverse"


_OVERRULED_MARKERS = re.compile(
    r"(?i)\b(overruled (?:by|in)|since overruled|stands overruled|no longer good law|"
    r"expressly overruled)\b")


def good_law_signal(candidate: Candidate) -> tuple[float | None, str | None]:
    """Good-law status. Full version reads the typed citation graph in
    Neo4j; the lite stopgap scans the fetched text for explicit negative-
    treatment markers and always labels itself as "review", never as a
    clean "still good law" guarantee.

    Repealed-statute note (IPC→BNS): a pre-repeal offence is good for its
    period — age or statute repeal alone NEVER produces a negative label
    here; only actual treatment evidence does."""
    treatment = neo4j_store.negative_treatment(candidate.doc_id)
    if treatment is not None:
        if treatment["overruled"]:
            return 0.0, "overruled"
        if treatment["negative_count"] > 2:
            return 0.4, "review"
        return 1.0, "valid"
    if candidate.doc_text and _OVERRULED_MARKERS.search(candidate.doc_text):
        return 0.3, "review"
    return None, None  # unknown — contributes nothing, chip stays honest


async def grounded_good_law_check(title: str, court: str, year: int | None) -> dict[str, Any]:
    """Web-grounded status check (Gemini + Google Search tool) for ONE
    judgment: overruled / reversed / stayed / SLP pending / good law.
    Heuristic by nature — the report labels it as a web check with sources,
    never a guarantee; callers cache it per session. {} on any failure."""
    settings = get_settings()
    if not settings.google_api_key:
        return {}
    try:
        import json as _json
        from google import genai
        from google.genai import types as gt

        client = genai.Client(api_key=settings.google_api_key)
        prompt = (
            "Search the web and check the CURRENT status of this Indian judgment:\n"
            f"{title} ({court}{', ' + str(year) if year else ''})\n\n"
            "Has it been overruled, reversed in appeal, stayed, or is a Special "
            "Leave Petition pending against it? Rely on court websites, Indian "
            "Kanoon, LiveLaw, Bar & Bench, SCC Online snippets and similar legal "
            "sources.\n\n"
            "Answer with STRICT JSON only:\n"
            '{"status": "good_law" | "overruled" | "reversed" | "stayed" | '
            '"slp_pending" | "unknown", "note": "<one sentence with what you found '
            'and where>"}\n'
            "Rules: say good_law ONLY if you actually found the case discussed with "
            "no negative treatment; if you find nothing about it, status=unknown. "
            "Never invent a citing case or an appeal that you did not find."
        )

        def _call():
            return client.models.generate_content(
                model=settings.gemini_model,
                contents=prompt,
                config=gt.GenerateContentConfig(
                    tools=[gt.Tool(google_search=gt.GoogleSearch())],
                    temperature=0.1,
                ),
            )

        resp = await asyncio.to_thread(_call)
        text = resp.text or ""
        m = re.search(r"\{.*\}", text, re.S)
        data = _json.loads(m.group(0)) if m else {}
        status = str(data.get("status") or "unknown").strip()
        if status not in ("good_law", "overruled", "reversed", "stayed",
                          "slp_pending", "unknown"):
            status = "unknown"
        sources: list[dict[str, str]] = []
        try:
            metadata = resp.candidates[0].grounding_metadata
            for chunk in (metadata.grounding_chunks or [])[:5]:
                web = getattr(chunk, "web", None)
                if web is not None and getattr(web, "uri", None):
                    sources.append({"title": getattr(web, "title", "") or web.uri,
                                    "uri": web.uri})
        except Exception:
            pass
        return {"status": status, "note": str(data.get("note") or "")[:300],
                "sources": sources}
    except Exception as exc:
        logger.warning("[goodlaw-web] grounded check failed (%s)", exc)
        return {}


def fact_match_signal(candidate: Candidate, context: CaseContext) -> float | None:
    """Phase D extension point (fact-vs-doctrine separation). Not built yet;
    weight is 0 in every current phase."""
    return None


def find_pinpoint(candidate: Candidate, issue_text: str,
                  keywords: KeywordSet) -> tuple[str | None, str | None]:
    """Most on-point paragraph of the fetched judgment, with a pinpoint ref.
    Deterministic lexical selection over the doc's own paragraphs — the
    returned pinpoint is an exact substring of the fetched text, which is
    what the CitationGuardian later verifies. Presentation only; never
    feeds the composite score."""
    text = candidate.doc_text
    if not text:
        return None, None
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n|\n(?=\d{1,3}\.\s)", text) if len(p.strip()) > 120]
    if not paragraphs:
        return None, None
    issue_tokens = set(_tokens(issue_text)) | {t.lower() for t in keywords.all_terms()}
    issue_tokens -= {"the", "of", "and", "in", "a", "to", "is", "for", "under", "whether"}
    best_idx, best_score = -1, 0.0
    for idx, para in enumerate(paragraphs):
        para_tokens = set(_tokens(para))
        overlap = len(issue_tokens & para_tokens)
        if overlap >= 3:
            score = overlap / math.sqrt(len(para_tokens) + 1)
            if score > best_score:
                best_idx, best_score = idx, score
    if best_idx < 0:
        return None, None
    para = paragraphs[best_idx]
    if len(para) > 500:  # trim at a word boundary, keep exact-substring property
        cut = para[:500]
        para = cut[:cut.rfind(" ")] if " " in cut else cut
    ref_match = re.match(r"^(\d{1,3})\.\s", paragraphs[best_idx])
    ref = f"para {ref_match.group(1)}" if ref_match else f"para {best_idx + 1}"
    return para, ref


# ─── Composite scoring (Section 8 — exact formula) ───────────────────────────

def composite_score(signals: SignalSet, phase_weights: dict[str, float]) -> ScoredResult:
    """The exact spec formula. Two hard rules:
    1. Good-law is a GATE — an overruled case is capped/red-flagged no
       matter how high its semantic score (hard branch, not a weight).
    2. The score is always explainable — the full breakdown rides along."""
    settings = get_settings()
    score = (
        phase_weights["semantic"] * signals.semantic_match
        + phase_weights["keyword"] * signals.keyword_match
        + phase_weights["authority"] * (signals.authority or 0.0)
        + phase_weights["good_law"] * (signals.good_law_status or 0.0)
        + phase_weights["party"] * (signals.party_fit or 0.0)
        + phase_weights["fact"] * (signals.fact_match or 0.0)
    )
    if signals.good_law_status_label == "overruled":
        return ScoredResult(
            doc_id="", score=round(min(score, settings.good_law_gate_cap), 4),
            red_flag=True, breakdown=signals,
        )
    return ScoredResult(doc_id="", score=round(score, 4), red_flag=False, breakdown=signals)


# ─── Citation Guardian (Section 1 — THE load-bearing safety component) ───────

class CitationGuardian:
    """Deterministic, non-LLM verification that every docId in the final
    result set was actually fetched from Indian Kanoon during THIS request
    (closed-world citation rule), and every pinpoint actually appears in
    that document's fetched text.

    Runs on every response. No bypass flag. No "trust the model" fallback.
    Drops here should basically never fire — frequent drops mean an
    upstream bug, never something to silence."""

    def verify(
        self,
        scored: list[ScoredResult],
        candidate_pool: dict[str, Candidate],
    ) -> tuple[list[ScoredResult], list[dict[str, str]]]:
        clean: list[ScoredResult] = []
        drops: list[dict[str, str]] = []
        for result in scored:
            candidate = candidate_pool.get(result.doc_id)
            if candidate is None:
                drops.append({"docId": result.doc_id, "reason": "not_in_fetched_pool"})
                logger.error(
                    "[CitationGuardian] DROP %s — docId was never fetched from "
                    "Indian Kanoon in this request. Upstream bug likely.",
                    result.doc_id,
                )
                continue
            if result.pinpoint:
                doc_norm = normalize_ws(candidate.doc_text or "")
                pin_norm = normalize_ws(result.pinpoint)
                if not doc_norm or pin_norm not in doc_norm:
                    drops.append({"docId": result.doc_id, "reason": "pinpoint_not_in_document"})
                    logger.error(
                        "[CitationGuardian] DROP %s — pinpoint text not found in "
                        "fetched document text.", result.doc_id,
                    )
                    continue
            clean.append(result)
        return clean, drops


citation_guardian = CitationGuardian()
