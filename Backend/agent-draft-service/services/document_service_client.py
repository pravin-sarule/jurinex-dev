"""
Fetch llm_models from document-service (HTTP). Document-service holds the llm_models table.
"""

from __future__ import annotations

import logging
import os
import time
from typing import Any, Dict, List, Optional

import requests

logger = logging.getLogger(__name__)

DOCUMENT_SERVICE_URL = os.environ.get("DOCUMENT_SERVICE_URL", "https://document-service-120280829617.asia-south1.run.app")
LLM_MODELS_PATH = "/api/llm-models"
TIMEOUT = 15

# ── In-process model list cache (TTL = 10 minutes) ───────────────────────────
_MODELS_CACHE: Dict[str, Any] = {}  # {"data": [...], "ts": float}
_MODELS_CACHE_TTL = 600  # seconds


def fetch_models_from_document_service() -> List[Dict[str, Any]]:
    """
    GET document-service /api/llm-models and return list of { id, name }.
    Log each model name to console. On failure returns [].
    Results are cached in-process for 10 minutes.
    """
    cached = _MODELS_CACHE.get("data")
    if cached is not None and (time.monotonic() - _MODELS_CACHE.get("ts", 0)) < _MODELS_CACHE_TTL:
        return cached

    url = f"{DOCUMENT_SERVICE_URL.rstrip('/')}{LLM_MODELS_PATH}"
    try:
        resp = requests.get(url, timeout=TIMEOUT)
        resp.raise_for_status()
        data = resp.json()
        models = data.get("models") if isinstance(data, dict) else []
        if not isinstance(models, list):
            models = []
        logger.info("[document_service] Fetched %d models from document-service", len(models))
        names = []
        for m in models:
            mid = m.get("id")
            name = m.get("name") or ""
            names.append(name)
            print(f"[document_service] Model: id={mid} -> name={name}")
        if names:
            print(f"[document_service] All model names: {', '.join(names)}")
        _MODELS_CACHE["data"] = models
        _MODELS_CACHE["ts"] = time.monotonic()
        return models
    except requests.RequestException as e:
        logger.warning("[document_service] Failed to fetch models from %s: %s", url, e)
        return []
    except Exception as e:
        logger.warning("[document_service] Error parsing response: %s", e)
        return []


def get_model_name_by_id_from_document_service(model_id: int) -> Optional[str]:
    """Resolve model_id to name using document-service list (fetches once per call; cache in caller if needed)."""
    models = fetch_models_from_document_service()
    for m in models:
        if m.get("id") == model_id:
            return m.get("name")
    return None


def build_id_to_name_map_from_document_service() -> Dict[int, str]:
    """Fetch models from document-service and return { id: name }."""
    models = fetch_models_from_document_service()
    return {int(m["id"]): (m.get("name") or "") for m in models if m.get("id") is not None}
