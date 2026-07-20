from __future__ import annotations

import logging
import re

from core.constants import STOP_WORDS
from models.issue_models import IssueCard
from models.run_models import CaseProfile
from utils.text import sentence_chunks, terms

logger = logging.getLogger(__name__)

# Case-caption / party / boilerplate tokens that must NEVER become search terms.
# These are the root cause of zero-candidate runs: searching Indian Kanoon for a
# party-name fragment like "shivasamb tondare the" returns nothing. The set also
# covers the cause-title / registry / cover-page vocabulary that dominates a
# document's first page (court name, bench city, "writ petition no.", "index").
_PARTY_NOISE = {
    "versus", "vs", "anr", "ors", "another", "others", "state", "union",
    "india", "appellant", "appellants", "respondent", "respondents",
    "petitioner", "petitioners", "applicant", "applicants", "complainant",
    "accused", "plaintiff", "defendant", "the", "thru", "through",
    "represented", "ltd", "limited", "pvt", "private", "company", "smt",
    "shri", "sri", "mrs", "messrs", "proprietor",
}
# Procedural / registry / cover-page words — present in almost every cause-title
# and never a substantive legal concept on their own.
_PROCEDURAL_NOISE = {
    "writ", "petition", "petitions", "appeal", "appeals", "revision", "suit",
    "application", "applications", "slp", "pil", "civil", "criminal", "original",
    "miscellaneous", "misc", "judicature", "bench", "coram", "honble", "honourable",
    "justice", "before", "dated", "order", "orders", "judgment", "judgement",
    "index", "registry", "diary", "filing", "serial", "annexure", "exhibit",
    "volume", "vol", "district", "dist", "taluka", "tehsil", "nos", "dic",
    "no", "and", "for", "between",
}
# High-Court bench cities and Indian states/UTs — pure noise inside a cause-title
# (court targeting is handled separately via preferred_courts → doctypes).
_PLACE_NOISE = {
    "supreme", "high", "bombay", "mumbai", "delhi", "madras", "chennai",
    "calcutta", "kolkata", "allahabad", "aurangabad", "nagpur", "jaipur",
    "jodhpur", "lucknow", "patna", "gauhati", "guwahati", "hyderabad",
    "bangalore", "bengaluru", "gandhinagar", "ahmedabad", "ernakulam",
    "maharashtra", "gujarat", "kerala", "karnataka", "rajasthan", "orissa",
    "odisha", "punjab", "haryana", "telangana", "andhra", "bihar", "jharkhand",
    "chhattisgarh", "uttarakhand", "himachal", "tripura", "manipur", "sikkim",
    "latur", "pune", "thane", "nashik",
}
_CAPTION_NOISE = _PARTY_NOISE | _PROCEDURAL_NOISE | _PLACE_NOISE

# Common English function words (pronouns, auxiliaries, connectives) that are not
# in the small core STOP_WORDS set but make for poor legal search terms/phrases —
# e.g. they turn "natural justice" into "challenges his" in the phrase miner.
_WEAK_WORDS = {
    "his", "her", "its", "our", "their", "your", "him", "them", "they", "she",
    "was", "were", "are", "had", "has", "have", "been", "will", "would", "shall",
    "should", "could", "may", "might", "must", "can", "did", "does", "done",
    "not", "but", "nor", "yet", "all", "any", "each", "few", "more", "most",
    "some", "such", "than", "too", "very", "who", "whom", "whose", "why", "how",
    "out", "off", "over", "then", "once", "here", "also", "only", "own", "same",
    "given", "made", "make", "upon", "said", "say", "per", "via", "etc", "him",
    "for", "nor", "are", "was", "him", "she", "you", "had", "has", "its",
}

_WORD_RE = re.compile(r"[a-zA-Z][a-zA-Z-]+")
_SENT_SPLIT_RE = re.compile(r"[.;:!?\n]+")
_CAPTION_RE = re.compile(r"\b(?:vs|v|versus)\b", re.I)


def _is_noise(word: str, noise: set[str]) -> bool:
    return word in noise or word in STOP_WORDS or word in _WEAK_WORDS


def _looks_like_caption(query: str) -> bool:
    """A 'X vs Y' style party caption — its tokens are party names, not legal terms."""
    return bool(_CAPTION_RE.search(query or ""))


def _legal_terms(text: str, noise: set[str], limit: int = 16) -> list[str]:
    """Salient single legal words from the document, excluding caption/party noise."""
    return [t for t in terms(text) if t not in noise and t not in _WEAK_WORDS][:limit]


def _legal_phrases(text: str, noise: set[str], limit: int = 6) -> list[str]:
    """
    Real multi-word legal phrases (e.g. 'natural justice', 'disciplinary enquiry')
    mined as the most frequent adjacent meaningful word pairs in the document.
    Used as quoted phrase searches — far more precise than concatenating random tokens.
    """
    counts: dict[str, int] = {}
    order: dict[str, int] = {}
    idx = 0
    # Form bigrams within sentence boundaries so phrases like "service contends"
    # (which span "...from service. He contends...") are never coined.
    for sentence in _SENT_SPLIT_RE.split(text or ""):
        words = [w for w in (m.lower() for m in _WORD_RE.findall(sentence)) if len(w) >= 3]
        for a, b in zip(words, words[1:]):
            idx += 1
            if _is_noise(a, noise) or _is_noise(b, noise):
                continue
            phrase = f"{a} {b}"
            counts[phrase] = counts.get(phrase, 0) + 1
            order.setdefault(phrase, idx)
    ranked = sorted(counts, key=lambda p: (-counts[p], order[p]))
    return ranked[:limit]


