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
import contextvars
import hashlib
import logging
import math
import re
import uuid
from collections import Counter
from datetime import datetime, timezone
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


# ─── Per-run court scope (issues-step Advanced search boxes) ─────────────────
# When the user restricts a search run to specific courts, the chosen
# doctypes replace the env default for EVERY query of that run. ContextVar so
# the fan-out's child tasks inherit it and concurrent runs never mix scopes.
_court_scope: "contextvars.ContextVar[str | None]" = contextvars.ContextVar(
    "court_scope", default=None)


def set_court_scope(doctypes: str | None) -> None:
    _court_scope.set(doctypes or None)


def court_scope() -> str | None:
    return _court_scope.get()


# Date range for one search run (issues-step date pickers): ready-made
# "fromdate:D-M-YYYY todate:D-M-YYYY" directives appended to every query of
# the run. Same ContextVar pattern as the court scope.
_date_scope: "contextvars.ContextVar[str | None]" = contextvars.ContextVar(
    "date_scope", default=None)


def set_date_scope(directives: str | None) -> None:
    _date_scope.set(directives or None)


def build_ik_query(term: str, exact: bool = False, doctypes: str | None = None) -> str:
    """Decorate one search term into a precise IK query.

    - Boolean operators are translated to IK's wire format (AND→ANDD,
      OR→ORR, NOT→NOTT) — display keeps the readable form.
    - exact=True wraps a multi-word term in double quotes so IK matches the
      phrase verbatim instead of ANDing the words anywhere in the document
      (terms that already carry their own quotes are left alone).
    - Every query gets the configured `doctypes:` filter so statute pages,
      law-commission reports and district-court noise never enter the
      candidate pool — the run's court scope (user's court boxes) replaces
      the env default when set. Empty IK_DOCTYPES disables the filter.
    """
    query = to_ik_operators(term.strip())
    if exact and " " in query and '"' not in query:
        query = f'"{query}"'
    if doctypes is None:
        scope = _court_scope.get()
        dt = scope if scope is not None else get_settings().ik_doctypes
    else:
        dt = doctypes
    if dt and "doctypes:" not in query:
        query = f"{query} doctypes:{dt}"
    dates = _date_scope.get()
    if dates and "fromdate:" not in query and "todate:" not in query:
        query = f"{query} {dates}"
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
                _ik_count_billed(path)
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
            _ik_count_cached()
            return cached
        # maxpages=1 pins the bill to exactly ONE page (₹0.50) per call —
        # IK bills per page returned, and pagenum jumps are free.
        data = await self._request("/search/", {"formInput": query, "pagenum": pagenum,
                                                "maxpages": 1})
        docs = (data or {}).get("docs") or []
        cache.set_json(cache_key, docs, ttl=86400)
        return docs

    async def search_raw(self, query: str, pagenum: int = 0) -> dict[str, Any] | None:
        """Raw /search/ call for the user-facing Advanced Search: preserves
        IK's own response shape (docs + found + categories) instead of the
        pipeline's docs-only view. None = the call itself failed (network /
        token rejected), distinct from an honest zero-result response."""
        norm = normalize_ws(query)
        cache_key = f"ik:searchraw:{hashlib.sha1(norm.encode()).hexdigest()}:{pagenum}"
        cached = cache.get_json(cache_key)
        if cached is not None:
            _ik_count_cached()
            return cached
        data = await self._request("/search/", {"formInput": query, "pagenum": pagenum,
                                                "maxpages": 1})
        if data is None:
            return None
        cache.set_json(cache_key, data, ttl=86400)
        return data

    async def fetch_doc_bundle(self, doc_id: str) -> tuple[str | None, dict[str, Any]]:
        """One /doc call → (full text, info). info carries publish date and
        cite/citedby samples+totals for the report's citation-context
        section. Both parts cached 7 days so a report view after a search
        never re-bills the document."""
        text = cache.get(f"ik:doc:{doc_id}")
        # v2 cache key: samples carry docId dicts, not bare title strings.
        info = cache.get_json(f"ik:docinfo2:{doc_id}")
        if text is not None and info is not None:
            _ik_count_cached()
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

    async def fetch_doc_raw(self, doc_id: str) -> dict[str, Any] | None:
        """Full /doc response for the Advanced Search document viewer —
        keeps IK's OWN HTML (headings, bold, pre-formatted orders) so the
        in-app page renders like Indian Kanoon's doc page. Cached 7 days,
        separate from the pipeline's stripped-text cache. None = the call
        itself failed (network / token rejected)."""
        cache_key = f"ik:docraw:{doc_id}"
        cached = cache.get_json(cache_key)
        if cached is not None:
            _ik_count_cached()
            return cached
        data = await self._request(f"/doc/{doc_id}/", {"maxcites": 50, "maxcitedby": 50})
        if not data:
            return None

        def _samples(items: Any) -> list[dict[str, str]]:
            out = []
            for item in items if isinstance(items, list) else []:
                title = strip_html(str((item or {}).get("title") or "")).strip()
                tid = str((item or {}).get("tid") or "").strip()
                if title:
                    out.append({"title": title, "docId": tid})
            return out

        cite_list = data.get("cites") or data.get("citeList") or []
        citedby_list = data.get("citedby") or data.get("citedbyList") or []
        raw = {
            "title": strip_html(str(data.get("title") or "")).strip(),
            "html": str(data.get("doc") or ""),
            "publishdate": str(data.get("publishdate") or ""),
            "docsource": strip_html(str(data.get("docsource") or "")).strip(),
            "numcites": int(data.get("numcites") or 0) or len(cite_list),
            "numcitedby": int(data.get("numcitedby") or 0) or len(citedby_list),
            "casesCited": _samples(cite_list),
            "citedBy": _samples(citedby_list),
        }
        cache.set_json(cache_key, raw, ttl=7 * 86400)
        return raw

    async def fetch_doc_meta(self, doc_id: str) -> dict[str, Any]:
        """/docmeta/ — cheap metadata call (author, bench, publish date).
        Cached 7 days; returns {} when unavailable."""
        cache_key = f"ik:docmeta:{doc_id}"
        cached = cache.get_json(cache_key)
        if cached is not None:
            _ik_count_cached()
            return cached
        data = await self._request(f"/docmeta/{doc_id}/") or {}
        meta = {k: strip_html(str(v)).strip() for k, v in data.items()
                if isinstance(v, (str, int, float)) and k in
                ("title", "publishdate", "author", "bench", "docsource", "doctype")}
        cache.set_json(cache_key, meta, ttl=7 * 86400)
        return meta

    async def fanout_and_fetch(self, keywords: KeywordSet, cap: int | None = None,
                               exclude: set[str] | None = None,
                               page_map: dict[str, int] | None = None) -> list[Candidate]:
        """ONE Indian Kanoon search per display query — exactly the queries
        the user sees (and curates) on the issue card, each carrying the
        run's court filter (the user's court boxes, else the env default).
        No forum/nationwide duplicate re-runs and no separate contra or
        axis-term fetch calls (axis terms still score/pinpoint lexically):
        50 displayed queries across a run = 50 search calls.
        Fallback: a keyword set with NO anchor queries (degraded generation,
        legacy sessions) fetches its axis terms instead — an issue never
        silently fetches nothing.
        `page_map`: wire query → last IK page THIS ISSUE fetched (the
        caller passes each issue its own sub-ledger). A repeat run of the
        SAME query fetches the NEXT page (Run #1 → pagenum 0, Run #2 →
        pagenum 1 …, IK's 0-based pagenum), so re-running digs deeper
        instead of re-buying page one — while an issue that never used a
        query starts at page one (served from cache when another issue
        already bought it). Mutated in place for session persistence.
        `exclude`: docIds already fetched earlier (never re-fetched)."""
        settings = get_settings()
        cap = cap or settings.ik_candidate_cap
        per_query = settings.ik_results_per_query
        exclude = exclude or set()
        page_map = page_map if page_map is not None else {}

        # (label kept as the raw term for matched_terms/keyword_signal,
        #  wire = decorated query actually sent, weight, take)
        queries: list[tuple[str, str, float, int]] = []
        seen_wire: set[str] = set()
        # 8 = MAX_QUERIES_PER_ISSUE: curated selections may exceed the 4
        # generated anchors.
        for anchor in keywords.anchor_queries[:8]:
            if not anchor.strip():
                continue
            wire = build_ik_query(anchor)
            if wire not in seen_wire:
                seen_wire.add(wire)
                queries.append((anchor.strip(), wire, 2.0, per_query + 5))
        if not queries:
            exact_terms = {t.strip().lower() for t in (keywords.doctrinal + keywords.outcome)}
            for term in keywords.all_terms():
                wire = build_ik_query(term, exact=term.strip().lower() in exact_terms)
                if wire not in seen_wire:
                    seen_wire.add(wire)
                    queries.append((term, wire, 1.0, per_query))
        if not queries:
            return []

        pages: list[int] = []
        for _label, wire, _weight, _take in queries:
            page = page_map.get(wire, -1) + 1
            page_map[wire] = page
            pages.append(page)
        results = await asyncio.gather(
            *(self.search(wire, pagenum=page)
              for (_label, wire, _weight, _take), page in zip(queries, pages)))

        by_id: dict[str, Candidate] = {}
        hits: Counter[str] = Counter()
        dropped_scope = 0
        for (label, _wire, weight, take), docs in zip(queries, results):
            for rank, doc in enumerate(docs[:take]):
                doc_id = str(doc.get("tid") or "").strip()
                if not doc_id or doc_id in exclude:
                    continue
                court = str(doc.get("docsource") or "").strip()
                # Court-scoped run: enforce the user's court boxes
                # deterministically, whatever IK returned.
                if not scope_allows_court(court):
                    dropped_scope += 1
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
                    court=court,
                    year=year_from_text(str(doc.get("publishdate") or ""), title),
                    headline=headline,
                    num_citedby=int(doc.get("numcitedby") or 0),
                    source_url=f"https://indiankanoon.org/doc/{doc_id}/",
                    matched_terms=[label],
                )
        if dropped_scope:
            logger.info("[scope] dropped %d candidate(s) outside the selected courts",
                        dropped_scope)
        pool = sorted(by_id.values(),
                      key=lambda c: (len(c.matched_terms), hits[c.doc_id]), reverse=True)
        return pool[:cap]


