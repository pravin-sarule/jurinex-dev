"""
agents/landmark_seeds.py

Landmark seed judgments for common Indian criminal litigation patterns.
These are fetched directly by IK tid, bypassing keyword search entirely.
Add new seeds here as lawyers confirm judgment quality.

HOW TO FIND A TID:
  Search the case title on indiankanoon.org
  The tid is the number in the URL: indiankanoon.org/doc/{tid}/
  Always verify the tid is correct before adding it here.
"""

from __future__ import annotations
import logging
import re
from typing import Any

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# SEED REGISTRY
# Each entry: tid (str), title, citation, court, year, why_relevant
# why_relevant = one sentence: what the holding says and why it applies
# ---------------------------------------------------------------------------

SEEDS: dict[str, list[dict]] = {

    "fir_quashing_commercial": [
        {
            "tid": "257876",
            "title": "R. Kalyani v. Janak C. Mehta and Ors.",
            "citation": "(2009) 1 SCC 516",
            "court": "Supreme Court of India",
            "year": 2009,
            "why_relevant": (
                "SC held courts must examine whether FIR prima facie discloses "
                "cognisable offence; FIR in civil/commercial dispute can be quashed "
                "under section 482 CrPC to prevent abuse of process."
            ),
        },
        {
            "tid": "1233",
            "title": "Indian Oil Corporation Ltd. v. NEPC India Ltd. and Ors.",
            "citation": "(2006) 6 SCC 736",
            "court": "Supreme Court of India",
            "year": 2006,
            "why_relevant": (
                "SC: criminal proceedings initiated in a commercial dispute amounts "
                "to abuse of process; section 482 CrPC quashing warranted when "
                "dispute is civil in nature dressed as criminal."
            ),
        },
        {
            "tid": "81340",
            "title": "Hridaya Ranjan Prasad Verma v. State of Bihar",
            "citation": "(2000) 4 SCC 168",
            "court": "Supreme Court of India",
            "year": 2000,
            "why_relevant": (
                "SC held mens rea of cheating under IPC 420 must exist at time of "
                "making promise; subsequent default or failure to repay does not "
                "retrospectively create criminal intent."
            ),
        },
        {
            "tid": "1509590",
            "title": "Vesa Holdings Pvt. Ltd. v. State of Kerala",
            "citation": "(2015) 8 SCC 293",
            "court": "Supreme Court of India",
            "year": 2015,
            "why_relevant": (
                "SC: civil liability cannot be converted into criminal liability; "
                "FIR quashed where commercial transaction underlying alleged cheating "
                "is contractual dispute with no criminal element."
            ),
        },
        {
            "tid": "647531",
            "title": "Sushil Suri v. CBI and Anr.",
            "citation": "(2011) 5 SCC 708",
            "court": "Supreme Court of India",
            "year": 2011,
            "why_relevant": (
                "SC exercised section 482 CrPC inherent power to quash FIR in "
                "civil/commercial dispute; reiterated that criminal courts should "
                "not be used as instrument of harassment."
            ),
        },
        {
            "tid": "338163",
            "title": "Paramjeet Batra v. State of Uttarakhand",
            "citation": "(2012) 11 SCC 673",
            "court": "Supreme Court of India",
            "year": 2012,
            "why_relevant": (
                "SC on quashing FIR involving IPC 467/468 forgery charges arising "
                "from commercial context; court can quash at FIR stage to prevent "
                "abuse where dispute is civil."
            ),
        },
    ],

    "fir_quashing_ni_act": [
        {
            "tid": "1382608",
            "title": "Meters and Instruments Pvt. Ltd. v. Kanchan Mehta",
            "citation": "(2018) 1 SCC 560",
            "court": "Supreme Court of India",
            "year": 2017,
            "why_relevant": (
                "SC on overlap between NI Act 138 proceedings and IPC 420 cheating; "
                "when cheque dishonour case exists both cannot run simultaneously "
                "if facts are identical; NI Act remedy preferred."
            ),
        },
        {
            "tid": "907512",
            "title": "Macquarie Bank Ltd. v. Shilpi Cable Technologies",
            "citation": "(2018) 2 SCC 674",
            "court": "Supreme Court of India",
            "year": 2018,
            "why_relevant": (
                "SC: NI Act 138 is a civil remedy with criminal trappings; "
                "adding IPC cheating charges on same cheque facts is prosecutorial "
                "overreach and abuse of process."
            ),
        },
    ],

    "cheating_mens_rea": [
        {
            "tid": "1198480",
            "title": "Urmila Devi v. Deity, Mandir Shree Chamunda",
            "citation": "(2017) 10 SCC 804",
            "court": "Supreme Court of India",
            "year": 2017,
            "why_relevant": (
                "SC: for IPC 420 cheating, deceptive intent must be present "
                "at inception of transaction; knowledge that document is forged "
                "is essential element of IPC 467/468."
            ),
        },
        {
            "tid": "1639530",
            "title": "Fiona Shrikhande v. State of Maharashtra",
            "citation": "(2013) 14 SCC 44",
            "court": "Supreme Court of India",
            "year": 2013,
            "why_relevant": (
                "SC distinguished cheating from civil breach of trust; held that "
                "mere breach of promise without pre-existing dishonest intent "
                "does not constitute cheating under IPC 420."
            ),
        },
    ],

    "section_482_crpc_scope": [
        {
            "tid": "455468",
            "title": "State of Haryana v. Bhajan Lal",
            "citation": "1992 Supp (1) SCC 335",
            "court": "Supreme Court of India",
            "year": 1992,
            "why_relevant": (
                "Landmark SC judgment laying down 7 categories of cases where "
                "FIR should be quashed under section 482 CrPC including cases "
                "where allegations do not disclose cognisable offence."
            ),
        },
        {
            "tid": "1823",
            "title": "Zandu Pharmaceutical Works Ltd. v. Mohd. Sharaful Haque",
            "citation": "(2005) 1 SCC 122",
            "court": "Supreme Court of India",
            "year": 2005,
            "why_relevant": (
                "SC on section 482 CrPC scope: inherent power must be used "
                "sparingly but court has duty to prevent abuse of criminal process "
                "where FIR is manifestly frivolous."
            ),
        },
    ],

    "forgery_ipc_467_468": [
        {
            "tid": "1893456",
            "title": "Inder Mohan Goswami v. State of Uttarakhand",
            "citation": "(2007) 12 SCC 1",
            "court": "Supreme Court of India",
            "year": 2007,
            "why_relevant": (
                "SC on quashing FIR for IPC 467/468 forgery; held that document "
                "must be shown to be forged and accused must have knowledge; "
                "mere civil dispute cannot attract forgery charges."
            ),
        },
    ],
}

