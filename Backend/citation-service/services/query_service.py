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
    # ── Land / tenancy / property doctrines (Phase 2) — so a land case translates to
    # real judgment phrases instead of borrowing tender doctrines.
    "forfeiture of land for non-utilisation": [
        "forfeiture of land",
        "non-utilisation",
        "breach of condition",
        "resumption of land",
        "non-user",
    ],
    "change of user": [
        "change of user",
        "conversion of land use",
        "non-agricultural use",
        "bona fide industrial use",
    ],
    "breach of condition of grant": [
        "breach of condition",
        "condition of grant",
        "violation of grant",
        "terms of the grant",
    ],
    "resumption of land": [
        "resumption of land",
        "re-entry",
        "forfeiture",
        "breach of condition",
    ],
}

# High-value landmark authorities to seed standalone landmark queries when the
# extractor did not surface any (CHECK 3: at least 1 Tata Cellular + 1 Motilal
# Padampat query for a tender case).
_DEFAULT_TENDER_LANDMARKS = ["Tata Cellular", "Motilal Padampat", "Reliance Energy"]

# Domain anchors — the most specific subject term is combined into precision
# queries so they target the case's actual field, not all of India (FAILURE 2).
# Ordered most-specific first. Land/tenancy/property terms lead (Phase 2) so a
# non-tender case gets a real anchor instead of an empty domain.
DOMAIN_ANCHORS = [
    # Land / tenancy / property
    "non-utilisation", "non-utilization", "change of user", "forfeiture",
    "resumption", "nazarana", "bona fide industrial", "tenancy",
    # Public-law / tender
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
    # Land / tenancy / property narrowing (Phase 2).
    if any(k in blob for k in ("forfeit", "non-utili", "non utili", "tenancy", "nazarana",
                               "change of user", "resumption", "lease", "grant", " land")):
        narrowing += ["forfeiture", "non-utilisation", "resumption", "breach of condition", "change of user"]
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


# ── FAILURE R3 — landmark "A v. B" cause-titles must be searched by TITLE, not as a
# verbatim body phrase (which returns 0 hits). We reduce the title to its distinctive
# party — the non-government side — and let ik_search wrap it in title:"...".
_CASE_SPLIT_RX = re.compile(r"\s+(?:v\.?|vs\.?|versus)\s+", re.IGNORECASE)
_GOV_PARTY_RX = re.compile(
    r"\b(state|union|govt|government|india|commissioner|collector|municipal|"
    r"corporation|authority|board|council|department|secretary|director|of|the)\b",
    re.IGNORECASE,
)
_CORP_SUFFIX_RX = re.compile(
    r"\b(ltd|pvt|private|limited|co|company|inc|llp|ors|anr|others|another|and)\b\.?",
    re.IGNORECASE,
)


def _clean_landmark_name(name: str) -> str:
    """Reduce a landmark cause-title to a short, distinctive name for a title: search.

      "State of Maharashtra v. Laxmanrao"    -> "Laxmanrao"
      "Tata Cellular Ltd. v. Union of India" -> "Tata Cellular"
      "Maneka Gandhi"                        -> "Maneka Gandhi"
    Returns "" when nothing distinctive survives (caller then skips the landmark).
    """
    raw = (name or "").strip().strip('"')
    if not raw:
        return ""
    parts = [p for p in _CASE_SPLIT_RX.split(raw) if p.strip()]
    if len(parts) >= 2:
        # Prefer the side with the fewest government/generic tokens (the distinctive party).
        parts.sort(key=lambda s: (len(_GOV_PARTY_RX.findall(s)), len(s.split())))
        candidate = parts[0]
    else:
        candidate = raw
    candidate = _CORP_SUFFIX_RX.sub(" ", candidate)
    candidate = re.sub(r"\s+", " ", candidate).strip(" .,&")
    return " ".join(candidate.split()[:4]).strip()


# Execution priority by query type (1 = highest = runs/protected first). FAILURE 1:
# doctrine/precision queries must never be starved by opponent/fallback queries.
# Protected band (retrieve_candidates) = priority <= 2 (precision/doctrine + landmark + strict).
QUERY_PRIORITY = {
    "doctrine": 1,        # Tier 1 — doctrine/precision (real phrase + one short anchor)
    "outcome": 2,         # Tier 2 — fact + favourable relief word (finds cases the client won)
    "landmark": 2,        # Tier 2 — landmark authority (title search)
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
         priority: int | None = None, case_name_search: bool = False) -> dict:
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
        # When True, retrieve_candidates routes this through IK's title:"..." path
        # (a bare case-name lookup) instead of a full-text formInput search (R3).
        "case_name_search": case_name_search,
    }