ik_client = IndianKanoonClient()


# ─── Indian Kanoon spend tracker (per search run) ────────────────────────────
# Official rate card, INR per request — mirrored from the IK account page.
IK_RATES_INR = {
    "search": 0.50,       # /search/
    "doc": 0.20,          # /doc/ (full judgment)
    "docmeta": 0.02,      # /docmeta/
    "docfragment": 0.05,  # /docfragment/ (unused by this pipeline)
    "origdoc": 0.50,      # /origdoc/  (unused by this pipeline)
}
_IK_KIND_LABELS = [
    ("search", "Search"),
    ("doc", "Document"),
    ("docmeta", "Document Metainfo"),
    ("docfragment", "Document Fragment"),
    ("origdoc", "Original Document"),
]

# LLM rates, INR per 1M tokens (input, output), matched by model-name prefix.
# Values follow the citation-service pricing.py conventions (USD list price
# × 96 INR/USD) — EDIT these to the rates you are actually billed.
LLM_RATES_INR = [
    ("gemini-3.1-pro", (120.00, 960.00)),   # pro class ≈ $1.25 / $10 per 1M
    ("gemini-3.6-flash", (72.00, 360.00)),  # $0.75 / $3.75 per 1M × 96 (list, thru 31 Dec 2026)
    ("gemini-2.5-flash", (28.80, 240.00)),  # $0.30 / $2.50 per 1M × 96 (list)
    ("claude", (288.00, 1440.00)),          # ≈ $3 / $15 per 1M (only if re-enabled)
]
DEFAULT_LLM_RATE_INR = (28.80, 240.00)
GEMINI_EMBED_PER_1M_INR = 14.40             # embeddings ≈ $0.15 per 1M × 96
GEMINI_GROUNDING_PER_CALL_INR = 3.36        # Google-Search grounding ≈ $0.035/call × 96
# Explicit context-cache STORAGE (the verifier's CachedContent): billed per
# 1M tokens per HOUR the cache lives (Flash list $1.00/1M/hr × 96 INR/USD).
# Implicit prefix caching has NO storage cost.
GEMINI_CACHE_STORAGE_PER_1M_HR_INR = 96.00

