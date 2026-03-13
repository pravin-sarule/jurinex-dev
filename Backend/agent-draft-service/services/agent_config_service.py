"""
Fetch drafting agent config and models from the database.
Agents table: id, name, prompt, model_ids, temperature, agent_type, created_at, updated_at, llm_parameters.
Resolves model_ids to Gemini model names using config/gemini_models.
"""

from __future__ import annotations

import json
import logging
import os
import time
from typing import Any, Dict, List, Optional

from services import draft_db

logger = logging.getLogger(__name__)

# Agent prompts table in draft DB (configurable via env)
AGENTS_TABLE = os.environ.get("AGENT_PROMPTS_TABLE", "agent_prompts")

# ── In-process agent config cache (TTL = 5 minutes) ──────────────────────────
# Avoids a DB query + HTTP call to document-service on every section generation.
_AGENT_CACHE: Dict[str, Dict[str, Any]] = {}  # agent_type → {"data": ..., "ts": float}
_AGENT_CACHE_TTL = 300  # seconds


def _get_cached_agent(agent_type: str) -> Optional[Dict[str, Any]]:
    entry = _AGENT_CACHE.get(agent_type)
    if entry and (time.monotonic() - entry["ts"]) < _AGENT_CACHE_TTL:
        return entry["data"]
    return None


def _set_cached_agent(agent_type: str, data: Optional[Dict[str, Any]]) -> None:
    _AGENT_CACHE[agent_type] = {"data": data, "ts": time.monotonic()}


def invalidate_agent_cache(agent_type: Optional[str] = None) -> None:
    """Call this after updating an agent config in DB to flush the cache."""
    if agent_type:
        _AGENT_CACHE.pop(agent_type, None)
    else:
        _AGENT_CACHE.clear()


def _parse_model_ids(raw: Any) -> List[int]:
    """Parse model_ids from DB (integer[] or jsonb array)."""
    if raw is None:
        return []
    if isinstance(raw, list):
        return [int(x) for x in raw if x is not None]
    if isinstance(raw, str):
        try:
            arr = json.loads(raw)
            return [int(x) for x in arr if x is not None] if isinstance(arr, list) else []
        except Exception:
            return []
    return []


def _parse_llm_parameters(raw: Any) -> Dict[str, Any]:
    """Parse llm_parameters from DB (jsonb)."""
    if raw is None:
        return {}
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        try:
            return json.loads(raw) if raw.strip() else {}
        except Exception:
            return {}
    return {}


def get_agent_by_type(agent_type: str) -> Optional[Dict[str, Any]]:
    """
    Fetch one agent by agent_type (e.g. 'drafting').
    Returns agent with keys: id, name, prompt, model_ids, temperature, agent_type,
    created_at, updated_at, llm_parameters, and resolved model_names (list of Gemini model names).
    Results are cached in-process for 5 minutes to avoid repeated DB + HTTP calls.
    """
    cached = _get_cached_agent(agent_type)
    if cached is not None:
        return cached

    try:
        with draft_db.get_draft_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"""
                    SELECT id, name, prompt, model_ids, temperature, agent_type,
                           created_at, updated_at, llm_parameters
                    FROM {AGENTS_TABLE}
                    WHERE agent_type = %s
                    ORDER BY updated_at DESC
                    LIMIT 1
                    """,
                    (agent_type,),
                )
                row = cur.fetchone()
                if not row:
                    _set_cached_agent(agent_type, None)
                    return None
                colnames = [d[0] for d in cur.description]
                raw = dict(zip(colnames, row))
                model_ids = _parse_model_ids(raw.get("model_ids"))
                raw["model_ids"] = model_ids
                raw["llm_parameters"] = _parse_llm_parameters(raw.get("llm_parameters"))

                from config.gemini_models import GEMINI_MODELS, CLAUDE_MODELS, get_model_name, is_valid_model, CLAUDE_DISPLAY_TO_API_ID
                model_names = []
                id_to_name = _fetch_model_id_to_name_from_document_service()
                for mid in model_ids:
                    name = id_to_name.get(mid) or get_model_name(mid)
                    if name and is_valid_model(name):
                        # Resolve display names to API IDs
                        model_names.append(CLAUDE_DISPLAY_TO_API_ID.get(name, name))
                default_names = list(GEMINI_MODELS) + list(CLAUDE_MODELS)
                raw["model_names"] = model_names if model_names else default_names
                raw["resolved_model"] = _resolved_model_from_ids(model_ids, id_to_name)
                # Console: agent and model from DB, prompt from DB
                resolved = raw["resolved_model"]
                prompt_preview = (raw.get("prompt") or "")[:80]
                print(f"[agent_config] Agent from DB: agent_type={agent_type!r}, resolved_model={resolved!r}, model_ids={model_ids}, model_names={model_names}")
                print(f"[agent_config] Prompt from DB (length={len(raw.get('prompt') or '')}): {prompt_preview}{'...' if len((raw.get('prompt') or '')) > 80 else ''}")
                _set_cached_agent(agent_type, raw)
                return raw
    except Exception as e:
        logger.warning("agent_config_service: could not fetch agent by type %s: %s", agent_type, e)
        return None


