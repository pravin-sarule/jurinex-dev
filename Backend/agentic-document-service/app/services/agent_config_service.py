"""
Per-agent configuration loader from public.agent_prompts.

Schema expected in DB:
  id            int / bigint
  name          text          (e.g. "Drafter Agent")
  prompt        text          (system prompt)
  model_ids     int[]         (FK to public.llm_models.id)
  temperature   numeric       (top-level column; llm_parameters.temperature takes precedence)
  agent_type    text          (e.g. "drafting", "intake", "retrieval")
  created_at    timestamptz
  updated_at    timestamptz
  llm_parameters jsonb        (full generation config blob)

Resolution order for every agent call:
  1. In-memory cache (TTL = CACHE_TTL_SECONDS)
  2. DB: agent_prompts — match agent_type first, then name ILIKE keyword
  3. Hardcoded defaults (caller supplies default_prompt; model from settings.adk_model)

Console output (logger.info / logger.warning) shows:
  - source (db | default)
  - agent name, db row id, agent_type
  - resolved model name, temperature
  - DB updated_at timestamp
"""
from __future__ import annotations

import json
import logging
import threading
import time
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger("agentic_document_service.agent_config")

# ── Constants ──────────────────────────────────────────────────────────────────
CACHE_TTL_SECONDS: float = 120.0
_DEFAULT_MODEL: str = "gemini-2.5-pro"
_DEFAULT_TEMPERATURE: float = 0.7

# Maps internal agent name → agent_type values to search in DB (first match wins)
_AGENT_TYPE_SEARCH: dict[str, list[str]] = {
    "form_population_agent":     ["intake", "form_population", "form population"],
    "document_processing_agent": ["document_processing", "document processing", "processing"],
    "grounded_retrieval_agent":  ["retrieval", "grounded_retrieval", "grounded retrieval", "qa"],
    "preset_execution_agent":    ["preset", "preset_execution", "preset execution"],
}

# Fallback: search by ILIKE on name when agent_type has no match
_AGENT_NAME_KEYWORDS: dict[str, list[str]] = {
    "form_population_agent":     ["form population", "intake"],
    "document_processing_agent": ["document processing", "classification"],
    "grounded_retrieval_agent":  ["retrieval", "grounded"],
    "preset_execution_agent":    ["preset"],
}


# ── Data class ─────────────────────────────────────────────────────────────────
@dataclass
class AgentConfig:
    agent_name: str
    prompt: str
    model_name: str
    temperature: float
    llm_parameters: dict[str, Any]
    agent_type: str
    source: str                        # "db" | "default"
    db_id: int | None = None
    db_updated_at: Any = None


# ── Cache ──────────────────────────────────────────────────────────────────────
_cache_lock = threading.Lock()
_cache: dict[str, tuple[AgentConfig, float]] = {}   # agent_name → (config, expires_at)


def _mono() -> float:
    return time.monotonic()