# ---------------------------------------------------------------------------
# DISPUTE TYPE ROUTER
# Maps from controversy_map.dispute_type → which seed categories to pull
# ---------------------------------------------------------------------------

DISPUTE_TYPE_ROUTER: dict[str, list[str]] = {
    "fir_quashing":           ["fir_quashing_commercial", "section_482_crpc_scope"],
    "civil_criminal_overlap": ["fir_quashing_commercial", "cheating_mens_rea"],
    "cheating_forgery":       ["cheating_mens_rea", "forgery_ipc_467_468", "fir_quashing_commercial"],
    "fir_quashing_ni_act":    ["fir_quashing_ni_act", "fir_quashing_commercial"],
    "other":                  ["section_482_crpc_scope"],
}

# ---------------------------------------------------------------------------
# STATUTE SIGNAL DETECTOR
# If these strings appear in applicable_statutes or query, add extra seeds
# ---------------------------------------------------------------------------

STATUTE_SIGNALS: list[tuple[list[str], str]] = [
    (["138", "NI Act", "Negotiable Instruments", "cheque"], "fir_quashing_ni_act"),
    (["467", "468", "forgery"],                             "forgery_ipc_467_468"),
    (["482", "quash"],                                      "section_482_crpc_scope"),
    (["420", "cheating", "mens rea"],                       "cheating_mens_rea"),
]


def get_seeds_for_case(
    dispute_type: str,
    applicable_statutes: list[str],
    raw_query: str = "",
) -> list[dict]:
    """
    Return seed judgment dicts for this case.
    Seeds are deduplicated by tid.
    """
    categories: list[str] = list(
        DISPUTE_TYPE_ROUTER.get(dispute_type, DISPUTE_TYPE_ROUTER["other"])
    )

    # Add extra categories based on statute signals
    combined_text = " ".join(applicable_statutes) + " " + raw_query
    for signals, category in STATUTE_SIGNALS:
        if any(s.lower() in combined_text.lower() for s in signals):
            if category not in categories:
                categories.append(category)

    # Collect and deduplicate
    seen: set[str] = set()
    seeds: list[dict] = []
    for category in categories:
        for seed in SEEDS.get(category, []):
            if seed["tid"] not in seen:
                seen.add(seed["tid"])
                seeds.append(seed)

    logger.info(
        "[SEEDS] dispute_type='%s' → categories=%s → %d seeds selected",
        dispute_type, categories, len(seeds),
    )
    return seeds


def infer_dispute_type_from_query(query: str, statutes: list[str]) -> str:
    """
    Fallback: infer dispute_type from raw query string if controversy_map
    has not been built yet.
    """
    q = query.lower()
    s = " ".join(statutes).lower()
    combined = q + " " + s

    if "482" in combined and ("420" in combined or "467" in combined):
        if "138" in combined or "ni act" in combined or "cheque" in combined:
            return "fir_quashing_ni_act"
        return "fir_quashing"
    if "420" in combined and ("civil" in combined or "commercial" in combined):
        return "civil_criminal_overlap"
    if "467" in combined or "468" in combined or "forgery" in combined:
        return "cheating_forgery"
    if "482" in combined or "quash" in combined:
        return "fir_quashing"
    return "other"