# ContextVar so concurrent runs never mix counts: child tasks (the per-issue
# fan-out) inherit the context of the request that started the run.
_ik_cost_tracker: "contextvars.ContextVar[dict | None]" = contextvars.ContextVar(
    "ik_cost_tracker", default=None)


def ik_cost_start() -> dict:
    """Begin tracking IK calls AND AI-model token usage for the current task
    tree (fan-out child tasks — and asyncio.to_thread workers — inherit the
    context, so a whole pipeline phase reports into one tracker)."""
    tracker: dict = {"billed": Counter(), "cached": 0,
                     "llm": {}, "embed_calls": 0, "embed_tokens_est": 0,
                     "grounding_calls": 0, "cache_storage": {}}
    _ik_cost_tracker.set(tracker)
    return tracker


def _ik_kind_for_path(path: str) -> str:
    if path.startswith("/docmeta"):
        return "docmeta"
    if path.startswith("/docfragment"):
        return "docfragment"
    if path.startswith("/origdoc"):
        return "origdoc"
    if path.startswith("/doc"):
        return "doc"
    return "search"


def _ik_count_billed(path: str) -> None:
    tracker = _ik_cost_tracker.get()
    if tracker is not None:
        tracker["billed"][_ik_kind_for_path(path)] += 1


def _ik_count_cached() -> None:
    tracker = _ik_cost_tracker.get()
    if tracker is not None:
        tracker["cached"] += 1


