from __future__ import annotations

import logging
import os

from core.budgets import BudgetTracker
from integrations.gemini._jsonsafe import loads_lenient
from integrations.gemini.client import get_client
from integrations.gemini.prompts import issue_extraction_prompt
from models.issue_models import IssueCard

logger = logging.getLogger(__name__)

# How much of the document to send. Skips far past the cover/index so the model
# reaches the synopsis + grounds. gemini-3.5-flash has a very large context window.
_MAX_CONTEXT_CHARS = int(os.environ.get("CITATION_V2_ISSUE_EXTRACT_CHARS", "60000"))
_MAX_OUTPUT_TOKENS = int(os.environ.get("CITATION_V2_ISSUE_MAX_TOKENS", "8192"))


def _issue_model() -> str:
    """Model for legal issue/keyword extraction. Configurable from .env."""
    return (
        os.environ.get("CITATION_V2_ISSUE_MODEL")
        or os.environ.get("CITATION_V2_GEMINI_MODEL")
        or os.environ.get("GEMINI_MODEL")
        or "gemini-3.5-flash"
    )


def extract_issue_cards(
    query: str,
    case_context: str,
    perspective: str,
    run_id: str,
    user_id: str,
    budget: BudgetTracker,
) -> list[IssueCard] | None:
    """
    Use the LLM to READ the case and produce real legal issue cards (legal_issue,
    phrase_terms, must_have_terms, statutes). Returns None on any failure so the
    caller can fall back to the deterministic heuristic extractor.
    """
    from utils.usage_tracker import record_gemini

    client = get_client()
    text = (case_context or "").strip()
    if not client or len(text) < 200:
        return None

    try:
        budget.consume("ai")
    except Exception as exc:
        logger.warning("[ISSUE_EXTRACT] AI budget exhausted (%s); falling back to heuristic", exc)
        return None

    model = _issue_model()
    prompt = issue_extraction_prompt(query, text[:_MAX_CONTEXT_CHARS], perspective)
    try:
        response = client.models.generate_content(
            model=model,
            contents=prompt,
            config={
                "temperature": 0,
                "max_output_tokens": _MAX_OUTPUT_TOKENS,
                "response_mime_type": "application/json",
                # Disable "thinking" so output tokens are spent on the JSON, not reasoning
                # (thinking was eating the budget and truncating the JSON → parse failures).
                "thinking_config": {"thinking_budget": 0},
            },
        )
        usage = getattr(response, "usage_metadata", None)
        tokens_in = int(getattr(usage, "prompt_token_count", 0) or 0)
        tokens_out = int(getattr(usage, "candidates_token_count", 0) or 0)
        record_gemini(run_id, user_id, "citation_v2_issue_extraction", tokens_in, tokens_out, model=model)
        data = loads_lenient(str(getattr(response, "text", "") or ""))
        if not isinstance(data, dict):
            logger.warning("[ISSUE_EXTRACT] Non-JSON response from %s; falling back to heuristic", model)
            return None
    except Exception:
        logger.exception("[ISSUE_EXTRACT] Gemini issue extraction failed; falling back to heuristic")
        return None

    # Court targeting: the AI-detected court drives the court-filtered IK query
    # (e.g. "Bombay High Court" → doctypes=bombay). Supreme Court kept as a strong
    # secondary so SC precedent is still reached via the all-courts doctrine query.
    detected_court = str(data.get("court") or "").strip()
    preferred_courts = [detected_court, "Supreme Court"] if detected_court else ["Supreme Court", "High Court"]

    def _strs(value, cap: int) -> list[str]:
        return [str(t).strip() for t in (value or []) if str(t).strip()][:cap]

    # Case-level opponent modelling (shared across cards so query_service can reach it).
    opp_args = _strs(data.get("opponent_arguments"), 6)
    opp_doctrines = _strs(data.get("opponent_doctrines"), 6)
    opp_terms = _strs(data.get("opponent_phrase_terms"), 8)

    cards: list[IssueCard] = []
    any_main = False
    for index, issue in enumerate((data.get("issues") or [])[:5], 1):
        if not isinstance(issue, dict):
            continue
        phrase_terms = _strs(issue.get("phrase_terms"), 8)
        must = _strs(issue.get("must_have_terms"), 6)
        statutes = _strs(issue.get("statutes"), 6)
        doctrines = _strs(issue.get("doctrines"), 8)
        synonyms = _strs(issue.get("synonyms"), 8) or must
        landmarks = _strs(issue.get("landmark_cases"), 8)
        legal_issue = str(issue.get("legal_issue") or "").strip()[:300]
        is_main = bool(issue.get("is_main_issue"))
        any_main = any_main or is_main
        if not (legal_issue or phrase_terms or must or statutes or doctrines):
            continue
        cards.append(IssueCard(
            issue_id=f"issue-{index}",
            legal_issue=legal_issue or f"Issue {index}",
            represented_side=perspective,
            favorable_position_for_selected_side=f"Authority favouring the {perspective}",
            likely_opposite_position=f"Authority opposing the {perspective}",
            statutes=statutes,
            must_have_terms=must,
            phrase_terms=phrase_terms,
            optional_synonyms=synonyms,
            negative_terms=[],
            preferred_courts=preferred_courts,
            expected_citation_use=str(issue.get("outcome_sought") or "").strip()[:300]
                or "support or test the selected side's legal proposition",
            doctrines=doctrines,
            is_main_issue=is_main,
            landmark_cases=landmarks,
            outcome_sought=str(issue.get("outcome_sought") or "").strip()[:300],
            opponent_arguments=opp_args,
            opponent_doctrines=opp_doctrines,
            opponent_phrase_terms=opp_terms,
        ))

    if not cards:
        return None
    # Guarantee exactly one main issue (the gravamen) — default to the first.
    if not any_main:
        cards[0].is_main_issue = True

    logger.info(
        "[ISSUE_EXTRACT] AI extracted %d issue card(s) via %s | main=%s | doctrines=%s | opp_terms=%d",
        len(cards), model,
        next((c.issue_id for c in cards if c.is_main_issue), "?"),
        (cards[0].doctrines or cards[0].phrase_terms)[:5], len(opp_terms),
    )
    return cards