# ── DB helpers ─────────────────────────────────────────────────────────────────
def _resolve_model_ids(model_ids: Any) -> str | None:
    """
    Resolve first model_id in the array to a model name string by querying llm_models.
    Returns None when the DB is unavailable or the row doesn't exist.
    """
    from app.services.db import get_db_connection, is_db_available

    ids: list[int] = []
    if isinstance(model_ids, list):
        ids = [int(x) for x in model_ids if x is not None]
    elif isinstance(model_ids, str):
        try:
            parsed = json.loads(model_ids)
            if isinstance(parsed, list):
                ids = [int(x) for x in parsed if x is not None]
        except Exception:
            pass

    if not ids or not is_db_available():
        return None

    try:
        with get_db_connection() as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT TRIM(name::text) AS name
                FROM public.llm_models
                WHERE id = ANY(%s) AND name IS NOT NULL AND TRIM(name::text) <> ''
                ORDER BY id
                LIMIT 1
                """,
                (ids,),
            )
            row = cur.fetchone()
            if row:
                name = str(row.get("name") or "").strip()
                return name if name else None
    except Exception as exc:
        logger.warning("[AgentConfig] model_ids=%s resolve error: %s", ids, exc)
    return None


def _fetch_agent_row(agent_name: str) -> dict[str, Any] | None:
    """
    Query agent_prompts for the best matching row.
    Strategy:
      1. Exact match on agent_type (case-insensitive), tried for each candidate type string.
      2. ILIKE match on name column, tried for each keyword.
    Returns the raw DB dict or None.
    """
    from app.services.db import get_db_connection, is_db_available

    if not is_db_available():
        return None

    agent_types = _AGENT_TYPE_SEARCH.get(agent_name, [])
    name_keywords = _AGENT_NAME_KEYWORDS.get(agent_name, [])

    try:
        with get_db_connection() as conn, conn.cursor() as cur:
            # ── Pass 1: exact agent_type match ───────────────────────────────
            for atype in agent_types:
                cur.execute(
                    """
                    SELECT *
                    FROM public.agent_prompts
                    WHERE LOWER(TRIM(agent_type::text)) = %s
                    ORDER BY updated_at DESC NULLS LAST, id DESC
                    LIMIT 1
                    """,
                    (atype.lower(),),
                )
                row = cur.fetchone()
                if row:
                    return dict(row)

            # ── Pass 2: ILIKE name keyword match ─────────────────────────────
            for keyword in name_keywords:
                cur.execute(
                    """
                    SELECT *
                    FROM public.agent_prompts
                    WHERE LOWER(name) LIKE %s
                    ORDER BY updated_at DESC NULLS LAST, id DESC
                    LIMIT 1
                    """,
                    (f"%{keyword.lower()}%",),
                )
                row = cur.fetchone()
                if row:
                    return dict(row)

    except Exception as exc:
        logger.warning("[AgentConfig] DB lookup failed for agent=%s: %s", agent_name, exc)

    return None


def _parse_llm_parameters(raw: Any) -> dict[str, Any]:
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            pass
    return {}


def _default_model_from_settings() -> str:
    try:
        from app.core.config import get_settings
        name = (get_settings().adk_model or "").strip()
        return name if name else _DEFAULT_MODEL
    except Exception:
        return _DEFAULT_MODEL


# ── Public API ─────────────────────────────────────────────────────────────────
def get_agent_config(agent_name: str, *, default_prompt: str = "") -> AgentConfig:
    """
    Return AgentConfig for the given internal agent name.

    Cache TTL = CACHE_TTL_SECONDS (default 120 s).

    Console logging:
      ✅  source=DB      — shows db_id, agent_type, model, temperature, updated_at
      ⚠️  source=DEFAULT — shown when no DB row found; uses settings.adk_model + default_prompt
    """
    now = _mono()

    # ── Cache hit ──────────────────────────────────────────────────────────────
    with _cache_lock:
        hit = _cache.get(agent_name)
        if hit and now < hit[1]:
            cfg = hit[0]
            logger.debug(
                "[AgentConfig] cache-hit  agent=%s  source=%s  model=%s",
                agent_name, cfg.source, cfg.model_name,
            )
            return cfg

    # ── DB lookup ──────────────────────────────────────────────────────────────
    row = _fetch_agent_row(agent_name)

    if row:
        llm_params = _parse_llm_parameters(row.get("llm_parameters"))

        # temperature: llm_parameters.temperature > top-level column > default
        if "temperature" in llm_params and llm_params["temperature"] is not None:
            temperature = float(llm_params["temperature"])
        elif row.get("temperature") is not None:
            temperature = float(row["temperature"])
        else:
            temperature = _DEFAULT_TEMPERATURE

        # model: resolve model_ids → llm_models.name; fall back to settings
        resolved_model = _resolve_model_ids(row.get("model_ids"))
        model_name = resolved_model if resolved_model else _default_model_from_settings()

        prompt = str(row.get("prompt") or default_prompt).strip() or default_prompt
        agent_type = str(row.get("agent_type") or "").strip()
        db_id = row.get("id")
        db_updated_at = row.get("updated_at")

        cfg = AgentConfig(
            agent_name=agent_name,
            prompt=prompt,
            model_name=model_name,
            temperature=temperature,
            llm_parameters=llm_params,
            agent_type=agent_type,
            source="db",
            db_id=db_id,
            db_updated_at=db_updated_at,
        )

        logger.info(
            "[AgentConfig] ✅  source=DB  agent=%-35s  db_id=%-4s  agent_type=%-25s  "
            "model=%-30s  temperature=%.2f  updated_at=%s",
            agent_name, db_id, agent_type, model_name, temperature, db_updated_at,
        )

    else:
        model_name = _default_model_from_settings()
        cfg = AgentConfig(
            agent_name=agent_name,
            prompt=default_prompt,
            model_name=model_name,
            temperature=_DEFAULT_TEMPERATURE,
            llm_parameters={},
            agent_type=agent_name,
            source="default",
        )

        logger.warning(
            "[AgentConfig] ⚠️   source=DEFAULT  agent=%-35s  model=%-30s  temperature=%.2f"
            "  (no row in agent_prompts — using hardcoded prompt)",
            agent_name, model_name, _DEFAULT_TEMPERATURE,
        )

    with _cache_lock:
        _cache[agent_name] = (cfg, now + CACHE_TTL_SECONDS)

    return cfg


def invalidate_agent_config_cache(agent_name: str | None = None) -> None:
    """Flush cache for one agent or all agents."""
    with _cache_lock:
        if agent_name:
            _cache.pop(agent_name, None)
        else:
            _cache.clear()
    logger.info("[AgentConfig] cache invalidated  agent=%s", agent_name or "ALL")
