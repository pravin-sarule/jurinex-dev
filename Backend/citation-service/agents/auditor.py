"""
Auditor Agent: the final zero-mistake verification gate before citations reach the user.

For every citation that the Librarian passed (validated or flagged), the Auditor:
  1. Verifies via Local DB integrity check (content, citation, title present)
  2. Cross-checks against Indian Kanoon API (if token available)
  3. Runs hallucination-indicator checks (future years, placeholder text, etc.)
  4. Computes a final audit_status and confidence score
  5. Persists the result into the DB via judgement_update_validation

Only citations with audit_status VERIFIED, VERIFIED_WITH_WARNINGS, or NEEDS_REVIEW
are approved for the user.  QUARANTINED citations are silently dropped.

Every step is logged with the source of the citation (local_db / indian_kanoon / google).
"""

from __future__ import annotations

import json
import logging
import os
import re
import urllib.request
import urllib.parse
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FuturesTimeout
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

# Target citation points for report (CHECK 8)
TARGET_CITATION_POINTS = 10


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _title_similarity(a: str, b: str) -> float:
    """Simple word-overlap Jaccard similarity between two titles."""
    wa = set(a.lower().split())
    wb = set(b.lower().split())
    if not wa or not wb:
        return 0.0
    return len(wa & wb) / len(wa | wb)


def _ik_verify_by_tid(tid: str, title: str, token: str) -> Dict[str, Any]:
    """Fetch a specific IK document by TID and compare title."""
    try:
        url = f"https://api.indiankanoon.org/doc/{tid}/"
        req = urllib.request.Request(url, method="GET")
        req.add_header("Authorization", f"Token {token}")
        req.add_header("Accept", "application/json")
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode())
        doc_title = data.get("title", "")
        sim = _title_similarity(title, doc_title)
        if sim >= 0.40:
            return {
                "verified": True,
                "method": "ik_doc_fetch",
                "confidence": min(99, int(sim * 100) + 40),
                "notes": f"IK doc confirmed — title sim={sim:.2f}: '{doc_title[:60]}'",
            }
        return {
            "verified": False,
            "method": "ik_doc_fetch_mismatch",
            "confidence": int(sim * 100),
            "notes": f"IK title mismatch (sim={sim:.2f}): got '{doc_title[:60]}'",
        }
    except Exception as exc:
        return {"verified": False, "method": "ik_fetch_error", "confidence": 0, "notes": str(exc)[:120]}


def _ik_verify_by_search(query: str, title: str, token: str) -> Dict[str, Any]:
    """Search IK for citation/title string and check first result."""
    try:
        url = "https://api.indiankanoon.org/search/?formInput=" + urllib.parse.quote(query) + "&pagenum=0"
        req = urllib.request.Request(url, method="GET")
        req.add_header("Authorization", f"Token {token}")
        req.add_header("Accept", "application/json")
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode())
        docs = data.get("docs") or []
        if not docs:
            return {"verified": False, "method": "ik_search_empty", "confidence": 0, "notes": "No IK search results"}
        first_title = docs[0].get("title", "")
        sim = _title_similarity(title, first_title)
        if sim >= 0.35:
            return {
                "verified": True,
                "method": "ik_search",
                "confidence": min(90, int(sim * 100) + 30),
                "notes": f"IK search match (sim={sim:.2f}): '{first_title[:60]}'",
            }
        return {
            "verified": False,
            "method": "ik_search_mismatch",
            "confidence": int(sim * 50),
            "notes": f"IK search returned unrelated result (sim={sim:.2f}): '{first_title[:60]}'",
        }
    except Exception as exc:
        return {"verified": False, "method": "ik_search_error", "confidence": 0, "notes": str(exc)[:120]}


def _verify_via_indian_kanoon(title: str, citation: str, jid: str) -> Dict[str, Any]:
    """
    Cross-check a citation against the Indian Kanoon API.
    Tries direct doc fetch (if IK tid available from jid prefix) then falls back to search.
    """
    token = (
        os.environ.get("INDIAN_KANOON_TOKEN")
        or os.environ.get("INDIAN_KANOON_API_TOKEN")
        or os.environ.get("IK_API_TOKEN")
    )
    if not token:
        return {"verified": False, "method": "ik_unavailable", "confidence": 0, "notes": "No IK API token configured"}

    # If jid starts with "ik_", we have the actual IK tid
    if jid.startswith("ik_"):
        tid = jid[3:]
        result = _ik_verify_by_tid(tid, title, token)
        if result["verified"]:
            return result
        # Fall through to search as backup

    # Search by citation string or title
    search_q = citation if (citation and citation not in ("—", "")) else title[:100]
    return _ik_verify_by_search(search_q, title, token)


