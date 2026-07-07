"""
Query-side embedding generation for the chatbot's search_documents tool.
Produces 768-dim vectors matching the chunk_embeddings table schema.
"""
from __future__ import annotations

import logging
import math

logger = logging.getLogger("ai_chatbot.embeddings")

EMBEDDING_DIMS = 768
_MODELS = ("models/gemini-embedding-001",)


def embed_query(text: str) -> list[float] | None:
    """
    Generate a 768-dim RETRIEVAL_QUERY embedding.
    Returns None on failure so callers can fall back gracefully.
    """
    try:
        from google import genai  # type: ignore
        from app.core.config import get_settings

        api_key = get_settings().gemini_api_key
        if not api_key:
            logger.warning("GEMINI_API_KEY not set — cannot generate embedding")
            return None

        client = genai.Client(api_key=api_key)
        for model in _MODELS:
            try:
                result = client.models.embed_content(
                    model=model,
                    contents=text,
                    config={
                        "task_type": "RETRIEVAL_QUERY",
                        "output_dimensionality": EMBEDDING_DIMS,
                    },
                )
                embeddings = getattr(result, "embeddings", None)
                if embeddings:
                    values = list(getattr(embeddings[0], "values", []) or [])
                    if values:
                        return _fit_dims(values, EMBEDDING_DIMS)
            except Exception as model_exc:
                logger.debug("Model %s failed: %s", model, model_exc)
                continue
        return None
    except Exception as exc:
        logger.error("embed_query error: %s", exc)
        return None


def _fit_dims(values: list[float], dims: int) -> list[float]:
    """Pool or pad a vector to exactly `dims` dimensions, then L2-normalise."""
    if len(values) == dims:
        return values
    if len(values) > dims:
        bucket = len(values) / float(dims)
        values = [
            sum(values[int(i * bucket): int((i + 1) * bucket)])
            / max(int((i + 1) * bucket) - int(i * bucket), 1)
            for i in range(dims)
        ]
    else:
        values = values + [0.0] * (dims - len(values))
    norm = math.sqrt(sum(v * v for v in values)) or 1.0
    return [v / norm for v in values]
