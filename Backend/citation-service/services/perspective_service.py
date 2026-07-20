"""
Represented-side detection for JuriNex (FAILURE 3).

A wrong represented side is catastrophic: it flips the entire SUPPORTING/ADVERSE
classification (a case the petitioner won becomes "adverse" to a client wrongly
tagged as respondent). Run 29abe5c0 showed "Represented side: respondent" for the
Tondare writ petition, whose client is the PETITIONER.

This module decides the represented side from multiple signals:

  1. The frontend-provided perspective is trusted by default (Step 1).
  2. A document-derived signal (writ jurisdiction + petitioner/respondent framing)
     is computed (Step 2).
  3. SANITY OVERRIDE (Step 3): only a HIGH-confidence petitioner-side writ document
     (Article 226/32 + >=2 petitioner cues + ZERO respondent-side cues) may correct
     a "respondent" perspective to "petitioner". This is deliberately one-directional
     and conservative so a genuine respondent-side run is never flipped. It can be
     disabled entirely with settings.enable_perspective_autocorrect=false.

The corrected value is written back to context.perspective (and context.represented_side)
so every downstream stage — scoring, evaluator, disposition — uses the same side.
"""

from __future__ import annotations

import logging

from core.config import settings
from core.constants import SUPPORTED_PERSPECTIVES

logger = logging.getLogger(__name__)

# Perspective is "explicit" when the user/frontend chose an actual party (not neutral).
_EXPLICIT_SIDES = {s for s in SUPPORTED_PERSPECTIVES if s != "neutral"}
# Only these source perspectives are eligible for the respondent→petitioner correction.
_RESPONDENT_PERSPECTIVES = {"respondent"}

# Confidence required before the document may override a user-chosen perspective.
_OVERRIDE_CONFIDENCE = 0.80

# A writ under Art. 226/32 is, by definition, filed BY the petitioner.
_WRIT_MARKERS = (
    "article 226", "article 32", "writ petition", "writ jurisdiction",
    "under article 226", "under article 32", "in the nature of mandamus",
)

# Document framed FROM the petitioner's side (i.e. the client is the petitioner).
_PETITIONER_CUES = (
    "the petitioner herein", "preferred by the petitioner", "filed by the petitioner",
    "petitioner has approached", "approached this court", "the petitioner submits",
    "petitioner prays", "instant writ petition", "present writ petition",
    "the petitioner/appellant", "petitioner is before this court",
    "on behalf of the petitioner", "the present petition is filed",
)

# Document framed FROM the respondent's side (counter-affidavit / reply / defence).
_RESPONDENT_CUES = (
    "answering respondent", "the respondent submits", "counter affidavit",
    "counter-affidavit", "reply affidavit", "on behalf of the respondent",
    "written submissions on behalf of the respondent", "reply on behalf of the respondent",
    "the deponent is the respondent",
)


def _extract_side_from_document(case_context: str) -> tuple[str, float, str, list[str]]:
    """Infer (side, confidence, block, cues) from the document framing.

    side: "petitioner" / "respondent" / "" (unknown)
    confidence: 0.0–1.0
    block: which party block the strongest cue sits in (for logging)
    cues: the matched cue phrases (for logging / audit)
    """
    low = (case_context or "").lower()
    if not low.strip():
        return "", 0.0, "", []

    pet_hits = [c for c in _PETITIONER_CUES if c in low]
    res_hits = [c for c in _RESPONDENT_CUES if c in low]
    writ = any(w in low for w in _WRIT_MARKERS)

    # R8 — a genuine RESPONDENT document is a counter-affidavit / reply: its tell-tale
    # phrases (_RESPONDENT_CUES) must DOMINATE, not merely tie. A petitioner's writ
    # always mentions "respondent(s)" incidentally; that must not flip the side.
    respondent_doc = bool(res_hits) and len(res_hits) > len(pet_hits)
    if respondent_doc:
        conf = min(0.85, 0.5 + 0.15 * len(res_hits))
        return "respondent", round(conf, 2), "respondent_block", res_hits

    # R8 — an Article 226/32 WRIT is, by definition, filed BY the petitioner. With no
    # dominant counter-affidavit framing, treat the writ marker as DECISIVE petitioner
    # evidence (confidence >= the override threshold) so a wrong "respondent" perspective
    # is corrected. This is the single largest cause of supporting cases being mislabelled
    # ADVERSE. Still one-directional (only respondent→petitioner) and gated by the flag.
    if writ:
        conf = min(0.97, _OVERRIDE_CONFIDENCE + 0.05 * len(pet_hits))
        return "petitioner", round(conf, 2), "petitioner_block", (pet_hits or ["writ_jurisdiction"])

    # Non-writ document: rely on explicit petitioner cues (kept below the override
    # threshold so a non-writ doc never silently flips a user-chosen respondent side).
    if pet_hits:
        conf = min(0.75, 0.35 + 0.15 * len(pet_hits))
        return "petitioner", round(conf, 2), "petitioner_block", pet_hits

    return "", 0.0, "", []


def detect_represented_side(perspective: str, case_context: str, query: str = "", run_id: str = "") -> str:
    """Return the represented side, correcting a clearly-wrong "respondent" perspective.

    See module docstring for the decision order. Pure function (only logs) so it is
    trivially unit-testable; the orchestrator writes the result onto the context.
    """
    rid = (run_id or "")[:8]
    p = (perspective or "neutral").strip().lower()
    explicit = p in _EXPLICIT_SIDES

    doc_side, confidence, block, cues = _extract_side_from_document(case_context)

    if not explicit:
        # Neutral / unset: keep neutral (a deliberate analytical mode — the AI judge
        # decides sides). We do NOT silently assign a party.
        logger.info("[JURINEX][%s][PERSPECTIVE] Extracted from doc: %s client_found_in=%s confidence=%s",
                    rid, doc_side or "none", block or "n/a",
                    "high" if confidence >= _OVERRIDE_CONFIDENCE else "low")
        logger.info("[JURINEX][%s][PERSPECTIVE_FINAL] represented_side=%s "
                    "— all classification will use this value", rid, p)
        return p

    logger.info("[JURINEX][%s][PERSPECTIVE] User-provided: %s", rid, p)

    # Step 3 — conservative, one-directional sanity override.
    if (settings.enable_perspective_autocorrect
            and p in _RESPONDENT_PERSPECTIVES
            and doc_side == "petitioner"
            and confidence >= _OVERRIDE_CONFIDENCE):
        logger.warning("[JURINEX][%s][PERSPECTIVE_MISMATCH] User said 'respondent' but the document "
                       "reads as a petitioner's writ — corrected respondent→petitioner "
                       "reason=writ_filed_by_client confidence=%.2f cues=%s",
                       rid, confidence, cues[:4])
        logger.info("[JURINEX][%s][PERSPECTIVE_FINAL] represented_side=petitioner "
                    "— all classification will use this value", rid)
        return "petitioner"

    logger.info("[JURINEX][%s][PERSPECTIVE_FINAL] represented_side=%s "
                "— all classification will use this value", rid, p)
    return p
