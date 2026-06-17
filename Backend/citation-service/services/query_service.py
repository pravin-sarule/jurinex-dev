import logging
import re

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


# ── FAILURE 1 — doctrine LABELS → ACTUAL judgment phrases ────────────────────────
# The issue-extraction AI tends to emit doctrine *descriptions* ("Article 14
# arbitrariness (Tata Cellular line)") which never appear verbatim in any judgment,
# so the IK searches returned 0 hits. This mapping turns each doctrine into the
# phrases courts actually use. Keys are matched leniently (see _doctrine_phrases).
DOCTRINE_TO_PHRASES = {
    "article 14 arbitrariness": [
        "arbitrary and capricious",
        "violates Article 14",
        "arbitrary exercise of power",
        "non-application of mind",
        "unreasonable and arbitrary",
    ],
    "tata cellular / judicial review of tender": [
        "Tata Cellular",
        "scope of judicial review",
        "limited scope of interference",
        "commercial decision of tender",
        "courts cannot sit in appeal",
    ],
    "wednesbury unreasonableness": [
        "Wednesbury",
        "so unreasonable that no reasonable authority",
        "irrationality",
        "unreasonableness",
    ],
    "substantial compliance": [
        "substantial compliance",
        "strict compliance",
        "essential condition",
        "ancillary condition",
        "directory condition",
        "mandatory condition",
    ],
    "legitimate expectation": [
        "legitimate expectation",
        "reasonable expectation",
        "expectation created",
        "representation acted upon",
    ],
    "promissory estoppel against state": [
        "promissory estoppel",
        "Motilal Padampat",
        "cannot resile from",
        "representation made",
        "detrimental reliance",
    ],
    "authority cannot benefit from own wrong": [
        "own wrong",
        "advantage of its default",
        "benefit from its failure",
        "cannot take advantage",
        "own default",
    ],
    "level playing field": [
        "level playing field",
        "equal treatment",
        "discriminatory treatment",
        "unequal treatment",
        "selective compliance",
    ],
    "natural justice": [
        "natural justice",
        "audi alteram partem",
        "opportunity of hearing",
        "principles of fairness",
        "right to be heard",
    ],
    "non-speaking order": [
        "speaking order",
        "reasoned order",
        "non-speaking",
        "cryptic order",
        "without assigning reasons",
    ],
}

# High-value landmark authorities to seed standalone landmark queries when the
# extractor did not surface any (CHECK 3: at least 1 Tata Cellular + 1 Motilal
# Padampat query for a tender case).
_DEFAULT_TENDER_LANDMARKS = ["Tata Cellular", "Motilal Padampat", "Reliance Energy"]

# Domain anchors — the most specific subject term is combined into precision
# queries so they target the case's actual field, not all of India (FAILURE 2).
# Ordered most-specific first.
DOMAIN_ANCHORS = [
    "blacklisting", "e-tender", "tender", "procurement", "auction",
    "allotment", "lease", "land acquisition", "promotion", "seniority",
    "termination", "dismissal", "pension", "gratuity", "reservation",
    "admission", "licence", "license",
]

_CONSTITUTION_SUFFIX_RX = re.compile(r"\s+of\s+the\s+constitution(\s+of\s+india)?\s*$", re.IGNORECASE)


def is_doctrine_label(phrase: str) -> bool:
    """Detect a doctrine DESCRIPTION (a lawyer's label) rather than a judgment phrase.

    Such labels — with parentheses, slashes, 'line)' descriptions, or >5 words —
    never occur verbatim in judgments and must be translated before searching IK.
    """
    p = (phrase or "").strip()
    if not p:
        return False
    low = p.lower()
    word_count = len(p.split())
    return any((
        "(" in p or ")" in p,
        "/" in p,
        " line)" in low,
        "wednesbury" in low and word_count > 2,
        "oral/written" in low,
        " vs " in low and word_count > 4,
        word_count > 5,  # IK phrases must be < 5 words
    ))


def clean_doctrine_name(label: str) -> str:
    """Strip parenthetical descriptions / slash-tails so a label can be looked up."""
    cleaned = re.sub(r"\(.*?\)", "", label or "")
    cleaned = re.sub(r"/.*", "", cleaned)
    return cleaned.strip().lower()


