"""
Librarian Agent: validates, enriches, and normalises every citation after Clerk ingestion.

Checks:
  1. Citation format (SCC, AIR, SCR, Manu, writ numbers, …)
  2. Year plausibility
  3. Court name recognition
  4. Content quality (not a stub)
  5. Area-of-law tagging

Logs exactly which source (local_db / indian_kanoon / google_search) each citation
came from before applying every check.

Returns validated / flagged / rejected ID lists so the Auditor agent knows where
to concentrate its deeper cross-checks.
"""

from __future__ import annotations

import logging
import os
import re
import json
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)
LIBRARIAN_WORKERS = max(1, min(12, int(os.environ.get("CITATION_LIBRARIAN_WORKERS", "6"))))

# ── Hierarchy constants ───────────────────────────────────────────────────────

# Keywords that identify low-hierarchy courts (District, Tribunals, Consumer fora).
# Any judgment whose court string contains one of these → hierarchy_rank=99 → reject.
_LOW_HIERARCHY_COURT_KWS: frozenset = frozenset({
    "district court", "sessions court", "munsiff", "civil judge",
    "judicial magistrate", "executive magistrate", "metropolitan magistrate",
    "motor accident claims tribunal", "mact",
    "family court",
    "debt recovery tribunal", "drt",
    "income tax appellate tribunal", "itat",
    "customs excise and service tax appellate tribunal", "cestat",
    "central administrative tribunal", "cat",
    "armed forces tribunal", "aft",
    "company law board",
    "national green tribunal", "ngt",
    "competition commission of india", "cci",
    "securities appellate tribunal", "sat",
    "consumer forum", "consumer court",
    "national consumer disputes redressal commission", "ncdrc",
    "state consumer disputes", "district consumer",
    "railway claims tribunal",
    "telecom disputes settlement", "tdsat",
    "intellectual property appellate board", "ipab",
    "real estate regulatory", "rera",
})

# State → lower-case HC name (mirrors watchdog._STATE_TO_HC_LOWER)
_STATE_TO_HC_LOWER: Dict[str, str] = {
    "andhra pradesh":   "andhra pradesh high court",
    "telangana":        "telangana high court",
    "delhi":            "delhi high court",
    "gujarat":          "gujarat high court",
    "karnataka":        "karnataka high court",
    "kerala":           "kerala high court",
    "madhya pradesh":   "madhya pradesh high court",
    "maharashtra":      "bombay high court",
    "goa":              "bombay high court",
    "punjab":           "punjab and haryana high court",
    "haryana":          "punjab and haryana high court",
    "rajasthan":        "rajasthan high court",
    "tamil nadu":       "madras high court",
    "uttar pradesh":    "allahabad high court",
    "west bengal":      "calcutta high court",
    "odisha":           "orissa high court",
    "assam":            "gauhati high court",
    "meghalaya":        "meghalaya high court",
    "manipur":          "manipur high court",
    "tripura":          "tripura high court",
    "himachal pradesh": "himachal pradesh high court",
    "uttarakhand":      "uttarakhand high court",
    "chhattisgarh":     "chhattisgarh high court",
    "jharkhand":        "jharkhand high court",
    "jammu":            "jammu and kashmir high court",
    "kashmir":          "jammu and kashmir high court",
    "sikkim":           "sikkim high court",
}


def _court_hierarchy_rank(court: str, case_state: str = "") -> Tuple[int, bool]:
    """
    Compute a hierarchy rank for the court string.

    Returns (rank, should_reject):
      rank 1  — Supreme Court of India
      rank 2  — same-state High Court (based on case_state)
      rank 3  — other High Court
      rank 4  — appellate tribunals (NCLAT, NCDRC, NCLT in appellate mode)
      rank 5  — unknown / unrecognised (pass through with low priority)
      rank 99 — District Court / lower tribunal → should_reject=True

    should_reject=True means the judgment should be discarded early by the Librarian.
    """
    if not court:
        return (5, False)

    cl = court.lower()

    # Supreme Court → rank 1
    if "supreme court" in cl:
        return (1, False)

    # Known low-hierarchy courts → reject
    for kw in _LOW_HIERARCHY_COURT_KWS:
        if kw in cl:
            return (99, True)

    # High Courts
    if "high court" in cl:
        state = (case_state or "").lower().strip()
        if state:
            # Direct substring: "delhi" in "delhi high court"
            if state in cl:
                return (2, False)
            # Mapped: "maharashtra" → "bombay high court"
            mapped_hc = _STATE_TO_HC_LOWER.get(state, "")
            if mapped_hc and mapped_hc in cl:
                return (2, False)
        return (3, False)

    # Appellate tribunals (NCLAT, NCDRC): keep but lower priority
    if any(t in cl for t in ("nclat", "ncdrc", "nclt", "appellate tribunal")):
        return (4, False)

    return (5, False)

