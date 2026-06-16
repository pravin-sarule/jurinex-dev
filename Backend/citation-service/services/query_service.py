import logging

from models.issue_models import IssueCard

logger = logging.getLogger(__name__)

# Indian Kanoon `doctypes` value used when no specific court applies — covers
# Supreme Court + all High Courts + District Courts combined.
DEFAULT_DOCTYPE = "judgments"

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


def _row(issue_id: str, query_id: str, query_type: str, form_input: str,
         expected: list[str], is_fallback: bool = False, doctypes: str = DEFAULT_DOCTYPE) -> dict:
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
    }


def generate_ik_queries(issues: list[IssueCard], custom_keywords: list[str] | None = None) -> list[dict]:
    generated: list[dict] = []
    counter = 1

    for issue in issues[:5]:
        issue_queries: list[dict] = []

        phrases = [c for c in (_clean_term(t) for t in issue.phrase_terms) if c]
        must_haves = [c for c in (_clean_term(t) for t in issue.must_have_terms) if c]
        doctrines = [c for c in (_clean_term(t) for t in issue.statutes) if c]
        synonyms = [c for c in (_clean_term(t) for t in issue.optional_synonyms) if c]

        # Level 1 — strict: top doctrine phrase ANDD a key term. IK has flat operators
        # (ANDD/ORR/NOTT) and does NOT support parentheses/grouping, so we keep it flat.
        if phrases:
            strict_terms = phrases[:1] + [m for m in must_haves if m not in phrases][:1]
        elif len(must_haves) >= 2:
            strict_terms = must_haves[:2]
        elif must_haves:
            strict_terms = must_haves[:1]
        else:
            strict_terms = synonyms[:2]
        strict_terms = list(dict.fromkeys(strict_terms))
        if strict_terms:
            # If the issue names a recognized court, the strict query becomes a
            # court-filtered query (REPLACEMENT, not an extra) so the count stays controlled.
            court_doctype = _resolve_court_doctype(getattr(issue, "preferred_courts", None))
            if court_doctype:
                issue_queries.append(_row(
                    issue.issue_id, f"Q{counter}", "court_filtered",
                    " ANDD ".join(strict_terms), strict_terms, doctypes=court_doctype,
                ))
            else:
                issue_queries.append(_row(
                    issue.issue_id, f"Q{counter}", "strict",
                    " ANDD ".join(strict_terms), strict_terms,
                ))
            counter += 1

        # Level 2 — doctrine/statute anchored (all courts). Anchor on a *different*
        # doctrine phrase than the strict query when available, so the two initial
        # queries cover two distinct doctrines.
        if doctrines:
            anchor = phrases[1:2] or phrases[:1] or must_haves[:1]
            doc_terms = list(dict.fromkeys(doctrines[:1] + anchor))
            issue_queries.append(_row(
                issue.issue_id, f"Q{counter}", "doctrine",
                " ANDD ".join(doc_terms), doctrines[:1],
            ))
            counter += 1

        # Level 3 — broad fallback: OR the top two doctrines for maximum recall (no ANDD).
        # e.g. "natural justice" ORR "legitimate expectation". Semantic ranking then sorts.
        fallback_src = (
            [t for t in issue.phrase_terms if t and t.strip()]
            or [t for t in issue.must_have_terms if t and t.strip()]
            or [t for t in issue.optional_synonyms if t and t.strip()]
        )
        fb_terms = [c for c in (_clean_term(t) for t in fallback_src) if c][:2]
        if fb_terms:
            fb_input = " ORR ".join(fb_terms) if len(fb_terms) >= 2 else fb_terms[0]
            issue_queries.append(_row(
                issue.issue_id, f"Q{counter}", "broad_fallback",
                fb_input, fb_terms, is_fallback=True,
            ))
            counter += 1

        # Max 2 initial queries + 1 fallback per issue.
        initial = [q for q in issue_queries if not q.get("is_fallback")][:2]
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
