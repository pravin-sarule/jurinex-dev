import logging

from core.config import settings
from models.issue_models import IssueCard

logger = logging.getLogger(__name__)

# Indian Kanoon `doctypes` value used when no specific court applies — covers
# Supreme Court + all High Courts + District Courts combined.
DEFAULT_DOCTYPE = "judgments"
SUPREME_COURT_DOCTYPE = "supremecourt"

# Maps a preferred-court label (lower-cased) to the IK `doctypes` filter value.
COURT_DOCTYPE_MAP = {
    "supreme court": "supremecourt",
    "bombay high court": "bombay",
    "bombay": "bombay",
    "delhi high court": "delhi",
    "delhi": "delhi",
    "allahabad high court": "allahabad",
    "allahabad": "allahabad",
    "madras high court": "chennai",
    "kerala high court": "kerala",
    "karnataka high court": "karnataka",
    "gujarat high court": "gujarat",
    "calcutta high court": "kolkata",
    "punjab and haryana high court": "punjab",
    "rajasthan high court": "rajasthan",
    "patna high court": "patna",
    "orissa high court": "orissa",
}


def _resolve_court_doctype(preferred_courts) -> str | None:
    """First recognized court in the issue's preferred_courts → its IK doctype, else None."""
    for court in (preferred_courts or []):
        mapped = COURT_DOCTYPE_MAP.get((court or "").strip().lower())
        if mapped:
            return mapped
    return None


def _clean_term(term: str) -> str:
    """Quote multi-word terms (phrase search); leave single words unquoted (broad)."""
    cleaned = (term or "").replace('"', '').strip()
    if not cleaned:
        return ""
    return f'"{cleaned}"' if ' ' in cleaned else cleaned


# Execution priority by query type (1 = highest = runs/protected first). FAILURE 1:
# doctrine queries must never be starved by opponent/fallback queries.
QUERY_PRIORITY = {
    "doctrine": 1,
    "strict": 2,
    "supreme_court": 3,
    "court_filtered": 4,
    "custom": 4,
    "opponent": 5,
    "broad_fallback": 6,
}


def _row(issue_id: str, query_id: str, query_type: str, form_input: str,
         expected: list[str], is_fallback: bool = False, doctypes: str = DEFAULT_DOCTYPE,
         priority: int | None = None) -> dict:
    prio = priority if priority is not None else QUERY_PRIORITY.get(query_type, 6)
    return {
        "issue_id": issue_id,
        "query_id": query_id,
        "query_type": query_type,
        "formInput": form_input,
        "query_string": form_input,
        "query": form_input,  # backward-compat alias for older readers
        "doctypes": doctypes,
        "pagenum": 0,
        "expected_terms": expected,
        "negative_terms": [],  # never restrict the first pass with negatives
        "is_fallback": is_fallback,
        "priority": prio,
        "rank": prio,  # back-compat: retrieval previously sorted on rank
    }


def generate_ik_queries(issues: list[IssueCard], custom_keywords: list[str] | None = None) -> list[dict]:
    generated: list[dict] = []
    counter = 1
    max_per_issue = settings.max_queries_per_issue

    for issue in issues[:5]:
        issue_queries: list[dict] = []
        seen_inputs: set[str] = set()

        phrases = [c for c in (_clean_term(t) for t in issue.phrase_terms) if c]
        must_haves = [c for c in (_clean_term(t) for t in issue.must_have_terms) if c]
        # Doctrines now come from the dedicated field (was incorrectly issue.statutes).
        doctrines = [c for c in (_clean_term(t) for t in (getattr(issue, "doctrines", None) or [])) if c]
        synonyms = [c for c in (_clean_term(t) for t in issue.optional_synonyms) if c]
        opponent = [c for c in (_clean_term(t) for t in (getattr(issue, "opponent_phrase_terms", None) or [])) if c]
        anchor = (must_haves[:1] or phrases[:1] or synonyms[:1])

        def _add(qtype: str, terms: list[str], *, doctypes: str = DEFAULT_DOCTYPE,
                 is_fallback: bool = False, expected: list[str] | None = None) -> None:
            nonlocal counter
            terms = list(dict.fromkeys([t for t in terms if t]))
            if not terms:
                return
            form_input = (" ORR " if is_fallback and len(terms) >= 2 else " ANDD ").join(terms) \
                if len(terms) >= 2 else terms[0]
            key = f"{doctypes}::{form_input.lower()}"
            if key in seen_inputs:
                return
            seen_inputs.add(key)
            issue_queries.append(_row(
                issue.issue_id, f"Q{counter}", qtype, form_input,
                expected or terms, is_fallback=is_fallback, doctypes=doctypes,
            ))
            counter += 1

        if phrases:
            strict_terms = phrases[:1] + [m for m in must_haves if m not in phrases][:1]
        elif len(must_haves) >= 2:
            strict_terms = must_haves[:2]
        elif must_haves:
            strict_terms = must_haves[:1]
        else:
            strict_terms = synonyms[:2]

        # Queries are emitted in MANDATORY priority order (FAILURE 1): doctrine queries are
        # the most legally critical and must run/protect first; opponent + fallback are last.

        # Priority 1 — DOCTRINE queries (the fix for doctrines never searched).
        for d in doctrines[:3]:
            _add("doctrine", [d] + anchor, expected=[d])

        # Priority 2 — STRICT fact-pattern query.
        _add("strict", strict_terms)

        # Priority 3 — SUPREME COURT (additive doctypes=supremecourt, not a replacement).
        if strict_terms:
            _add("supreme_court", strict_terms, doctypes=SUPREME_COURT_DOCTYPE)

        # Priority 4 — local HIGH COURT (or whichever court the issue names), additive.
        court_doctype = _resolve_court_doctype(getattr(issue, "preferred_courts", None))
        if court_doctype and court_doctype != SUPREME_COURT_DOCTYPE:
            _add("court_filtered", strict_terms, doctypes=court_doctype)

        # Priority 5 — OPPONENT query (adverse authority for the opposition bundle).
        if opponent:
            _add("opponent", opponent[:1] + anchor, expected=opponent[:1])

        # Priority 6 — BROAD FALLBACK (lowest; OR the top phrases for recall).
        fallback_src = (
            [t for t in issue.phrase_terms if t and t.strip()]
            or [t for t in (getattr(issue, "doctrines", None) or []) if t and t.strip()]
            or [t for t in issue.must_have_terms if t and t.strip()]
        )
        fb_terms = [c for c in (_clean_term(t) for t in fallback_src) if c][:2]
        _add("broad_fallback", fb_terms, is_fallback=True)

        # Cap initial queries at max_per_issue (keeps highest-priority since emitted in
        # priority order); always keep the single fallback.
        initial = [q for q in issue_queries if not q.get("is_fallback")][:max_per_issue]
        fallback = [q for q in issue_queries if q.get("is_fallback")][:1]
        generated.extend(initial + fallback)

    # Custom keywords / case-name chips searched verbatim.
    custom = [item.strip() for item in (custom_keywords or []) if item and item.strip()]
    for value in custom[:3]:
        generated.append(_row(
            issues[0].issue_id if issues else "CUSTOM", f"Q{counter}", "custom",
            value, [value],
        ))
        counter += 1

    logger.info(
        "IK queries generated",
        extra={"details": {
            "queries_count": len(generated),
            "queries": [{"id": q["query_id"], "type": q["query_type"], "doctypes": q["doctypes"],
                         "formInput": q["formInput"], "is_fallback": q["is_fallback"]}
                        for q in generated],
        }},
    )
    return generated
