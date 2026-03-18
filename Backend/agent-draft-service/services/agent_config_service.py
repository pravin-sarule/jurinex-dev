"""
Fetch agent config (prompt, model, temperature, llm_parameters) from the database by agent_type.
Uses only the implemented Claude and Gemini models from config/gemini_models; parameters
are loaded from DB (agent_prompts) per agent name/type, with fallback to hardcoded defaults.
"""

from __future__ import annotations

import json
import logging
import os
import re
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
        data = entry["data"]
        if data:
            print(f"[agent_config] Cache HIT for {agent_type!r}: resolved_model={data.get('resolved_model')!r}, model_ids={data.get('model_ids')}")
        return data
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


def _normalize_agent_name(value: Any) -> str:
    """Normalize agent names for tolerant DB matching."""
    return re.sub(r"\s+", " ", str(value or "").strip()).lower()


def _hydrate_agent_row(raw: Dict[str, Any]) -> Dict[str, Any]:
    """Parse and enrich a raw DB row with resolved model metadata."""
    from config.gemini_models import (
        GEMINI_MODELS,
        CLAUDE_MODELS,
        get_model_name,
        is_valid_model,
        CLAUDE_DISPLAY_TO_API_ID,
    )

    model_ids = _parse_model_ids(raw.get("model_ids"))
    raw["model_ids"] = model_ids
    raw["llm_parameters"] = _parse_llm_parameters(raw.get("llm_parameters"))

    model_names = []
    id_to_name = _fetch_model_id_to_name_from_document_service()
    for mid in model_ids:
        name = id_to_name.get(mid) or get_model_name(mid)
        if name and is_valid_model(name):
            model_names.append(CLAUDE_DISPLAY_TO_API_ID.get(name, name))

    default_names = list(GEMINI_MODELS) + list(CLAUDE_MODELS)
    raw["model_names"] = model_names if model_names else default_names
    raw["resolved_model"] = _resolved_model_from_ids(model_ids, id_to_name)
    return raw


def _fetch_agents(agent_types: Optional[List[str]] = None) -> List[Dict[str, Any]]:
    """Fetch and hydrate agent rows, optionally filtered by one or more agent types."""
    try:
        with draft_db.get_draft_conn() as conn:
            with conn.cursor() as cur:
                if agent_types:
                    cur.execute(
                        f"""
                        SELECT id, name, prompt, model_ids, temperature, agent_type,
                               created_at, updated_at, llm_parameters
                        FROM {AGENTS_TABLE}
                        WHERE agent_type = ANY(%s)
                        ORDER BY updated_at DESC
                        """,
                        (agent_types,),
                    )
                else:
                    cur.execute(
                        f"""
                        SELECT id, name, prompt, model_ids, temperature, agent_type,
                               created_at, updated_at, llm_parameters
                        FROM {AGENTS_TABLE}
                        ORDER BY updated_at DESC
                        """
                    )
                rows = cur.fetchall()
                colnames = [d[0] for d in cur.description]
    except Exception as e:
        logger.warning("agent_config_service: could not fetch agents for types %s: %s", agent_types, e)
        return []

    return [_hydrate_agent_row(dict(zip(colnames, row))) for row in rows]


def _pick_agent_by_preferred_names(
    agents: List[Dict[str, Any]],
    preferred_names: Optional[List[str]] = None,
) -> Optional[Dict[str, Any]]:
    """Pick the best matching agent row by preferred name list, then fallback to most recent."""
    valid_names = [_normalize_agent_name(name) for name in (preferred_names or []) if str(name or "").strip()]
    if not agents:
        return None
    if not valid_names:
        return agents[0]

    for preferred in valid_names:
        for agent in agents:
            if _normalize_agent_name(agent.get("name")) == preferred:
                return agent

    for preferred in valid_names:
        for agent in agents:
            agent_name = _normalize_agent_name(agent.get("name"))
            if preferred in agent_name or agent_name in preferred:
                return agent

    return agents[0]