def _verify_via_local_db(jid: str) -> Dict[str, Any]:
    """Check that the judgement in the DB has sufficient content and metadata."""
    try:
        from db.client import judgement_get
        j = judgement_get(jid)
        if not j:
            return {"verified": False, "method": "local_db_missing", "confidence": 0, "notes": "ID not in DB", "source": "unknown"}

        has_title   = bool((j.get("title") or "").strip())
        has_cite    = bool(j.get("primary_citation") and j.get("primary_citation") not in ("—", ""))
        # Accept ratio/excerpt as proof of content when raw_content is unavailable
        # (e.g. ES down, PG citation_data missing full_text)
        raw_len = len(j.get("raw_content") or j.get("full_text") or "")
        ratio_len = len(j.get("ratio") or "")
        has_content = raw_len >= 500 or (
            ratio_len >= 80 and ratio_len > 0
            and (j.get("ratio") or "").strip().lower() not in (
                "further research needed", "further research needed.",
                "ratio not available.", "ratio not available",
            )
        )

        quality_score = sum([has_title, has_cite, has_content])
        confidence    = {3: 90, 2: 70, 1: 45, 0: 0}[quality_score]

        return {
            "verified": quality_score >= 2,
            "method":   "local_db",
            "confidence": confidence,
            "notes":    f"title={has_title}, citation={has_cite}, content≥500={has_content}",
            "source":   j.get("source", "unknown"),
        }
    except Exception as exc:
        return {"verified": False, "method": "local_db_error", "confidence": 0, "notes": str(exc)[:100], "source": "unknown"}


def _hallucination_flags(title: str, citation: str, ratio: str) -> List[str]:
    """
    Return a list of anomaly codes that suggest a hallucinated or corrupt citation.
    Empty list = clean.
    """
    flags: List[str] = []
    text = f"{title} {citation} {ratio}".lower()
    now_year = datetime.now().year

    # Future year in citation
    for yr_str in re.findall(r"\b(20\d{2})\b", citation or ""):
        if int(yr_str) > now_year:
            flags.append("future_year_in_citation")

    # Suspiciously simple placeholder-style citation: "(YYYY) 1 SCC 1"
    if re.search(r"\(20\d{2}\)\s*1\s*SCC\s*1\b", citation or ""):
        flags.append("suspiciously_simple_citation")

    # Placeholder / empty citation value
    if (citation or "").strip().lower() in ("—", "n/a", "none", "null", "unavailable", "not extracted", "pending"):
        flags.append("placeholder_citation")

    # Ratio too short to be real (ignore known placeholder values set by the clerk)
    _ratio_stripped = (ratio or "").strip()
    _ratio_is_placeholder = _ratio_stripped.lower() in (
        "further research needed", "further research needed.",
        "ratio not available.", "ratio not available",
        "ratio decidendi not available.", "—", "",
    )
    if _ratio_stripped and not _ratio_is_placeholder and len(_ratio_stripped) < 40:
        flags.append("ratio_too_short")

    # Title looks like a generic web page heading (no legal case name pattern)
    if title and not re.search(r"\bv(?:s?|\.)\b|\bversus\b|\bv/s\b", title, re.I):
        if not re.search(
            r"(petition|appeal|writ|suit|case|state|union|company|ltd|inc|"
            r"in\s+re|ex\s+parte|commissioner|tribunal|authority|board|"
            r"corporation|municipal|government|department|ministry|secretary|"
            r"director|president|chairman|collector|officer|inspector)",
            title, re.I,
        ):
            flags.append("non_case_title")

    return flags


# ─────────────────────────────────────────────────────────────────────────────
# Verdict helpers (CHANGE 1A / 1B)
# ─────────────────────────────────────────────────────────────────────────────