def _doctrine_phrases(label: str) -> list[str]:
    """Return the ACTUAL judgment phrases for a doctrine label.

    Lookup order: exact cleaned key → key/phrase substring match → the cleaned
    label itself (only if it is already a short, usable phrase).
    """
    cleaned = clean_doctrine_name(label)
    if not cleaned:
        return []
    if cleaned in DOCTRINE_TO_PHRASES:
        return DOCTRINE_TO_PHRASES[cleaned]
    # Lenient match: the label shares wording with a known doctrine key or one of
    # its phrases (e.g. "authority cannot take advantage of its own wrong" →
    # "authority cannot benefit from own wrong" via the phrase "cannot take advantage").
    for key, phrases in DOCTRINE_TO_PHRASES.items():
        if key in cleaned or cleaned in key:
            return phrases
        if any(p.lower() in cleaned for p in phrases):
            return phrases
    # Not a known doctrine: keep it only if it is already a clean short phrase.
    if not is_doctrine_label(cleaned):
        return [cleaned]
    # Last resort: first 4 words, de-labelled.
    return [" ".join(cleaned.split()[:4])]


def _resolve_phrase(phrase: str) -> str:
    """A single searchable phrase: translate doctrine labels, pass real phrases through."""
    if is_doctrine_label(phrase):
        phrases = _doctrine_phrases(phrase)
        return phrases[0] if phrases else ""
    return (phrase or "").strip()


def _primary_domain(issue: IssueCard) -> str:
    """The most specific domain term for this issue (drives precision narrowing)."""
    haystack = " ".join([
        (issue.legal_issue or ""),
        " ".join(issue.must_have_terms or []),
        " ".join(issue.phrase_terms or []),
        " ".join(getattr(issue, "doctrines", None) or []),
    ]).lower()
    for anchor in DOMAIN_ANCHORS:
        if anchor in haystack:
            return anchor
    return ""


