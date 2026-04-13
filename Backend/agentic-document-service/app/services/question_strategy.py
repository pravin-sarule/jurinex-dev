"""
Heuristics for when the learning agent should surface a verification popup (MCQ).
"""

from __future__ import annotations

import re
from typing import Any, Literal

QuestionType = Literal["comprehension", "application", "analysis"]


def should_ask_question(context: dict[str, Any]) -> dict[str, Any]:
    """
    Input (flexible keys; snake_case preferred):
      messages_since_last_question: int
      last_concept_explained: str (optional)
      user_expressed_confusion: bool (optional)
      topic_transition: bool (optional)
      user_performance: { recent_accuracy: float, weak_concepts: list[str] }
      current_section: str (optional)
      document_progress: float 0..1 (optional)
    Output:
      should_ask: bool
      reason: str
      suggested_type: QuestionType
      suggested_concept: str
    """
    msgs = int(context.get("messages_since_last_question") or 0)
    last_concept = str(context.get("last_concept_explained") or "").strip()
    confused = bool(context.get("user_expressed_confusion"))
    transition = bool(context.get("topic_transition"))
    perf = context.get("user_performance") or {}
    try:
        recent_accuracy = float(perf.get("recent_accuracy", 0.65))
    except (TypeError, ValueError):
        recent_accuracy = 0.65
    weak: list[str] = []
    raw_weak = perf.get("weak_concepts")
    if isinstance(raw_weak, list):
        weak = [str(x).strip() for x in raw_weak if str(x).strip()]

    current_section = str(context.get("current_section") or "").strip()
    try:
        doc_progress = float(context.get("document_progress") or 0.0)
    except (TypeError, ValueError):
        doc_progress = 0.0
    adversarial_mode = bool(context.get("adversarial_mode"))

    suggested_concept = weak[0] if weak else (last_concept or current_section or "key_point")
    suggested_type: QuestionType = "comprehension"
    if adversarial_mode:
        suggested_type = "analysis"
    if confused:
        suggested_type = "comprehension"
    if adversarial_mode and msgs >= 1:
        return {
            "should_ask": True,
            "reason": "Adversarial mode enabled; inject opposition-style verification regularly.",
            "suggested_type": "analysis",
            "suggested_concept": suggested_concept,
        }

    elif recent_accuracy > 0.82 and msgs >= 2:
        suggested_type = "analysis"
    elif recent_accuracy > 0.65:
        suggested_type = "application"

    # At most one question per two user messages (user rule).
    if msgs < 2 and not confused and not transition:
        return {
            "should_ask": False,
            "reason": "Cooldown: wait until at least two learner messages since last popup.",
            "suggested_type": suggested_type,
            "suggested_concept": suggested_concept,
        }

    if confused:
        return {
            "should_ask": True,
            "reason": "Learner expressed uncertainty; verify understanding with a grounded MCQ.",
            "suggested_type": "comprehension",
            "suggested_concept": suggested_concept,
        }

    if transition:
        return {
            "should_ask": True,
            "reason": "Topic transition; checkpoint with a quick verification question.",
            "suggested_type": suggested_type,
            "suggested_concept": suggested_concept,
        }

    if msgs >= 3:
        return {
            "should_ask": True,
            "reason": "Three or more exchanges without assessment; insert a verification popup.",
            "suggested_type": suggested_type,
            "suggested_concept": suggested_concept,
        }

    if last_concept and len(last_concept) > 3:
        return {
            "should_ask": True,
            "reason": "New material was introduced; confirm comprehension before advancing.",
            "suggested_type": "comprehension",
            "suggested_concept": suggested_concept[:120],
        }

    if doc_progress >= 0.85 and msgs >= 2:
        return {
            "should_ask": True,
            "reason": "Learner has covered most of the section; verify synthesis.",
            "suggested_type": "analysis",
            "suggested_concept": suggested_concept,
        }

    return {
        "should_ask": False,
        "reason": "No strong trigger; continue dialogue without a mandatory popup this turn.",
        "suggested_type": suggested_type,
        "suggested_concept": suggested_concept,
    }


def infer_user_confusion(user_text: str) -> bool:
    t = (user_text or "").strip().lower()
    if not t:
        return False
    needles = (
        "confused",
        "don't understand",
        "do not understand",
        "not sure",
        "unclear",
        "what do you mean",
        "i don't get",
        "lost me",
        "help me understand",
    )
    return any(n in t for n in needles)


def infer_topic_transition(prev_user: str, current_user: str) -> bool:
    a = (prev_user or "").strip().lower()
    b = (current_user or "").strip().lower()
    if not a or not b:
        return False
    stop = set(
        "the a an to of in for on at by with from as is was are were be been being "
        "it this that these those i you we they he she not".split()
    )

    def keywords(s: str) -> set[str]:
        tokens = re.findall(r"[a-z0-9]{3,}", s)
        return {x for x in tokens if x not in stop}

    ka, kb = keywords(a), keywords(b)
    if not ka or not kb:
        return False
    overlap = len(ka & kb) / max(1, min(len(ka), len(kb)))
    return overlap < 0.15