def get_agent_by_preferences(
    agent_type: Optional[str] = None,
    preferred_names: Optional[List[str]] = None,
    fallback_agent_types: Optional[List[str]] = None,
) -> Optional[Dict[str, Any]]:
    """
    Resolve an agent row by preferred DB name first, then by primary/fallback agent types.

    This prevents selecting the wrong row when multiple agent_prompts share a broad
    agent_type such as 'drafting' but represent different logical agents.
    """
    candidate_types: List[str] = []
    for value in [agent_type, *(fallback_agent_types or [])]:
        cleaned = str(value or "").strip()
        if cleaned and cleaned not in candidate_types:
            candidate_types.append(cleaned)

    candidates = _fetch_agents(candidate_types or None)
    if not candidates:
        return None

    selected = _pick_agent_by_preferred_names(candidates, preferred_names)
    if selected:
        print(
            f"[agent_config] Selected agent by preferences: "
            f"requested_type={agent_type!r}, fallbacks={fallback_agent_types}, "
            f"preferred_names={preferred_names}, selected_name={selected.get('name')!r}, "
            f"selected_type={selected.get('agent_type')!r}, resolved_model={selected.get('resolved_model')!r}"
        )
    return selected


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
                raw = _hydrate_agent_row(dict(zip(colnames, row)))
                model_ids = raw.get("model_ids") or []
                # Console: agent and model from DB, prompt from DB
                resolved = raw["resolved_model"]
                prompt_preview = (raw.get("prompt") or "")[:80]
                print(
                    f"[agent_config] Agent from DB: agent_type={agent_type!r}, "
                    f"resolved_model={resolved!r}, model_ids={model_ids}, "
                    f"model_names={raw.get('model_names')}"
                )
                print(f"[agent_config] Prompt from DB (length={len(raw.get('prompt') or '')}): {prompt_preview}{'...' if len((raw.get('prompt') or '')) > 80 else ''}")
                _set_cached_agent(agent_type, raw)
                return raw
    except Exception as e:
        logger.warning("agent_config_service: could not fetch agent by type %s: %s", agent_type, e)
        return None


def _fetch_model_id_to_name_from_document_db() -> Dict[int, str]:
    """Query llm_models directly from Document_DB (DATABASE_URL — same cluster as document-service)."""
    import psycopg2
    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        return {}
    try:
        conn = psycopg2.connect(db_url)
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT id, name FROM llm_models WHERE name IS NOT NULL AND name != ''")
                rows = cur.fetchall()
                result = {int(row[0]): str(row[1]) for row in rows if row[0] is not None}
                if result:
                    print(f"[agent_config] llm_models from Document_DB: {result}")
                return result
        finally:
            conn.close()
    except Exception as e:
        logger.debug("agent_config_service: could not query llm_models from Document_DB: %s", e)
        return {}


def _fetch_model_id_to_name_from_document_service() -> Dict[int, str]:
    """Fetch llm_models — tries Document_DB direct query first, then document-service HTTP."""
    # Primary: direct DB query (fast, no HTTP overhead)
    db_map = _fetch_model_id_to_name_from_document_db()
    if db_map:
        return db_map
    # Fallback: document-service HTTP (works both locally and in production)
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
    print(f"[agent_config] _resolved_model_from_ids: model_ids={model_ids}, id_to_name_keys={list(id_to_name.keys())}")
    for mid in model_ids:
        from_doc_service = id_to_name.get(mid)
        from_local_map = get_model_name(mid)
        name = from_doc_service or from_local_map
        print(f"[agent_config]   model_id={mid}: doc_service={from_doc_service!r}, local_map={from_local_map!r}, resolved_name={name!r}, is_valid={is_valid_model(name) if name else False}")
        if name and is_valid_model(name):
            # Resolve display names (e.g. "Claude Sonnet 4.5") to API model ID
            if name in CLAUDE_DISPLAY_TO_API_ID:
                resolved = CLAUDE_DISPLAY_TO_API_ID[name]
                print(f"[agent_config]   → Resolved display name {name!r} to API ID {resolved!r}")
                return resolved
            return name
        # If name exists but failed is_valid_model, check if it's a claude- prefix (API ID not in our list)
        if name and isinstance(name, str) and name.strip().lower().startswith("claude-"):
            print(f"[agent_config]   → Accepting unregistered Claude model by prefix: {name!r}")
            return name.strip()
    print(f"[agent_config]   → No valid model resolved from model_ids={model_ids}, using default={DEFAULT_GEMINI_MODEL!r}")
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

    return [_hydrate_agent_row(dict(zip(colnames, row))) for row in rows]


def get_resolved_model_for_agent(agent_type: str, override_model: Optional[str] = None) -> str:
    """
    Return the model name (Gemini or Claude) to use for the given agent_type.
    Uses only config/gemini_models (GEMINI_MODELS + Claude). Loads from DB by agent_type;
    override_model used if valid, else agent's resolved_model from DB, else default.
    """
    from config.gemini_models import is_valid_model

    if override_model and is_valid_model(override_model):
        return override_model
    agent = get_agent_by_type(agent_type)
    if agent:
        return _ensure_allowed_model(agent.get("resolved_model"), agent_type)
    return _ensure_allowed_model(None, agent_type)


# ---------------------------------------------------------------------------
# DB-first config: load by agent_type; only Gemini/Claude from config/gemini_models
# ---------------------------------------------------------------------------