# Console labels per pipeline task (agent name → readable step).
_TASK_LABELS = {
    "doc_classify": "1 Document classification",
    "context_extract": "2 Context extraction",
    "grounds_extract": "3 Grounds extraction",
    "issue_split": "3 Issue spotting",
    "fresh_extract": "3 Fresh-matter grounds",
    "keyword_extract": "4 Query generation",
    "judgment_verifier": "5 Judgment verification",
    "citation_analysis": "6 Report analysis",
    "case_summary": "7 Judgment summary",
    "good_law_check": "8 Good-law web check",
}


def llm_track_usage(model: str, usage: Any, task: str = "other",
                    cache_method: str | None = None) -> None:
    """Record one model call's token usage from an ADK event's / genai
    response's usage_metadata, keyed by (task, model) so the bill shows
    which pipeline step spent what on which model. Events without usage
    (partials) are skipped. cached = tokens served from Gemini's context
    cache — billed at 25% of the input rate. cache_method names WHICH
    cache the call site rides ('explicit' = the verifier's CachedContent,
    'implicit' = Gemini's automatic prefix cache); recorded on the row once
    cached tokens are actually observed, and stored with the usage event."""
    tracker = _ik_cost_tracker.get()
    if tracker is None or usage is None:
        return
    prompt = getattr(usage, "prompt_token_count", 0) or 0
    output = ((getattr(usage, "candidates_token_count", 0) or 0)
              + (getattr(usage, "thoughts_token_count", 0) or 0))
    cached = getattr(usage, "cached_content_token_count", 0) or 0
    if not prompt and not output:
        return
    row = tracker["llm"].setdefault(f"{task}|{model}",
                                    {"calls": 0, "in": 0, "out": 0, "cached": 0})
    row["calls"] += 1
    row["in"] += prompt
    row["out"] += output
    row["cached"] = row.get("cached", 0) + cached
    if cached and cache_method:
        row["cache_method"] = cache_method


def embed_track(texts: list[str], tokens: int | None = None) -> None:
    """Embedding spend. `tokens` = Gemini's own count_tokens result (exact);
    without it, chars/4 estimate and the table row is labelled "est."."""
    tracker = _ik_cost_tracker.get()
    if tracker is None:
        return
    tracker["embed_calls"] += 1
    if tokens is not None:
        tracker["embed_tokens_est"] += int(tokens)
    else:
        tracker["embed_tokens_est"] += sum(len(t) for t in texts) // 4
        tracker["embed_est"] = True


def grounding_track() -> None:
    tracker = _ik_cost_tracker.get()
    if tracker is not None:
        tracker["grounding_calls"] += 1


def cache_storage_track(model: str, tokens: int, hours: float) -> None:
    """One explicit context-cache CREATION: `tokens` stay stored for `hours`
    (the cache TTL) and bill at the per-1M-per-hour storage rate. Recorded
    on the run whose call created the cache — at one creation per hour, the
    storage line appears once per hour of verifier traffic."""
    tracker = _ik_cost_tracker.get()
    if tracker is None or not tokens:
        return
    slot = tracker.setdefault("cache_storage", {}).setdefault(
        model, {"count": 0, "tokens": 0, "cost": 0.0})
    slot["count"] += 1
    slot["tokens"] += int(tokens)
    slot["cost"] += tokens / 1e6 * GEMINI_CACHE_STORAGE_PER_1M_HR_INR * hours


