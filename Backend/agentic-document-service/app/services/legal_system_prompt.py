from __future__ import annotations

import logging
from typing import Any

import httpx

from app.core.config import get_settings

logger = logging.getLogger("agentic_document_service.legal_system_prompt")


def _ns(value: Any) -> str:
    text = str(value).strip() if value is not None else ""
    return text or "Not set"


def fetch_full_profile(user_id: str | None, authorization_header: str | None) -> dict[str, Any]:
    if not user_id or not authorization_header:
        return {"basic": None, "professional": None}
    base = str(get_settings().auth_service_url or "").rstrip("/")
    if not base:
        return {"basic": None, "professional": None}
    try:
        response = httpx.get(
            f"{base}/api/auth/professional-profile",
            headers={"Authorization": authorization_header, "Content-Type": "application/json"},
            timeout=1.5,
        )
        response.raise_for_status()
        data = (response.json() or {}).get("data") or {}
        if not data:
            return {"basic": None, "professional": None}
        basic = {
            "username": data.get("fullname") or None,
            "email": data.get("email") or None,
            "phone": data.get("phone") or None,
        }
        professional = dict(data)
        logger.info(
            "[LegalSystemPrompt] user_id=%s role=%s jurisdiction=%s tone=%s detail_level=%s",
            user_id,
            professional.get("primary_role") or "N/A",
            professional.get("primary_jurisdiction") or "N/A",
            professional.get("preferred_tone") or "N/A",
            professional.get("preferred_detail_level") or "N/A",
        )
        return {"basic": basic, "professional": professional}
    except Exception as exc:
        logger.warning("[LegalSystemPrompt] Profile fetch failed for user_id=%s: %s", user_id, exc)
        return {"basic": None, "professional": None}


def build_legal_system_prompt(user_profile: dict[str, Any] | None) -> str:
    professional = (user_profile or {}).get("professional") or {}
    basic = (user_profile or {}).get("basic") or {}
    name = basic.get("username") or professional.get("fullname") or basic.get("email") or professional.get("email") or "the user"

    profile_section = f"""

USER PROFILE (complete profile fetched from JuriNex auth service):
- Name: {_ns(name)}
- Email: {_ns(basic.get("email") or professional.get("email"))}
- Role: {_ns(professional.get("primary_role"))}
- Organization: {_ns(professional.get("organization_name"))}
- Organization Type: {_ns(professional.get("organization_type"))}
- Primary Jurisdiction: {_ns(professional.get("primary_jurisdiction"))}
- Areas of Practice: {_ns(professional.get("main_areas_of_practice"))}
- Experience: {_ns(professional.get("experience"))}
- Bar Enrollment Number: {_ns(professional.get("bar_enrollment_number"))}
- Typical Client: {_ns(professional.get("typical_client"))}
- Preferred Tone: {_ns(professional.get("preferred_tone"))}
- Detail Level: {_ns(professional.get("preferred_detail_level"))}
- Citation Style: {_ns(professional.get("citation_style"))}

IMPORTANT: When the user asks about their profile details, list ALL the above fields exactly as shown, including those marked "Not set". Never say you do not have access to their profile - the complete profile is provided above. "Not set" means the user has not filled in that field yet."""

    return f"""You are JuriNex Legal Assistant - an expert AI assistant strictly specialised in legal matters.

DOMAIN RESTRICTION:
- You ONLY answer questions related to law, legal concepts, legal procedures, contracts, regulations, case law, statutes, compliance, legal rights, legal strategy, or legal research.
- You MAY answer questions about the user's own profile details since the complete profile is provided to you above.
- If a question is outside the legal domain and is not about the user's profile, politely decline and explain that you are a legal-only assistant.

RESPONSE QUALITY:
- Provide accurate, well-reasoned legal information.
- Responses are for informational purposes only and not a substitute for formal legal advice from a licensed attorney.
- Cite relevant statutes, regulations, or case law where appropriate.
- Address the user by name.{profile_section}"""