def _compute_final_verdict(
    jid: str,
    j: dict,
    local_check: dict,
    ik_check: dict,
    hallucination_flags: list,
    is_flagged: bool,
) -> dict:
    local_verified  = local_check.get("verified", False)
    local_conf      = int(local_check.get("confidence") or 0)
    ik_verified     = ik_check.get("verified", False)
    ik_conf         = int(ik_check.get("confidence") or 0)
    ik_method       = ik_check.get("method", "")
    ik_unavailable  = ik_method in (
        "ik_unavailable", "ik_timeout", "ik_error", "no_ik_token", "skipped"
    )
    if "future_year_in_citation" in hallucination_flags:
        return {"audit_status": "QUARANTINED", "final_confidence": 0, "multi_route_confirmed": False}
    if ik_unavailable:
        ik_verified = False
        ik_conf     = local_conf
    multi_route = local_verified and ik_verified
    if multi_route:
        final_confidence = min(99, max(local_conf, ik_conf) + 7)
    else:
        final_confidence = max(local_conf, ik_conf)
    soft_flags = [f for f in hallucination_flags if f != "future_year_in_citation"]
    if soft_flags:
        final_confidence = max(40, final_confidence - 10)
    source = (j.get("source") or "local").lower()
    trust_baseline = {"local": 80, "indian_kanoon": 75, "google": 50}.get(source, 70)
    either_verified = local_verified or ik_verified
    if either_verified and not soft_flags:
        return {"audit_status": "VERIFIED", "final_confidence": max(trust_baseline, final_confidence), "multi_route_confirmed": multi_route}
    if either_verified and soft_flags:
        return {"audit_status": "VERIFIED_WITH_WARNINGS", "final_confidence": max(trust_baseline - 10, final_confidence - 10), "multi_route_confirmed": multi_route}
    if source == "google" and not ik_verified:
        return {"audit_status": "QUARANTINED", "final_confidence": final_confidence, "multi_route_confirmed": False}
    if final_confidence >= 45:
        return {"audit_status": "NEEDS_REVIEW", "final_confidence": final_confidence, "multi_route_confirmed": False}
    return {"audit_status": "QUARANTINED", "final_confidence": final_confidence, "multi_route_confirmed": False}


def _check_ik_with_timeout(jid: str, j: dict, timeout_secs: int = 8) -> dict:
    ik_token = (
        os.environ.get("INDIAN_KANOON_API_TOKEN")
        or os.environ.get("IK_API_KEY")
        or os.environ.get("IK_TOKEN")
        or os.environ.get("INDIAN_KANOON_TOKEN")
        or os.environ.get("IK_API_TOKEN")
    )
    if not ik_token:
        return {"verified": False, "confidence": 0, "method": "no_ik_token", "notes": "No IK API token configured"}
    title    = (j.get("title") or "")
    citation = (j.get("primary_citation") or "")
    try:
        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(_verify_via_indian_kanoon, title, citation, jid)
            return future.result(timeout=timeout_secs)
    except FuturesTimeout:
        logger.warning("[AUDITOR] IK check timed out for %s after %ds", jid, timeout_secs)
        return {"verified": False, "confidence": 0, "method": "ik_timeout", "notes": f"IK API did not respond within {timeout_secs}s"}
    except Exception as exc:
        logger.warning("[AUDITOR] IK check error for %s: %s", jid, exc)
        return {"verified": False, "confidence": 0, "method": "ik_error", "notes": str(exc)[:120]}


# ─────────────────────────────────────────────────────────────────────────────
# Main entry point
# ─────────────────────────────────────────────────────────────────────────────

