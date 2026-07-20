"""
Direction-aware legal-principle detection (FAILURE 3).

Some doctrines are DIRECTED — they cut against a specific party. "Authority cannot
take advantage of its own wrong" helps a petitioner when applied against the
*authority*, but a precedent that applies it against the *bidder/petitioner* is
ADVERSE even though the phrase matches. The legacy scorer matched phrase presence
only; this module checks WHICH party the principle is applied against by reading
the subject immediately preceding the principle in the operative sentence.
"""

from __future__ import annotations

import re

# principle (canonical, lowercase substring) -> who it must / must-not apply to.
DIRECTED_PRINCIPLES: dict[str, dict[str, list[str]]] = {
    "advantage of its own wrong": {
        "must_apply_to": ["authority", "respondent", "state", "government",
                          "municipal", "corporation", "department"],
        "wrong_if_applies_to": ["petitioner", "appellant", "bidder",
                                "contractor", "tenderer", "applicant"],
    },
    "advantage of his own wrong": {
        "must_apply_to": ["authority", "respondent", "state", "government",
                          "municipal", "corporation", "department"],
        "wrong_if_applies_to": ["petitioner", "appellant", "bidder",
                                "contractor", "tenderer", "applicant"],
    },
    "benefit from its own wrong": {
        "must_apply_to": ["authority", "respondent", "state", "government"],
        "wrong_if_applies_to": ["petitioner", "bidder", "contractor", "appellant"],
    },
    "benefit from his own wrong": {
        "must_apply_to": ["authority", "respondent", "state", "government"],
        "wrong_if_applies_to": ["petitioner", "bidder", "contractor", "appellant"],
    },
    "estoppel": {
        "must_apply_to": ["authority", "government", "state", "respondent"],
        "wrong_if_applies_to": [],  # estoppel can run either way
    },
    "legitimate expectation": {
        "must_apply_to": [],  # favours the petitioner by nature — not directional here
        "wrong_if_applies_to": [],
    },
}

CORRECT_DIRECTION = "CORRECT_DIRECTION"
WRONG_DIRECTION = "WRONG_DIRECTION"
UNCLEAR = "UNCLEAR"

_SUBJECT_WINDOW = 90  # chars before the principle that hold its grammatical subject


def _config_for(principle: str) -> dict | None:
    """Match an issue phrase to a canonical directed principle (substring either way)."""
    p = (principle or "").lower().strip()
    if not p:
        return None
    if p in DIRECTED_PRINCIPLES:
        return DIRECTED_PRINCIPLES[p]
    for key, cfg in DIRECTED_PRINCIPLES.items():
        if key in p or p in key:
            return cfg
    return None


def check_principle_direction(fragment_text: str, principle: str, client_role: str = "") -> str:
    """Return CORRECT_DIRECTION / WRONG_DIRECTION / UNCLEAR for one principle.

    Looks at the subject in the window immediately BEFORE each occurrence of the
    principle ("petitioner cannot take advantage of its own wrong" → WRONG).
    """
    text = (fragment_text or "").lower()
    cfg = _config_for(principle)
    if cfg is None:
        return UNCLEAR
    # Identify the canonical key text that actually appears in the fragment.
    p = (principle or "").lower().strip()
    needle = p if p in text else next((k for k in DIRECTED_PRINCIPLES if k in text and _config_for(k) is cfg), "")
    if not needle or needle not in text:
        return UNCLEAR

    wrong = cfg.get("wrong_if_applies_to", [])
    correct = cfg.get("must_apply_to", [])
    if not wrong and not correct:
        return CORRECT_DIRECTION  # non-directional (e.g. legitimate expectation)

    for m in re.finditer(re.escape(needle), text):
        window = text[max(0, m.start() - _SUBJECT_WINDOW):m.start()]
        wrong_hit = max((window.rfind(w) for w in wrong), default=-1)
        correct_hit = max((window.rfind(c) for c in correct), default=-1)
        if wrong_hit != -1 and wrong_hit >= correct_hit:
            return WRONG_DIRECTION
        if correct_hit != -1 and correct_hit > wrong_hit:
            return CORRECT_DIRECTION

    # Sentence-level fallback when no subject sits in the immediate window.
    if wrong and any(w in text for w in wrong) and not any(c in text for c in correct):
        return WRONG_DIRECTION
    if correct and any(c in text for c in correct):
        return CORRECT_DIRECTION
    return UNCLEAR


def assess_fragment_direction(
    fragment_text: str, extra_principles: list[str] | None = None,
) -> tuple[str, str, str]:
    """Scan a fragment for directed principles. Returns (direction, principle, evidence).

    WRONG_DIRECTION takes precedence (most important to catch). `evidence` is the
    sentence containing the offending principle, for logging.
    """
    text = fragment_text or ""
    if not text.strip():
        return UNCLEAR, "", ""
    principles = list(DIRECTED_PRINCIPLES.keys()) + [p for p in (extra_principles or []) if p]
    seen: set[str] = set()
    correct_hit: tuple[str, str, str] | None = None
    for principle in principles:
        key = (principle or "").lower().strip()
        if not key or key in seen:
            continue
        seen.add(key)
        direction = check_principle_direction(text, principle)
        if direction == WRONG_DIRECTION:
            return WRONG_DIRECTION, principle, _evidence_sentence(text, principle)
        if direction == CORRECT_DIRECTION and correct_hit is None and _config_for(principle):
            correct_hit = (CORRECT_DIRECTION, principle, _evidence_sentence(text, principle))
    return correct_hit or (UNCLEAR, "", "")


def _evidence_sentence(text: str, principle: str) -> str:
    low = text.lower()
    needle = (principle or "").lower().strip()
    idx = low.find(needle)
    if idx < 0:
        for k in DIRECTED_PRINCIPLES:
            if k in low:
                idx = low.find(k)
                break
    if idx < 0:
        return ""
    start = text.rfind(".", 0, idx) + 1
    end = text.find(".", idx)
    end = end if end != -1 else min(len(text), idx + 160)
    return text[start:end].strip()[:200]
