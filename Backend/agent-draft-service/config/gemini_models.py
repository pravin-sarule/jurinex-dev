"""
Single source of truth for Gemini and Claude models.
Used by agents (drafter, critic, assembler, etc.) and by agent config fetched from DB.
"""

from __future__ import annotations

from typing import List, Optional

# ----- Gemini -----
# All supported Gemini model names (API model id strings)
GEMINI_MODELS: List[str] = [
    "gemini-2.0-flash-lite",
    "gemini-2.0-flash",
    "gemini-2.5-flash-lite",
    "gemini-2.5-flash",
    "gemini-flash-lite-latest",
    "gemini-flash-latest",
    "gemini-2.5-pro",
    "gemini-3-flash-preview",
    "gemini-3-pro-preview",
]

# Default model when none is specified (payload or DB)
DEFAULT_GEMINI_MODEL = "gemini-flash-lite-latest"

# Map DB model_id (integer) to Gemini model name. Used when agent.model_ids from DB
# stores integers that reference this mapping (e.g. id 21 -> gemini-2.5-flash).
# Extend this map to match your llm_models table or drafting_agent.model_ids.
MODEL_ID_TO_NAME: dict[int, str] = {
    1: "gemini-2.0-flash-lite",
    2: "gemini-2.0-flash",
    3: "gemini-2.5-flash-lite",
    4: "gemini-2.5-flash",
    5: "gemini-flash-lite-latest",
    6: "gemini-flash-latest",
    7: "gemini-2.5-pro",
    8: "gemini-3-flash-preview",
    9: "gemini-3-pro-preview",
    # Common DB ids if your schema uses different numbering
    21: "gemini-2.5-flash",
}

# Reverse: model name -> id (first occurrence in MODEL_ID_TO_NAME)
MODEL_NAME_TO_ID: dict[str, int] = {v: k for k, v in sorted(MODEL_ID_TO_NAME.items())}

# ----- Claude (Anthropic) -----
# Claude model names as stored in DB / document-service (llm_models). API accepts these IDs.
CLAUDE_MODELS: List[str] = [
    "claude-opus-4-6",
    "claude-sonnet-4-5",
    "claude-haiku-4-5",
    "claude-opus-4-5",
    "claude-opus-4-1",
    "claude-sonnet-4",
    "claude-sonnet-3-7",
    "claude-opus-4",
    "claude-haiku-3",
]

# Map display/friendly name to Anthropic API model ID (when DB stores a different string)
CLAUDE_DISPLAY_TO_API_ID: dict[str, str] = {
    "Claude Opus 4.6": "claude-opus-4-6",
    "Claude Sonnet 4.5": "claude-sonnet-4-5",
    "Claude Haiku 4.5": "claude-haiku-4-5",
    "Claude Opus 4.5": "claude-opus-4-5",
    "Claude Opus 4.1": "claude-opus-4-1",
    "Claude Sonnet 4": "claude-sonnet-4",
    "Claude Sonnet 3.7": "claude-sonnet-3-7",
    "Claude Opus 4": "claude-opus-4",
    "Claude Haiku 3": "claude-haiku-3",
}

DEFAULT_CLAUDE_MODEL = "claude-sonnet-4-5"


def get_model_name(model_id: int) -> Optional[str]:
    """Resolve DB model_id to Gemini model name."""
    return MODEL_ID_TO_NAME.get(model_id)


def get_model_id(model_name: str) -> Optional[int]:
    """Resolve Gemini model name to DB model_id."""
    return MODEL_NAME_TO_ID.get(model_name)


def is_claude_model(model_name: str) -> bool:
    """Return True if model_name is a supported Claude model (by name or prefix)."""
    if not model_name or not isinstance(model_name, str):
        return False
    name = model_name.strip().lower()
    if name in [m.lower() for m in CLAUDE_MODELS]:
        return True
    if name.startswith("claude-"):
        return True
    if model_name in CLAUDE_DISPLAY_TO_API_ID:
        return True
    return False


def is_valid_model(model_name: str) -> bool:
    """Return True if model_name is a supported Gemini or Claude model."""
    if not model_name:
        return False
    return model_name in GEMINI_MODELS or is_claude_model(model_name)


def claude_api_model_id(model_name: str) -> str:
    """Resolve display or DB name to Anthropic API model ID."""
    if model_name in CLAUDE_DISPLAY_TO_API_ID:
        return CLAUDE_DISPLAY_TO_API_ID[model_name]
    if model_name in CLAUDE_MODELS:
        return model_name
    if model_name.strip().lower().startswith("claude-"):
        return model_name.strip()
    return DEFAULT_CLAUDE_MODEL


def resolve_model(model: Optional[str] = None, model_ids: Optional[List[int]] = None) -> str:
    """
    Resolve which model to use.
    Priority: model (string) -> first of model_ids resolved to name -> DEFAULT_GEMINI_MODEL.
    """
    if model and is_valid_model(model):
        return model
    if model_ids:
        for mid in model_ids:
            name = get_model_name(mid)
            if name:
                return name
    return DEFAULT_GEMINI_MODEL
