
"""
Prompt Resolver — dynamic prompt loading from Draft_DB.agent_prompts with fallback.

Resolution precedence:
  1. DB row exists + prompt non-empty → source = "database"
  2. DB row missing/blank + file_path exists → source = "file"
  3. All else → source = "default" (in-code prompt)
  4. DB connection fails → source = "default" (log error, continue)

Model resolution:
  1. DB row has model_ids → resolve from Document_DB.llm_models (is_active=true)
  2. model_ids inactive/missing → env GEMINI_MODEL or CLAUDE_MODEL

Cache: per-process TTL (60s).
"""

from __future__ import annotations

import json
import logging
import os
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


@dataclass
class PromptConfig:
    """Resolved prompt configuration for an agent."""
    prompt: str
    model_name: str
    temperature: float
    max_tokens: int
    source: str                    # "database" | "file" | "default"
    prompt_name: str               # e.g. "Clerk"
    agent_type: str                # e.g. "citation"
    model_ids: Optional[List[int]] = None
    warnings: List[str] = field(default_factory=list)
    llm_parameters: Dict[str, Any] = field(default_factory=dict)  # Full llm_parameters from DB

    @property
    def gemini_config(self) -> Dict[str, Any]:
        """Safely mapped kwargs for google.genai.types.GenerateContentConfig"""
        out = {
            "temperature": self.temperature,
            "maxOutputTokens": self.max_tokens,
        }
        params = self.llm_parameters or {}
        
        # UI: system_instructions -> Gemini: systemInstruction
        if params.get("system_instructions"):
            out["systemInstruction"] = params["system_instructions"]
            
        # UI: thinking_mode -> Gemini: thinkingConfig
        if params.get("thinking_mode"):
            try:
                from google.genai import types
                thinking_budget = params.get("thinking_budget") or 1024
                # thinking_budget needs to be integer
                out["thinkingConfig"] = types.ThinkingConfig(thinking_budget_tokens=int(thinking_budget))
            except Exception as e:
                self.warnings.append(f"Failed to set thinkingConfig: {e}")
                
        # UI: grounding_google_search -> Gemini: tools
        if params.get("grounding_google_search"):
            try:
                from google.genai import types
                out["tools"] = [{"googleSearch": {}}]
            except Exception as e:
                self.warnings.append(f"Failed to set googleSearch tool: {e}")
                
        # Media resolution
        mr = params.get("media_resolution")
        if mr and mr != "default":
            out["mediaResolution"] = mr

        return out

    @property
    def claude_config(self) -> Dict[str, Any]:
        """Safely mapped kwargs for Anthropic Messages API body"""
        out = {
            "temperature": self.temperature,
            "max_tokens": self.max_tokens,
        }
        params = self.llm_parameters or {}
        
        # System instructions
        if params.get("system_instructions"):
            out["system"] = params["system_instructions"]
            
        # UI: thinking_mode -> Anthropic needs slightly different structure but mapping basic logic:
        # Note: Claude proxy may or may not support thinking objects directly yet in body,
        # but if we pass it, we should ensure it follows the Anthropic format if passed.
        # We will omit complex Claude tools mapping unless specifically needed, to be safe.
        return out


# ── Cache ────────────────────────────────────────────────────────────────────

_prompt_cache: Dict[tuple, tuple] = {}   # (name, agent_type) → (PromptConfig, timestamp)
_CACHE_TTL = 60.0  # seconds


def _cache_get(name: str, agent_type: str) -> Optional[PromptConfig]:
    key = (name, agent_type)
    if key in _prompt_cache:
        config, ts = _prompt_cache[key]
        if time.time() - ts < _CACHE_TTL:
            return config
        del _prompt_cache[key]
    return None


def _cache_set(name: str, agent_type: str, config: PromptConfig) -> None:
    _prompt_cache[(name, agent_type)] = (config, time.time())


# ── model_ids parsing ────────────────────────────────────────────────────────

