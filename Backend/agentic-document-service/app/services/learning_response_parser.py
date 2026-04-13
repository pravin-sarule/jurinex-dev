"""
Parse model output for Learning Mode: strict JSON and optional <POPUP_QUESTION> blocks.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

from app.services.learning_agent_controller import LearningAgentController

logger = logging.getLogger("agentic_document_service.learning_response_parser")

_OPEN_TAG = re.compile(r"<POPUP_QUESTION\s*>", re.IGNORECASE)
_CLOSE_TAG = re.compile(r"</\s*POPUP_QUESTION\s*>", re.IGNORECASE)


def extract_popup_from_tags(raw_text: str) -> tuple[str, dict[str, Any] | None]:
    """Returns (text_without_tags, popup_dict_or_none)."""
    text = raw_text or ""
    m_open = _OPEN_TAG.search(text)
    if not m_open:
        return text.strip(), None
    m_close = _CLOSE_TAG.search(text, m_open.end())
    if not m_close:
        logger.warning("[learning_response_parser] unclosed POPUP_QUESTION tag")
        return text.strip(), None
    inner = text[m_open.end() : m_close.start()].strip()
    try:
        data = json.loads(inner)
    except Exception:
        logger.warning("[learning_response_parser] POPUP_QUESTION JSON invalid")
        stripped = (text[: m_open.start()] + text[m_close.end() :]).strip()
        return stripped, None
    stripped = (text[: m_open.start()] + text[m_close.end() :]).strip()
    return stripped, data if isinstance(data, dict) else None


def parse_learning_model_output(raw_text: str) -> tuple[dict[str, Any], bool, str | None]:
    """
    Returns (normalized_payload, json_ok, stripped_tag_prose).

    If tags wrap JSON outside the main object, the tag-stripped string is parsed first.
    """
    raw = raw_text or ""
    outside, tagged_popup = extract_popup_from_tags(raw)
    if tagged_popup and not (outside or "").strip():
        payload = LearningAgentController.fallback_payload()
        ok = False
    else:
        json_src = (outside.strip() if (outside or "").strip() else raw)
        payload, ok = LearningAgentController.parse_model_json_with_status(json_src)
    if tagged_popup:
        merged = dict(payload)
        merged["popup_question"] = tagged_popup
        merged = LearningAgentController.normalize_payload(merged)
        return merged, ok, ((outside or "").strip() or None)
    return payload, ok, ((outside or "").strip() or None) if (outside or "").strip() else None