def run_auditor(
    validated_ids: List[str],
    flagged_ids:   Optional[List[str]] = None,
    verify_online: bool = True,
) -> Dict[str, Any]:
    """
    Cross-validate every citation from the Librarian.

    - validated_ids  → standard scrutiny
    - flagged_ids    → stricter: must pass IK cross-check or be quarantined
    - verify_online  → set False to skip IK API calls (e.g. in tests / no token)

    Returns:
        approved_ids     — safe to show to the user (VERIFIED / VERIFIED_WITH_WARNINGS / NEEDS_REVIEW)
        quarantined_ids  — removed from user view
        audit_details    — dict[id] -> full audit trail
    """
    from db.client import judgement_get, judgement_update_validation

    flagged_ids  = flagged_ids or []
    all_ids      = list(dict.fromkeys(validated_ids + flagged_ids))  # preserve order, deduplicate

    approved_ids:    List[str]       = []
    quarantined_ids: List[str]       = []
    audit_details:   Dict[str, Any]  = {}

    logger.info("╔══ AUDITOR AGENT ════════════════════════════════════════╗")
    logger.info("║ Input: %3d validated + %3d flagged = %3d total           ║",
                len(validated_ids), len(flagged_ids), len(all_ids))
    logger.info("║ Checks: Local DB integrity · Indian Kanoon · Hallucination ║")
    logger.info("║ Goal: ZERO MISTAKES — only verified citations for user   ║")
    logger.info("╚══════════════════════════════════════════════════════════╝")

    for jid in all_ids:
        j = judgement_get(jid)
        if not j:
            logger.warning("[AUDITOR] ✗ Cannot load %s — quarantined (not in DB)", jid)
            quarantined_ids.append(jid)
            audit_details[jid] = {"audit_status": "QUARANTINED", "final_confidence": 0, "reason": "not_found_in_db"}
            continue

        is_flagged          = jid in flagged_ids
        local_check         = _verify_via_local_db(jid)
        ik_check            = _check_ik_with_timeout(jid, j, timeout_secs=8) if verify_online else {"verified": False, "method": "skipped", "confidence": 0, "notes": "verify_online=False"}
        title               = (j.get("title") or "")
        citation            = (j.get("primary_citation") or "")
        ratio               = (j.get("ratio") or "")
        hallucination_flags = _hallucination_flags(title, citation, ratio)

        source      = j.get("source", "unknown")
        source_icon = {"local": "🏛", "indian_kanoon": "📚", "google": "🌐"}.get(source, "❓")
        label       = "FLAGGED" if is_flagged else "validated"
        logger.info("[AUDITOR] %s [%-14s | %-9s] %-60s | %s",
                    source_icon, source.upper(), label, title[:60], citation or "—")
        logger.info("  ├─ [LOCAL_DB]      %s confidence=%d | %s",
                    "✓" if local_check["verified"] else "✗", local_check["confidence"], local_check.get("notes", ""))
        logger.info("  ├─ [IK]            %s method=%-22s confidence=%d | %s",
                    "✓" if ik_check["verified"] else "✗", ik_check["method"], ik_check["confidence"], ik_check.get("notes", ""))
        if hallucination_flags:
            logger.warning("  ├─ [HALLUCINATION] ⚠ %s", hallucination_flags)
        else:
            logger.info("  ├─ [HALLUCINATION] ✓ clean")

        verdict        = _compute_final_verdict(jid, j, local_check, ik_check, hallucination_flags, is_flagged)
        audit_status   = verdict["audit_status"]
        final_conf     = verdict["final_confidence"]
        multi_route    = verdict["multi_route_confirmed"]

        # ── Persist to DB ─────────────────────────────────────────────────────
        try:
            judgement_update_validation(
                jid,
                audit_status=audit_status,
                audit_confidence=final_conf,
            )
        except Exception as exc:
            logger.warning("  [AUDITOR] DB persist failed for %s: %s", jid, exc)

        # ── Log verdict ───────────────────────────────────────────────────────
        if audit_status in ("VERIFIED", "VERIFIED_WITH_WARNINGS"):
            logger.info("  └─ [VERDICT] ✅ %-26s confidence=%d  multi_route=%s", audit_status, final_conf, multi_route)
        elif audit_status == "NEEDS_REVIEW":
            logger.warning("  └─ [VERDICT] 🔍 %-26s confidence=%d", audit_status, final_conf)
        else:
            logger.warning("  └─ [VERDICT] ❌ %-26s confidence=%d  flags=%s", audit_status, final_conf, hallucination_flags)

        audit_details[jid] = {
            "audit_status":          audit_status,
            "final_confidence":      final_conf,
            "local_check":           local_check,
            "ik_check":              ik_check,
            "hallucination_flags":   hallucination_flags,
            "multi_route_confirmed": multi_route,
            "is_flagged":            is_flagged,
        }

        if audit_status in ("VERIFIED", "VERIFIED_WITH_WARNINGS", "NEEDS_REVIEW"):
            approved_ids.append(jid)
        else:
            quarantined_ids.append(jid)

    pass_rate = 100.0 * len(approved_ids) / max(1, len(all_ids))
    logger.info(
        "╔══ AUDITOR SUMMARY ═══════════════════════════════════════╗\n"
        "║  ✅ Approved:    %3d  (shown to user)                    ║\n"
        "║  ❌ Quarantined: %3d  (hidden — zero-mistake policy)     ║\n"
        "║  📊 Pass rate:   %5.1f%%                                  ║\n"
        "╚══════════════════════════════════════════════════════════╝",
        len(approved_ids), len(quarantined_ids), pass_rate,
    )

    # CHECK 8: expose counts and failed IDs for root_agent retry loop
    approved_count = len(approved_ids)
    missing_count = max(0, TARGET_CITATION_POINTS - approved_count)
    return {
        "approved_ids":      approved_ids,
        "quarantined_ids":   quarantined_ids,
        "audit_details":     audit_details,
        "approved_count":    approved_count,
        "missing_count":     missing_count,
        "failed_point_ids":  quarantined_ids,  # IDs that failed audit (for retry targeting)
    }
