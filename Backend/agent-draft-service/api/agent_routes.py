"""
Agent config API: list models (fetched from document-service) and fetch agent config from draft DB (agent_prompts).
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List

from fastapi import APIRouter, Query

from config.gemini_models import (
    CLAUDE_MODELS,
    DEFAULT_GEMINI_MODEL,
    GEMINI_MODELS,
)
from services import agent_config_service
from services.document_service_client import fetch_models_from_document_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["agents"])


@router.get("/models", response_model=Dict[str, Any])
def list_models() -> Dict[str, Any]:
    """
    Fetch llm_models from document-service and return the list. Logs each model name to console.
    Falls back to config models if document-service is unavailable.
    """
    models = fetch_models_from_document_service()
    if models:
        model_names = [m.get("name") for m in models if m.get("name")]
        print(f"[API /api/models] Fetched from document_service: {model_names}")
        return {
            "success": True,
            "source": "document_service",
            "models": models,
            "model_names": model_names,
            "default": DEFAULT_GEMINI_MODEL,
        }
    config_models = list(GEMINI_MODELS) + list(CLAUDE_MODELS)
    print(f"[API /api/models] Fallback to config: {config_models}")
    return {
        "success": True,
        "source": "config",
        "models": [{"id": i, "name": n} for i, n in enumerate(config_models, 1)],
        "model_names": config_models,
        "default": DEFAULT_GEMINI_MODEL,
    }


@router.get("/agents/config", response_model=Dict[str, Any])
def get_agent_config(
    agent_type: str = Query(..., description="Agent type, e.g. 'drafting'"),
) -> Dict[str, Any]:
    """
    Fetch agent config for the given agent_type from DB.
    Returns: id, name, prompt, model_ids, model_names, resolved_model, temperature, llm_parameters.
    If no DB row exists, returns empty config and default models list.
    """
    agent = agent_config_service.get_agent_by_type(agent_type)
    if not agent:
        return {
            "agent_type": agent_type,
            "agent": None,
            "models": list(GEMINI_MODELS) + list(CLAUDE_MODELS),
            "resolved_model": DEFAULT_GEMINI_MODEL,
        }
    # Serialize dates and strip non-JSON-serializable if any
    out = dict(agent)
    for k in ("created_at", "updated_at"):
        if k in out and hasattr(out[k], "isoformat"):
            out[k] = out[k].isoformat()
    return {
        "agent_type": agent_type,
        "agent": out,
        "models": out.get("model_names", list(GEMINI_MODELS) + list(CLAUDE_MODELS)),
        "resolved_model": out.get("resolved_model", DEFAULT_GEMINI_MODEL),
    }


@router.get("/agents/list", response_model=Dict[str, Any])
def list_agents_by_type(
    agent_type: str = Query(..., description="Agent type, e.g. 'drafting'"),
) -> Dict[str, Any]:
    """
    List all agents for the given agent_type with their model_ids and resolved model names.
    """
    agents: List[Dict[str, Any]] = agent_config_service.get_agents_by_type(agent_type)
    for a in agents:
        for k in ("created_at", "updated_at"):
            if k in a and hasattr(a[k], "isoformat"):
                a[k] = a[k].isoformat()
    return {
        "agent_type": agent_type,
        "agents": agents,
        "models": list(GEMINI_MODELS) + list(CLAUDE_MODELS),
    }
