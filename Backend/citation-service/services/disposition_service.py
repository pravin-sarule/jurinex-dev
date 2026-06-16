"""
Outcome-aware adverse detection for JuriNex.

The legacy scoring (services/scoring_service.py) infers SUPPORTING/ADVERSE from a
bag-of-words favorability count over title+headline+fragment. A judgment that
*dismisses* a petition but discusses petitioner-friendly doctrines (e.g. Punjab
Homeopathic) therefore scores as SUPPORTING — a dangerous, wrong label.

This module reads what the court actually ORDERED (the operative disposition,
which in Indian judgments sits at the END of the document) and maps it, together
with the client's role, onto the correct citation classification.

Two extractors are combined:
  1. detect_disposition_regex  — free, anchored to the operative span only so a
     *quoted precedent* ("...in X the petition was allowed...") does not count.
  2. detect_disposition_gemini — one gemini-3.5-flash call on full_text[-4000:],
     used ONLY when the regex is not confident. Registered through usage_tracker
     so its cost shows in the run cost breakdown.

All thresholds are read from core.config.settings so behaviour can be tuned from
.env without code changes. The whole step is gated by settings.enable_disposition_check.
"""

from __future__ import annotations

import logging
import os
import re
from dataclasses import dataclass

from core.budgets import BudgetTracker
from core.enums import Classification, Disposition, WinningParty
from core.exceptions import BudgetExceeded
from models.citation_models import Candidate

logger = logging.getLogger(__name__)


