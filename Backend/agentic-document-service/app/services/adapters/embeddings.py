"""
Gemini text-embedding adapter with batching, rate-limit protection, and retry.

Key design:
- embed_batch() splits large lists into sub-batches (default 50 texts each)
- Each sub-batch is sent via a single Gemini embed_content call
- A token-bucket rate limiter ensures we never exceed EMBEDDING_RPM_LIMIT
- On 429 / ResourceExhausted errors, exponential backoff + retry up to
  EMBEDDING_MAX_RETRIES times before falling back to deterministic hash vectors
- In-process MD5 cache avoids re-embedding identical texts within a session
- Falls back to a deterministic hash-based vector if Gemini is unavailable,
  so the pipeline never breaks during development or quota exhaustion
"""
from __future__ import annotations

import hashlib
import logging
import math
import random
import threading
import time
from app.services.llm_chat_config import get_llm_chat_config

logger = logging.getLogger("agentic_document_service.embeddings")

# ---------------------------------------------------------------------------
# In-process embedding cache (md5 key → vector)
# ---------------------------------------------------------------------------
_embedding_cache: dict[str, list[float]] = {}
_gemini_unavailable_logged = False

EMBEDDING_DIMS = 768
# text-embedding-004 is tried first; if it returns 404 (not found / quota issue),
# it is added to _bad_models so subsequent calls skip it without wasting retries.
EMBEDDING_MODELS = ("text-embedding-004", "gemini-embedding-001")

# Process-level set of model names that have returned a permanent 404/not-found
# error.  Entries are added lazily on first failure and persist for the process
# lifetime so retries do not hammer an unavailable model.
_bad_models: set[str] = set()


# ---------------------------------------------------------------------------
# Config helpers
# ---------------------------------------------------------------------------

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


def _get_batch_size() -> int:
    try:
        from app.core.config import get_settings
        return max(1, int(get_settings().embedding_batch_size or 50))
    except Exception:
        return 50


def _get_max_retries() -> int:
    try:
        from app.core.config import get_settings
        return max(0, int(get_settings().embedding_max_retries or 5))
    except Exception:
        return 5


def _get_rpm_limit() -> int:
    try:
        from app.core.config import get_settings
        return max(1, int(get_settings().embedding_rpm_limit or 1500))
    except Exception:
        return 1500


# ---------------------------------------------------------------------------
# Token-bucket rate limiter (thread-safe)
# ---------------------------------------------------------------------------

class _TokenBucket:
    """
    Thread-safe token bucket.
    Tokens refill at `rpm / 60` per second up to a cap of `rpm`.
    Each acquire(n) call blocks until n tokens are available.
    """

    def __init__(self, rpm: int) -> None:
        self._rpm = rpm
        self._refill_rate = rpm / 60.0          # tokens per second
        self._tokens = float(rpm)               # start full
        self._max_tokens = float(rpm)
        self._last_refill = time.monotonic()
        self._lock = threading.Lock()

    def acquire(self, tokens: int = 1) -> None:
        while True:
            with self._lock:
                now = time.monotonic()
                elapsed = now - self._last_refill
                self._tokens = min(
                    self._max_tokens,
                    self._tokens + elapsed * self._refill_rate,
                )
                self._last_refill = now
                if self._tokens >= tokens:
                    self._tokens -= tokens
                    return
                deficit = tokens - self._tokens
                wait_secs = deficit / self._refill_rate
            time.sleep(max(0.01, wait_secs))


# Lazy singleton so we pick up the configured RPM on first use
_rate_limiter: _TokenBucket | None = None
_rate_limiter_rpm: int = 0
_rate_limiter_lock = threading.Lock()


def _get_rate_limiter() -> _TokenBucket:
    global _rate_limiter, _rate_limiter_rpm
    rpm = _get_rpm_limit()
    with _rate_limiter_lock:
        if _rate_limiter is None or _rate_limiter_rpm != rpm:
            _rate_limiter = _TokenBucket(rpm)
            _rate_limiter_rpm = rpm
    return _rate_limiter