def _get_agent_defaults() -> Dict[str, Dict[str, Any]]:
    """Build default config per agent_type using only config/gemini_models (single source of truth)."""
    from config.gemini_models import (
        DEFAULT_GEMINI_MODEL,
        DEFAULT_CLAUDE_MODEL,
        GEMINI_MODELS,
    )
    # Use only implemented models: Gemini and Claude from gemini_models
    gemini_default = DEFAULT_GEMINI_MODEL
    claude_default = DEFAULT_CLAUDE_MODEL
    gemini_pro = "gemini-2.5-pro" if "gemini-2.5-pro" in GEMINI_MODELS else gemini_default
    return {
        "drafting": {"model": gemini_default, "temperature": 0.7, "prompt": ""},
        "critic": {"model": gemini_pro, "temperature": 0.1, "prompt": ""},
        "citation": {"model": gemini_default, "temperature": 0.3, "prompt": ""},
        "injection": {"model": claude_default, "temperature": 0.3, "prompt": ""},
        "extraction": {"model": claude_default, "temperature": 0.3, "prompt": ""},
        "autopopulation": {"model": claude_default, "temperature": 0.3, "prompt": ""},
        "assembler": {"model": gemini_default, "temperature": 0.3, "prompt": ""},
    }


def _ensure_allowed_model(model: Optional[str], agent_type: str) -> str:
    """Return model only if it is an allowed Gemini/Claude model from config/gemini_models; else agent default."""
    from config.gemini_models import is_valid_model, DEFAULT_GEMINI_MODEL
    defaults = _get_agent_defaults()
    if model and is_valid_model(model):
        return model
    return (defaults.get(agent_type) or {}).get("model") or DEFAULT_GEMINI_MODEL


# Lazy-built so we don't import gemini_models at module load
AGENT_DEFAULTS: Dict[str, Dict[str, Any]] = {}
def _agent_defaults() -> Dict[str, Dict[str, Any]]:
    global AGENT_DEFAULTS
    if not AGENT_DEFAULTS:
        AGENT_DEFAULTS.update(_get_agent_defaults())
    return AGENT_DEFAULTS


def get_agent_config_with_defaults(
    agent_type: str,
    fallback_agent_types: Optional[List[str]] = None,
    preferred_names: Optional[List[str]] = None,
    default_model: Optional[str] = None,
    default_temperature: Optional[float] = None,
    default_prompt: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Load prompt and LLM configuration from DB by agent_type (agent name). Uses only
    Gemini and Claude models (and their parameters) from config/gemini_models; if DB
    has no row for this agent, returns hardcoded defaults from that same config.

    Tries get_agent_by_type(agent_type), then each of fallback_agent_types. If a row
    exists, model is validated against is_valid_model (Gemini/Claude only); invalid
    models are replaced with the agent's default. Temperature, prompt, llm_parameters
    come from DB; when missing, from _get_agent_defaults().

    Returns: model, temperature, prompt, llm_parameters, id, name, resolved_model.
    """
    from config.gemini_models import DEFAULT_GEMINI_MODEL

    defaults_map = _agent_defaults()

    # 1) Load from DB by agent type (and optional fallbacks)
    agent = get_agent_by_preferences(
        agent_type=agent_type,
        preferred_names=preferred_names,
        fallback_agent_types=fallback_agent_types,
    )
    if agent:
        # Only allow models from config/gemini_models (Gemini + Claude)
        model = _ensure_allowed_model(agent.get("resolved_model"), agent_type)
        t = agent.get("temperature")
        temperature = float(t) if t is not None else float((defaults_map.get(agent_type) or {}).get("temperature", 0.3))
        prompt = (agent.get("prompt") or "").strip()
        llm_params = agent.get("llm_parameters") or {}
        return {
            "model": model,
            "temperature": temperature,
            "prompt": prompt,
            "llm_parameters": llm_params,
            "id": agent.get("id"),
            "name": agent.get("name"),
            "resolved_model": model,
        }

    # 2) No DB row: use defaults from gemini_models only
    defaults = defaults_map.get(agent_type, {})
    model = default_model or defaults.get("model") or DEFAULT_GEMINI_MODEL
    model = _ensure_allowed_model(model, agent_type)
    temperature = default_temperature if default_temperature is not None else defaults.get("temperature", 0.3)
    temperature = float(temperature)
    prompt = (default_prompt if default_prompt is not None else defaults.get("prompt")) or ""
    logger.info(
        "[agent_config] No DB config for agent_type=%s — using defaults: model=%s, temperature=%s",
        agent_type, model, temperature,
    )
    return {
        "model": model,
        "temperature": temperature,
        "prompt": prompt,
        "llm_parameters": {},
        "id": None,
        "name": None,
        "resolved_model": model,
    }
