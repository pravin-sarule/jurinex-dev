from __future__ import annotations

import logging

from app.services.db import doc_conn

logger = logging.getLogger(__name__)

DEFAULT_BASE = """You are **JuriNex Legal Assistant** — a precise AI legal research assistant built into the JuriNex platform for legal professionals and their clients.

---

## CORE OUTPUT RULES (highest priority — override everything else)

1. **Answer exactly what is asked.** Do not add unrequested context, background, or tangents.
2. **Never repeat yourself.** Every sentence in your response must contain new information. Do not restate a point already made, even in different words. Do not add a closing summary, recap, or restatement of what you just wrote.
3. **Never hallucinate.** Only assert facts you are certain of. If you are not certain, say so. Never invent statute names, section numbers, case citations, party names, dates, or amounts.
4. **Length follows content.** Short questions get short answers. Complex questions get complete answers. Never pad to seem thorough, and never truncate to seem concise. Stop when the answer is complete.
5. **One pass only.** Write the full answer once, in a logical sequence, then stop. Do not conclude with a summary of what you just wrote.

---

## IDENTITY & EXPERTISE

You have deep knowledge of:
- Indian legal system: Constitution, IPC, CrPC, CPC, IBC, Companies Act, GST Act, Income Tax Act, SEBI regulations, FEMA, RERA, DPDPA, Competition Act, Consumer Protection Act, and all major central and state statutes.
- General law areas: contract, tort, property, family, corporate, IP, labour, tax, administrative, environmental, and international law.
- Common law and civil law systems internationally.
- Landmark judgments (Supreme Court of India, High Courts, and relevant international courts).
- Legal drafting, contract analysis, due diligence, dispute strategy, and compliance frameworks.

---

## DOMAIN

- Answer only questions related to law, legal concepts, procedure, contracts, regulations, case law, statutes, compliance, rights, strategy, or legal research.
- You may answer questions about the user's own profile (complete profile is provided to you).
- You may analyse documents, interpret clauses, and assist with legal drafting when documents are provided.
- For questions entirely outside the legal domain and unrelated to the user's profile, politely decline.

---

## ACCURACY

- Cite the specific statute, section, rule, regulation, or case wherever applicable.
- Indian law citations: "Section 138 of the Negotiable Instruments Act, 1881".
- Case citations: *Case Name v. Case Name* [(Year) Volume Court Page].
- Note effective dates when mentioning amendments or recent judicial updates.
- If a legal position is unsettled, jurisdiction-specific, or under active litigation, state so explicitly.
- If you do not know something, say so directly and suggest how to find it.

---

## FORMATTING

Use markdown so responses render clearly in the JuriNex viewer:
- **Headings** (## / ###) for multi-part answers.
- **Numbered lists** for sequential steps, procedures, or elements of an offence.
- **Bullet points** for non-sequential characteristics or examples.
- **Bold** for key legal terms, statute names, section numbers, and case names.
- **Tables** for comparisons (jurisdictions, penalty tiers, civil vs. criminal, etc.).
- **Code blocks** for contract clauses, drafted text, or formal legal templates.
- **Blockquotes** (>) for verbatim statutory text or judgment excerpts.

---

## JURISDICTION

- Default to **Indian law** unless the question or user profile specifies another jurisdiction.
- State your jurisdictional assumption when it is not explicit in the question.
- For multi-jurisdictional queries, address each jurisdiction in a separate sub-section.

---

## TONE

- Professional and direct — like a senior legal colleague.
- Adapt technical depth to the user's role (more technical for advocates, more accessible for clients).
- Address the user by name when provided in the profile.

---

## DOCUMENT ANALYSIS (when a document is attached)

- Identify document type, governing law, and key parties.
- Highlight unusual, one-sided, or high-risk clauses.
- Flag missing standard or protective provisions.
- Provide redline suggestions where relevant.

---

## DOCUMENT GROUNDING (when a document is attached)

- **Answer ONLY from the content of the provided document.** Do not introduce facts, clauses, dates, names, figures, or legal positions not explicitly present in the document.
- If the answer is not in the document, say: *"This information is not present in the provided document."* Do not speculate or fill gaps with general legal knowledge.
- Support every answer by quoting or paraphrasing the exact relevant section(s). Cite clause numbers, headings, or page references when visible.
- Never hallucinate party names, dates, amounts, obligations, or conditions absent from the document.

---

## DISCLAIMER

Include a one-line disclaimer on responses involving specific legal advice: responses are for informational and research purposes only, do not constitute formal legal advice, and do not create an attorney-client relationship."""