def get_narrowing_terms(issue: IssueCard) -> list[str]:
    """Domain-specific narrowing terms (FAILURE 2) keyed off the issue's must-haves.

    Returned UNQUOTED — _clean_term quotes multi-word phrases when the query is built.
    """
    narrowing: list[str] = []
    must_haves = " ".join(issue.must_have_terms or []).lower()
    legal = (issue.legal_issue or "").lower()
    blob = f"{must_haves} {legal}"

    if "experience" in blob or "certificate" in blob:
        narrowing += ["disqualification", "experience certificate", "work order"]
    if "turnover" in blob:
        narrowing += ["turnover certificate", "eligibility", "discrimination"]
    if "estoppel" in blob or "assurance" in blob or "oral" in blob or "delay" in blob:
        narrowing += ["oral assurance", "detrimental reliance", "cannot resile"]
    if "rejection" in blob or "reasons" in blob or "hearing" in blob:
        narrowing += ["opportunity of hearing", "speaking order", "reasoned order"]
    # Always-available relief narrowing.
    narrowing += ["quashed", "writ"]
    return list(dict.fromkeys(narrowing))[:6]


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
# doctrine/precision queries must never be starved by opponent/fallback queries.
# Protected band (retrieve_candidates) = priority <= 2 (precision/doctrine + landmark + strict).
QUERY_PRIORITY = {
    "doctrine": 1,        # Tier 1 — doctrine/precision (real phrase + narrowing + domain)
    "landmark": 2,        # Tier 2 — landmark authority + domain
    "strict": 2,          # core fact-pattern query
    "supreme_court": 3,
    "statute_combined": 3,
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


def _precision_terms(phrase: str, narrowing: list[str], domain: str, anchor: str) -> list[str]:
    """Combine a doctrine/precision phrase with a narrowing term and the domain so the
    query targets 3+ specific terms (FAILURE 2), never a single phrase across all India."""
    out = [phrase]
    low = phrase.lower()
    for n in narrowing:
        if n and n.lower() != low and n.lower() not in {o.lower() for o in out}:
            out.append(n)
            break
    if domain and domain.lower() != low and domain.lower() not in {o.lower() for o in out}:
        out.append(domain)
    if len(out) < 2 and anchor and anchor.lower() != low:
        out.append(anchor)
    return out[:3]


def generate_ik_queries(issues: list[IssueCard], custom_keywords: list[str] | None = None) -> list[dict]:
    generated: list[dict] = []
    counter = 1
    max_per_issue = settings.max_queries_per_issue

    for issue in issues[:5]:
        issue_queries: list[dict] = []
        seen_inputs: set[str] = set()
        rid_terms: list[str] = []  # for the QUERY_GEN log

        phrases_raw = [t for t in (issue.phrase_terms or []) if t and t.strip()]
        synonyms = [c for c in (_clean_term(t) for t in issue.optional_synonyms) if c]
        doctrines_raw = [t for t in (getattr(issue, "doctrines", None) or []) if t and t.strip()]
        opponent_raw = [t for t in (getattr(issue, "opponent_phrase_terms", None) or []) if t and t.strip()]
        landmarks = [t for t in (getattr(issue, "landmark_cases", None) or []) if t and t.strip()]

        domain = _primary_domain(issue)
        narrowing = get_narrowing_terms(issue)
        anchor_term = (issue.must_have_terms[:1] or phrases_raw[:1] or [""])[0]

        def _add(qtype: str, terms: list[str], *, doctypes: str = DEFAULT_DOCTYPE,
                 is_fallback: bool = False, expected: list[str] | None = None,
                 priority: int | None = None) -> bool:
            nonlocal counter
            cleaned = list(dict.fromkeys([_clean_term(t) for t in terms if t and t.strip()]))
            cleaned = [c for c in cleaned if c]
            # Non-fallback queries MUST combine >= 2 terms with ANDD (never a bare
            # single phrase across all of India — FAILURE 2 / existing test contract).
            if not is_fallback and len(cleaned) < 2:
                return False
            if not cleaned:
                return False
            form_input = (" ORR " if is_fallback and len(cleaned) >= 2 else " ANDD ").join(cleaned) \
                if len(cleaned) >= 2 else cleaned[0]
            key = f"{doctypes}::{form_input.lower()}"
            if key in seen_inputs:
                return False
            seen_inputs.add(key)
            issue_queries.append(_row(
                issue.issue_id, f"Q{counter}", qtype, form_input,
                expected or cleaned, is_fallback=is_fallback, doctypes=doctypes, priority=priority,
            ))
            counter += 1
            return True

        # Core fact-pattern terms reused for the strict / SC / court / statute queries.
        if phrases_raw:
            strict_terms = [_resolve_phrase(phrases_raw[0])] + (issue.must_have_terms[:1] or [])
        elif len(issue.must_have_terms) >= 2:
            strict_terms = issue.must_have_terms[:2]
        elif issue.must_have_terms:
            strict_terms = issue.must_have_terms[:1]
        else:
            strict_terms = [s for s in synonyms[:2]]
        strict_terms = [t for t in strict_terms if t]

        # Core fact-pattern query terms, widened to 3 (phrase + domain + a narrowing
        # term) so the strict / SC / court queries are precise multi-term combinations
        # (FAILURE 2 Rule 2), not a single phrase across all of India.
        core_terms = list(dict.fromkeys(strict_terms + ([domain] if domain else [])))
        for _n in narrowing:
            if len(core_terms) >= 3:
                break
            if _n.lower() not in {t.lower() for t in core_terms}:
                core_terms.append(_n)

        # ── Tier 1 — DOCTRINE / PRECISION (priority 1): real phrase + narrowing + domain.
        # Pool = doctrines first (translated to actual phrases), then top phrase_terms.
        precision_pool: list[tuple[str, str]] = []
        for d in doctrines_raw:
            ph = _resolve_phrase(d)
            if ph:
                precision_pool.append((ph, d))
        for p in phrases_raw:
            ph = _resolve_phrase(p)
            if ph:
                precision_pool.append((ph, p))
        seen_ph: set[str] = set()
        emitted_precision = 0
        for ph, original in precision_pool:
            if ph.lower() in seen_ph:
                continue
            seen_ph.add(ph.lower())
            if emitted_precision >= 3:  # Tier 1 = 2-3 precision queries
                break
            terms = _precision_terms(ph, narrowing, domain, anchor_term)
            if _add("doctrine", terms, expected=[ph]):
                emitted_precision += 1
                rid_terms.append(ph)
                if is_doctrine_label(original):
                    logger.info('[JURINEX][QUERY_GEN] issue=%s phrase="%s" is_doctrine_label=True '
                                '→ using_actual_phrase="%s"', issue.issue_id, original, ph)

        # ── Tier 2 — LANDMARK authority queries (priority 2). At least 2 per tender run.
        landmark_pool = landmarks[:2] or (_DEFAULT_TENDER_LANDMARKS[:2] if domain in {"tender", "e-tender", "procurement", "blacklisting", "auction"} else [])
        for name in landmark_pool:
            terms = [name] + ([domain] if domain else (issue.must_have_terms[:1] or []))
            _add("landmark", terms, expected=[name])

        # ── Tier 2 — STRICT fact-pattern query (priority 2).
        _add("strict", core_terms)

        # ── Tier 3 — SUPREME COURT (additive doctypes=supremecourt, priority 3).
        _add("supreme_court", core_terms, doctypes=SUPREME_COURT_DOCTYPE)

        # ── Tier 3 — STATUTE-combined precision (priority 3): phrase + statute + domain.
        statutes = [s for s in (issue.statutes or []) if s and s.strip()]
        if statutes and precision_pool:
            statute = _CONSTITUTION_SUFFIX_RX.sub("", statutes[0]).strip()
            base_phrase = precision_pool[0][0]
            _add("statute_combined", [base_phrase, statute] + ([domain] if domain else []),
                 expected=[base_phrase, statute])

        # ── Tier 4 — local HIGH COURT (or whichever court the issue names), priority 4.
        court_doctype = _resolve_court_doctype(getattr(issue, "preferred_courts", None))
        if court_doctype and court_doctype != SUPREME_COURT_DOCTYPE:
            _add("court_filtered", core_terms, doctypes=court_doctype)

        # ── Tier 4 — OPPONENT query (adverse authority for the opposition bundle), priority 5.
        if opponent_raw:
            opp = _resolve_phrase(opponent_raw[0])
            if opp:
                _add("opponent", [opp] + ([domain] if domain else (issue.must_have_terms[:1] or [])),
                     expected=[opp])

        # ── Tier 5 — BROAD FALLBACK (lowest; OR the top phrases for recall).
        fallback_src = (
            [_resolve_phrase(t) for t in phrases_raw]
            or [_resolve_phrase(t) for t in doctrines_raw]
            or [t for t in issue.must_have_terms if t and t.strip()]
        )
        fb_terms = [t for t in fallback_src if t][:2]
        _add("broad_fallback", fb_terms, is_fallback=True)

        # Cap initial queries at max_per_issue. Preserve STRUCTURAL DIVERSITY first
        # (≤2 landmark + strict + SC + court + opponent — each a distinct retrieval
        # angle the spec requires), then fill the remaining slots with the highest-
        # priority precision/doctrine/statute queries. Execution (retrieve_candidates)
        # still runs/protects by priority, so doctrine queries run first regardless.
        initial_all = [q for q in issue_queries if not q.get("is_fallback")]
        fallback = [q for q in issue_queries if q.get("is_fallback")][:1]

        def _take(qtype: str, n: int = 1) -> list:
            return [q for q in initial_all if q["query_type"] == qtype][:n]

        structural = (_take("landmark", 2) + _take("strict", 1) + _take("supreme_court", 1)
                      + _take("court_filtered", 1) + _take("opponent", 1))
        structural_ids = {id(q) for q in structural}
        fill = [q for q in initial_all if id(q) not in structural_ids]
        remaining = max(0, max_per_issue - len(structural))
        kept = structural + sorted(fill, key=lambda q: q["priority"])[:remaining]
        initial = sorted(kept, key=lambda q: q["priority"])
        generated.extend(initial + fallback)

        by_tier = {}
        for q in initial + fallback:
            by_tier[q["query_type"]] = by_tier.get(q["query_type"], 0) + 1
        logger.info("[JURINEX][QUERY_GEN] Generated %d queries for issue %s: %s",
                    len(initial + fallback), issue.issue_id, by_tier)

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
                         "priority": q["priority"], "formInput": q["formInput"], "is_fallback": q["is_fallback"]}
                        for q in generated],
        }},
    )
    return generated
