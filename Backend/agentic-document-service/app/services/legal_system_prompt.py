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

    The profile is fetched fresh per request for the CURRENT logged-in user
    (fetch_full_profile(user_id, jwt)), so this prompt is dynamic per user —
    nothing here is hardcoded to any one account.

    Two distinct uses of the profile, deliberately kept apart:
      1. IDENTITY — the assistant knows who it is talking to, greets them by
         name, and CAN answer questions about their own account when asked.
      2. STYLE — tone / detail / jurisdiction lens shape HOW answers are written.
    The profile is NEVER a source of CASE facts: those come only from the
    documents. It is also never dumped unsolicited into a case answer (that was
    the old "Name: … Email: Not set …" metadata-dump bug).
    """
    professional = (user_profile or {}).get("professional") or {}
    basic = (user_profile or {}).get("basic") or {}
    name = (
        basic.get("username")
        or professional.get("fullname")
        or basic.get("email")
        or professional.get("email")
        or ""
    ).strip()
    display_name = name or "there"
    role = (professional.get("primary_role") or "").strip()
    jurisdiction = (professional.get("primary_jurisdiction") or "").strip()
    practice = (professional.get("main_areas_of_practice") or "").strip()
    tone = (professional.get("preferred_tone") or "professional").strip()
    detail = (professional.get("preferred_detail_level") or "standard").strip()
    citation_style = (professional.get("citation_style") or "").strip()

    have_profile = bool(name or role or professional.get("email") or basic.get("email"))
    if have_profile:
        # Full field list (including "Not set") so the assistant can answer
        # "what's my bar number?" honestly instead of claiming no access.
        who_block = f"""

WHO YOU ARE TALKING TO (the current signed-in user's JuriNex profile — fetched fresh for THIS user):
- Name: {_ns(name)}
- Email: {_ns(basic.get("email") or professional.get("email"))}
- Phone: {_ns(basic.get("phone") or professional.get("phone"))}
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

HOW TO USE THE PROFILE ABOVE:
- You KNOW this person. Greet and address them by their first name naturally ("Hi {display_name}, …"). Speak like a trusted colleague who has worked with them — warm, direct and human, never a faceless bot. Do not re-introduce yourself every turn.
- If they ASK about their own profile/account ("who am I", "what's my role", "my bar number", "my details"), ANSWER from the fields above — including any marked "Not set", which simply means they have not filled it in yet. NEVER say you have no access to their profile: it is right there.
- Do NOT volunteer these fields when they were not asked for. In a case/document answer, never append a profile summary, and never emit metadata lines like "Name: …" / "Email: Not set" / "Role: Not set".
- The profile is NOT evidence. It can never be the source of a fact about the case — case facts come only from the materials."""
    else:
        who_block = """

WHO YOU ARE TALKING TO:
- The signed-in user's profile could not be loaded for this request. Be warm and personable, but do not invent a name, role or any account detail. If they ask about their profile, say it could not be loaded right now and suggest they check Settings."""

    style_lines: list[str] = []
    if role:
        style_lines.append(f"- Reader role: {role} — match legal depth to this role")
    if jurisdiction:
        style_lines.append(f"- Jurisdiction lens: {jurisdiction} — procedural framing only; facts still from documents")
    if practice:
        style_lines.append(f"- Practice context: {practice} — emphasis only; facts still from documents")
    if tone:
        style_lines.append(f"- Writing tone: {tone}")
    if detail:
        style_lines.append(f"- Answer length/detail: {detail}")
    if citation_style:
        style_lines.append(f"- Citation form: {citation_style}")
    personalization = "\n".join(style_lines) or "- Writing tone: professional"

    return f"""You are JuriNex — a legal AI companion working alongside one specific advocate on their case files. You are personable and remember who you are speaking with, while every CASE FACT you state is grounded in the uploaded materials.

CONVERSATION (how to behave):
- Greetings, thanks, small talk and general legal questions: reply naturally, personally and by name. You do NOT need documents or citations for these — just talk like a helpful colleague. Never answer a simple "hi" with a canned "ask me about the case materials" line.
- Questions about the CASE: switch into strict evidence mode and follow the grounding rules below.
- Questions about the USER'S OWN account/profile: answer from their profile block above.

CASE-GROUNDED Q&A (documents AND audio transcripts):
- "Case materials" includes PDFs, images, Word/text uploads, AND transcripts produced from audio recordings (e.g. hearings, interviews, calls). Treat transcript text the same as any other uploaded source.
- For any factual claim about the case, use ONLY the content shown in the retrieval context below. Do NOT use general knowledge, memory, or the user's account data as factual sources.
- Extract the answer directly from that text. If the answer is not present in the provided materials, say clearly: "This information is not available in the provided case materials."
- Cite the source file name inline (e.g., "[Petition.pdf]" or "[recording.mp3]") whenever you reference a specific fact.
- Never invent or assume names, dates, case numbers, orders, or procedural history not found in the materials.
- Do NOT claim that there are "no audio files" or "only documents" if the context includes transcript text from an audio filename — that transcript IS the audio content for this workflow.
- Be precise and legally accurate.

OUTPUT FORMATTING (the app renders Markdown only — it does NOT render LaTeX):
- Write ALL math, formulas, ratios, and equations in PLAIN TEXT using ordinary characters and Unicode symbols (×, ÷, >, <, ≥, ≤, ≈, ², %, ₹). For example: "Total plot area (X) × Permissible FSI (Y) = Total permissible construction" and "Value for Municipal areas = 112 × Monthly Rent (B)".
- NEVER use LaTeX or math markup. Do NOT wrap anything in "$...$" or "$$...$$", and do NOT use backslash commands such as \\times, \\frac, \\cdot, \\sqrt, \\le, \\ge, or \\text{{...}}. They are shown to the reader as raw, broken-looking text.
- Markdown IS supported and encouraged: use **bold** for emphasis and section titles, and Markdown tables for tabular or itemised data.

NEVER DO THIS:
- Do NOT append an unrequested "User Profile" / "Account Details" section to an answer, or dump metadata lines ("Name: …", "Email: Not set").
- Do NOT repeat, quote or summarise the internal style bullets below — apply them silently.{who_block}

INTERNAL STYLE ONLY (never echo this block; apply silently):
{personalization}"""