def _llm_rate(model: str) -> tuple[float, float]:
    for prefix, rate in LLM_RATES_INR:
        if model.startswith(prefix):
            return rate
    return DEFAULT_LLM_RATE_INR


def _llm_row_cost(model: str, row: dict) -> float:
    """INR for one (task, model) usage row — cached input tokens (Gemini
    context caching, implicit or explicit) bill at 25% of the input rate."""
    rate_in, rate_out = _llm_rate(model)
    cached = min(row.get("cached", 0), row.get("in", 0))
    return ((row.get("in", 0) - cached) / 1e6 * rate_in
            + cached / 1e6 * rate_in * 0.25
            + row.get("out", 0) / 1e6 * rate_out)


def merge_cost_ledger(ledger: dict | None, tracker: dict) -> dict:
    """Fold one phase's tracker into the session's cumulative cost ledger
    (JSON-safe plain dicts — persisted in the session payload, so the
    end-to-end bill survives restarts and spans analyze → search → reports)."""
    led = ledger or {}
    out: dict = {
        "llm": {model: dict(row) for model, row in (led.get("llm") or {}).items()},
        "billed": dict(led.get("billed") or {}),
        "cached": int(led.get("cached") or 0),
        "embed_calls": int(led.get("embed_calls") or 0),
        "embed_tokens_est": int(led.get("embed_tokens_est") or 0),
        "grounding_calls": int(led.get("grounding_calls") or 0),
    }
    for model, row in tracker.get("llm", {}).items():
        dst = out["llm"].setdefault(model, {"calls": 0, "in": 0, "out": 0})
        for key in ("calls", "in", "out", "cached"):
            dst[key] = dst.get(key, 0) + row.get(key, 0)
    for kind, count in dict(tracker.get("billed") or {}).items():
        out["billed"][kind] = out["billed"].get(kind, 0) + count
    out["cached"] += tracker.get("cached", 0)
    out["embed_calls"] += tracker.get("embed_calls", 0)
    out["embed_tokens_est"] += tracker.get("embed_tokens_est", 0)
    out["grounding_calls"] += tracker.get("grounding_calls", 0)
    out["embed_est"] = bool(led.get("embed_est")) or bool(tracker.get("embed_est"))
    out["cache_storage"] = {m: dict(s) for m, s in (led.get("cache_storage") or {}).items()}
    for model, slot in (tracker.get("cache_storage") or {}).items():
        dst = out["cache_storage"].setdefault(
            model, {"count": 0, "tokens": 0, "cost": 0.0})
        dst["count"] += slot.get("count", 0)
        dst["tokens"] += slot.get("tokens", 0)
        dst["cost"] += slot.get("cost", 0.0)
    return out


def cost_totals(tracker: dict) -> tuple[float, float]:
    """Public (ai_total, ik_total) in INR for a tracker or cumulative
    ledger — used for the one-line session total under the per-run bill."""
    return _cost_totals(tracker)


# ─── Usage events → citation_usage_events (per-user billing ledger) ─────────
# The admin DB owns pricing: its BEFORE INSERT trigger reads
# citation_rate_card and stamps cost_inr/cost_usd. The engine reports WHAT
# was used — aggregate rows per (operation, model) per pipeline step — and
# its own figure only as producer_cost_inr (drift signal). Caller identity
# rides a ContextVar set by the API layer, like the court scope.

_usage_identity: "contextvars.ContextVar[dict | None]" = contextvars.ContextVar(
    "usage_identity", default=None)


def set_usage_identity(user_id: str | None, case_id: str | None = None) -> None:
    _usage_identity.set({"user_id": str(user_id) if user_id else "anonymous",
                         "case_id": str(case_id) if case_id else None})


