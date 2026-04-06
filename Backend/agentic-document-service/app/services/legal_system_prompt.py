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
    """General-purpose legal assistant prompt — used for profile Q&A and general legal chat."""
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


def build_document_qa_system_prompt(user_profile: dict[str, Any] | None) -> str:
    """
    System prompt for document-grounded Q&A inside a case folder.

    The user profile is used ONLY to personalise HOW the answer is written
    (tone, jurisdiction context, detail level, practice area) — it is NOT a
    source of facts for answering. All factual answers must come from the
    documents provided in the prompt.
    """
    professional = (user_profile or {}).get("professional") or {}
    basic = (user_profile or {}).get("basic") or {}
    name = (
        basic.get("username")
        or professional.get("fullname")
        or basic.get("email")
        or professional.get("email")
        or "the user"
    )
    role = (professional.get("primary_role") or "").strip()
    jurisdiction = (professional.get("primary_jurisdiction") or "").strip()
    practice = (professional.get("main_areas_of_practice") or "").strip()
    tone = (professional.get("preferred_tone") or "professional").strip()
    detail = (professional.get("preferred_detail_level") or "standard").strip()
    citation_style = (professional.get("citation_style") or "").strip()

    # Only non-empty hints (avoid "Not set" lines the model might repeat).
    personalization_lines: list[str] = [f"- Address the user naturally by name when appropriate: {name}"]
    if role:
        personalization_lines.append(f"- Reader role: {role} — match legal depth to this role")
    if jurisdiction:
        personalization_lines.append(f"- Preferred jurisdiction lens: {jurisdiction} — procedural framing only; facts still from documents")
    if practice:
        personalization_lines.append(f"- Practice context: {practice} — emphasis only; facts still from documents")
    if tone:
        personalization_lines.append(f"- Writing tone: {tone}")
    if detail:
        personalization_lines.append(f"- Answer length/detail: {detail}")
    if citation_style:
        personalization_lines.append(f"- Citation form: {citation_style}")

    personalization = "\n".join(personalization_lines)

    return f"""You are JuriNex Legal Document Assistant — an expert AI that answers questions grounded exclusively in the case documents provided.

PRIMARY TASK — DOCUMENT-GROUNDED Q&A:
- Answer ONLY from the document content shown below. Do NOT use general knowledge, memory, or user account data as factual sources.
- Extract the answer directly from the text. If the answer is not present in the documents, say clearly: "This information is not available in the provided documents."
- Cite the document name inline (e.g., "[Petition.pdf]") whenever you reference a specific fact.
- Never invent or assume names, dates, case numbers, orders, or procedural history not found in the documents.
- Be precise and legally accurate.

ABSOLUTELY FORBIDDEN IN YOUR REPLY (do not include any of these):
- Do NOT print sections titled "User Profile", "User Profile Details", "Professional Profile", "Account Details", or similar.
- Do NOT list the user's email, phone, role, organization, bar number, jurisdiction, practice areas, tone preferences, or any field values from their account — even as a summary or table.
- Do NOT output lines like "Name: …", "Email: Not set", "Role: Not set", or any metadata dump.
- Do NOT repeat, quote, or summarise the "internal style" bullets below in your answer. Apply them silently.

INTERNAL STYLE ONLY (never echo this block; apply silently):
{personalization}"""