def _fetch_model_id_to_name_from_document_service() -> Dict[int, str]:
    """Fetch llm_models from document-service and return { id: name }."""
    try:
        from services.document_service_client import build_id_to_name_map_from_document_service
        return build_id_to_name_map_from_document_service()
    except Exception as e:
        logger.warning("agent_config_service: could not fetch models from document-service: %s", e)
        return {}


def _resolved_model_from_ids(model_ids: List[int], id_to_name: Dict[int, str]) -> str:
    """First model name from document-service map, else config fallback, else default.

    Display names (e.g. 'Claude Sonnet 4.5') from document-service are resolved
    to their Anthropic API model ID via claude_api_model_id().
    """
    from config.gemini_models import get_model_name, is_valid_model, DEFAULT_GEMINI_MODEL, claude_api_model_id, is_claude_model, CLAUDE_DISPLAY_TO_API_ID
    for mid in model_ids:
        name = id_to_name.get(mid) or get_model_name(mid)
        if name and is_valid_model(name):
            # Resolve display names (e.g. "Claude Sonnet 4.5") to API model ID
            if name in CLAUDE_DISPLAY_TO_API_ID:
                return CLAUDE_DISPLAY_TO_API_ID[name]
            return name
    return DEFAULT_GEMINI_MODEL


def get_agents_by_type(agent_type: str) -> List[Dict[str, Any]]:
    """
    Fetch all agents for the given agent_type.
    Each agent includes model_ids, model_names, and resolved_model.
    """
    try:
        with draft_db.get_draft_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"""
                    SELECT id, name, prompt, model_ids, temperature, agent_type,
                           created_at, updated_at, llm_parameters
                    FROM {AGENTS_TABLE}
                    WHERE agent_type = %s
                    ORDER BY name, updated_at DESC
                    """,
                    (agent_type,),
                )
                rows = cur.fetchall()
                colnames = [d[0] for d in cur.description]
    except Exception as e:
        logger.warning("agent_config_service: could not list agents for type %s: %s", agent_type, e)
        return []

    from config.gemini_models import GEMINI_MODELS, CLAUDE_MODELS, get_model_name, is_valid_model, CLAUDE_DISPLAY_TO_API_ID

    id_to_name = _fetch_model_id_to_name_from_document_service()
    default_names = list(GEMINI_MODELS) + list(CLAUDE_MODELS)
    result = []
    for row in rows:
        raw = dict(zip(colnames, row))
        model_ids = _parse_model_ids(raw.get("model_ids"))
        raw["model_ids"] = model_ids
        raw["llm_parameters"] = _parse_llm_parameters(raw.get("llm_parameters"))
        model_names = []
        for mid in model_ids:
            name = id_to_name.get(mid) or get_model_name(mid)
            if name and is_valid_model(name):
                model_names.append(CLAUDE_DISPLAY_TO_API_ID.get(name, name))
        raw["model_names"] = model_names if model_names else default_names
        raw["resolved_model"] = _resolved_model_from_ids(model_ids, id_to_name)
        result.append(raw)
    return result


def get_resolved_model_for_agent(agent_type: str, override_model: Optional[str] = None) -> str:
    """
    Return the model name (Gemini or Claude) to use for the given agent_type.
    Uses override_model if provided and valid, else agent's resolved_model from DB, else default.
    """
    from config.gemini_models import resolve_model, is_valid_model, DEFAULT_GEMINI_MODEL

    if override_model and is_valid_model(override_model):
        return override_model
    agent = get_agent_by_type(agent_type)
    if agent:
        return agent.get("resolved_model") or DEFAULT_GEMINI_MODEL
    return DEFAULT_GEMINI_MODEL