def assess_context(case_context: str) -> dict:
    """
    Judge whether the loaded document context is substantive or just a cover page /
    cause-title. A cause-title yields only registry/party tokens (no real legal
    vocabulary), so a low substantive-term count signals the full judgment text was
    never extracted upstream — the true cause of irrelevant or zero citations.
    """
    text = (case_context or "").strip()
    substantive = _legal_terms(text, _CAPTION_NOISE, limit=10_000)
    chars = len(text)
    cover_page_only = chars < 800 or len(substantive) < 5
    return {
        "chars": chars,
        "substantive_term_count": len(substantive),
        "substantive_terms_sample": substantive[:12],
        "cover_page_only": cover_page_only,
        "quality": "cover_page_or_thin" if cover_page_only else "ok",
    }


def has_research_signal(query: str, case_context: str) -> bool:
    """
    True when there is enough legal content to build meaningful IK queries.

    A bare 'X vs State' caption with no document content yields only party names —
    the pipeline must not generate (party-name) queries from it.
    """
    if (case_context or "").strip():
        return True
    if _looks_like_caption(query):
        return False
    return bool([t for t in terms(query) if t not in _CAPTION_NOISE])


def build_case_profile(query: str, case_context: str, perspective: str) -> CaseProfile:
    source = f"{query}\n{case_context}"
    statutes = list(dict.fromkeys(re.findall(r"\b(?:section|article|rule)\s+\d+[a-zA-Z-]*", source, re.I)))[:8]
    facts = sentence_chunks(case_context, 5)
    return CaseProfile(
        represented_side=perspective,
        opposite_side="opposite_party" if perspective != "neutral" else "neutral",
        relief_sought=query[:500],
        statutes=statutes,
        important_facts=facts,
    )


def build_issue_cards(
    query: str,
    profile: CaseProfile,
    perspective: str,
    case_context: str = "",
) -> list[IssueCard]:
    """
    Build issue cards whose search terms come from the DOCUMENT'S legal content,
    not from the case caption / party names.

    Previously every term was derived from `query` (typically "X vs State"), so the
    pipeline searched Indian Kanoon for party-name phrases and got zero results.
    """
    context = case_context or ""
    is_caption = _looks_like_caption(query)

    # When the query is a party caption, treat its tokens as noise so they never
    # leak into searches. When it's a genuine legal question, its tokens are valid.
    caption_noise = set(_CAPTION_NOISE)
    if is_caption:
        caption_noise |= set(terms(query))

    legal_terms = _legal_terms(context, caption_noise)
    legal_phrases = _legal_phrases(context, caption_noise)

    # Fold the query's own terms in only when it is not a party caption.
    if not is_caption:
        query_terms = [t for t in terms(query) if t not in _CAPTION_NOISE]
        legal_terms = list(dict.fromkeys(legal_terms + query_terms))

    # Last-resort term pool so we never emit empty cards (caption-only input with no
    # document content is short-circuited upstream in the orchestrator instead).
    if not legal_terms:
        legal_terms = terms(query)[:16]

    # Issue labels: prefer document sentences; fall back to splitting the query.
    raw_issues = [s.strip(" .:-") for s in profile.important_facts if len(s.strip()) > 24][:5]
    if not raw_issues:
        raw_issues = [part.strip(" .:-") for part in re.split(r"[;\n]|\band\b", query, flags=re.I) if len(part.strip()) > 12]
    issues = list(dict.fromkeys(raw_issues))[:5]
    while len(issues) < 3:
        suffix = ("applicable statutory interpretation", "procedural fairness and burden", "relief and precedent")[len(issues)]
        issues.append(f"{(query or 'legal issue')[:120]}: {suffix}")

    cards = []
    for index, issue in enumerate(issues[:5], 1):
        # Terms that actually appear in this issue rank first; otherwise the global pool.
        issue_words = set(terms(issue))
        issue_specific = [t for t in legal_terms if t in issue_words]
        must = (issue_specific + [t for t in legal_terms if t not in issue_specific])[:6]
        # Phrases sharing a word with this issue first, then the top document phrases.
        ranked_phrases = sorted(legal_phrases, key=lambda p, w=issue_words: (0 if w & set(p.split()) else 1))
        cards.append(IssueCard(
            issue_id=f"issue-{index}",
            legal_issue=issue,
            represented_side=perspective,
            favorable_position_for_selected_side=f"Authority favouring the {perspective}",
            likely_opposite_position=f"Authority opposing the {perspective}",
            statutes=profile.statutes,
            must_have_terms=must,
            phrase_terms=ranked_phrases[:2],
            optional_synonyms=legal_terms[:8],
            negative_terms=[],  # never seed negatives on the first pass — they only shrink recall
            preferred_courts=["Supreme Court", profile.court] if profile.court else ["Supreme Court", "High Court"],
            expected_citation_use="support or test the selected side's legal proposition",
        ))

    profile.legal_issues = [card.legal_issue for card in cards]
    logger.info(
        "Issue cards built",
        extra={"details": {
            "issues_count": len(cards),
            "is_caption_query": is_caption,
            "legal_terms_sample": legal_terms[:8],
            "legal_phrases_sample": legal_phrases[:4],
        }},
    )
    return cards