def _parse_model_ids(raw: Any) -> List[int]:
    """Safely parse model_ids from any storage format (array, JSON string, text, int)."""
    if raw is None:
        return []
    if isinstance(raw, list):
        out = []
        for x in raw:
            if x is not None:
                try:
                    out.append(int(x))
                except (TypeError, ValueError):
                    pass
        return out
    if isinstance(raw, int):
        return [raw]
    if isinstance(raw, str):
        raw = raw.strip()
        # Try JSON parse first: "[1, 5]" or "[1]"
        if raw.startswith("["):
            try:
                parsed = json.loads(raw)
                if isinstance(parsed, list):
                    return [int(x) for x in parsed if x is not None]
            except (json.JSONDecodeError, TypeError, ValueError):
                pass
        # Fallback: strip brackets, split on comma
        raw = raw.strip("[]{}").strip()
        if not raw:
            return []
        out = []
        for part in raw.split(","):
            part = part.strip()
            if part.isdigit():
                out.append(int(part))
        return out
    return []


# ── DB fetch helpers ─────────────────────────────────────────────────────────

def _fetch_prompt_from_db(name: str, agent_type: str) -> Optional[Dict[str, Any]]:
    """Fetch prompt row from Draft_DB.agent_prompts. Returns dict or None."""
    try:
        from db.connections import get_draft_db_conn, release_draft_db_conn
    except ImportError:
        logger.warning("[PROMPT_RESOLVER] db.connections not available")
        return None

    conn = None
    try:
        conn = get_draft_db_conn()
        if not conn:
            return None
        with conn.cursor() as cur:
            cur.execute(
                """SELECT id, name, prompt, model_ids, temperature, agent_type, llm_parameters
                   FROM public.agent_prompts
                   WHERE name = %s AND agent_type = %s
                   ORDER BY updated_at DESC
                   LIMIT 1""",
                (name, agent_type),
            )
            row = cur.fetchone()
            if not row:
                return None
            return {
                "id": row[0],
                "name": row[1],
                "prompt": row[2],
                "model_ids": row[3],
                "temperature": row[4],
                "agent_type": row[5],
                "llm_parameters": row[6],
            }
    except Exception as exc:
        logger.error("[PROMPT_RESOLVER] DB fetch failed for %s/%s: %s", name, agent_type, exc)
        return None
    finally:
        if conn:
            try:
                release_draft_db_conn(conn)
            except Exception:
                pass


def _resolve_model_names(model_ids: List[int]) -> List[str]:
    """Resolve model_ids to active model names from Document_DB.llm_models."""
    if not model_ids:
        return []
    try:
        from db.connections import get_doc_db_conn, release_doc_db_conn
    except ImportError:
        return []

    conn = None
    try:
        conn = get_doc_db_conn()
        if not conn:
            return []
        with conn.cursor() as cur:
            cur.execute(
                """SELECT id, name FROM public.llm_models
                   WHERE id = ANY(%s) AND is_active = true
                   ORDER BY id""",
                (model_ids,),
            )
            return [row[1] for row in cur.fetchall()]
    except Exception as exc:
        logger.error("[PROMPT_RESOLVER] Model resolution failed: %s", exc)
        return []
    finally:
        if conn:
            try:
                release_doc_db_conn(conn)
            except Exception:
                pass


# ── Main resolver ────────────────────────────────────────────────────────────

