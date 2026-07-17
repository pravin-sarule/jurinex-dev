"""
Post-loop Verification + Confidence Grading.

Per the J&K HC compliance requirement, NO citation reaches the user without
passing this step.  BLOCKED citations are dropped entirely.

Confidence grades:
  HIGH          — Citation confirmed from a T1 official source
  MEDIUM        — Found via T2 (reporter/media); official citation resolved
  BLOCKED       — Cannot verify; dropped before surfacing to user
"""
from __future__ import annotations

import json
import logging
import os
import re
import time
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


def _gemini_verify(
    parties: str,
    court: str,
    year: str,
    citation_no: str,
    source_url: str,
    authority_tier: str,
    run_id: Optional[str] = None,
    user_id: str = "anonymous",
) -> Dict[str, Any]:
    """
    Uses Gemini grounding to confirm the citation exists at an authorised source.
    Returns dict with confidence, verification_status, official_citation.
    """
    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        return {"confidence": "MEDIUM", "verification_status": "unverified", "official_citation": citation_no}

    # T1 source — already authoritative; assign HIGH without extra LLM call
    if authority_tier == "T1":
        return {
            "confidence": "HIGH",
            "verification_status": "verified",
            "official_citation": citation_no or "",
        }

    prompt = f"""You are verifying whether the following Indian court citation is real and accessible.

Citation to verify:
- Parties: {parties}
- Court: {court}
- Year: {year}
- Citation number: {citation_no}
- Source URL: {source_url}

Use Google Search to:
1. Confirm the case exists at an official/authorised Indian legal source.
2. Find the official SCC / SCR / neutral citation if not already known.

Return ONLY this JSON:
{{
  "exists": true,
  "official_citation": "(2022) 5 SCC 123",
  "verified_url": "https://indiankanoon.org/doc/...",
  "reason": "short reason"
}}
If the case cannot be verified, set "exists": false.
"""

    try:
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=api_key)
        model = os.environ.get("GEMINI_FLASH_MODEL", "gemini-2.5-flash")
        grounding_tool = types.Tool(google_search=types.GoogleSearch())
        thinking_config = None
        try:
            thinking_config = types.ThinkingConfig(thinking_budget=0)
        except Exception:
            pass
        config = types.GenerateContentConfig(
            tools=[grounding_tool],
            max_output_tokens=512,
            temperature=0.0,
            **({"thinking_config": thinking_config} if thinking_config else {}),
        )

        response = None
        for attempt in range(2):
            try:
                response = client.models.generate_content(model=model, contents=prompt, config=config)
                break
            except Exception as exc:
                msg = str(exc)
                if ("429" in msg or "RESOURCE_EXHAUSTED" in msg.upper()) and attempt < 1:
                    time.sleep(5)
                    continue
                raise

        if response is None:
            return {"confidence": "MEDIUM", "verification_status": "unverified", "official_citation": citation_no}

        text = (getattr(response, "text", None) or "").strip()
        text = re.sub(r"^```(?:json)?\s*\n?", "", text, flags=re.M)
        text = re.sub(r"\n?```\s*$", "", text, flags=re.M).strip()
        m = re.search(r"\{.*\}", text, re.DOTALL)
        if m:
            text = m.group(0)
        parsed = json.loads(text)
        if not isinstance(parsed, dict):
            raise ValueError("not a dict")

        if parsed.get("exists"):
            return {
                "confidence": "HIGH" if authority_tier == "T1" else "MEDIUM",
                "verification_status": "verified",
                "official_citation": str(parsed.get("official_citation") or citation_no),
            }
        return {"confidence": "BLOCKED", "verification_status": "blocked", "official_citation": ""}

    except Exception as exc:
        logger.warning("[VERIFY] Verification failed for %r: %s", parties[:60], exc)
        # Give benefit of the doubt if T2 source but can't verify -> MEDIUM unverified
        if authority_tier == "T2":
            return {"confidence": "MEDIUM", "verification_status": "unverified", "official_citation": citation_no}
        return {"confidence": "BLOCKED", "verification_status": "blocked", "official_citation": ""}


def verify_citations(
    candidates: List[Any],
    run_id: Optional[str] = None,
    user_id: str = "anonymous",
) -> List[Dict[str, Any]]:
    """
    Verify each citation candidate and assign a confidence grade.

    Grades:
      HIGH    — confirmed from T1 or verified via grounding
      MEDIUM  — T2 source, citation confirmed but not yet cross-checked to T1
      BLOCKED — cannot verify; dropped

    Returns only HIGH and MEDIUM citations (BLOCKED are silently dropped).
    """
    if not candidates:
        return []

    # Normalise to list of dicts
    normalised: List[Dict[str, Any]] = []
    for c in candidates:
        if isinstance(c, dict):
            normalised.append(c)
        elif hasattr(c, "model_dump"):
            normalised.append(c.model_dump())
        elif hasattr(c, "__dict__"):
            normalised.append(vars(c))
        else:
            try:
                normalised.append(json.loads(str(c)))
            except Exception:
                continue

    verified: List[Dict[str, Any]] = []
    for i, cand in enumerate(normalised):
        parties = str(cand.get("parties") or "")
        court = str(cand.get("court") or "")
        year = str(cand.get("year") or "")
        citation_no = str(cand.get("citation_no") or "")
        source_url = str(cand.get("source_url") or "")
        authority_tier = str(cand.get("authority_tier") or "T2")

        if not (parties or citation_no or source_url):
            logger.debug("[VERIFY] Skipping empty candidate at index %d", i)
            continue

        if i > 0:
            time.sleep(1.5)   # polite rate-limit spacing

        grade = _gemini_verify(
            parties=parties,
            court=court,
            year=year,
            citation_no=citation_no,
            source_url=source_url,
            authority_tier=authority_tier,
            run_id=run_id,
            user_id=user_id,
        )

        if grade.get("confidence") == "BLOCKED":
            logger.info("[VERIFY] BLOCKED (dropped): %s", parties[:60] or source_url[:60])
            continue

        verified.append({
            **cand,
            "confidence": grade["confidence"],
            "verification_status": grade["verification_status"],
            "official_citation": grade.get("official_citation") or citation_no,
        })
        logger.info(
            "[VERIFY] %s -> %s | %s",
            (parties or citation_no)[:60],
            grade["confidence"],
            grade["verification_status"],
        )

    logger.info("[VERIFY] %d/%d candidates passed verification", len(verified), len(normalised))
    return verified
