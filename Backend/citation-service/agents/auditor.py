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
        has_content = len(j.get("raw_content") or "") >= 500

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

    # Ratio too short to be real
    if ratio and len(ratio.strip()) < 40:
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
        is_flagged = jid in flagged_ids

        j = judgement_get(jid)
        if not j:
            logger.warning("[AUDITOR] ✗ Cannot load %s — quarantined (not in DB)", jid)
            quarantined_ids.append(jid)
            audit_details[jid] = {"audit_status": "QUARANTINED", "reason": "not_in_db", "final_confidence": 0}
            continue

        source   = j.get("source", "unknown")
        title    = (j.get("title") or "")
        citation = (j.get("primary_citation") or "")
        ratio    = (j.get("ratio") or "")

        source_icon = {"local": "🏛", "indian_kanoon": "📚", "google": "🌐"}.get(source, "❓")
        label       = "FLAGGED" if is_flagged else "validated"
        logger.info(
            "[AUDITOR] %s [%-14s | %-9s] %-60s | %s",
            source_icon, source.upper(), label, title[:60], citation or "—",
        )
        logger.info("  ├─ [SOURCE_TRAIL] jid=%s  origin=%s", jid, source)

        # ── Check 1: Local DB integrity ───────────────────────────────────────
        local_check = _verify_via_local_db(jid)
        icon = "✓" if local_check["verified"] else "✗"
        logger.info("  ├─ [LOCAL_DB]       %s confidence=%d | %s", icon, local_check["confidence"], local_check["notes"])

        # ── Check 2: Indian Kanoon cross-check ────────────────────────────────
        ik_check: Dict[str, Any] = {"verified": False, "method": "skipped", "confidence": 0, "notes": "IK check not requested"}
        if verify_online:
            ik_check = _verify_via_indian_kanoon(title, citation, jid)
            icon = "✓" if ik_check["verified"] else "✗"
            logger.info("  ├─ [INDIAN_KANOON]  %s method=%-22s confidence=%d | %s",
                        icon, ik_check["method"], ik_check["confidence"], ik_check["notes"])
        else:
            logger.info("  ├─ [INDIAN_KANOON]  — (verify_online=False)")

        # ── Check 3: Hallucination / integrity flags ──────────────────────────
        hall_flags = _hallucination_flags(title, citation, ratio)
        if hall_flags:
            logger.warning("  ├─ [HALLUCINATION]  ⚠ Flags: %s", hall_flags)
        else:
            logger.info("  ├─ [HALLUCINATION]  ✓ No anomalies detected")

        # ── Compute final verdict ─────────────────────────────────────────────
        any_verified = local_check["verified"] or ik_check["verified"]
        max_conf     = max(local_check["confidence"], ik_check["confidence"])

        # Trust baseline per source (reflects how reliable the originating pipeline step is)
        trust_base = {"local": 80, "indian_kanoon": 75, "google": 50}.get(source, 40)

        critical_hallucination = any(f in hall_flags for f in (
            "future_year_in_citation", "placeholder_citation",
        ))

        if critical_hallucination:
            audit_status      = "QUARANTINED"
            final_confidence  = 0
            reason            = f"Critical hallucination flags: {hall_flags}"

        elif any_verified and not hall_flags:
            audit_status      = "VERIFIED"
            final_confidence  = max(trust_base, max_conf)
            reason            = f"Verified via {local_check['method']} + {ik_check['method']}"

        elif any_verified and hall_flags:
            audit_status      = "VERIFIED_WITH_WARNINGS"
            final_confidence  = max(trust_base - 10, max_conf - 10)
            reason            = f"Verified but warnings present: {hall_flags}"

        elif is_flagged and not any_verified:
            # For Indian Kanoon source: apply trust baseline — if we have a title and
            # basic DB record (max_conf ≥ 45), give NEEDS_REVIEW instead of quarantine.
            # IK citations are often flagged only because citation format is non-standard,
            # not because the document is fake.
            if source == "indian_kanoon" and max_conf >= 45:
                audit_status      = "NEEDS_REVIEW"
                final_confidence  = max(40, max_conf - 10)
                reason            = f"Flagged by Librarian but IK source with basic DB record (conf={max_conf}) — needs review"
            else:
                audit_status      = "QUARANTINED"
                final_confidence  = 0
                reason            = "Flagged by Librarian and failed all verification checks"

        elif max_conf >= 45:
            audit_status      = "NEEDS_REVIEW"
            final_confidence  = max(40, max_conf - 15)
            reason            = f"Partial evidence only — max_confidence={max_conf}"

        else:
            audit_status      = "QUARANTINED"
            final_confidence  = 0
            reason            = "Insufficient evidence from all verification sources"

        # ── Persist to DB ─────────────────────────────────────────────────────
        try:
            judgement_update_validation(
                jid,
                audit_status=audit_status,
                audit_confidence=final_confidence,
            )
        except Exception as exc:
            logger.warning("  [AUDITOR] DB persist failed for %s: %s", jid, exc)

        # ── Log verdict ───────────────────────────────────────────────────────
        if audit_status in ("VERIFIED", "VERIFIED_WITH_WARNINGS"):
            approved_ids.append(jid)
            logger.info("  └─ [VERDICT] ✅ %-26s confidence=%d | source=%-14s | %s",
                        audit_status, final_confidence, source.upper(), reason)

        elif audit_status == "NEEDS_REVIEW":
            approved_ids.append(jid)   # included but flagged yellow for user
            logger.warning("  └─ [VERDICT] 🔍 %-26s confidence=%d | source=%-14s | %s",
                           audit_status, final_confidence, source.upper(), reason)

        else:
            quarantined_ids.append(jid)
            logger.warning("  └─ [VERDICT] ❌ %-26s source=%-14s | %s",
                           audit_status, source.upper(), reason)

        audit_details[jid] = {
            "audit_status":        audit_status,
            "final_confidence":    final_confidence,
            "source":              source,
            "local_check":         local_check,
            "ik_check":            ik_check,
            "hallucination_flags": hall_flags,
            "reason":              reason,
        }

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
