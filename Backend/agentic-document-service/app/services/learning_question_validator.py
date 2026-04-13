"""
Validate document-grounded MCQ payloads before they are shown to learners.
"""

from __future__ import annotations

import logging
import re
from typing import Any

logger = logging.getLogger("agentic_document_service.learning_question_validator")

_BANNED_OPTION_PHRASES = ("all of the above", "none of the above", "both a and b")


def validate_question(question_obj: dict[str, Any]) -> dict[str, Any]:
    errors: list[str] = []
    warnings: list[str] = []

    checks = [
        _validate_structure(question_obj, errors),
        _validate_question_text(question_obj, errors, warnings),
        _validate_options(question_obj, errors, warnings),
        _validate_correct_answer(question_obj, errors),
        _validate_explanations(question_obj, errors, warnings),
        _validate_difficulty(question_obj, errors, warnings),
        _validate_grounding_ids(question_obj, errors, warnings),
    ]
    is_valid = all(checks) and not errors
    return {"is_valid": is_valid, "errors": errors, "warnings": warnings}


def _validate_structure(q: dict[str, Any], errors: list[str]) -> bool:
    if not isinstance(q, dict):
        errors.append("question must be an object")
        return False
    return True


def _validate_question_text(q: dict[str, Any], errors: list[str], warnings: list[str]) -> bool:
    text = str(q.get("question_text") or "").strip()
    wc = len(text.split())
    if wc < 4:
        errors.append("question_text too short")
        return False
    if wc > 120:
        warnings.append("question_text is long; consider shortening")
    if not text.endswith("?"):
        warnings.append("question_text should usually end with ?")
    return True


def _validate_options(q: dict[str, Any], errors: list[str], warnings: list[str]) -> bool:
    opts = q.get("options")
    if not isinstance(opts, list) or len(opts) != 4:
        errors.append("options must be a list of exactly 4 items")
        return False
    seen_ids: set[str] = set()
    for item in opts:
        if isinstance(item, dict):
            oid = str(item.get("id") or "").strip().upper()
            body = str(item.get("text") or "").strip()
        else:
            errors.append("each option must be {id, text}")
            return False
        if oid not in {"A", "B", "C", "D"}:
            errors.append(f"invalid option id {oid!r}")
            return False
        if oid in seen_ids:
            errors.append("duplicate option ids")
            return False
        seen_ids.add(oid)
        w = len(body.split())
        if w < 2:
            errors.append(f"option {oid} text too short")
            return False
        if w > 80:
            warnings.append(f"option {oid} is very long")
        low = body.lower()
        if any(b in low for b in _BANNED_OPTION_PHRASES):
            errors.append(f"option {oid} uses disallowed pattern")
            return False
    if seen_ids != {"A", "B", "C", "D"}:
        errors.append("options must include ids A, B, C, D")
        return False
    return True


def _validate_correct_answer(q: dict[str, Any], errors: list[str]) -> bool:
    ca = str(q.get("correct_answer") or "").strip().upper()
    if ca not in {"A", "B", "C", "D"}:
        errors.append("correct_answer must be A, B, C, or D")
        return False
    return True


def _validate_explanations(q: dict[str, Any], errors: list[str], warnings: list[str]) -> bool:
    exp = q.get("explanations")
    if not isinstance(exp, dict):
        errors.append("explanations must be an object keyed by A-D")
        return False
    for k in ("A", "B", "C", "D"):
        line = str(exp.get(k) or "").strip()
        if len(line.split()) < 4:
            errors.append(f"explanation for {k} is too short to be educational")
            return False
    return True


def _validate_difficulty(q: dict[str, Any], errors: list[str], warnings: list[str]) -> bool:
    d = str(q.get("difficulty") or "").strip().lower()
    if d not in ("easy", "medium", "intermediate", "hard"):
        warnings.append("difficulty should be easy | intermediate | hard")
    return True


def _validate_grounding_ids(q: dict[str, Any], errors: list[str], warnings: list[str]) -> bool:
    """
    For synthesis/comparison style legal MCQs, enforce grounding from >=2 sources.
    """
    qtype = str(q.get("question_type") or q.get("type") or "").strip().lower()
    concept = str(q.get("concept") or "").strip().lower()
    needs_multi_source = qtype in {"synthesis", "comparison", "cross_document"} or "synth" in concept
    gids = q.get("grounding_ids")
    if gids is None:
        if needs_multi_source:
            errors.append("synthesis/comparison question must include grounding_ids")
            return False
        return True
    if not isinstance(gids, list):
        errors.append("grounding_ids must be a list")
        return False
    cleaned = [str(x).strip() for x in gids if str(x).strip()]
    if not cleaned:
        if needs_multi_source:
            errors.append("grounding_ids cannot be empty for synthesis/comparison questions")
            return False
        warnings.append("grounding_ids is empty")
        return True
    if needs_multi_source and len(set(cleaned)) < 2:
        errors.append("synthesis/comparison question requires at least two grounding_ids")
        return False
    return True


def sanitize_public_popup(popup: dict[str, Any]) -> dict[str, Any]:
    """Strip answer-sensitive fields for SSE / browser."""
    pub = {k: v for k, v in popup.items() if k not in ("correct_answer", "explanations")}
    return pub
