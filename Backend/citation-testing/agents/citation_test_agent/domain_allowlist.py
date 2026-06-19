"""
Authority Allowlist — T1/T2/T3 domain tiers for Citation Testing Agent.
Copied from citation-service — same rules apply.
"""
from __future__ import annotations

import logging
import os
from typing import List, Optional, Tuple
from urllib.parse import urlparse

logger = logging.getLogger(__name__)

_T1 = [
    "sci.gov.in", "main.sci.gov.in", "supremecourt.gov.in",
    "egazette.gov.in", "gazette.gov.in", "indiacode.nic.in",
    "legislative.gov.in", "prsindia.org",
    "ecourts.gov.in", "njdg.ecourts.gov.in", "judgments.ecourts.gov.in",
    "bombayhighcourt.nic.in", "delhihighcourt.nic.in", "mphc.gov.in",
    "highcourtofkerala.nic.in", "hcraj.nic.in", "allahabad.nic.in",
    "calcuttahighcourt.gov.in", "hcmadras.tn.nic.in", "karnatakajudiciary.gov.in",
]
_T1_WILDCARDS = [".gov.in", ".nic.in", ".judiciary.gov.in"]

_T2 = [
    "indiankanoon.org",
    "casemine.com", "app.bharatlaw.ai", "lawfinderlive.com",
    "scconline.com", "manupatra.com",
    # livelaw.in and barandbench.com are news sites — accepted only for
    # judgment-specific URL paths (checked separately in _is_judgment_source)
]

_T3 = ["lawcommissionofindia.nic.in", "ssrn.com", "lawreview.co.in"]


def _norm(uri: str) -> str:
    if not uri:
        return ""
    if not uri.startswith(("http://", "https://")):
        uri = "https://" + uri
    h = urlparse(uri).netloc.lower()
    return h[4:] if h.startswith("www.") else h


def tier_of(uri: str) -> Optional[str]:
    h = _norm(uri)
    if not h:
        return None
    if h in _T1:
        return "T1"
    for sfx in _T1_WILDCARDS:
        if h.endswith(sfx):
            return "T1"
    if h in _T2 or any(h.endswith(f".{d}") for d in _T2):
        return "T2"
    if h in _T3 or any(h.endswith(f".{d}") for d in _T3):
        return "T3"
    return None


def filter_results(results: List[Tuple[str, str, str]]):
    """Filter (uri, title, snippet) tuples; return SearchResult list with tier tags."""
    from agents.citation_test_agent.schema import SearchResult
    kept = []
    for uri, title, snippet in results:
        tier = tier_of(uri)
        if tier is None:
            logger.debug("[ALLOWLIST] dropped off-list: %s", uri[:80])
            continue
        kept.append(SearchResult(uri=uri, title=title, snippet=snippet, authority_tier=tier))
    return kept
