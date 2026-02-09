"""
Universal Sections API: Get universal section structure (frontend-hardcoded approach)

These sections are the same for ALL legal templates. The frontend hardcodes these
sections and their default prompts, allowing users to edit prompts before generation.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, Dict, List

from fastapi import APIRouter

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["universal-sections"])


def load_universal_sections() -> List[Dict[str, Any]]:
    """Load universal sections from config file."""
    config_path = Path(__file__).resolve().parent.parent / "config" / "universal_sections.json"
    
    if not config_path.exists():
        logger.warning("universal_sections.json not found, returning empty list")
        return []
    
    with open(config_path, "r", encoding="utf-8") as f:
        data = json.load(f)
        return data.get("universal_sections", [])


@router.get("/universal-sections")
def get_universal_sections() -> Dict[str, Any]:
    """
    Get the universal section structure that applies to ALL legal templates.
    
    Returns 23 standard sections with:
    - section_key: Unique identifier
    - section_name: Display name
    - sort_order: Rendering order
    - is_required: Whether this section must be generated
    - default_prompt: Default prompt for generation (user can edit)
    
    Frontend should:
    1. Hardcode these sections in the UI
    2. Display default_prompt in an editable textarea
    3. Allow user to edit the prompt
    4. Pass the edited prompt to /generate endpoint
    5. Store user's edited prompt in section_versions.user_prompt_override
    """
    sections = load_universal_sections()
    
    return {
        "success": True,
        "sections": sections,
        "count": len(sections),
        "message": "Universal sections apply to all legal templates. Users can edit prompts before generation."
    }


@router.get("/universal-sections/{section_key}")
def get_universal_section_by_key(section_key: str) -> Dict[str, Any]:
    """Get a specific universal section by its key."""
    sections = load_universal_sections()
    section = next((s for s in sections if s["section_key"] == section_key), None)
    
    if not section:
        return {
            "success": False,
            "section": None,
            "error": f"Section '{section_key}' not found"
        }
    
    return {
        "success": True,
        "section": section
    }