# ── Citation format patterns (Indian legal citations) ─────────────────────────
_CITATION_PATTERNS: List[tuple] = [
    (re.compile(r"\(\s*\d{4}\s*\)\s*\d+\s*SCC\s*\d+", re.I),        "SCC"),
    (re.compile(r"AIR\s*\d{4}\s*(SC|HC|All|Bom|Cal|Del|Mad|Ker|Guj|Raj|P&H|Kar|AP|Orissa|MP|Pat)\s*\d+", re.I), "AIR"),
    (re.compile(r"\d{4}\s*\(\d+\)\s*SCR\s*\d+",          re.I),        "SCR"),
    (re.compile(r"\d{4}\s*SCC\s*\(Supp\)\s*\d+",         re.I),        "SCC_SUPP"),
    (re.compile(r"JT\s*\d{4}\s*\(\d+\)\s*\d+",           re.I),        "JT"),
    (re.compile(r"MANU/[A-Z]+/\d+/\d{4}",                re.I),        "MANU"),
    (re.compile(r"WP\s*(?:No\.?)?\s*\d+\s*(?:of|/)\s*\d{4}", re.I),  "WRIT"),
    (re.compile(r"Crl\.?\s*A\.?\s*(?:No\.?)?\s*\d+\s*(?:of|/)\s*\d{4}", re.I), "CRIMINAL_APPEAL"),
    (re.compile(r"C\.?A\.?\s*(?:No\.?)?\s*\d+\s*(?:of|/)\s*\d{4}",  re.I),     "CIVIL_APPEAL"),
    (re.compile(r"\d{4}\s*\d+\s*AWC\s*\d+",              re.I),        "AWC"),
    (re.compile(r"SLP\s*(?:No\.?)?\s*\d+\s*(?:of|/)\s*\d{4}",       re.I),     "SLP"),
    # SCC OnLine / SCC Online (Indian Kanoon commonly returns these)
    (re.compile(r"\d{4}\s*SCC\s*On\s*[Ll]ine\s+(?:SC|HC|[A-Z]+)\s*\d+", re.I), "SCC_ONLINE"),
    (re.compile(r"SCC\s*OnLine\s+(?:SC|HC|[A-Z]+)\s*\d+",              re.I),   "SCC_ONLINE"),
    # eCourts / neutral citation formats
    (re.compile(r"\d{4}:(?:SC|[A-Z]{2,6}):\d+",                         re.I),  "NEUTRAL_CITE"),
    # ILR / All LJ / other reporters
    (re.compile(r"ILR\s*\(?\d{4}\)?\s*(?:SC|[A-Z]+)\s*\d+",            re.I),  "ILR"),
    (re.compile(r"\d{4}\s*All\s*LJ\s*\d+",                              re.I),  "ALL_LJ"),
    # Unreported / case number only (e.g., "Civil Appeal No. 1234 of 2020")
    (re.compile(r"(?:Civil|Criminal|Writ|Special)\s+(?:Appeal|Petition|Application)\s+No\.?\s*\d+\s+of\s+\d{4}", re.I), "CASE_NO"),
]

_VALID_COURTS = {
    "supreme court", "sc", "high court", "hc", "allahabad", "bombay", "calcutta",
    "delhi", "madras", "kerala", "gujarat", "rajasthan", "punjab", "haryana",
    "karnataka", "telangana", "andhra pradesh", "orissa", "odisha", "jharkhand",
    "chhattisgarh", "uttarakhand", "himachal pradesh", "jammu", "sikkim",
    "tripura", "meghalaya", "manipur", "assam", "gauhati", "patna", "mp",
    "madhya pradesh", "nclat", "nclt", "ncdrc", "itat", "cestat",
    # Additional tribunals / courts commonly in IK results
    "national", "tribunal", "consumer", "motor accident", "armed forces",
    "central administrative", "income tax appellate", "customs excise",
    "debt recovery", "telecom disputes", "securities appellate", "sat",
    "competition commission", "cci", "railway claims", "drt", "drat",
    "appellate tribunal", "authority", "commission", "board",
    "district court", "sessions court", "family court",
    "india", "of india",   # "Supreme Court of India" — "of india" present
    "web",   # Google-sourced results get court="Web"
}

