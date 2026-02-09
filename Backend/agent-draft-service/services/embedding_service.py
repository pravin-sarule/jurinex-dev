# """Gemini embedding service. Mirrors document-service embeddingService (models/text-embedding-004)."""

# from __future__ import annotations

# import os
# from typing import List

# from google import genai  # type: ignore


# MAX_CHARS = int(os.environ.get("GEMINI_EMBEDDING_MAX_CHARS", "8000"))
# BATCH_SIZE = int(os.environ.get("GEMINI_EMBEDDING_BATCH_SIZE", "100"))
# MODEL = os.environ.get("GEMINI_EMBEDDING_MODEL", "models/text-embedding-004")


# def _client() -> genai.Client:
#     api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
#     if not api_key:
#         raise ValueError("GEMINI_API_KEY or GOOGLE_API_KEY must be set")
#     return genai.Client(api_key=api_key)


# def _clean_text(text: str) -> str:
#     if not text:
#         return ""
#     return " ".join(text.split()).strip()[:MAX_CHARS]


# def generate_embeddings(texts: List[str]) -> List[List[float]]:
#     """
#     Generate embeddings for a list of texts using Gemini models/text-embedding-004.
#     Mirrors document-service embeddingService.generateEmbeddings.
#     """
#     import logging
#     import time
#     logger = logging.getLogger(__name__)
    
#     if not texts:
#         return []

#     client = _client()
#     cleaned = [_clean_text(t) for t in texts]
#     all_embeddings: List[List[float]] = []
    
#     max_retries = 3
#     retry_delay = 1  # seconds

#     for i in range(0, len(cleaned), BATCH_SIZE):
#         batch = cleaned[i : i + BATCH_SIZE]
        
#         for attempt in range(max_retries):
#             try:
#                 response = client.models.embed_content(
#                     model=MODEL,
#                     contents=batch,
#                 )
#                 if hasattr(response, "embeddings") and response.embeddings:
#                     for emb in response.embeddings:
#                         vals = getattr(emb, "values", None) or []
#                         all_embeddings.append(list(vals))
#                 else:
#                     # Single content: response.embedding or response.embeddings[0]
#                     emb = getattr(response, "embedding", None)
#                     if emb is None and getattr(response, "embeddings", None):
#                         emb = response.embeddings[0]
#                     if emb is not None:
#                         v = getattr(emb, "values", None)
#                         all_embeddings.append(list(v) if v is not None else [])
#                 break  # Success, exit retry loop
                
#             except Exception as e:
#                 error_msg = str(e)
#                 if attempt < max_retries - 1:
#                     logger.warning(f"[Embedding Service] Attempt {attempt + 1}/{max_retries} failed: {error_msg}. Retrying in {retry_delay}s...")
#                     time.sleep(retry_delay)
#                     retry_delay *= 2  # Exponential backoff
#                 else:
#                     logger.error(f"[Embedding Service] All {max_retries} attempts failed: {error_msg}")
#                     raise

#     return all_embeddings
"""Gemini embedding service using gemini-embedding-001."""

from __future__ import annotations

import os
from typing import List

import numpy as np
from google import genai  # type: ignore
from google.genai import types


MAX_CHARS = int(os.environ.get("GEMINI_EMBEDDING_MAX_CHARS", "8000"))
BATCH_SIZE = int(os.environ.get("GEMINI_EMBEDDING_BATCH_SIZE", "100"))
# Default to gemini-embedding-001 (official Gemini embedding model)
MODEL = os.environ.get("GEMINI_EMBEDDING_MODEL", "gemini-embedding-001")
# Output dimensions: 768, 1536, or 3072 (default 768 to match database schema)
EMBEDDING_DIMENSIONS = int(os.environ.get("GEMINI_EMBEDDING_DIMENSIONS", "768"))

# Note: gemini-embedding-001 doesn't require 'models/' prefix


def _client() -> genai.Client:
    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        raise ValueError("GEMINI_API_KEY or GOOGLE_API_KEY must be set")
    return genai.Client(api_key=api_key)


def _clean_text(text: str) -> str:
    if not text:
        return ""
    return " ".join(text.split()).strip()[:MAX_CHARS]


def generate_embeddings(texts: List[str]) -> List[List[float]]:
    """
    Generate embeddings for a list of texts using Gemini gemini-embedding-001.
    """
    import logging
    import time
    logger = logging.getLogger(__name__)
    
    if not texts:
        return []

    client = _client()
    cleaned = [_clean_text(t) for t in texts]
    all_embeddings: List[List[float]] = []
    
    max_retries = 3
    retry_delay = 1  # seconds

    for i in range(0, len(cleaned), BATCH_SIZE):
        batch = cleaned[i : i + BATCH_SIZE]
        
        for attempt in range(max_retries):
            try:
                logger.info(f"[Embedding Service] Processing batch {i//BATCH_SIZE + 1}, size={len(batch)}, model={MODEL}, dimensions={EMBEDDING_DIMENSIONS}")
                
                response = client.models.embed_content(
                    model=MODEL,
                    contents=batch,
                    config=types.EmbedContentConfig(
                        output_dimensionality=EMBEDDING_DIMENSIONS
                    )
                )
                
                if hasattr(response, "embeddings") and response.embeddings:
                    for emb in response.embeddings:
                        vals = getattr(emb, "values", None) or []
                        vals_list = list(vals)
                        
                        # Normalize embeddings for dimensions other than 3072
                        # (3072 is already normalized by the model)
                        if EMBEDDING_DIMENSIONS != 3072 and vals_list:
                            vals_np = np.array(vals_list)
                            norm = np.linalg.norm(vals_np)
                            if norm > 0:
                                vals_list = (vals_np / norm).tolist()
                        
                        all_embeddings.append(vals_list)
                else:
                    # Single content: response.embedding or response.embeddings[0]
                    emb = getattr(response, "embedding", None)
                    if emb is None and getattr(response, "embeddings", None):
                        emb = response.embeddings[0]
                    if emb is not None:
                        v = getattr(emb, "values", None)
                        vals_list = list(v) if v is not None else []
                        
                        # Normalize embeddings for dimensions other than 3072
                        if EMBEDDING_DIMENSIONS != 3072 and vals_list:
                            vals_np = np.array(vals_list)
                            norm = np.linalg.norm(vals_np)
                            if norm > 0:
                                vals_list = (vals_np / norm).tolist()
                        
                        all_embeddings.append(vals_list)
                
                logger.info(f"[Embedding Service] Successfully generated {len(batch)} embeddings")
                break  # Success, exit retry loop
                
            except Exception as e:
                error_msg = str(e)
                if attempt < max_retries - 1:
                    logger.warning(f"[Embedding Service] Attempt {attempt + 1}/{max_retries} failed: {error_msg}. Retrying in {retry_delay}s...")
                    time.sleep(retry_delay)
                    retry_delay *= 2  # Exponential backoff
                else:
                    logger.error(f"[Embedding Service] All {max_retries} attempts failed: {error_msg}")
                    raise

    logger.info(f"[Embedding Service] Total embeddings generated: {len(all_embeddings)}")
    return all_embeddings