def _usage_rows(tracker: dict, session_id: str | None, stage: str) -> list[dict[str, Any]]:
    ident = _usage_identity.get() or {}
    run_id = uuid.uuid4().hex[:16]
    base = {
        "session_id": session_id,
        "run_id": run_id,
        "stage": stage,
        "user_id": ident.get("user_id") or "anonymous",
        "case_id": ident.get("case_id"),
        "cache_hit": False,
        "cached_tokens": 0,
        "metadata": {"cache_method": "none"},
        "occurred_at": datetime.now(timezone.utc),
    }
    rows: list[dict[str, Any]] = []
    for key, r in (tracker.get("llm") or {}).items():
        task, _, model = key.partition("|")
        if not model:  # rows from before task-level tracking
            task, model = "other", key
        cached = int(min(r.get("cached", 0), r.get("in", 0)))
        # Which cache served the cached tokens: 'explicit' (verifier
        # CachedContent) / 'implicit' (Gemini prefix cache) / 'none'.
        method = (r.get("cache_method") or "implicit") if cached else "none"
        rows.append({**base,
                     "provider": "claude" if model.startswith("claude") else "gemini",
                     "service": "judgement_ai", "operation": task, "model": model,
                     "unit": "tokens", "quantity": int(r["in"] + r["out"]),
                     "calls": int(r["calls"]),
                     "input_tokens": int(r["in"]), "output_tokens": int(r["out"]),
                     "cached_tokens": cached,
                     "metadata": {"cache_method": method},
                     "producer_cost_inr": round(_llm_row_cost(model, r), 6)})
    if tracker.get("embed_calls"):
        tokens = int(tracker.get("embed_tokens_est") or 0)
        rows.append({**base, "provider": "gemini", "service": "judgement_ai",
                     "operation": "embedding_rerank", "model": "gemini-embedding-001",
                     "unit": "tokens", "quantity": tokens,
                     "calls": int(tracker["embed_calls"]),
                     "input_tokens": tokens, "output_tokens": 0,
                     "producer_cost_inr": round(tokens / 1e6 * GEMINI_EMBED_PER_1M_INR, 6)})
    if tracker.get("grounding_calls"):
        n = int(tracker["grounding_calls"])
        rows.append({**base, "provider": "gemini", "service": "judgement_ai",
                     "operation": "google_search_grounding", "model": None,
                     "unit": "calls", "quantity": n, "calls": n,
                     "input_tokens": 0, "output_tokens": 0,
                     "producer_cost_inr": round(n * GEMINI_GROUNDING_PER_CALL_INR, 6)})
    for model, slot in (tracker.get("cache_storage") or {}).items():
        # Explicit context-cache storage — tokens held for the cache TTL.
        rows.append({**base, "provider": "gemini", "service": "judgement_ai",
                     "operation": "context_cache_storage", "model": model,
                     "unit": "tokens", "quantity": int(slot.get("tokens", 0)),
                     "calls": int(slot.get("count", 0)),
                     "input_tokens": 0, "output_tokens": 0,
                     "cached_tokens": int(slot.get("tokens", 0)),
                     "metadata": {"cache_method": "explicit",
                                  "rate_inr_per_1m_token_hour":
                                      GEMINI_CACHE_STORAGE_PER_1M_HR_INR},
                     "producer_cost_inr": round(slot.get("cost", 0.0), 6)})
    for kind, count in dict(tracker.get("billed") or {}).items():
        rows.append({**base, "provider": "indian_kanoon", "service": "indian_kanoon",
                     "operation": kind, "model": None,
                     "unit": "calls", "quantity": int(count), "calls": int(count),
                     "input_tokens": 0, "output_tokens": 0,
                     "producer_cost_inr": round(IK_RATES_INR[kind] * count, 6)})
    if tracker.get("cached"):
        n = int(tracker["cached"])
        rows.append({**base, "provider": "indian_kanoon", "service": "indian_kanoon",
                     "operation": "cache_hit", "model": None,
                     "unit": "calls", "quantity": n, "calls": n,
                     "input_tokens": 0, "output_tokens": 0,
                     "cache_hit": True,
                     "metadata": {"cache_method": "response_cache"},
                     "producer_cost_inr": 0.0})
    for step_no, row in enumerate(rows):
        row["step_no"] = step_no
        row["event_key"] = (f"jud:{run_id}:{step_no}:{row['operation']}:"
                            f"{row.get('model') or 'ik'}")
    return rows


def flush_usage_events(tracker: dict, *, session_id: str | None, stage: str) -> int:
    """Report one pipeline step's spend to citation_usage_events. Sync
    (psycopg2) — call via asyncio.to_thread from async code. Never raises:
    a billing-ledger outage must never break research."""
    try:
        rows = _usage_rows(tracker, session_id, stage)
        if not rows:
            return 0
        from stores import postgres  # local import: stores must stay import-light
        written = postgres.usage_insert_events(rows)
        if written:
            logger.info("[usage] %d event row(s) → citation_usage_events "
                        "(stage=%s user=%s session=%s)",
                        written, stage, rows[0]["user_id"], session_id or "-")
        return written
    except Exception as exc:
        logger.warning("[usage] failed to record usage events: %s", exc)
        return 0