_AREAS_OF_LAW: Dict[str, List[str]] = {
    "constitutional": ["fundamental rights", "basic structure", "article 21", "article 14",
                       "directive principle", "writ", "pil", "habeas corpus", "constitution"],
    "criminal":       ["bail", "crpc", "ipc", "murder", "cognizable", "arrest", "custody",
                       "fir", "offence", "accused", "sentence", "acquittal"],
    "civil":          ["contract", "tort", "property", "succession", "limitation",
                       "injunction", "specific performance", "damages"],
    "corporate":      ["company", "ibc", "insolvency", "resolution", "corporate",
                       "nclt", "nclat", "shareholder", "director", "memorandum"],
    "taxation":       ["income tax", "gst", "customs", "vat", "assessment",
                       "demand", "penalty", "itat", "cestat", "revenue"],
    "family":         ["divorce", "maintenance", "custody", "adoption", "marriage",
                       "hindu marriage", "matrimonial", "guardian"],
    "environmental":  ["environment", "pollution", "forest", "wildlife", "ngt",
                       "emission", "green", "ecology"],
    "labour":         ["labour", "industrial", "workman", "retrenchment", "service",
                       "employee", "trade union", "wages", "termination"],
    "intellectual_property": ["patent", "trademark", "copyright", "trade secret",
                               "passing off", "infringement"],
    "arbitration":    ["arbitration", "award", "seat", "enforcement", "icsid",
                       "conciliation", "mediation"],
    "administrative": ["natural justice", "audi alteram", "judicial review",
                       "administrative", "ultra vires", "public authority"],
}


def _detect_citation_format(citation_str: str) -> Optional[str]:
    if not citation_str:
        return None
    for pattern, label in _CITATION_PATTERNS:
        if pattern.search(citation_str):
            return label
    return None


def _validate_year(text: str) -> Optional[int]:
    years = re.findall(r"\b(1[89]\d{2}|20[012]\d)\b", text or "")
    for yr_str in years:
        yr = int(yr_str)
        if yr <= datetime.now().year:
            return yr
    return None


def _detect_area(text: str) -> str:
    text_lower = text.lower()
    scores: Dict[str, int] = {}
    for area, keywords in _AREAS_OF_LAW.items():
        score = sum(1 for kw in keywords if kw in text_lower)
        if score:
            scores[area] = score
    return max(scores, key=scores.get) if scores else "general"


def _validate_court(court: str) -> bool:
    if not court:
        return False
    court_lower = court.lower()
    return any(c in court_lower for c in _VALID_COURTS)


# ─────────────────────────────────────────────────────────────────────────────