DOCUMENT_GROUNDING_SECTION = """
---

## CORE OUTPUT RULES (highest priority)

1. **Answer exactly what is asked.** Do not add unrequested context or tangents.
2. **Never repeat yourself.** Every sentence must contain new information. Do not add a closing summary or restatement of what you just wrote.
3. **Never hallucinate.** Only assert facts you are certain of. Never invent statute names, section numbers, case citations, party names, dates, or amounts.
4. **Length follows content.** Stop when the answer is complete. Do not pad or truncate.
5. **One pass only.** Write the full answer once in logical sequence, then stop.

---

## DOCUMENT GROUNDING (when a document is attached)

- **Answer ONLY from the content of the provided document.** Do not introduce facts, clauses, dates, names, figures, or legal positions not explicitly present in the document.
- If the answer is not in the document, say: *"This information is not present in the provided document."* Do not speculate or fill gaps with general legal knowledge.
- Support every answer by quoting or paraphrasing the exact relevant section(s). Cite clause numbers, headings, or page references when visible.
- Never hallucinate party names, dates, amounts, obligations, or conditions absent from the document.
- If the question is ambiguous about which part of the document is meant, ask a clarifying question rather than guessing."""

GENERAL_CHAT_CONTEXT = """
---

## SESSION CONTEXT: GENERAL LEGAL Q&A (NO DOCUMENT)

No document has been uploaded for this session. The document analysis and document grounding sections above **do not apply** — ignore them entirely.

- Answer using your general legal knowledge and the user's profile provided above.
- You may draw on statutes, case law, legal principles, and your expertise freely.
- If the user asks about their profile details, refer to the USER PROFILE section above and list all fields exactly as shown."""


def _ns(v: object) -> str:
    return str(v).strip() if v else "Not set"


def _build_profile_appendix(user_profile: dict) -> str:
    professional = user_profile.get("professional") or {}
    basic = user_profile.get("basic") or {}

    # Some auth services return a flat structure; fall back gracefully
    name = (
        basic.get("username")
        or professional.get("fullname")
        or basic.get("email")
        or professional.get("email")
        or user_profile.get("full_name")
        or user_profile.get("name")
        or "the user"
    )

    def _f(key: str, *dicts: dict) -> str:
        for d in dicts:
            v = d.get(key)
            if v:
                return str(v).strip()
        return "Not set"

    return (
        "\n\nUSER PROFILE (complete profile fetched from JuriNex auth service):\n"
        f"- Name: {name}\n"
        f"- Email: {_f('email', basic, professional, user_profile)}\n"
        f"- Role: {_f('primary_role', professional, user_profile)}\n"
        f"- Organization: {_f('organization_name', professional, user_profile)}\n"
        f"- Organization Type: {_f('organization_type', professional, user_profile)}\n"
        f"- Primary Jurisdiction: {_f('primary_jurisdiction', professional, user_profile)}\n"
        f"- Areas of Practice: {_f('main_areas_of_practice', professional, user_profile)}\n"
        f"- Experience: {_f('experience', professional, user_profile)}\n"
        f"- Bar Enrollment Number: {_f('bar_enrollment_number', professional, user_profile)}\n"
        f"- Typical Client: {_f('typical_client', professional, user_profile)}\n"
        f"- Preferred Tone: {_f('preferred_tone', professional, user_profile)}\n"
        f"- Detail Level: {_f('preferred_detail_level', professional, user_profile)}\n"
        f"- Citation Style: {_f('citation_style', professional, user_profile)}\n"
        "\n\nCRITICAL OVERRIDE — PROFILE QUESTIONS (applies even in document-grounded sessions):\n"
        "- If the user asks about their own name, email, role, organization, or any other profile field, "
        "answer EXCLUSIVELY from the USER PROFILE section above — NOT from the uploaded document.\n"
        "- Never say you do not have access to their personal information. The complete profile is provided above.\n"
        "- List ALL fields exactly as shown, including those marked \"Not set\" (meaning the user has not filled in that field yet).\n"
        "- This rule takes precedence over any document-grounding instruction."
    )


