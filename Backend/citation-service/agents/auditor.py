# 

from __future__ import annotations

import json
import logging
import os
import re
import urllib.request
import urllib.parse
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────────────────────
# LEGAL VALIDATION HELPERS (NEW)
# ─────────────────────────────────────────────────────────────

def _is_valid_indian_citation(citation: str) -> bool:
    patterns = [
        r"\(\d{4}\)\s*\d+\s*SCC\s*\d+",
        r"AIR\s*\d{4}\s*SC\s*\d+",
        r"\d{4}\s*SCC\s*OnLine\s*\w+\s*\d+",
    ]
    return any(re.search(p, citation or "") for p in patterns)


def _is_valid_case_title(title: str) -> bool:
    return bool(re.search(r"\b(vs?|versus|v\/s)\b", title or "", re.I))


def _is_valid_ratio(ratio: str) -> bool:
    if not ratio or len(ratio.strip()) < 80:
        return False
    keywords = ["held", "observed", "principle", "court", "ruled"]
    return any(k in ratio.lower() for k in keywords)


# ─────────────────────────────────────────────────────────────
# EXISTING HELPERS (REUSED)
# ─────────────────────────────────────────────────────────────

def _title_similarity(a: str, b: str) -> float:
    wa = set(a.lower().split())
    wb = set(b.lower().split())
    if not wa or not wb:
        return 0.0
    return len(wa & wb) / len(wa | wb)


# ─────────────────────────────────────────────────────────────
# INDIAN KANOON VERIFICATION
# ─────────────────────────────────────────────────────────────

def _verify_via_indian_kanoon(title: str, citation: str, token: str) -> Dict[str, Any]:
    try:
        url = "https://api.indiankanoon.org/search/?formInput=" + urllib.parse.quote(citation or title)
        req = urllib.request.Request(url)
        req.add_header("Authorization", f"Token {token}")

        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode())

        docs = data.get("docs", [])
        if not docs:
            return {"verified": False, "confidence": 0}

        first_title = docs[0].get("title", "")
        sim = _title_similarity(title, first_title)

        return {
            "verified": sim > 0.35,
            "confidence": int(sim * 100)
        }

    except Exception as e:
        return {"verified": False, "confidence": 0, "error": str(e)}


# ─────────────────────────────────────────────────────────────
# LOCAL DB CHECK
# ─────────────────────────────────────────────────────────────

def _verify_via_local_db(j: dict) -> Dict[str, Any]:
    has_title = bool(j.get("title"))
    has_citation = bool(j.get("primary_citation"))
    has_content = len(j.get("ratio", "")) > 50

    score = sum([has_title, has_citation, has_content])

    return {
        "verified": score >= 2,
        "confidence": score * 30
    }


# ─────────────────────────────────────────────────────────────
# HALLUCINATION DETECTION (ENHANCED)
# ─────────────────────────────────────────────────────────────

def _hallucination_flags(j: dict) -> List[str]:
    flags = []

    title = j.get("title", "")
    citation = j.get("primary_citation", "")
    ratio = j.get("ratio", "")

    # Future year check
    now_year = datetime.now().year
    for yr in re.findall(r"\b(20\d{2})\b", citation):
        if int(yr) > now_year:
            flags.append("future_year")

    if not _is_valid_indian_citation(citation):
        flags.append("invalid_citation_format")

    if not _is_valid_case_title(title):
        flags.append("invalid_case_title")

    if not _is_valid_ratio(ratio):
        flags.append("weak_ratio")

    return flags


# ─────────────────────────────────────────────────────────────
# FINAL VERDICT ENGINE (UPGRADED)
# ─────────────────────────────────────────────────────────────

def _compute_final_verdict(j: dict, local: dict, ik: dict, flags: list) -> dict:

    legal_valid = (
        _is_valid_indian_citation(j.get("primary_citation")) and
        _is_valid_case_title(j.get("title")) and
        _is_valid_ratio(j.get("ratio"))
    )

    local_verified = local["verified"]
    ik_verified = ik["verified"]

    multi_source = local_verified and ik_verified

    base_conf = max(local.get("confidence", 0), ik.get("confidence", 0))

    # HARD FAIL
    if not legal_valid:
        return {
            "audit_status": "QUARANTINED",
            "confidence": 20
        }

    # STRONG VERIFIED
    if multi_source:
        return {
            "audit_status": "VERIFIED",
            "confidence": min(99, base_conf + 10)
        }

    # PARTIAL VERIFIED
    if local_verified or ik_verified:
        return {
            "audit_status": "NEEDS_REVIEW",
            "confidence": base_conf
        }

    return {
        "audit_status": "QUARANTINED",
        "confidence": base_conf
    }


# ─────────────────────────────────────────────────────────────
# MAIN AUDITOR
# ─────────────────────────────────────────────────────────────

def run_auditor(judgements: List[dict]) -> Dict[str, Any]:

    token = os.environ.get("INDIAN_KANOON_TOKEN")

    approved = []
    rejected = []
    details = {}

    for j in judgements:

        jid = j.get("id")

        local_check = _verify_via_local_db(j)

        ik_check = (
            _verify_via_indian_kanoon(j["title"], j["primary_citation"], token)
            if token else {"verified": False, "confidence": 0}
        )

        flags = _hallucination_flags(j)

        verdict = _compute_final_verdict(j, local_check, ik_check, flags)

        details[jid] = {
            "verdict": verdict,
            "flags": flags
        }

        if verdict["audit_status"] in ("VERIFIED", "NEEDS_REVIEW"):
            approved.append(jid)
        else:
            rejected.append(jid)

    return {
        "approved": approved,
        "rejected": rejected,
        "details": details
    }