def resolve_prompt(
    name: str,
    agent_type: str,
    default_prompt: str,
    default_model: str,
    default_temperature: float,
    default_max_tokens: int = 1024,
    file_path: Optional[str] = None,
) -> PromptConfig:
    """
    Resolve prompt config with precedence: DB → file → default.

    Args:
        name: Agent identity key, e.g. "Clerk", "KeywordExtractor"
        agent_type: Agent type, e.g. "citation"
        default_prompt: In-code fallback prompt text
        default_model: Fallback model name (e.g. "gemini-2.0-flash")
        default_temperature: Fallback temperature
        default_max_tokens: Fallback max tokens
        file_path: Optional path to prompt file (e.g. "instructions/citation.txt")

    Returns:
        PromptConfig with resolved values and source indicator.
    """
    # Check cache first
    cached = _cache_get(name, agent_type)
    if cached is not None:
        return cached

    warnings: List[str] = []
    prompt = None
    model_name = default_model
    temperature = default_temperature
    max_tokens = default_max_tokens
    source = "default"
    model_ids_raw = None

    # ── Step 1: Try DB ────────────────────────────────────────────────────
    row = _fetch_prompt_from_db(name, agent_type)
    if row:
        db_prompt = (row.get("prompt") or "").strip()
        if db_prompt:
            prompt = db_prompt
            source = "database"
        else:
            warnings.append(f"DB row found for {name}/{agent_type} but prompt is blank")

        # Temperature from DB (if present)
        db_temp = row.get("temperature")
        if db_temp is not None:
            try:
                temperature = float(db_temp)
            except (TypeError, ValueError):
                warnings.append(f"Invalid temperature in DB: {db_temp}")

        # Model resolution from DB
        model_ids_raw = row.get("model_ids")
        parsed_ids = _parse_model_ids(model_ids_raw)
        if parsed_ids:
            resolved_names = _resolve_model_names(parsed_ids)
            if resolved_names:
                model_name = resolved_names[0]  # Use first active model
            else:
                warnings.append(f"model_ids {parsed_ids} resolved to no active models, using default")

        # llm_parameters extraction (full JSON from DB)
        llm_params_raw = row.get("llm_parameters")
        llm_params: Dict[str, Any] = {}
        if llm_params_raw and isinstance(llm_params_raw, dict):
            llm_params = llm_params_raw
        elif llm_params_raw and isinstance(llm_params_raw, str):
            try:
                parsed = json.loads(llm_params_raw)
                if isinstance(parsed, dict):
                    llm_params = parsed
            except (json.JSONDecodeError, TypeError, ValueError):
                pass

        # Temperature precedence: llm_parameters.temperature > column temperature > default
        if "temperature" in llm_params:
            try:
                temperature = float(llm_params["temperature"])
            except (TypeError, ValueError):
                pass

        # Max tokens from llm_parameters (if present)
        if "max_tokens" in llm_params:
            try:
                max_tokens = int(llm_params["max_tokens"])
            except (TypeError, ValueError):
                pass

    # ── Step 2: Try file (if DB didn't provide prompt) ────────────────────
    if prompt is None and file_path:
        try:
            p = Path(file_path)
            if not p.is_absolute():
                p = Path(__file__).resolve().parent.parent / file_path
            if p.exists():
                file_content = p.read_text(encoding="utf-8").strip()
                if file_content:
                    prompt = file_content
                    source = "file"
        except Exception as exc:
            warnings.append(f"File read failed ({file_path}): {exc}")

    # ── Step 3: Default ───────────────────────────────────────────────────
    if prompt is None:
        prompt = default_prompt
        source = "default"
        if not row:
            warnings.append(f"No DB row for {name}/{agent_type}, using default prompt")

    config = PromptConfig(
        prompt=prompt,
        model_name=model_name,
        temperature=temperature,
        max_tokens=max_tokens,
        source=source,
        prompt_name=name,
        agent_type=agent_type,
        model_ids=_parse_model_ids(model_ids_raw) if model_ids_raw else None,
        warnings=warnings,
        llm_parameters=llm_params if row else {},
    )

    _cache_set(name, agent_type, config)

    # Log resolution
    if warnings:
        for w in warnings:
            logger.warning("[PROMPT_RESOLVER] %s", w)
    logger.info(
        "[PROMPT_RESOLVER] %s/%s → source=%s model=%s temp=%.2f",
        name, agent_type, source, model_name, temperature,
    )

    return config
