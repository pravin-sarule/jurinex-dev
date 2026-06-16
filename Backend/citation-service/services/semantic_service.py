from __future__ import annotations

import logging
import math
import os
import re

from models.citation_models import Candidate
from models.issue_models import IssueCard

logger = logging.getLogger(__name__)

_CASE_CHARS = int(os.environ.get("CITATION_V2_SEMANTIC_CASE_CHARS", "8000"))
_CAND_CHARS = int(os.environ.get("CITATION_V2_SEMANTIC_CAND_CHARS", "6000"))
_ISSUE_QUERY_CHARS = int(os.environ.get("CITATION_V2_SEMANTIC_ISSUE_CHARS", "2000"))

_HELD_RX = re.compile(r"\b(held\s+that|it\s+is\s+held|we\s+hold|the\s+ratio|HELD)\b", re.IGNORECASE)


def _cosine(a: list[float], b: list[float]) -> float:
    if not a or not b:
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    return (dot / (na * nb)) if na and nb else 0.0


def _ratio_slice(candidate: Candidate) -> str:
    """Prefer the candidate's ratio/holding text over the opening facts.

    full_text is only present after fetch_full_documents, so at scoring time this
    gracefully falls back to fragment/headline/title (what retrieval gave us).
    """
    full = (candidate.full_text or "").strip()
    if len(full) > 2500:
        m = _HELD_RX.search(full)
        if m:
            return full[m.start():m.start() + _CAND_CHARS]
        # Middle section is far more likely to carry the ratio than the opening facts.
        return full[2000:2000 + _CAND_CHARS]
    blob = " ".join([candidate.title or "", candidate.headline or "", candidate.fragment or ""]).strip()
    return (blob or (candidate.title or "x"))[:_CAND_CHARS]


def _issue_query_text(issue: IssueCard) -> str:
    """Build the search-side text for an issue: the question + its doctrines/phrases."""
    parts = [issue.legal_issue or ""]
    parts += list(getattr(issue, "doctrines", None) or [])
    parts += list(issue.phrase_terms or [])
    parts += list(issue.statutes or [])
    return " ".join(p for p in parts if p).strip()[:_ISSUE_QUERY_CHARS]


def case_similarity_scores(
    case_context: str,
    candidates: list[Candidate],
    run_id: str,
    user_id: str,
    issues: list[IssueCard] | None = None,
) -> dict[str, float]:
    """
    Per-issue semantic relevance. Each candidate is compared against the embedding of
    the SPECIFIC issue it was retrieved for (issue_statement + doctrines), not one
    whole-case vector — so a peripheral sub-issue match no longer scores high (FAILURE 2).

    Query side uses RETRIEVAL_QUERY, candidate side uses RETRIEVAL_DOCUMENT (FAILURE 3).
    Returns {} (caller falls back to lexical) when embeddings are unavailable.
    """
    items = list(candidates or [])
    case_text = (case_context or "").strip()[:_CASE_CHARS]
    if not items or len(case_text) < 50:
        return {}

    try:
        from db.client import get_document_embeddings_batch, get_query_embeddings_batch
    except Exception:
        logger.warning("[SEMANTIC] embedder import failed; using lexical scoring")
        return {}

    # ── Query side: one vector per issue (+ a whole-case fallback vector) ─────────
    issue_list = list(issues or [])
    issue_ids = [iss.issue_id for iss in issue_list]
    query_texts = [_issue_query_text(iss) or case_text for iss in issue_list] + [case_text]
    try:
        q_vecs = get_query_embeddings_batch(query_texts)
    except Exception:
        logger.exception("[SEMANTIC] query embedding failed; using lexical scoring")
        return {}
    if not q_vecs or not q_vecs[-1]:
        logger.info("[SEMANTIC] no case vector returned; using lexical scoring")
        return {}
    case_vec = q_vecs[-1]
    issue_vec = {iid: q_vecs[i] for i, iid in enumerate(issue_ids) if i < len(q_vecs) and q_vecs[i]}

    # ── Candidate side: ratio/holding slice embedded as a DOCUMENT ───────────────
    cand_texts = [_ratio_slice(c) for c in items]
    try:
        c_vecs = get_document_embeddings_batch(cand_texts)
    except Exception:
        logger.exception("[SEMANTIC] document embedding failed; using lexical scoring")
        return {}

    sims: dict[str, float] = {}
    for c, v in zip(items, c_vecs):
        ref = issue_vec.get(c.matched_issue_id) or case_vec
        sims[c.doc_id] = max(0.0, min(1.0, _cosine(ref, v)))

    # Record embedding cost (~4 chars/token) across both batches.
    try:
        from utils.usage_tracker import record_gemini_embedding
        est_tokens = max(1, (sum(len(t) for t in query_texts) + sum(len(t) for t in cand_texts)) // 4)
        record_gemini_embedding(
            run_id, user_id, est_tokens,
            model=os.environ.get("GEMINI_QUERY_EMBEDDING_MODEL", "models/gemini-embedding-001"),
        )
    except Exception:
        logger.debug("[SEMANTIC] embedding cost record skipped", exc_info=True)

    logger.info(
        "[SEMANTIC] scored %d candidate(s) per-issue (%d issue vec, case_chars=%d); top=%.3f",
        len(sims), len(issue_vec), len(case_text), max(sims.values()) if sims else 0.0,
    )
    return sims