def _cost_totals(tracker: dict) -> tuple[float, float]:
    """(ai_total, ik_total) in INR for one tracker/ledger."""
    ai = 0.0
    for key, row in tracker.get("llm", {}).items():
        _task, _, model = key.partition("|")
        ai += _llm_row_cost(model or key, row)
    ai += tracker.get("embed_tokens_est", 0) / 1e6 * GEMINI_EMBED_PER_1M_INR
    ai += tracker.get("grounding_calls", 0) * GEMINI_GROUNDING_PER_CALL_INR
    ai += sum(slot.get("cost", 0.0)
              for slot in (tracker.get("cache_storage") or {}).values())
    ik = sum(IK_RATES_INR[kind] * count
             for kind, count in dict(tracker.get("billed") or {}).items())
    return ai, ik


def run_cost_log(tracker: dict, tag: str, step: dict | None = None) -> None:
    """ONE tabular console bill: every AI model's real token usage at
    rate-card prices, plus every Indian Kanoon request. Pass the session's
    cumulative ledger for the end-to-end bill; `step` (the phase's own
    tracker) adds a "this step" line under the grand total. Sections appear
    only when they saw traffic."""
    sep = "=" * 92
    dash = "-" * 92
    logger.info("[cost] %s", sep)
    logger.info("[cost] COMPLETE COST — %s", tag)

    ai_total = 0.0
    llm_rows = []
    for key, row in tracker.get("llm", {}).items():
        task, _, model = key.partition("|")
        if not model:  # ledger rows from before task-level tracking
            task, model = "other", key
        llm_rows.append((_TASK_LABELS.get(task, task), model, row))
    llm_rows.sort()
    if (llm_rows or tracker.get("embed_calls") or tracker.get("grounding_calls")
            or tracker.get("cache_storage")):
        logger.info("[cost] %s", dash)
        logger.info("[cost] %-27s %-24s %5s %11s %11s %8s",
                    "Task / agent", "Model", "Calls", "Tokens in",
                    "Tokens out", "Cost INR")
        total_cached = 0
        for label, model, row in llm_rows:
            cost = _llm_row_cost(model, row)
            ai_total += cost
            total_cached += min(row.get("cached", 0), row.get("in", 0))
            logger.info("[cost] %-27s %-24s %5d %11s %11s %8.2f",
                        label[:27], model[:24], row["calls"],
                        f"{row['in']:,}", f"{row['out']:,}", cost)
        if llm_rows:
            # Always printed — 0 means no call was served from a Gemini
            # context cache (implicit prefix or the verifier's explicit one).
            logger.info("[cost] %-27s %-24s %5s %11s %11s %8s",
                        "  of which CACHED input", "(billed at 25%)", "",
                        f"{total_cached:,}", "-", "")
        if tracker.get("embed_calls"):
            cost = tracker["embed_tokens_est"] / 1e6 * GEMINI_EMBED_PER_1M_INR
            ai_total += cost
            embed_label = ("5 Embedding rerank (est.)" if tracker.get("embed_est")
                           else "5 Embedding rerank")
            logger.info("[cost] %-27s %-24s %5d %11s %11s %8.2f",
                        embed_label, "gemini-embedding-001",
                        tracker["embed_calls"],
                        f"{tracker['embed_tokens_est']:,}", "-", cost)
        if tracker.get("grounding_calls"):
            cost = tracker["grounding_calls"] * GEMINI_GROUNDING_PER_CALL_INR
            ai_total += cost
            logger.info("[cost] %-27s %-24s %5d %11s %11s %8.2f",
                        "8 Google-search grounding", "per-call rate",
                        tracker["grounding_calls"], "-", "-", cost)
        for model, slot in (tracker.get("cache_storage") or {}).items():
            # Explicit context-cache STORAGE (verifier prompt held for its
            # TTL). Implicit prefix caching stores nothing and costs nothing.
            ai_total += slot.get("cost", 0.0)
            logger.info("[cost] %-27s %-24s %5d %11s %11s %8.2f",
                        "5 Context cache storage", model[:24],
                        slot.get("count", 0), f"{slot.get('tokens', 0):,}",
                        "-", slot.get("cost", 0.0))
        logger.info("[cost] %-27s %-24s %5s %11s %11s %8.2f",
                    "AI subtotal", "", "", "", "", ai_total)

    billed: Counter = tracker["billed"]
    ik_total = sum(IK_RATES_INR[kind] * count for kind, count in billed.items())
    if billed or tracker.get("cached"):
        logger.info("[cost] %s", dash)
        logger.info("[cost] %-28s %6s %12s %12s %9s",
                    "Indian Kanoon", "Calls", "Rate", "", "Cost INR")
        for kind, label in _IK_KIND_LABELS:
            count = billed.get(kind, 0)
            if count == 0 and kind in ("docfragment", "origdoc"):
                continue  # endpoints this pipeline never calls
            logger.info("[cost] %-28s %6d %12.2f %12s %9.2f",
                        label, count, IK_RATES_INR[kind], "",
                        IK_RATES_INR[kind] * count)
        if tracker.get("cached"):
            logger.info("[cost] %-28s %6d %12s %12s %9.2f",
                        "Cache hits (free)", tracker["cached"], "-", "", 0.0)
        logger.info("[cost] %-28s %6s %12s %12s %9.2f",
                    "IK subtotal", "", "", "", ik_total)

    logger.info("[cost] %s", dash)
    logger.info("[cost] %-28s %6s %12s %12s %9.2f",
                "GRAND TOTAL (INR)", "", "", "", ai_total + ik_total)
    if step is not None:
        step_ai, step_ik = _cost_totals(step)
        logger.info("[cost] %-28s %6s %12s %12s %9.2f",
                    "  of which THIS step", "", "", "", step_ai + step_ik)
    logger.info("[cost] %s", sep)


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
            tokens = None
            try:
                # Gemini's own token counter — exact billing tokens for the
                # embedded input (the count endpoint itself is free).
                counted = client.models.count_tokens(
                    model=settings.gemini_embedding_model, contents=texts)
                tokens = getattr(counted, "total_tokens", None)
            except Exception:
                tokens = None  # chars/4 fallback inside embed_track
            embed_track(texts, tokens)
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


