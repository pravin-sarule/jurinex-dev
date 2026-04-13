"""
Lightweight performance view + next-step hints for Learning Mode sessions.
"""

from __future__ import annotations

from typing import Any


def analyze_performance(session_snapshot: dict[str, Any]) -> dict[str, Any]:
    metrics = session_snapshot.get("performance_metrics") or {}
    total = int(metrics.get("total_questions") or 0)
    correct = int(metrics.get("correct_answers") or 0)
    accuracy = (correct / total) if total else 0.0
    by_concept = metrics.get("accuracy_by_concept") or {}
    struggling = [c for c, acc in by_concept.items() if float(acc) < 0.5]
    mastered = [c for c, acc in by_concept.items() if float(acc) >= 0.8 and total >= 3]
    factual = float(metrics.get("factual_accuracy") or 0.0)
    procedural = float(metrics.get("procedural_accuracy") or 0.0)
    jurisprudential = float(metrics.get("jurisprudential_accuracy") or 0.0)
    legal_mastery_level = "Level 1: Factual Mastery"
    if factual >= 0.75 and procedural >= 0.65:
        legal_mastery_level = "Level 2: Procedural Mastery"
    if factual >= 0.8 and procedural >= 0.75 and jurisprudential >= 0.65:
        legal_mastery_level = "Level 3: Jurisprudential Mastery"
    return {
        "overall_accuracy": accuracy,
        "struggling_concepts": struggling,
        "mastered_concepts": mastered,
        "total_questions": total,
        "factual_accuracy": factual,
        "procedural_accuracy": procedural,
        "jurisprudential_accuracy": jurisprudential,
        "legal_mastery_level": legal_mastery_level,
    }


def recommend_next_action(state_dict: dict[str, Any]) -> dict[str, Any]:
    insights = analyze_performance(state_dict)
    if insights["overall_accuracy"] < 0.45 and insights["total_questions"] >= 3:
        return {
            "action": "review",
            "difficulty": "easy",
            "focus_concept": (insights["struggling_concepts"] or ["last_section"])[0],
            "note": "Accuracy dipped; prefer shorter explanations and easier checks.",
        }
    if insights["overall_accuracy"] > 0.85 and insights["total_questions"] >= 4:
        return {
            "action": "challenge",
            "difficulty": "hard",
            "focus_concept": (insights["mastered_concepts"] or ["advanced"])[0],
            "note": "Learner is excelling; offer deeper synthesis prompts.",
        }
    return {
        "action": "continue",
        "difficulty": "medium",
        "focus_concept": "",
        "note": "Maintain current pacing.",
    }


def adjust_difficulty(concept: str, performance_history: list[dict[str, Any]]) -> str:
    rel = [h for h in performance_history if str(h.get("concept") or "") == str(concept)]
    if len(rel) < 2:
        return "medium"
    correct = sum(1 for h in rel if h.get("is_correct"))
    acc = correct / len(rel)
    if acc < 0.5:
        return "easy"
    if acc > 0.85:
        return "hard"
    return "medium"