# ── Tunables (env-overridable; safe defaults) ───────────────────────────────────
def _f(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


# Below this regex confidence we ask Gemini to read the tail of the judgment.
GEMINI_FALLBACK_FLOOR = _f("CITATION_V2_DISPOSITION_GEMINI_FLOOR", 0.70)
# A reconciled outcome must reach this confidence before it may override a label.
OVERRIDE_FLOOR = _f("CITATION_V2_DISPOSITION_OVERRIDE_FLOOR", 0.70)
# Below this we don't even record an opinion (log a warning, keep existing label).
ABSTAIN_FLOOR = _f("CITATION_V2_DISPOSITION_ABSTAIN_FLOOR", 0.50)
# Fraction of the document treated as the operative tail when no anchor is found.
_TAIL_FRACTION = _f("CITATION_V2_DISPOSITION_TAIL_FRACTION", 0.15)
_GEMINI_TAIL_CHARS = int(_f("CITATION_V2_DISPOSITION_GEMINI_CHARS", 4000))


@dataclass
class DispositionResult:
    disposition: str = Disposition.UNKNOWN.value      # ALLOWED / DISMISSED / PARTLY_ALLOWED / REMANDED / UNKNOWN
    winning_party: str = WinningParty.UNCLEAR.value   # PETITIONER / RESPONDENT / UNCLEAR
    operative_quote: str = ""                         # verbatim operative sentence(s)
    confidence: float = 0.0                           # 0.0 – 1.0
    source: str = "REGEX"                             # REGEX / GEMINI / COMBINED


# ── Operative-span anchors (searched from the END of the judgment) ──────────────
# Only reliable PARAGRAPH openers — short mid-sentence words like "accordingly"
# would truncate the span past the subject ("the petition is ...") and lose the
# decisive pattern, so they are deliberately excluded.
_OPERATIVE_ANCHORS = (
    "in the result", "in view of the above", "in view of the foregoing",
    "for the foregoing reasons", "for the reasons recorded", "for the reasons stated",
    "for these reasons", "in these circumstances", "in the circumstances",
    "in the upshot", "it is hereby ordered", "it is ordered", "we order",
    "we direct", "hence, the", "thus, the",
    "\norder\n", "\no r d e r\n", "\njudgment\n",
)
_MIN_SPAN_CHARS = 40

# Signed patterns. Weight 2.0 = explicit "<subject> is allowed/dismissed"; 1.0 = bare verb.
_PAT = {
    Disposition.PARTLY_ALLOWED: [
        (r"part(?:ly|ially)\s+allowed", 2.0),
        (r"allowed\s+in\s+part", 2.0),
        (r"part(?:ly|ially)\s+succeed", 2.0),
        (r"allowed\s+to\s+the\s+(?:above\s+)?extent", 1.5),
    ],
    Disposition.REMANDED: [
        (r"\brema(?:nd|nded|nds)\b", 1.5),
        (r"\bremitted\b", 1.5),
        (r"de\s+novo", 1.5),
        (r"fresh\s+(?:consideration|decision|adjudication|hearing)", 1.5),
    ],
    Disposition.ALLOWED: [
        (r"(?:writ\s+petition|petition|appeal|application|revision|rule|slp|special\s+leave\s+petition)s?"
         r"[^.\n]{0,40}\b(?:is|are|stand|stands|hereby|accordingly)\b[^.\n]{0,25}\ballowed\b", 2.0),
        (r"rule\s+(?:is\s+)?made\s+absolute", 2.0),
        (r"impugned\s+(?:order|judgment|notification|decision|award|action|communication)"
         r"[^.\n]{0,80}(?:is|are)[^.\n]{0,25}(?:quashed|set\s+aside|struck\s+down)", 2.0),
        (r"\b(?:quashed|set\s+aside|struck\s+down)\b", 1.0),
        (r"(?:writ|direction|mandamus)\s+(?:is\s+)?issued", 1.0),
        (r"relief\s+(?:is\s+|prayed\s+for\s+is\s+)?granted", 1.0),
        (r"prayer[^.\n]{0,30}(?:is\s+)?granted", 1.0),
        (r"\ballowed\b", 0.8),
    ],
    Disposition.DISMISSED: [
        (r"(?:writ\s+petition|petition|appeal|application|revision|slp|special\s+leave\s+petition)s?"
         r"[^.\n]{0,40}\b(?:is|are|stand|stands|hereby|accordingly)\b[^.\n]{0,25}\b(?:dismissed|rejected)\b", 2.0),
        (r"\b(?:petition|appeal|application)s?\s+fail(?:s)?\b", 2.0),
        (r"no\s+interference\s+(?:is\s+)?(?:warranted|called\s+for|required)", 1.8),
        (r"cannot\s+interfere", 1.8),
        (r"no\s+ground[s]?\s+(?:for|to)\s+interfere", 1.8),
        (r"(?:devoid\s+of|without|no)\s+merit", 1.2),
        (r"prayer[^.\n]{0,30}(?:is\s+)?(?:rejected|refused|declined)", 1.2),
        (r"\bdismissed\b", 0.9),
        (r"\brejected\b", 0.7),
    ],
}
_COMPILED = {
    disp: [(re.compile(p, re.IGNORECASE), w) for p, w in pats]
    for disp, pats in _PAT.items()
}


def _operative_span(full_text: str) -> tuple[str, bool]:
    """Return (operative_text, found_by_anchor). Scopes outcome patterns to the order."""
    text = full_text or ""
    low = text.lower()
    cut = -1
    for anchor in _OPERATIVE_ANCHORS:
        idx = low.rfind(anchor)
        if idx > cut:
            cut = idx
    # Anchor must sit in the latter part of the document and leave a usable span.
    if cut >= 0 and cut > len(text) * 0.4 and (len(text) - cut) >= _MIN_SPAN_CHARS:
        return text[cut:], True
    # Fallback: last N% of the document.
    tail_start = int(len(text) * (1.0 - _TAIL_FRACTION))
    return text[tail_start:], False


def _first_quote(span: str) -> str:
    """Pick a short verbatim operative sentence for the report."""
    for sent in re.split(r"(?<=[.;])\s+", span.strip()):
        s = sent.strip()
        low = s.lower()
        if 10 <= len(s) <= 400 and any(
            kw in low for kw in (
                "allowed", "dismissed", "rejected", "quashed", "set aside",
                "made absolute", "no merit", "interfere", "remand", "disposed",
                "fails", "granted",
            )
        ):
            return s
    s = span.strip().replace("\n", " ")
    return s[-300:] if s else ""


def _winning_party(disposition: str) -> str:
    if disposition == Disposition.ALLOWED.value:
        return WinningParty.PETITIONER.value
    if disposition == Disposition.DISMISSED.value:
        return WinningParty.RESPONDENT.value
    return WinningParty.UNCLEAR.value


def detect_disposition_regex(full_text: str) -> DispositionResult:
    """Free disposition extractor. Scores signed patterns within the operative span only."""
    text = (full_text or "").strip()
    if len(text) < 200:
        return DispositionResult(confidence=0.0, source="REGEX")

    span, by_anchor = _operative_span(text)
    scores: dict[str, float] = {}
    strong_hit = False
    for disp, compiled in _COMPILED.items():
        total = 0.0
        for rx, weight in compiled:
            hits = len(rx.findall(span))
            if hits:
                total += weight * min(hits, 3)
                if weight >= 2.0:
                    strong_hit = True
        if total:
            scores[disp.value] = total

    if not scores:
        return DispositionResult(disposition=Disposition.UNKNOWN.value, confidence=0.0,
                                 source="REGEX")

    allowed = scores.get(Disposition.ALLOWED.value, 0.0)
    dismissed = scores.get(Disposition.DISMISSED.value, 0.0)
    partly = scores.get(Disposition.PARTLY_ALLOWED.value, 0.0)
    remanded = scores.get(Disposition.REMANDED.value, 0.0)

    if partly:
        disp = Disposition.PARTLY_ALLOWED.value
    elif allowed and dismissed and abs(allowed - dismissed) < 1.0:
        disp = Disposition.PARTLY_ALLOWED.value  # genuinely mixed → distinguishable
    elif remanded >= max(allowed, dismissed) and remanded > 0:
        disp = Disposition.REMANDED.value
    elif allowed > dismissed:
        disp = Disposition.ALLOWED.value
    elif dismissed > allowed:
        disp = Disposition.DISMISSED.value
    else:
        disp = Disposition.UNKNOWN.value

    # Confidence: anchored + explicit subject phrase = high; otherwise lower.
    if disp == Disposition.UNKNOWN.value:
        conf = 0.0
    elif by_anchor and strong_hit:
        conf = 0.9
    elif by_anchor:
        conf = 0.75
    elif strong_hit:
        conf = 0.7
    else:
        conf = 0.6
    # Penalise conflict between the two decisive categories.
    if allowed and dismissed and disp in (Disposition.ALLOWED.value, Disposition.DISMISSED.value):
        conf = max(0.0, conf - 0.2)

    return DispositionResult(
        disposition=disp,
        winning_party=_winning_party(disp),
        operative_quote=_first_quote(span),
        confidence=round(conf, 2),
        source="REGEX",
    )


def detect_disposition_gemini(
    full_text: str, run_id: str, user_id: str, budget: BudgetTracker,
) -> DispositionResult | None:
    """LLM disposition extractor on the judgment tail. Returns None on any failure/skip."""
    from integrations.gemini._jsonsafe import loads_lenient
    from integrations.gemini.client import get_client
    from integrations.gemini.prompts import disposition_prompt
    from utils.usage_tracker import record_gemini

    client = get_client()
    tail = (full_text or "").strip()[-_GEMINI_TAIL_CHARS:]
    if not client or len(tail) < 200:
        return None
    # Dedicated, non-"ai" budget op: it is NOT capped by max_ai_calls (reserved for
    # extraction + final judge) but still counts toward the run's total cost ceiling.
    try:
        budget.consume("ai_disposition", estimated_cost=0.2)
    except BudgetExceeded:
        logger.warning("[DISPOSITION] budget exhausted; skipping Gemini, keeping regex result")
        return None

    model = (os.environ.get("CITATION_V2_DISPOSITION_MODEL")
             or os.environ.get("CITATION_V2_JUDGE_MODEL")
             or os.environ.get("CITATION_V2_GEMINI_MODEL")
             or os.environ.get("GEMINI_MODEL", "gemini-3.5-flash"))
    try:
        resp = client.models.generate_content(
            model=model, contents=disposition_prompt(tail),
            config={
                "temperature": 0,
                "max_output_tokens": int(os.environ.get("CITATION_V2_DISPOSITION_MAX_TOKENS", "512")),
                "response_mime_type": "application/json",
                "thinking_config": {"thinking_budget": 0},
            },
        )
        usage = getattr(resp, "usage_metadata", None)
        record_gemini(
            run_id, user_id, "citation_v2_disposition",
            int(getattr(usage, "prompt_token_count", 0) or 0),
            int(getattr(usage, "candidates_token_count", 0) or 0),
            model=model,
        )
        data = loads_lenient(str(getattr(resp, "text", "") or ""))
        if not isinstance(data, dict):
            return None
    except Exception:
        logger.exception("[DISPOSITION] Gemini disposition call failed")
        return None

    disp_raw = str(data.get("disposition") or "").strip().upper().replace(" ", "_")
    allowed_vals = {d.value for d in Disposition}
    disposition = disp_raw if disp_raw in allowed_vals else Disposition.UNKNOWN.value
    wp_raw = str(data.get("winning_party") or "").strip().upper()
    winning = wp_raw if wp_raw in {w.value for w in WinningParty} else _winning_party(disposition)
    try:
        conf = float(data.get("confidence", 0.0))
    except (TypeError, ValueError):
        conf = 0.6 if disposition != Disposition.UNKNOWN.value else 0.0
    return DispositionResult(
        disposition=disposition,
        winning_party=winning,
        operative_quote=str(data.get("operative_quote") or "")[:400],
        confidence=round(max(0.0, min(1.0, conf)), 2),
        source="GEMINI",
    )


def reconcile(regex_res: DispositionResult, gemini_res: DispositionResult | None) -> DispositionResult:
    """Combine the two extractors (PART 1 Step 3)."""
    if gemini_res is None:
        return regex_res
    if regex_res.disposition == gemini_res.disposition and regex_res.disposition != Disposition.UNKNOWN.value:
        return DispositionResult(
            disposition=regex_res.disposition,
            winning_party=regex_res.winning_party or gemini_res.winning_party,
            operative_quote=regex_res.operative_quote or gemini_res.operative_quote,
            confidence=round(min(0.99, max(regex_res.confidence, gemini_res.confidence) + 0.1), 2),
            source="COMBINED",
        )
    # Disagreement → trust whichever is confident; if both are, abstain.
    r_ok = regex_res.confidence >= GEMINI_FALLBACK_FLOOR and regex_res.disposition != Disposition.UNKNOWN.value
    g_ok = gemini_res.confidence >= GEMINI_FALLBACK_FLOOR and gemini_res.disposition != Disposition.UNKNOWN.value
    if g_ok and not r_ok:
        return gemini_res
    if r_ok and not g_ok:
        return regex_res
    if g_ok and r_ok:
        return DispositionResult(disposition=Disposition.UNKNOWN.value, confidence=0.0, source="COMBINED")
    # Neither confident → take the higher-confidence guess, de-rated.
    best = gemini_res if gemini_res.confidence >= regex_res.confidence else regex_res
    return DispositionResult(
        disposition=best.disposition, winning_party=best.winning_party,
        operative_quote=best.operative_quote, confidence=round(best.confidence * 0.85, 2),
        source="COMBINED",
    )


# ── client role bucketing + label mapping ───────────────────────────────────────
_PETITIONER_ROLES = {"petitioner", "appellant", "applicant", "complainant", "plaintiff"}
_RESPONDENT_ROLES = {"respondent", "defendant", "state", "opposite_party"}


def client_role(perspective: str) -> str:
    """Bucket the configured perspective into PETITIONER / RESPONDENT / NEUTRAL.

    'accused' and 'neutral' are intentionally NEUTRAL: who-won is ambiguous for
    them, so we never auto-flip — the AI judge decides.
    """
    p = (perspective or "").strip().lower()
    if p in _PETITIONER_ROLES:
        return "PETITIONER"
    if p in _RESPONDENT_ROLES:
        return "RESPONDENT"
    return "NEUTRAL"


def map_disposition_to_classification(disposition: str, perspective: str) -> Classification | None:
    """disposition × client_role → citation label. None = keep the existing label."""
    role = client_role(perspective)
    if role == "NEUTRAL" or disposition == Disposition.UNKNOWN.value:
        return None
    petitioner_table = {
        Disposition.ALLOWED.value: Classification.SUPPORTING,
        Disposition.DISMISSED.value: Classification.ADVERSE,
        Disposition.PARTLY_ALLOWED.value: Classification.DISTINGUISHABLE,
        Disposition.REMANDED.value: Classification.WEAK_CONTEXTUAL,
    }
    respondent_table = {
        Disposition.ALLOWED.value: Classification.ADVERSE,
        Disposition.DISMISSED.value: Classification.SUPPORTING,
        Disposition.PARTLY_ALLOWED.value: Classification.DISTINGUISHABLE,
        Disposition.REMANDED.value: Classification.WEAK_CONTEXTUAL,
    }
    table = petitioner_table if role == "PETITIONER" else respondent_table
    return table.get(disposition)


def detect_for_candidate(
    candidate: Candidate, run_id: str, user_id: str, budget: BudgetTracker,
    allow_gemini: bool = True,
) -> DispositionResult:
    """Run regex (+ optional Gemini fallback), store the result on the candidate, return it.

    res.source is REGEX when only the regex ran, GEMINI/COMBINED when the LLM was
    consulted — callers use that to count paid calls against a cap.
    """
    res = detect_disposition_regex(candidate.full_text)
    if allow_gemini and res.confidence < GEMINI_FALLBACK_FLOOR:
        g = detect_disposition_gemini(candidate.full_text, run_id, user_id, budget)
        if g is not None:
            res = reconcile(res, g)
    candidate.disposition = res.disposition
    candidate.winning_party = res.winning_party
    candidate.operative_quote = res.operative_quote
    candidate.outcome_confidence = res.confidence
    candidate.outcome_source = res.source
    return res


def apply_override(candidate: Candidate, perspective: str) -> tuple[bool, Classification | None]:
    """Override the candidate's classification when the outcome is confident enough.

    Returns (overridden, new_label). Does NOT override on UNKNOWN or low confidence.
    """
    new_label = map_disposition_to_classification(candidate.disposition, perspective)
    if new_label is None:
        return False, None
    if candidate.outcome_confidence < OVERRIDE_FLOOR:
        return False, new_label
    if new_label == candidate.classification:
        return False, new_label
    candidate.classification = new_label
    candidate.supports_selected_side = new_label == Classification.SUPPORTING
    candidate.adverse_to_selected_side = new_label == Classification.ADVERSE
    candidate.outcome_overridden = True
    return True, new_label


def apply_disposition_veto(candidates: list[Candidate], perspective: str) -> int:
    """Re-assert confident dispositions AFTER the AI judge (judge may have re-flipped).

    A confident operative outcome is ground truth about who won; it beats the
    judge's doctrinal read. Returns the number of labels corrected.
    """
    corrected = 0
    for c in candidates or []:
        if not c.disposition or c.disposition == Disposition.UNKNOWN.value:
            continue
        if c.outcome_confidence < OVERRIDE_FLOOR:
            continue
        target = map_disposition_to_classification(c.disposition, perspective)
        if target is not None and target != c.classification:
            logger.info(
                "[DISPOSITION] VETO %s: judge=%s -> %s (disposition=%s conf=%.2f)",
                (c.title or c.doc_id)[:50], c.classification.value, target.value,
                c.disposition, c.outcome_confidence,
            )
            c.classification = target
            c.supports_selected_side = target == Classification.SUPPORTING
            c.adverse_to_selected_side = target == Classification.ADVERSE
            c.outcome_overridden = True
            corrected += 1
    return corrected
