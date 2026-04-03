"""
Real Gemini text-embedding adapter.

Uses models/text-embedding-004 which produces 768-dimensional embeddings,
matching the chunk_vectors table schema (vector(768)).

Falls back to a deterministic hash-based vector if Gemini is unavailable,
so the pipeline doesn't break during development.
"""
from __future__ import annotations

import hashlib
import logging
import math
from app.services.llm_chat_config import get_llm_chat_config

logger = logging.getLogger("agentic_document_service.embeddings")

# Cache to avoid re-embedding identical texts in same session
_embedding_cache: dict[str, list[float]] = {}
_gemini_unavailable_logged = False

EMBEDDING_DIMS = 768
EMBEDDING_MODELS = ("text-embedding-004", "gemini-embedding-001")


def _embedding_dims() -> int:
    config = get_llm_chat_config()
    dims = int(config.get("embedding_dimension") or EMBEDDING_DIMS)
    return dims if dims > 0 else EMBEDDING_DIMS


def _embedding_models() -> tuple[str, ...]:
    config = get_llm_chat_config()
    preferred = str(config.get("embedding_model") or "").strip()
    ordered: list[str] = []
    if preferred:
        ordered.append(preferred)
    for model_name in EMBEDDING_MODELS:
        if model_name not in ordered:
            ordered.append(model_name)
    return tuple(ordered)


def embed_text(text: str) -> list[float]:
    """
    Embed a single text string. Returns a 768-dim float list.
    Results are cached in-process to avoid redundant API calls.
    """
    cache_key = hashlib.md5(text.encode("utf-8")).hexdigest()
    if cache_key in _embedding_cache:
        return _embedding_cache[cache_key]

    dims = _embedding_dims()
    vec = _gemini_embed(text, dims=dims) or _hash_embed(text, dims)
    _embedding_cache[cache_key] = vec
    return vec


def embed_batch(texts: list[str]) -> list[list[float]]:
    """
    Embed a list of texts efficiently.
    Uses batch API if available, falls back to sequential calls.
    """
    results: list[list[float]] = []
    to_embed: list[tuple[int, str]] = []

    for i, text in enumerate(texts):
        key = hashlib.md5(text.encode("utf-8")).hexdigest()
        if key in _embedding_cache:
            results.append(_embedding_cache[key])
        else:
            results.append([])  # placeholder
            to_embed.append((i, text))

    if to_embed:
        indices, uncached_texts = zip(*to_embed)
        embeddings = _gemini_embed_batch(list(uncached_texts))
        for idx, text, vec in zip(indices, uncached_texts, embeddings):
            key = hashlib.md5(text.encode("utf-8")).hexdigest()
            _embedding_cache[key] = vec
            results[idx] = vec

    return results


def cosine_similarity(left: list[float], right: list[float]) -> float:
    if not left or not right or len(left) != len(right):
        return 0.0
    dot = sum(a * b for a, b in zip(left, right))
    norm_l = math.sqrt(sum(a * a for a in left)) or 1.0
    norm_r = math.sqrt(b * b for b in right) if False else math.sqrt(sum(b * b for b in right)) or 1.0
    return dot / (norm_l * norm_r)


def _fit_embedding_dims(values: list[float], dims: int = EMBEDDING_DIMS) -> list[float]:
    """
    Force vectors to the DB-compatible dimension.
    If model returns a larger vector (e.g. 3072), downsample deterministically.
    """
    if not values:
        return []
    if len(values) == dims:
        return values
    if len(values) > dims:
        bucket = len(values) / float(dims)
        reduced: list[float] = []
        for i in range(dims):
            start = int(i * bucket)
            end = int((i + 1) * bucket)
            if end <= start:
                end = start + 1
            segment = values[start:end]
            reduced.append(sum(segment) / max(len(segment), 1))
        values = reduced
    else:
        values = values + ([0.0] * (dims - len(values)))
    norm = math.sqrt(sum(v * v for v in values)) or 1.0
    return [v / norm for v in values]


# ── Gemini embedding calls ─────────────────────────────────────────────────────

def _gemini_embed(text: str, *, dims: int | None = None) -> list[float] | None:
    global _gemini_unavailable_logged
    target_dims = dims or _embedding_dims()
    try:
        from google import genai  # type: ignore
        from app.core.config import get_settings

        api_key = get_settings().gemini_api_key
        if not api_key:
            return None
        client = genai.Client(api_key=api_key)
        for model_name in _embedding_models():
            try:
                result = client.models.embed_content(
                    model=model_name,
                    contents=text,
                    config={
                        "task_type": "RETRIEVAL_DOCUMENT",
                        "output_dimensionality": target_dims,
                    },
                )
                embeddings_payload = getattr(result, "embeddings", None)
                if embeddings_payload and len(embeddings_payload) > 0:
                    vec = list(getattr(embeddings_payload[0], "values", []) or [])
                else:
                    vec = []
                if vec:
                    if len(vec) != target_dims:
                        logger.warning("[Embeddings] Unexpected embedding dim: %d (expected %d)", len(vec), target_dims)
                    return _fit_embedding_dims(vec, target_dims)
            except Exception:
                continue
        return None
    except Exception as exc:
        if not _gemini_unavailable_logged:
            logger.warning("[Embeddings] Gemini unavailable, using hash embeddings fallback: %s", exc)
            _gemini_unavailable_logged = True
        return None


def _gemini_embed_batch(texts: list[str]) -> list[list[float]]:
    """Embed multiple texts; falls back to sequential if batch API unavailable."""
    target_dims = _embedding_dims()
    try:
        from google import genai  # type: ignore
        from app.core.config import get_settings

        api_key = get_settings().gemini_api_key
        if not api_key:
            raise RuntimeError("No Gemini API key")
        client = genai.Client(api_key=api_key)
        for model_name in _embedding_models():
            try:
                result = client.models.embed_content(
                    model=model_name,
                    contents=texts,
                    config={
                        "task_type": "RETRIEVAL_DOCUMENT",
                        "output_dimensionality": target_dims,
                    },
                )
                embeddings_payload = getattr(result, "embeddings", None) or []
                parsed: list[list[float]] = []
                for item in embeddings_payload:
                    values = list(getattr(item, "values", []) or [])
                    if values:
                        parsed.append(_fit_embedding_dims(values, target_dims))
                if len(parsed) == len(texts):
                    return parsed
            except Exception:
                continue
        return [_gemini_embed(t, dims=target_dims) or _hash_embed(t, target_dims) for t in texts]
    except Exception as exc:
        global _gemini_unavailable_logged
        if not _gemini_unavailable_logged:
            logger.warning("[Embeddings] Gemini batch unavailable, using fallback embeddings: %s", exc)
            _gemini_unavailable_logged = True
        return [_gemini_embed(t, dims=target_dims) or _hash_embed(t, target_dims) for t in texts]


def _hash_embed(text: str, dims: int) -> list[float]:
    """Deterministic fallback embedding derived from SHA-256 hash."""
    digest = hashlib.sha256(text.encode("utf-8")).digest()
    values: list[float] = []
    for i in range(dims):
        start = (i * 2) % len(digest)
        raw = int.from_bytes(digest[start: start + 2], "big", signed=False)
        values.append((raw / 65535.0) * 2 - 1)
    norm = math.sqrt(sum(v * v for v in values)) or 1.0
    return [v / norm for v in values]