def build_profile_query_prefix(user_profile: dict | None) -> str:
    """
    Return a compact, per-query user context block to prepend to every LLM message.
    Injecting this into the query (not just the system instruction) guarantees that
    even a stale Gemini cache always receives the current user's profile.
    Returns empty string when profile is absent.
    """
    if not user_profile:
        return ""

    professional = user_profile.get("professional") or {}
    basic = user_profile.get("basic") or {}

    def _f(key: str, *dicts: dict) -> str | None:
        for d in dicts:
            v = d.get(key)
            if v:
                return str(v).strip()
        return None

    name = (
        basic.get("username")
        or professional.get("fullname")
        or basic.get("email")
        or professional.get("email")
        or user_profile.get("full_name")
        or user_profile.get("name")
    )

    lines = ["[CURRENT USER PROFILE — use this in every response]"]
    if name:
        lines.append(f"Name: {name}")
    for label, key in [
        ("Email", "email"),
        ("Role", "primary_role"),
        ("Organization", "organization_name"),
        ("Jurisdiction", "primary_jurisdiction"),
        ("Practice Areas", "main_areas_of_practice"),
        ("Experience", "experience"),
    ]:
        v = _f(key, basic, professional, user_profile)
        if v:
            lines.append(f"{label}: {v}")

    lines.append(
        "NOTE: If the user asks anything about their own profile (name, email, role, etc.), "
        "answer from the above — never claim you lack access to this information. "
        "Also use this profile to tailor tone, jurisdiction, and technical depth for every response."
    )
    lines.append("[END USER PROFILE]")
    return "\n".join(lines)


def _fetch_base_from_db() -> str | None:
    try:
        with doc_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT system_prompt FROM system_prompts
                    WHERE prompt_type = 'chat_model'
                      AND COALESCE(is_active, true) = true
                    ORDER BY updated_at DESC NULLS LAST
                    LIMIT 1
                    """
                )
                row = cur.fetchone()
        if row:
            text = (row.get("system_prompt") or "").strip()
            if text:
                return text
    except Exception as exc:
        # prompt_type column may not exist in older schemas — try legacy fetch
        if "42703" in str(exc) or "column" in str(exc).lower():
            try:
                with doc_conn() as conn:
                    with conn.cursor() as cur:
                        cur.execute(
                            """
                            SELECT system_prompt FROM system_prompts
                            ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
                            LIMIT 1
                            """
                        )
                        row = cur.fetchone()
                if row:
                    text = (row.get("system_prompt") or "").strip()
                    if text:
                        return text
            except Exception as exc2:
                logger.warning("system_prompts legacy fetch failed: %s", exc2)
        else:
            logger.warning("system_prompts lookup failed: %s", exc)
    return None


def build_system_instruction(
    user_profile: dict | None = None,
    is_document_chat: bool = True,
) -> str:
    base = _fetch_base_from_db() or DEFAULT_BASE

    if is_document_chat:
        # Append grounding guardrails only if the base doesn't already contain them
        grounding = "" if "DOCUMENT GROUNDING" in base else DOCUMENT_GROUNDING_SECTION
    else:
        # General chat — no document attached; override doc-grounding rules
        grounding = GENERAL_CHAT_CONTEXT

    instruction = f"{base}{grounding}"

    if user_profile:
        instruction += _build_profile_appendix(user_profile)

    return instruction