def run_librarian(
    judgement_ids: List[str],
    case_state: str = "",
    dimensions: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """
    Validate and enrich each judgement in the DB.

    Args:
        judgement_ids — IDs to validate
        case_state    — state/jurisdiction string (e.g. "Maharashtra") used for same-state HC
                        priority scoring and to reject unrelated low-hierarchy courts.
        dimensions    — Legal Dimensions from LegalDimensionExtractor (reserved for future use).

    Returns:
        validated_ids      — passed all / most checks (goes to Auditor)
        flagged_ids        — has ≥3 warnings (Auditor will apply stricter scrutiny)
        rejected_ids       — critical issues or low-hierarchy courts
        details            — per-ID result dict (includes hierarchy_rank)
        hierarchy_rankings — {jid: rank} sorted map for ReportBuilder ordering
    """
    from db.client import judgement_update_validation
    from db.connections import get_pg_conn
    from psycopg2.extras import RealDictCursor

    validated_ids: List[str] = []
    flagged_ids:   List[str] = []
    rejected_ids:  List[str] = []
    details:       Dict[str, Any] = {}

    judgement_map: Dict[str, Dict[str, Any]] = {}
    conn = get_pg_conn()
    if conn:
        try:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(
                    """
                    SELECT canonical_id, case_name, court_code, source_type, citation_data
                      FROM judgments
                     WHERE canonical_id = ANY(%s)
                    """,
                    (judgement_ids,),
                )
                rows = cur.fetchall() or []
                for row in rows:
                    citation_data = row.get("citation_data") or {}
                    if isinstance(citation_data, str):
                        try:
                            citation_data = json.loads(citation_data)
                        except Exception:
                            citation_data = {}
                    canonical_id = str(row.get("canonical_id") or "").strip()
                    if not canonical_id:
                        continue
                    judgement_map[canonical_id] = {
                        "source": citation_data.get("source_type") or row.get("source_type") or "unknown",
                        "title": row.get("case_name") or citation_data.get("case_name") or "",
                        "primary_citation": citation_data.get("primary_citation") or "",
                        "court": citation_data.get("court_name") or row.get("court_code") or "",
                        "ratio": citation_data.get("holding_text") or citation_data.get("summary_text") or "",
                        "raw_content": citation_data.get("full_text") or "",
                        "area": citation_data.get("area") or "",
                    }
        except Exception as exc:
            logger.warning("[LIBRARIAN] bulk judgment preload failed: %s", exc)
        finally:
            conn.close()

    logger.info("╔══ LIBRARIAN AGENT ═══════════════════════════════════════╗")
    logger.info("║ Validating %3d citation(s) — format · year · court ·     ║", len(judgement_ids))
    logger.info("║ content quality · area-of-law tagging                    ║")
    logger.info("╚══════════════════════════════════════════════════════════╝")

    def _validate_one(jid: str) -> tuple[str, Dict[str, Any]]:
        j = judgement_map.get(jid)
        if not j:
            logger.warning("[LIBRARIAN] ✗ ID not found in DB — skipping: %s", jid)
            return jid, {"source": "unknown", "status": "rejected", "issues": ["not_in_db"], "warnings": [], "enrichments": {}, "hierarchy_rank": 99}

        source       = j.get("source", "unknown")
        title        = (j.get("title") or "")
        primary_cite = (j.get("primary_citation") or "")
        court        = (j.get("court") or "")
        ratio        = (j.get("ratio") or "")
        raw_content  = (j.get("raw_content") or "")
        full_text    = f"{title} {ratio}"

        issues:      List[str] = []
        warnings:    List[str] = []
        enrichments: Dict[str, Any] = {}

        # ── 0. Hierarchy check (early reject for low-level courts) ────────────
        h_rank, h_reject = _court_hierarchy_rank(court, case_state)
        enrichments["hierarchy_rank"] = h_rank
        if h_reject:
            rank_label = {1: "SC", 2: "same-HC", 3: "HC", 4: "Appellate Tribunal"}.get(h_rank, f"rank-{h_rank}")
            logger.warning(
                "[LIBRARIAN] ✗ HIERARCHY REJECT (rank=%d) — %s | court=%s",
                h_rank, title[:60], court[:60],
            )
            return jid, {
                "source": source,
                "status": "rejected",
                "issues": ["low_hierarchy_court"],
                "warnings": [],
                "enrichments": enrichments,
                "hierarchy_rank": h_rank,
            }

        source_icon = {"local": "🏛", "indian_kanoon": "📚", "google": "🌐"}.get(source, "❓")
        logger.info(
            "[LIBRARIAN] %s [%-14s] %-65s | %s",
            source_icon, source.upper(), title[:65], primary_cite or "—",
        )

        # ── 1. Citation format ────────────────────────────────────────────────
        fmt = _detect_citation_format(primary_cite)
        if fmt:
            logger.info("  ├─ [FORMAT]  ✓ %s → %s", primary_cite[:40], fmt)
            enrichments["citation_format"] = fmt
        elif primary_cite and primary_cite not in ("—", ""):
            logger.warning("  ├─ [FORMAT]  ⚠ Unrecognised pattern: %r", primary_cite[:50])
            warnings.append("unrecognised_citation_format")
        else:
            logger.warning("  ├─ [FORMAT]  ✗ No primary citation present")
            issues.append("missing_citation")

        # ── 2. Year plausibility ──────────────────────────────────────────────
        detected_year = _validate_year(primary_cite) or _validate_year(title)
        if detected_year:
            logger.info("  ├─ [YEAR]    ✓ %d", detected_year)
            enrichments["detected_year"] = detected_year
        else:
            logger.warning("  ├─ [YEAR]    ⚠ No plausible year found")
            warnings.append("year_undetectable")

        # ── 3. Court recognition ──────────────────────────────────────────────
        if _validate_court(court):
            logger.info("  ├─ [COURT]   ✓ %s", court[:40])
        else:
            logger.warning("  ├─ [COURT]   ⚠ Unknown court: %r", court[:40])
            warnings.append("unknown_court")

        # ── 4. Content quality ────────────────────────────────────────────────
        content_len = len(raw_content)
        if content_len >= 500:
            logger.info("  ├─ [CONTENT] ✓ %d chars", content_len)
        elif content_len >= 100:
            logger.warning("  ├─ [CONTENT] ⚠ Thin content: %d chars", content_len)
            warnings.append("thin_content")
        else:
            logger.warning("  ├─ [CONTENT] ✗ Stub/empty content: %d chars", content_len)
            issues.append("empty_content")

        # ── 5. Area-of-law detection ──────────────────────────────────────────
        existing_area = j.get("area") or ""
        area = existing_area or _detect_area(full_text)
        logger.info("  ├─ [AREA]    → %s%s", area, " (pre-tagged)" if existing_area else " (auto-detected)")
        enrichments["area_of_law"] = area

        # ── 6. Determine validation status ───────────────────────────────────
        # Critical: missing citation AND empty content = reject outright
        if "missing_citation" in issues and "empty_content" in issues:
            status = "rejected"
            logger.warning("  └─ [STATUS]  ✗ REJECTED — %s", issues)
        elif issues:
            # Has some critical issue but not both → flag for Auditor scrutiny
            status = "flagged"
            logger.warning("  └─ [STATUS]  ⚠ FLAGGED  — issues=%s", issues)
        elif len(warnings) >= 3:
            status = "flagged"
            logger.warning("  └─ [STATUS]  ⚠ FLAGGED  — too many warnings: %s", warnings)
        elif warnings:
            status = "validated_with_warnings"
            logger.info("  └─ [STATUS]  ~ VALIDATED (warnings: %s)", warnings)
        else:
            status = "validated"
            logger.info("  └─ [STATUS]  ✓ VALIDATED")

        # ── 7. Persist enrichments ────────────────────────────────────────────
        try:
            judgement_update_validation(
                jid,
                librarian_status=status,
                librarian_warnings=", ".join(warnings) if warnings else "",
                librarian_issues=", ".join(issues) if issues else "",
                area=area if not existing_area else None,
            )
        except Exception as exc:
            logger.warning("  [LIBRARIAN] DB update failed for %s: %s", jid, exc)

        return jid, {
            "source":         source,
            "status":         status,
            "warnings":       warnings,
            "issues":         issues,
            "enrichments":    enrichments,
            "hierarchy_rank": h_rank,
        }

    with ThreadPoolExecutor(max_workers=min(LIBRARIAN_WORKERS, len(judgement_ids) or 1)) as pool:
        futs = {pool.submit(_validate_one, jid): jid for jid in judgement_ids}
        for fut in as_completed(futs):
            jid = futs[fut]
            try:
                result_jid, det = fut.result(timeout=60)
            except Exception as exc:
                logger.warning("[LIBRARIAN] Worker failed for %s: %s", jid, exc)
                result_jid, det = jid, {"source": "unknown", "status": "rejected", "issues": [str(exc)[:80]], "warnings": [], "enrichments": {}}
            details[result_jid] = det
            status = det.get("status")
            if status in ("validated", "validated_with_warnings"):
                validated_ids.append(result_jid)
            elif status == "flagged":
                flagged_ids.append(result_jid)
            else:
                rejected_ids.append(result_jid)
            if len(details) and (len(details) == len(judgement_ids) or len(details) % 5 == 0):
                logger.info("[LIBRARIAN] progress %d/%d checked", len(details), len(judgement_ids))

    hierarchy_rankings: Dict[str, int] = {
        jid: (details[jid].get("hierarchy_rank") or 5)
        for jid in details
    }

    logger.info(
        "╔══ LIBRARIAN SUMMARY ═════════════════════════════════════╗\n"
        "║  ✓ Validated:  %3d  |  ⚠ Flagged: %3d  |  ✗ Rejected: %3d ║\n"
        "╚══════════════════════════════════════════════════════════╝",
        len(validated_ids), len(flagged_ids), len(rejected_ids),
    )

    return {
        "validated_ids":      validated_ids,
        "flagged_ids":        flagged_ids,
        "rejected_ids":       rejected_ids,
        "details":            details,
        "hierarchy_rankings": hierarchy_rankings,
    }