def _short(term: str, max_words: int = 4) -> str:
    """Trim a term to <= max_words (IK phrases must be < 5 words)."""
    return " ".join((term or "").split()[:max_words]).strip()


def _fact_terms(issue: IssueCard) -> list[str]:
    """This case's OWN salient short fact phrases — the grounding for precision/recall
    queries (Phase 2). Prefers AI-provided fact_terms, else derives from must_have_terms
    and short, non-label phrase_terms so a precision query is 'doctrine ANDD <fact>',
    never 'doctrine ANDD quashed'."""
    explicit = [_short(t) for t in (getattr(issue, "fact_terms", None) or []) if t and t.strip()]
    if explicit:
        return list(dict.fromkeys([t for t in explicit if t]))[:6]
    derived: list[str] = []
    for t in (issue.must_have_terms or []):
        if t and t.strip() and not is_doctrine_label(t):
            derived.append(_short(t))
    for p in (issue.phrase_terms or []):
        if p and p.strip() and not is_doctrine_label(p) and len(p.split()) <= 4:
            derived.append(_short(p))
    return list(dict.fromkeys([t for t in derived if t]))[:6]


def _validate_recipe(raw: str) -> str:
    """Validate/normalise an AI-authored flat IK query string. Returns '' if unusable.

    Hard rules: NO parentheses; NEVER mix ANDD and ORR in one string (the engine is flat
    — nesting is impossible); each phrase <= 4 words; strip doctrine-label junk; >= 1 term.
    """
    s = (raw or "").strip()
    if not s or "(" in s or ")" in s:
        return ""
    has_and = " ANDD " in s
    has_or = " ORR " in s
    if has_and and has_or:
        return ""  # flat engine cannot nest/mix operators
    op = " ANDD " if has_and else (" ORR " if has_or else "")
    parts = re.split(r"\s+(?:ANDD|ORR)\s+", s) if op else [s]
    cleaned: list[str] = []
    for p in parts:
        t = p.strip().strip('"').strip()
        if not t:
            continue
        if is_doctrine_label(t):  # contains parenthetical/label junk or > 5 words
            t = " ".join(t.split()[:4])
        c = _clean_term(_short(t))
        if c:
            cleaned.append(c)
    cleaned = list(dict.fromkeys(cleaned))
    if not cleaned:
        return ""
    if len(cleaned) == 1:
        return cleaned[0]
    return (op or " ANDD ").join(cleaned)


def _single_word_anchor(pool: list[str], exclude_low: str) -> str:
    """First SINGLE-WORD term in pool. ANDD-ing two rare multi-word phrases returns ~0
    hits on Indian Kanoon (a doc must contain BOTH), so a precision query pairs the rare
    phrase with ONE common keyword instead. Returns '' if no single word is available."""
    for t in pool:
        t = (t or "").strip()
        if t and len(t.split()) == 1 and t.lower() != exclude_low:
            return t
    return ""


def _outcome_terms(issue: IssueCard) -> list[str]:
    """Relief/result words a FAVOURABLE judgment uses. Drives outcome queries that
    actually retrieve cases the client-type WON, so the Recommended bucket is not empty."""
    explicit = [_short(t, 3) for t in (getattr(issue, "outcome_terms", None) or []) if t and t.strip()]
    return (list(dict.fromkeys([t for t in explicit if t])) or ["set aside", "quashed", "allowed"])[:3]


_STATUTE_RX = re.compile(r"(section|article)\s+([0-9][0-9A-Za-z\-]*)", re.IGNORECASE)