# docsource substrings per selectable High-Court token — powers the
# deterministic post-fetch guard for court-scoped runs (scope_allows_court).
# Bench/variant doctypes IK offers that _HC_PROFILES doesn't carry directly
# are mapped by hand; the profile table fills in the rest below.
_COURT_TOKEN_MATCH: dict[str, tuple[str, ...]] = {
    "jaipur": ("rajasthan",),
    "jodhpur": ("rajasthan",),
    "kolkata_app": ("calcutta",),
    "delhiorders": ("delhi",),
    "patna_orders": ("patna",),
    "amravati": ("andhra", "amaravati", "amravati"),
    "srinagar": ("jammu", "kashmir"),
}
for _kw, _doctype, _match, _label in _HC_PROFILES:
    _COURT_TOKEN_MATCH.setdefault(_doctype, _match)


def scope_allows_court(court: str) -> bool:
    """Deterministic guard for a court-scoped run: does this candidate's
    court (its IK docsource line) belong to one of the user's selected
    courts? IK's own doctypes: filter already ran at fetch time — this
    drops anything that still slips through (aggregates, odd doc indexing)
    BEFORE the candidate is billed, verified or surfaced. Tokens with no
    docsource mapping (tribunals, laws, aggregates) stay permissive for
    non-court docsources — IK's filter remains the authority for them.
    No active scope → everything passes."""
    scope = _court_scope.get()
    if scope is None:
        return True
    low = (court or "").lower()
    permissive_other = False
    for token in scope.split(","):
        token = token.strip()
        if not token:
            continue
        if token in ("supremecourt", "scorders"):
            if "supreme court" in low:
                return True
            continue
        if token in ("delhidc", "bangaloredc"):
            if "district" in low:
                return True
            continue
        if token == "highcourts":
            if "high court" in low:
                return True
            continue
        match = _COURT_TOKEN_MATCH.get(token)
        if match is not None:
            # An HC token must match its state AND actually be a High Court
            # ('Bombay City Civil Court' never satisfies the bombay token).
            if "high court" in low and any(m in low for m in match):
                return True
            continue
        permissive_other = True
    if permissive_other and ("high court" not in low and "supreme court" not in low
                             and "district" not in low):
        return True
    return False


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
        llm_track_usage(settings.gemini_model, getattr(resp, "usage_metadata", None),
                        task="good_law_check")
        grounding_track()
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