def _is_rate_limit_error(msg: str) -> bool:
    lower = msg.lower()
    return any(kw in lower for kw in ("429", "quota", "rate limit", "resource exhausted", "too many requests"))


def _is_model_not_found_error(msg: str) -> bool:
    """Return True for 404 / model-not-found errors that are permanent, not transient."""
    lower = msg.lower()
    return any(kw in lower for kw in ("404", "not found", "is not found", "does not exist", "model not found"))


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

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

    - Hits in-process cache are returned immediately (no API call).
    - Remaining texts are split into sub-batches of `embedding_batch_size`
      and sent to Gemini in parallel-friendly serial calls protected by the
      token-bucket rate limiter and exponential-backoff retry.
    - Any sub-batch that exhausts retries falls back to hash vectors so the
      overall pipeline never fails, even for 1 000-page documents.
    """
    if not texts:
        return []

    dims = _embedding_dims()
    results: list[list[float]] = [[] for _ in range(len(texts))]

    # --- cache pass ---
    uncached_indices: list[int] = []
    for i, text in enumerate(texts):
        key = hashlib.md5(text.encode("utf-8")).hexdigest()
        if key in _embedding_cache:
            results[i] = _embedding_cache[key]
        else:
            uncached_indices.append(i)

    if not uncached_indices:
        return results

    # --- batch embed uncached texts ---
    uncached_texts = [texts[i] for i in uncached_indices]
    batch_size = _get_batch_size()
    embedded = _embed_texts_in_batches(uncached_texts, dims, batch_size)

    # --- write back to cache and result list ---
    for slot, (orig_idx, text) in enumerate(zip(uncached_indices, uncached_texts)):
        vec = embedded[slot]
        key = hashlib.md5(text.encode("utf-8")).hexdigest()
        _embedding_cache[key] = vec
        results[orig_idx] = vec

    return results


def cosine_similarity(left: list[float], right: list[float]) -> float:
    if not left or not right or len(left) != len(right):
        return 0.0
    dot = sum(a * b for a, b in zip(left, right))
    norm_l = math.sqrt(sum(a * a for a in left)) or 1.0
    norm_r = math.sqrt(sum(b * b for b in right)) or 1.0
    return dot / (norm_l * norm_r)


# ---------------------------------------------------------------------------
# Internal batch helpers
# ---------------------------------------------------------------------------

def _embed_texts_in_batches(texts: list[str], dims: int, batch_size: int) -> list[list[float]]:
    """
    Split `texts` into sub-batches of `batch_size`, embed each with retry,
    fall back to hash embeddings for any sub-batch that permanently fails.
    """
    results: list[list[float]] = []
    total = len(texts)
    for batch_start in range(0, total, batch_size):
        batch = texts[batch_start: batch_start + batch_size]
        logger.debug(
            "[Embeddings] Batch %d-%d / %d",
            batch_start + 1,
            min(batch_start + batch_size, total),
            total,
        )
        batch_vecs = _gemini_embed_batch_with_retry(batch, dims)
        if batch_vecs is None or len(batch_vecs) != len(batch):
            # Fallback: deterministic hash for every text in this sub-batch
            logger.warning(
                "[Embeddings] Sub-batch %d-%d failed — using hash fallback for %d texts",
                batch_start + 1,
                min(batch_start + batch_size, total),
                len(batch),
            )
            batch_vecs = [_hash_embed(t, dims) for t in batch]
        results.extend(batch_vecs)
    return results


def _gemini_embed_batch_with_retry(texts: list[str], dims: int) -> list[list[float]] | None:
    """
    Send a single sub-batch to Gemini with exponential-backoff retry on
    rate-limit errors (429 / ResourceExhausted).

    Returns the list of vectors on success, None if all retries are exhausted
    or a non-recoverable error occurs.
    """
    max_retries = _get_max_retries()
    rate_limiter = _get_rate_limiter()

    for attempt in range(max_retries + 1):
        if attempt > 0:
            backoff = min(120.0, (2 ** (attempt - 1)) * 2.0) + random.uniform(0, 1.5)
            logger.warning(
                "[Embeddings] Rate limit hit — retry %d/%d, backing off %.1fs",
                attempt,
                max_retries,
                backoff,
            )
            time.sleep(backoff)

        # Honour the rate limit before each API call
        rate_limiter.acquire()

        try:
            from google import genai  # type: ignore
            from app.core.config import get_settings

            api_key = get_settings().gemini_api_key
            if not api_key:
                return None

            client = genai.Client(api_key=api_key)
            rate_limited = False

            for model_name in _embedding_models():
                # Skip models that have previously returned a permanent 404.
                if model_name in _bad_models:
                    continue
                try:
                    result = client.models.embed_content(
                        model=model_name,
                        contents=texts,
                        config={
                            "task_type": "RETRIEVAL_DOCUMENT",
                            "output_dimensionality": dims,
                        },
                    )
                    payload = getattr(result, "embeddings", None) or []
                    parsed: list[list[float]] = []
                    for item in payload:
                        values = list(getattr(item, "values", []) or [])
                        if values:
                            parsed.append(_fit_embedding_dims(values, dims))
                    if len(parsed) == len(texts):
                        return parsed
                    # Partial result — try next model
                    continue
                except Exception as model_exc:
                    exc_str = str(model_exc)
                    if _is_rate_limit_error(exc_str):
                        rate_limited = True
                        break   # don't try other models; let outer loop retry
                    if _is_model_not_found_error(exc_str):
                        # Permanent failure: blacklist this model for the process lifetime
                        # and immediately fall through to the next model (e.g. gemini-embedding-001).
                        if model_name not in _bad_models:
                            _bad_models.add(model_name)
                            logger.warning(
                                "[Embeddings] Model '%s' returned 404/not-found — "
                                "blacklisting for this process; falling back to next model. "
                                "Error: %s",
                                model_name,
                                exc_str[:200],
                            )
                        continue
                    continue    # non-rate-limit, non-404 error — try next model

            if rate_limited and attempt < max_retries:
                continue        # outer loop will sleep then retry
            return None

        except Exception as exc:
            if _is_rate_limit_error(str(exc)) and attempt < max_retries:
                continue
            global _gemini_unavailable_logged
            if not _gemini_unavailable_logged:
                logger.warning("[Embeddings] Gemini unavailable: %s", exc)
                _gemini_unavailable_logged = True
            return None

    # All retries exhausted
    logger.error("[Embeddings] All %d retries exhausted for batch of %d texts", max_retries, len(texts))
    return None


# ---------------------------------------------------------------------------
# Single-text Gemini call (used by embed_text)
# ---------------------------------------------------------------------------

def _gemini_embed(text: str, *, dims: int | None = None) -> list[float] | None:
    global _gemini_unavailable_logged
    target_dims = dims or _embedding_dims()
    try:
        from google import genai  # type: ignore
        from app.core.config import get_settings

        api_key = get_settings().gemini_api_key
        if not api_key:
            return None

        _get_rate_limiter().acquire()
        client = genai.Client(api_key=api_key)
        for model_name in _embedding_models():
            if model_name in _bad_models:
                continue
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
                        logger.warning(
                            "[Embeddings] Unexpected embedding dim: %d (expected %d)",
                            len(vec),
                            target_dims,
                        )
                    return _fit_embedding_dims(vec, target_dims)
            except Exception as exc:
                if _is_model_not_found_error(str(exc)) and model_name not in _bad_models:
                    _bad_models.add(model_name)
                    logger.warning(
                        "[Embeddings] Model '%s' returned 404/not-found in embed_text — "
                        "blacklisting; will use next model. Error: %s",
                        model_name, str(exc)[:200],
                    )
                continue
        return None
    except Exception as exc:
        if not _gemini_unavailable_logged:
            logger.warning("[Embeddings] Gemini unavailable, using hash embeddings fallback: %s", exc)
            _gemini_unavailable_logged = True
        return None


# ---------------------------------------------------------------------------
# Vector utilities
# ---------------------------------------------------------------------------

def _fit_embedding_dims(values: list[float], dims: int = EMBEDDING_DIMS) -> list[float]:
    """Force vectors to the DB-compatible dimension by pooling or padding."""
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