def _statute_token(statute: str) -> str:
    """A SHORT searchable statute token ("section 63-1A", "article 226") — IK won't match
    a full citation like "Section 63-1A of the Maharashtra Tenancy and Agricultural Lands
    Act 1948" combined with other terms (returns ~0)."""
    m = _STATUTE_RX.search(statute or "")
    if m:
        return f"{m.group(1).lower()} {m.group(2).rstrip('-')}".strip()
    return _short(_CONSTITUTION_SUFFIX_RX.sub("", statute or ""), 3)


def _precision_terms(phrase: str, must_haves: list[str], domain: str, fact_terms: list[str]) -> list[str]:
    """Ground a doctrine/precision phrase with ONE short anchor — e.g.
    'bona fide industrial use' ANDD tenancy — NOT two rare phrases ANDD'd together
    (which returns ~0 hits). Prefers a single-word keyword; NEVER falls back to a bare
    relief word like 'quashed' (the old ungrounded failure). Returns [phrase] (which the
    caller drops) only when no usable anchor exists."""
    low = phrase.lower()
    anchor = _single_word_anchor(list(must_haves) + ([domain] if domain else []) + list(fact_terms), low)
    if not anchor:
        # No single word — accept one short fact phrase / the domain (still just 2 terms).
        for a in (list(fact_terms) + ([domain] if domain else [])):
            if a and a.lower() != low:
                anchor = a
                break
    return [phrase, anchor] if anchor else [phrase]


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
        fact_terms = _fact_terms(issue)  # this case's OWN facts — the grounding (Phase 2)
        must_haves = [t for t in (issue.must_have_terms or []) if t and t.strip()]

        def _add(qtype: str, terms: list[str], *, doctypes: str = DEFAULT_DOCTYPE,
                 is_fallback: bool = False, expected: list[str] | None = None,
                 priority: int | None = None, case_name_search: bool = False) -> bool:
            nonlocal counter
            # Case-name (title) search: a single bare name, no ANDD join, routed to
            # IK's title:"..." path by retrieve_candidates (R3). The >=2-term rule
            # below does NOT apply — a title lookup is intentionally one term.
            if case_name_search:
                name = next((t.strip() for t in terms if t and t.strip()), "")
                if not name:
                    return False
                key = f"casename::{name.lower()}"
                if key in seen_inputs:
                    return False
                seen_inputs.add(key)
                issue_queries.append(_row(
                    issue.issue_id, f"Q{counter}", qtype, name,
                    expected or [name], doctypes=doctypes, priority=priority,
                    case_name_search=True,
                ))
                counter += 1
                return True
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

        def _add_recipe(form_input: str, *, is_fallback: bool, qtype: str) -> bool:
            """Append a pre-built (already-validated) flat IK query string verbatim."""
            nonlocal counter
            key = f"{DEFAULT_DOCTYPE}::{form_input.lower()}"
            if not form_input or key in seen_inputs:
                return False
            seen_inputs.add(key)
            issue_queries.append(_row(
                issue.issue_id, f"Q{counter}", qtype, form_input, [form_input],
                is_fallback=is_fallback,
            ))
            counter += 1
            return True

        # ── Phase 2 — AI-AUTHORED, fact-grounded query recipes first (each validated for
        # flat-operator safety: no parentheses, never ANDD+ORR mixed, phrases < 5 words).
        # The deterministic builder below still runs so an issue is never under-covered if
        # the model emits few/no recipes ("never worse than today").
        recipes_precision = 0
        recipes_recall = 0
        for recipe in (getattr(issue, "ai_query_recipes", None) or []):
            if not isinstance(recipe, dict):
                continue
            kind = str(recipe.get("kind") or "precision").lower()
            raw_q = str(recipe.get("q") or "")
            if kind == "landmark":
                clean = _clean_landmark_name(raw_q)
                if clean:
                    _add("landmark", [clean], expected=[clean], case_name_search=True)
                continue
            form_input = _validate_recipe(raw_q)
            if not form_input:
                continue
            is_recall = " ORR " in form_input
            if _add_recipe(form_input, is_fallback=is_recall,
                           qtype="broad_fallback" if is_recall else "doctrine"):
                if is_recall:
                    recipes_recall += 1
                else:
                    recipes_precision += 1

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

        # Core fact-pattern query terms = the lead phrase + ONE short anchor (2 terms).
        # A 3-term ANDD of rare phrases returns ~0 hits; 2 terms keeps the strict / SC /
        # court queries precise but recall-rich (the reranker sorts the wider pool).
        core_terms = list(dict.fromkeys(strict_terms))
        if len(core_terms) < 2:
            _ca = _single_word_anchor(must_haves + ([domain] if domain else []) + fact_terms,
                                      (core_terms[0].lower() if core_terms else ""))
            if _ca:
                core_terms.append(_ca)
        core_terms = core_terms[:2]

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
            if emitted_precision >= max(1, 3 - recipes_precision):  # 2-3 precision incl. AI recipes
                break
            terms = _precision_terms(ph, must_haves, domain, fact_terms)
            if _add("doctrine", terms, expected=[ph]):
                emitted_precision += 1
                rid_terms.append(ph)
                if is_doctrine_label(original):
                    logger.info('[JURINEX][QUERY_GEN] issue=%s phrase="%s" is_doctrine_label=True '
                                '→ using_actual_phrase="%s"', issue.issue_id, original, ph)

        # ── Tier 2 — LANDMARK authority queries (priority 2), searched by TITLE (R3).
        # A landmark "A v. B" is matched against the case TITLE via its distinctive party
        # name, never as a verbatim full-text phrase (which returns 0 hits).
        landmark_pool = landmarks[:2] or (_DEFAULT_TENDER_LANDMARKS[:2] if domain in {"tender", "e-tender", "procurement", "blacklisting", "auction"} else [])
        for name in landmark_pool:
            clean = _clean_landmark_name(name)
            if clean:
                _add("landmark", [clean], expected=[name], case_name_search=True)

        # ── Tier 2 — STRICT fact-pattern query (priority 2).
        _add("strict", core_terms)

        # ── Tier 2 — FAVOURABLE-OUTCOME queries (priority 2): <subject> ANDD <relief word>
        # e.g. forfeiture ANDD "set aside". These retrieve cases the client-type actually
        # WON, so the Recommended bucket is not empty (the run that found only adverse
        # authority had NO outcome-oriented query). The reranker/scorer sort the result.
        outcome_anchor = _single_word_anchor(must_haves + ([domain] if domain else []) + fact_terms, "") or domain
        if outcome_anchor:
            for _ow in _outcome_terms(issue)[:2]:
                _add("outcome", [outcome_anchor, _ow], expected=[outcome_anchor, _ow])

        # ── Tier 3 — SUPREME COURT (additive doctypes=supremecourt, priority 3).
        _add("supreme_court", core_terms, doctypes=SUPREME_COURT_DOCTYPE)

        # ── Tier 3 — STATUTE-combined precision (priority 3): SHORT statute token + ONE
        # fact anchor (2 terms). A full citation ANDD'd with other terms returns ~0 hits.
        statutes = [s for s in (issue.statutes or []) if s and s.strip()]
        if statutes:
            token = _statute_token(statutes[0])
            s_anchor = _single_word_anchor(must_haves + ([domain] if domain else []) + fact_terms,
                                           token.lower()) or domain
            if token and s_anchor:
                _add("statute_combined", [token, s_anchor], expected=[token, s_anchor])

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

        # ── Tier 5 — BROAD FALLBACK = fact-grounded ORR recall query (R4): synonyms of the
        # case's OWN facts, OR'd — grounded recall, not a doctrine across all of India.
        # Skipped when an AI recall recipe already covered this issue.
        if recipes_recall == 0:
            recall_src = (
                fact_terms
                or [_resolve_phrase(t) for t in phrases_raw]
                or [_resolve_phrase(t) for t in doctrines_raw]
                or [t for t in issue.must_have_terms if t and t.strip()]
            )
            fb_terms = [t for t in recall_src if t][:3]
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

        # Doctrine/precision (priority 1) is the most important — keep it FIRST so the
        # diversity queries (landmark/outcome/SC/court/opponent) never starve it.
        structural = (_take("doctrine", 3) + _take("outcome", 1) + _take("landmark", 2)
                      + _take("strict", 1) + _take("supreme_court", 1)
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
