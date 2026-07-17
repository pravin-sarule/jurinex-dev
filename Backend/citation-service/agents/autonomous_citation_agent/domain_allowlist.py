"""
Authority Allowlist — Tiered domain list for the Citation Web Agent.

T1 — Primary / Official (citable):   *.gov.in, *.nic.in, official court portals
T2 — Recognized reporters (discover + verify):  indiankanoon.org, livelaw, barandbench, casemine
T3 — Secondary / persuasive (never the citation):  law commission, academic

Any URL whose host does not match any tier is dropped before it reaches the LLM.
"""
from __future__ import annotations

import json
import logging
import os
from typing import List, Optional, Tuple
from urllib.parse import urlparse

logger = logging.getLogger(__name__)

# Default T1 — official government / court portals
_DEFAULT_T1: List[str] = [
    "sci.gov.in",
    "main.sci.gov.in",
    "supremecourt.gov.in",
    "egazette.gov.in",
    "gazette.gov.in",
    "indiacode.nic.in",
    "legislative.gov.in",
    "prsindia.org",
    # eCourts / NJDG
    "ecourts.gov.in",
    "njdg.ecourts.gov.in",
    "judgments.ecourts.gov.in",
    # High Court official portals (*.nic.in or *.gov.in patterns covered by wildcard below)
    "bombayhighcourt.nic.in",
    "delhihighcourt.nic.in",
    "mphc.gov.in",
    "highcourtofkerala.nic.in",
    "hcraj.nic.in",
    "allahabad.nic.in",
    "calcuttahighcourt.gov.in",
    "hcmadras.tn.nic.in",
    "karnatakajudiciary.gov.in",
    "telangana.gov.in",
    "andhralawhighcourt.gov.in",
    "punjabhariyanahighcourt.gov.in",
    "hpshimla.nic.in",
    "gauhati.gov.in",
    "jharkhandhighcourt.gov.in",
    "chhattisgarhhighcourt.gov.in",
    "uttarakhandhighcourt.gov.in",
    "orissahighcourt.nic.in",
    "sikkim.nic.in",
    "meghalayahighcourt.nic.in",
    "manipurhighcourt.nic.in",
    "tripurahighcourt.nic.in",
    "jkhighcourt.nic.in",
]

# Wildcard suffixes for T1 (*.gov.in and *.nic.in are all T1 by default)
_DEFAULT_T1_WILDCARDS: List[str] = [".gov.in", ".nic.in", ".judiciary.gov.in"]

# Default T2 — recognized reporters / reputable legal media
_DEFAULT_T2: List[str] = [
    "indiankanoon.org",
    "livelaw.in",
    "barandbench.com",
    "casemine.com",
    "app.bharatlaw.ai",
    "lawfinderlive.com",
    "scconline.com",
    "manupatra.com",
    "lawoctopus.com",
]

# Default T3 — secondary / persuasive (never the citation)
_DEFAULT_T3: List[str] = [
    "lawcommissionofindia.nic.in",
    "ssrn.com",
    "lawreview.co.in",
    "judicialreforms.nic.in",
    "epw.in",
]


def _load_tier(env_key: str, default: List[str]) -> List[str]:
    """Load a tier's domain list from env JSON or use defaults."""
    raw = os.environ.get(env_key, "").strip()
    if raw:
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, list):
                return [str(d).strip().lower() for d in parsed if str(d).strip()]
        except Exception:
            logger.warning("[ALLOWLIST] Could not parse %s JSON; using defaults", env_key)
    return default


def _normalize_host(uri: str) -> str:
    """Extract and normalise the host from a URI string."""
    if not uri:
        return ""
    if not uri.startswith(("http://", "https://")):
        uri = "https://" + uri
    host = urlparse(uri).netloc.lower()
    if host.startswith("www."):
        host = host[4:]
    return host


class AuthorityAllowlist:
    """Thread-safe allowlist loaded once and reused."""

    def __init__(self):
        self._t1: List[str] = _load_tier("CITATION_WEB_ALLOWLIST_T1", _DEFAULT_T1)
        self._t1_wildcards: List[str] = _DEFAULT_T1_WILDCARDS
        self._t2: List[str] = _load_tier("CITATION_WEB_ALLOWLIST_T2", _DEFAULT_T2)
        self._t3: List[str] = _load_tier("CITATION_WEB_ALLOWLIST_T3", _DEFAULT_T3)
        self._enabled: bool = os.environ.get(
            "CITATION_WEB_ENABLED", "true"
        ).strip().lower() not in ("false", "0", "no", "off")
        logger.info(
            "[ALLOWLIST] Loaded — T1=%d domains (+wildcards), T2=%d, T3=%d, enabled=%s",
            len(self._t1), len(self._t2), len(self._t3), self._enabled,
        )

    @property
    def enabled(self) -> bool:
        return self._enabled

    def is_authorized(self, uri: str) -> Optional[str]:
        """
        Return 'T1', 'T2', 'T3', or None (not authorised).
        None means the URL must be dropped before reaching the LLM.
        """
        host = _normalize_host(uri)
        if not host:
            return None
        # T1 — exact
        if host in self._t1:
            return "T1"
        # T1 — wildcard (*.gov.in, *.nic.in)
        for suffix in self._t1_wildcards:
            if host.endswith(suffix):
                return "T1"
        # T2
        if host in self._t2 or any(host.endswith(f".{d}") for d in self._t2):
            return "T2"
        # T3
        if host in self._t3 or any(host.endswith(f".{d}") for d in self._t3):
            return "T3"
        return None

    def filter_results(
        self,
        results: List[Tuple[str, str, str]],   # (uri, title, snippet)
    ):
        """
        Filter a list of (uri, title, snippet) tuples.
        Returns dicts with authority_tier tagged; drops unauthorised URIs.
        Logs dropped count for audit.
        """
        from agents.autonomous_citation_agent.schema import SearchResult
        kept = []
        dropped = 0
        for uri, title, snippet in results:
            tier = self.is_authorized(uri)
            if tier is None:
                dropped += 1
                logger.debug("[ALLOWLIST] DROPPED (off-list): %s", uri[:80])
                continue
            kept.append(SearchResult(uri=uri, title=title, snippet=snippet, authority_tier=tier))
        if dropped:
            logger.info(
                "[ALLOWLIST] Dropped %d off-list URL(s) out of %d total",
                dropped, dropped + len(kept),
            )
        if kept:
            logger.info("[ALLOWLIST] Kept %d authorised URL(s)", len(kept))
        return kept


# Module-level singleton (lazy-init on first use)
_allowlist: Optional[AuthorityAllowlist] = None


def get_allowlist() -> AuthorityAllowlist:
    global _allowlist
    if _allowlist is None:
        _allowlist = AuthorityAllowlist()
    return _allowlist


def is_authorized(uri: str) -> Optional[str]:
    """Convenience wrapper — returns tier string or None."""
    return get_allowlist().is_authorized(uri)
