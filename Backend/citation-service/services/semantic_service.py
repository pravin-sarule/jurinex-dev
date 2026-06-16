from __future__ import annotations

import logging
import math
import os

from models.citation_models import Candidate

logger = logging.getLogger(__name__)

_CASE_CHARS = int(os.environ.get("CITATION_V2_SEMANTIC_CASE_CHARS", "8000"))
_CAND_CHARS = int(os.environ.get("CITATION_V2_SEMANTIC_CAND_CHARS", "6000"))


def _cosine(a: list[float], b: list[float]) -> float:
    if not a or not b:
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    return (dot / (na * nb)) if na and nb else 0.0


def case_similarity_scores(
    case_context: str,
    candidates: list[Candidate],
    run_id: str,
    user_id: str,
) -> dict[str, float]:
    """
    Semantic relevance: embed the case + each candidate and return {doc_id: cosine}.
    Returns {} (caller falls back to lexical scoring) if embeddings are unavailable.
    Records the embedding cost.
    """
    items = list(candidates or [])
    case_text = (case_context or "").strip()[:_CASE_CHARS]
    if not items or len(case_text) < 50:
        return {}

    try:
        from db.client import get_query_embeddings_batch
    except Exception:
        logger.warning("[SEMANTIC] embedder import failed; using lexical scoring")
        return {}

    cand_texts = []
    for c in items:
        blob = " ".join([c.title or "", c.headline or "", c.fragment or "", (c.full_text or "")[:2000]]).strip()
        cand_texts.append(blob[:_CAND_CHARS] or (c.title or "x"))

    texts = [case_text] + cand_texts
    try:
        vecs = get_query_embeddings_batch(texts)
    except Exception:
        logger.exception("[SEMANTIC] embedding call failed; using lexical scoring")
        return {}

    if not vecs or not vecs[0]:
        logger.info("[SEMANTIC] no case vector returned; using lexical scoring")
        return {}

    case_vec = vecs[0]
    cand_vecs = vecs[1:]
    sims: dict[str, float] = {}
    for c, v in zip(items, cand_vecs):
        sims[c.doc_id] = max(0.0, min(1.0, _cosine(case_vec, v)))

    # Record embedding cost (estimate tokens from characters; ~4 chars/token).
    try:
        from utils.usage_tracker import record_gemini_embedding
        est_tokens = max(1, sum(len(t) for t in texts) // 4)
        record_gemini_embedding(
            run_id, user_id, est_tokens,
            model=os.environ.get("GEMINI_QUERY_EMBEDDING_MODEL", "models/gemini-embedding-001"),
        )
    except Exception:
        logger.debug("[SEMANTIC] embedding cost record skipped", exc_info=True)

    logger.info(
        "[SEMANTIC] scored %d candidate(s) by embedding similarity (case_chars=%d); top=%.3f",
        len(sims), len(case_text), max(sims.values()) if sims else 0.0,
    )
    return sims
