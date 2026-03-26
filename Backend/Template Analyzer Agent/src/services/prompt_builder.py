"""
Prompt Builder Service - 3-Layer Architecture for Legal Template Generation
---------------------------------------------------------------------------
Layer 1: System Identity & Rules (persona, output format, anti-hallucination)
Layer 2: Legal Knowledge Context (governing law, case law, sections per category)
Layer 3: User Requirements (mapped from frontend 20+ field JSON)
"""

from typing import Any, Dict, List, Optional

# ---------------------------------------------------------------------------
# LAYER 2 - Legal Knowledge Metadata per document category
# ---------------------------------------------------------------------------

LEGAL_CONTEXT_MAP: Dict[str, Dict[str, Any]] = {
    "Property": {
        "label": "Property / Real Estate Documents",
        "governing_law": (
            "Transfer of Property Act, 1882; Registration Act, 1908; "
            "Stamp Act (state-specific); Indian Contract Act, 1872; "
            "Real Estate (Regulation and Development) Act, 2016 (RERA)"
        ),
        "relevant_acts": [
            "Transfer of Property Act, 1882",
            "Registration Act, 1908",
            "Indian Contract Act, 1872",
            "Stamp Act (applicable state)",
            "RERA, 2016",
        ],
        "case_law": [
            "Suraj Lamp & Industries Pvt. Ltd. vs State of Haryana (2012) 1 SCC 656 — Power of Attorney sales",
            "Waman Shriniwas Kini vs Ratilal Bhagwandas & Co AIR 1959 SC 689 — Specific performance",
            "K. Narendra vs Riviera Apartments Pvt. Ltd. (1999) 5 SCC 77 — Builder-buyer disputes",
        ],
        "mandatory_sections": [
            "Title / Document Header",
            "Parties (Lessor/Licensor/Vendor and Lessee/Licensee/Purchaser)",
            "Property Description (Schedule of Property)",
            "Consideration and Payment Terms",
            "Term and Possession",
            "Rights and Obligations of Parties",
            "Covenants by Parties",
            "Default and Remedies",
            "Stamp Duty and Registration",
            "Governing Law and Jurisdiction",
            "Dispute Resolution (Arbitration Clause)",
            "Execution and Signature Block",
            "Witnesses and Notary",
        ],
    },
    "Agreement": {
        "label": "Agreements & Contracts",
        "governing_law": (
            "Indian Contract Act, 1872; Specific Relief Act, 1963; "
            "Arbitration and Conciliation Act, 1996"
        ),
        "relevant_acts": [
            "Indian Contract Act, 1872",
            "Specific Relief Act, 1963",
            "Arbitration and Conciliation Act, 1996",
            "Information Technology Act, 2000 (for digital contracts)",
        ],
        "case_law": [
            "Carlill vs Carbolic Smoke Ball Co [1893] — Offer and acceptance principles",
            "Hadley vs Baxendale (1854) — Remoteness of damages",
            "ONGC vs Saw Pipes Ltd. (2003) 5 SCC 705 — Liquidated damages enforceability",
        ],
        "mandatory_sections": [
            "Title / Agreement Header",
            "Date and Place of Execution",
            "Parties (Full legal names, addresses, PAN/GST if applicable)",
            "Recitals / Background",
            "Definitions and Interpretation",
            "Scope of Agreement / Services",
            "Consideration and Payment Terms",
            "Duration / Term",
            "Obligations of Each Party",
            "Representations and Warranties",
            "Confidentiality / Non-Disclosure",
            "Intellectual Property (if applicable)",
            "Indemnification",
            "Limitation of Liability",
            "Termination",
            "Force Majeure",
            "Governing Law and Jurisdiction",
            "Dispute Resolution",
            "Entire Agreement / Severability",
            "Notices",
            "Execution and Signature Block",
        ],
    },
    "Court": {
        "label": "Court Petitions & Applications",
        "governing_law": (
            "Code of Civil Procedure, 1908; Code of Criminal Procedure, 1973; "
            "Constitution of India, 1950; Indian Evidence Act, 1872; "
            "Specific Relief Act, 1963"
        ),
        "relevant_acts": [
            "Code of Civil Procedure, 1908 (CPC)",
            "Code of Criminal Procedure, 1973 (CrPC)",
            "Constitution of India, 1950",
            "Indian Evidence Act, 1872",
            "Specific Relief Act, 1963",
            "Limitation Act, 1963",
        ],
        "case_law": [
            "Arnesh Kumar vs State of Bihar (2014) 8 SCC 273 — Arrest guidelines",
            "D.K. Basu vs State of West Bengal (1997) 1 SCC 416 — Custodial rights",
            "State of Rajasthan vs Union of India (1977) 3 SCC 592 — Federal principles",
        ],
        "mandatory_sections": [
            "Court Header (Name of Court, Jurisdiction)",
            "Case Title / Caption",
            "Application/Petition Number",
            "Parties (Petitioner/Applicant and Respondent)",
            "Subject Matter",
            "Grounds / Facts in Brief",
            "Grounds for Relief (numbered)",
            "Legal Submissions",
            "Prayer / Relief Sought",
            "Affidavit Verification",
            "Advocate Signature and Enrollment Number",
            "Date and Place",
        ],
    },
    "Trust": {
        "label": "Trust & Estate Documents",
        "governing_law": (
            "Indian Trusts Act, 1882; Indian Succession Act, 1925; "
            "Income Tax Act, 1961 (Sections 11-13 for charitable trusts); "
            "Foreign Contribution Regulation Act, 2010 (if applicable)"
        ),
        "relevant_acts": [
            "Indian Trusts Act, 1882",
            "Indian Succession Act, 1925",
            "Income Tax Act, 1961 (Sections 11-13)",
            "Registration Act, 1908",
            "Charitable and Religious Trusts Act, 1920",
        ],
        "case_law": [
            "Commissioner of Income Tax vs Trustees of H.E.H. Nizam (1976) — Trust taxation",
            "Suresh Chand vs Kundan (1994) — Trust management disputes",
        ],
        "mandatory_sections": [
            "Trust Deed Header",
            "Date and Place of Execution",
            "Settlor Details",
            "Trustee(s) Details",
            "Beneficiary Details",
            "Trust Property (Schedule)",
            "Objects and Purposes of the Trust",
            "Powers of the Trustee",
            "Obligations of the Trustee",
            "Meetings and Quorum",
            "Accounts and Audit",
            "Dissolution and Winding Up",
            "Amendments",
            "Governing Law",
            "Signature Block and Witnesses",
        ],
    },
    "Family": {
        "label": "Family Law Documents",
        "governing_law": (
            "Hindu Marriage Act, 1955; Special Marriage Act, 1954; "
            "Guardians and Wards Act, 1890; Hindu Succession Act, 1956; "
            "Domestic Violence Act, 2005; Muslim Personal Law (Shariat) Application Act, 1937"
        ),
        "relevant_acts": [
            "Hindu Marriage Act, 1955",
            "Special Marriage Act, 1954",
            "Guardians and Wards Act, 1890",
            "Hindu Succession Act, 1956",
            "Protection of Women from Domestic Violence Act, 2005",
            "Hindu Minority and Guardianship Act, 1956",
        ],
        "case_law": [
            "Shayara Bano vs Union of India (2017) — Triple Talaq unconstitutional",
            "Githa Hariharan vs Reserve Bank of India (1999) 2 SCC 228 — Mother as natural guardian",
            "Sarla Mudgal vs Union of India (1995) 3 SCC 635 — Bigamy and conversion",
        ],
        "mandatory_sections": [
            "Document Header",
            "Parties (Husband/Wife/Father/Mother/Child)",
            "Background and Marriage Details",
            "Subject Matter",
            "Terms and Conditions",
            "Child Custody and Maintenance (if applicable)",
            "Property Settlement",
            "Alimony / Maintenance",
            "Mutual Obligations",
            "Duration and Finality",
            "Governing Law and Jurisdiction",
            "Signature Block and Witnesses",
            "Court Stamp / Notarization",
        ],
    },
    "Employment": {
        "label": "Employment & HR Documents",
        "governing_law": (
            "Industrial Disputes Act, 1947; Contract Labour Act, 1970; "
            "Payment of Wages Act, 1936; Employees' Provident Fund Act, 1952; "
            "Sexual Harassment of Women at Workplace Act, 2013"
        ),
        "relevant_acts": [
            "Industrial Disputes Act, 1947",
            "Contract Labour (Regulation and Abolition) Act, 1970",
            "Payment of Wages Act, 1936",
            "Employees' Provident Fund and Misc. Provisions Act, 1952",
            "Sexual Harassment of Women at Workplace (Prevention, Prohibition and Redressal) Act, 2013",
            "Shops and Establishments Act (state-specific)",
        ],
        "case_law": [
            "Workmen of Dimakuchi Tea Estate vs Management (1958) — Definition of workman",
            "Bangalore Water Supply vs A. Rajappa (1978) 2 SCC 213 — Industry definition",
        ],
        "mandatory_sections": [
            "Offer Letter / Agreement Header",
            "Date and Place",
            "Employer Details",
            "Employee Details",
            "Position and Role",
            "Compensation and Benefits",
            "Working Hours and Leave",
            "Probation Period",
            "Confidentiality and Non-Disclosure",
            "Non-Compete (if applicable)",
            "Intellectual Property",
            "Termination Conditions",
            "Grievance Redressal",
            "Governing Law",
            "Signature Block",
        ],
    },
    "General": {
        "label": "General Legal Document",
        "governing_law": (
            "Indian Contract Act, 1872; Specific Relief Act, 1963; "
            "Limitation Act, 1963; Arbitration and Conciliation Act, 1996"
        ),
        "relevant_acts": [
            "Indian Contract Act, 1872",
            "Specific Relief Act, 1963",
            "Limitation Act, 1963",
            "Arbitration and Conciliation Act, 1996",
        ],
        "case_law": [],
        "mandatory_sections": [
            "Document Header and Title",
            "Date and Place",
            "Parties",
            "Background / Recitals",
            "Definitions",
            "Subject Matter",
            "Terms and Conditions",
            "Obligations",
            "Governing Law",
            "Dispute Resolution",
            "Entire Agreement",
            "Signature Block",
        ],
    },
}


def _get_court_format(document_type: str) -> str:
    """Return court-specific header/structure formatting instructions based on document type."""
    doc = (document_type or "").lower()

    if any(x in doc for x in ["supreme court", "slp", "special leave petition", "transfer petition", "civil appeal"]):
        return """
COURT FORMATTING — SUPREME COURT OF INDIA:
  Document header (centered, ALL CAPS, no markdown):
    IN THE SUPREME COURT OF INDIA
    CIVIL ORIGINAL JURISDICTION  [or CRIMINAL APPELLATE JURISDICTION as appropriate]
    WRIT PETITION (CIVIL) NO. __writ_petition_number__ OF __year__
                        IN THE MATTER OF:
    __petitioner_name__                                          ...PETITIONER
                              VERSUS
    __respondent_name__                                         ...RESPONDENT
  - Use "Hon'ble" before Justice names throughout
  - Sections: FACTS AND CIRCUMSTANCES, QUESTIONS OF LAW, GROUNDS, PRAYER, VERIFICATION
  - End with: Filed through Advocate on Record — __advocate_name__, AOR Reg. No. __aor_number__
  - Include: Certificate under Order XV-A of Supreme Court Rules, 2013
"""
    if any(x in doc for x in ["writ petition", "pil", "public interest litigation", "high court", "habeas corpus"]):
        return """
COURT FORMATTING — HIGH COURT:
  Document header (centered, ALL CAPS, no markdown):
    IN THE HIGH COURT OF __state__ AT __bench_location__
    WRIT PETITION NO. __writ_petition_number__ OF __year__
                      IN THE MATTER OF:
    __petitioner_name__                                          ...PETITIONER
                              VERSUS
    __respondent_name__                                         ...RESPONDENT
    PETITION UNDER ARTICLE 226 OF THE CONSTITUTION OF INDIA
  - Sections: BRIEF FACTS, GROUNDS FOR RELIEF (numbered A, B, C...), PRAYERS, AFFIDAVIT IN SUPPORT
  - End with: Advocate Name, Enrollment No., Firm Name, Date, Place
  - Include: URGENT MENTIONING APPLICATION (if applicable)
"""
    if any(x in doc for x in ["bail", "anticipatory bail", "criminal complaint", "quashing", "fir", "crpc", "bnss"]):
        return """
COURT FORMATTING — CRIMINAL / SESSIONS COURT:
  Document header (centered, ALL CAPS, no markdown):
    IN THE COURT OF THE HON'BLE __court_designation__
    AT __court_location__
    CRIMINAL MISC. APPLICATION NO. __application_number__ OF __year__
                      IN THE MATTER OF:
    __applicant_name__                                          ...APPLICANT/ACCUSED
                              VERSUS
    STATE OF __state__                                          ...RESPONDENT
  - Include: FIR No. __fir_number__, Police Station: __police_station__, Sections: __sections_of_offence__
  - Sections: FACTS OF THE CASE, GROUNDS FOR BAIL (numbered), PRAYER, AFFIDAVIT
  - Verification: "I, __deponent_name__, aged __age__ years, resident of __address__, do hereby solemnly affirm and state on oath..."
  - End with: Advocate Name, Enrollment No., Date, Place
"""
    if any(x in doc for x in ["civil suit", "plaint", "written statement", "execution application", "injunction", "district court", "summary suit"]):
        return """
COURT FORMATTING — CIVIL COURT / DISTRICT COURT:
  Document header (centered, ALL CAPS, no markdown):
    IN THE COURT OF THE HON'BLE __court_designation__
    AT __court_location__
    CIVIL SUIT NO. __suit_number__ OF __year__
    __plaintiff_name__                                          ...PLAINTIFF
                              VERSUS
    __defendant_name__                                         ...DEFENDANT
  - For Plaint sections: FACTS, CAUSE OF ACTION (with date), COURT JURISDICTION, LIMITATION, VALUATION OF SUIT, PRAYER
  - For Written Statement: PRELIMINARY OBJECTIONS (numbered), REPLY ON MERITS (para-wise), PRAYER
  - Verification: "I, __deponent_name__, Plaintiff/Defendant herein, do hereby verify that the contents of paragraphs ___ to ___ are true to my personal knowledge..."
  - Court Fee: "Court fee stamp of Rs. __court_fee_amount__ affixed"
  - End with: Advocate Name, Enrollment No., Date, Place
"""
    if any(x in doc for x in ["consumer complaint", "consumer forum", "ncdrc", "scdrc", "dcdrc"]):
        return """
COURT FORMATTING — CONSUMER FORUM:
  Document header (centered, ALL CAPS, no markdown):
    BEFORE THE __forum_name__
    [DISTRICT / STATE / NATIONAL] CONSUMER DISPUTES REDRESSAL COMMISSION
    AT __location__
    COMPLAINT NO. __complaint_number__ OF __year__
    __complainant_name__                                        ...COMPLAINANT
                              VERSUS
    __opposite_party_name__                                    ...OPPOSITE PARTY
  - Include: Date of purchase/service, Amount paid, Nature of defect/deficiency
  - Sections: FACTS, NATURE OF DEFICIENCY, PRAYER (with compensation amount), DOCUMENTS LIST, AFFIDAVIT
"""
    if any(x in doc for x in ["arbitration", "arbitral", "sec 34", "section 34", "sec 9", "section 9", "sec 11", "section 11"]):
        return """
COURT FORMATTING — ARBITRATION:
  Document header (centered, ALL CAPS, no markdown):
    IN THE MATTER OF ARBITRATION UNDER THE ARBITRATION AND CONCILIATION ACT, 1996
    ARBITRAL PROCEEDINGS BETWEEN:
    __claimant_name__                                           ...CLAIMANT
                              AND
    __respondent_name__                                        ...RESPONDENT
  - For court applications (Sec 9/34/36): use appropriate Civil Court header above it
  - Include: Arbitration Agreement dated __arbitration_agreement_date__, Seat: __seat_of_arbitration__
  - Sections: BACKGROUND, CLAIMS / GROUNDS (numbered), PRAYER, DOCUMENTS LIST
"""
    return ""  # No special court header for property/agreement/trust docs


def _get_legal_context(category: Optional[str]) -> Dict[str, Any]:
    """Return legal context for the given category (falls back to General)."""
    if not category:
        return LEGAL_CONTEXT_MAP["General"]
    # Try exact match first
    for key in LEGAL_CONTEXT_MAP:
        if key.lower() == category.lower():
            return LEGAL_CONTEXT_MAP[key]
    # Try partial match
    for key in LEGAL_CONTEXT_MAP:
        if key.lower() in category.lower() or category.lower() in key.lower():
            return LEGAL_CONTEXT_MAP[key]
    return LEGAL_CONTEXT_MAP["General"]


def _format_list(items: List[str]) -> str:
    return "\n".join(f"  - {item}" for item in items)


# ---------------------------------------------------------------------------
# Public: build_generation_prompt
# ---------------------------------------------------------------------------

def build_generation_prompt(requirements: Dict[str, Any]) -> str:
    """
    Build the full 3-layer prompt for Gemini legal template generation.

    Args:
        requirements: Dict with 20+ fields from the frontend Zustand store.
    Returns:
        Complete prompt string to send to Gemini.
    """
    ctx = _get_legal_context(requirements.get("category"))

    # -----------------------------------------------------------------------
    # LAYER 1 — System Identity & Hard Rules
    # -----------------------------------------------------------------------
    layer1 = """=== LAYER 1: SYSTEM IDENTITY & GENERATION RULES ===

You are an Expert Indian Legal Document Engineer with 25+ years of experience drafting court-accepted legal templates across all domains of Indian law.

MANDATORY OUTPUT RULES — VIOLATION OF ANY RULE MAKES THE OUTPUT INVALID:

1. PLACEHOLDER SYNTAX: Use ONLY __field_name__ (double underscores on BOTH sides) for ALL variable fields.
   NEVER use {{curly_brackets}}, [square_brackets], <angle_brackets>, or any other syntax.
   Field names must be: lowercase, snake_case, no spaces, no special characters except underscore.
   Example: __party_name__, __property_address__, __date_of_execution__

2. DOCUMENT STRUCTURE: EVERY document must have:
   (a) A centered TITLE in ALL CAPS
   (b) Numbered sections: 1., 2., 3. with subsections 1.1, 1.2, etc.
   (c) PARTIES section defining all parties with placeholders
   (d) RECITALS / WHEREAS clauses (background)
   (e) Main body clauses (numbered)
   (f) SIGNATURE BLOCK at the end with witness lines
   (g) SCHEDULE / ANNEXURE (if property or complex documents)

3. LEGAL CITATIONS: Reference ONLY real, verifiable Indian statutes and case laws.
   Never fabricate section numbers or case citations.
   State the full Act name and year.

4. COMPLETENESS: Generate a COMPLETE, ready-to-use template.
   Do NOT skip sections. Do NOT use placeholders like "[Insert clause here]".
   Every clause must be fully drafted with appropriate __placeholders__ for variable data.

5. LANGUAGE: Draft in clear, formal legal English unless bilingual is specified.
   If bilingual (English + Hindi/Marathi/etc.) is requested, include a translated version after each section.

6. FIELD NAMING CONVENTIONS:
   - Parties: __party1_name__, __party1_address__, __party1_pan__, __party2_name__, etc.
   - Dates: __date_of_execution__, __commencement_date__, __expiry_date__
   - Money: __consideration_amount__, __monthly_rent__, __security_deposit__
   - Places: __property_address__, __court_jurisdiction__, __state__
   - IDs: __aadhar_number__, __pan_number__, __gstin__

7. ANTI-HALLUCINATION: If a specific legal provision is uncertain, state "as per applicable law" rather than citing an incorrect section.

OUTPUT FORMAT:
- Plain text (no markdown except for the title)
- Use line breaks generously for readability
- Indent subsections with spaces
- All caps for section headings
- Signature block must have 3 spaces for sign + witness lines
"""

    # -----------------------------------------------------------------------
    # LAYER 2 — Legal Knowledge Context (category-specific)
    # -----------------------------------------------------------------------
    sections_text = _format_list(ctx["mandatory_sections"])
    acts_text = _format_list(ctx["relevant_acts"])
    case_law_text = _format_list(ctx["case_law"]) if ctx["case_law"] else "  - (Apply general Indian contract law principles)"

    layer2 = f"""
=== LAYER 2: LEGAL KNOWLEDGE CONTEXT ===

DOCUMENT CATEGORY: {ctx['label']}

GOVERNING LEGAL FRAMEWORK:
{ctx['governing_law']}

APPLICABLE ACTS AND STATUTES:
{acts_text}

RELEVANT CASE LAW (cite as appropriate):
{case_law_text}

MANDATORY SECTIONS FOR THIS DOCUMENT TYPE (include ALL of these):
{sections_text}
"""

    # -----------------------------------------------------------------------
    # LAYER 3 — User Requirements Mapping
    # -----------------------------------------------------------------------
    subject = requirements.get("subject", "Legal Document")
    category = requirements.get("category", "General")
    property_type = requirements.get("propertyType", "")
    party_type = requirements.get("partyType", "")
    jurisdiction = requirements.get("jurisdiction", "India")
    state = requirements.get("state", "")
    language = requirements.get("language", "English")
    detail_level = requirements.get("detailLevel", "standard")
    urgency = requirements.get("urgency", "normal")
    num_parties = requirements.get("numParties", 2)
    party_roles = requirements.get("partyRoles", [])
    special_clauses = requirements.get("specialClauses", [])
    schedules = requirements.get("schedules", [])
    free_text = requirements.get("freeText", "")
    template_name = requirements.get("templateName", subject)
    duration = requirements.get("duration", "")
    consideration = requirements.get("consideration", "")
    governing_state = requirements.get("governingState", state or jurisdiction)
    dispute_resolution = requirements.get("disputeResolution", "Arbitration")
    confidentiality = requirements.get("confidentiality", False)
    non_compete = requirements.get("nonCompete", False)
    ip_clause = requirements.get("ipClause", False)
    force_majeure = requirements.get("forceMajeure", True)
    indemnity = requirements.get("indemnity", False)
    court_name = requirements.get("courtName", "")
    case_number = requirements.get("caseNumber", "")
    petitioner_name = requirements.get("petitionerName", "")
    purpose = requirements.get("purpose", "")
    context_notes = requirements.get("contextNotes", "")

    # Build detail instruction
    detail_map = {
        "brief": "BRIEF — 1-2 pages, essential clauses only, minimal boilerplate",
        "standard": "STANDARD — 3-5 pages, full professional template, all necessary clauses",
        "comprehensive": "COMPREHENSIVE — 8-12 pages, exhaustive coverage, all optional clauses included, sub-clauses for every provision",
        "ultra_detailed": "ULTRA-DETAILED — 15+ pages, include sub-sections, explanatory notes in brackets, ALL optional clauses, detailed schedules",
    }
    detail_instruction = detail_map.get(detail_level, detail_map["standard"])

    # Build urgency note
    urgency_note = ""
    if urgency == "high":
        urgency_note = "NOTE: This is a HIGH-URGENCY document. Include bold/prominent warnings for time-sensitive obligations."
    elif urgency == "critical":
        urgency_note = "CRITICAL: Add 'TIME IS OF THE ESSENCE' clause prominently in the agreement."

    # Build party instructions
    party_instructions = ""
    if party_roles:
        party_instructions = "PARTY ROLES:\n" + "\n".join(f"  - Party {i+1}: {role}" for i, role in enumerate(party_roles))
    else:
        party_instructions = f"NUMBER OF PARTIES: {num_parties}\n  - Use generic Party 1 and Party 2 naming unless subject implies specific roles."
    if party_type:
        party_instructions += f"\n  - Party Type Context: {party_type}"

    # Build special clauses section
    clause_instructions = ""
    if special_clauses:
        clause_instructions = "SPECIAL CLAUSES TO INCLUDE (mandatory):\n" + "\n".join(f"  - {c}" for c in special_clauses)

    # Build schedules section
    schedule_instructions = ""
    if schedules:
        schedule_instructions = "SCHEDULES / ANNEXURES TO INCLUDE:\n" + "\n".join(f"  - Schedule {i+1}: {s}" for i, s in enumerate(schedules))

    # Build property context
    property_context = ""
    if property_type:
        property_context = f"PROPERTY TYPE: {property_type}"

    # Build court context
    court_context = ""
    if court_name or case_number:
        court_context = f"COURT DETAILS: {court_name or 'Competent Court of Jurisdiction'}"
        if case_number:
            court_context += f"\n  Case No.: {case_number} (use __case_number__ placeholder)"

    # Language instruction
    lang_instruction = ""
    if "bilingual" in language.lower() or ("+" in language):
        parts = language.split("+")
        lang_instruction = f"LANGUAGE: Bilingual — Draft in {parts[0].strip()} with {parts[1].strip() if len(parts) > 1 else 'Hindi'} translation of key clauses."
    elif language.lower() != "english":
        lang_instruction = f"LANGUAGE: {language} — Draft the entire document in {language}."
    else:
        lang_instruction = "LANGUAGE: English (formal legal English)"

    court_format = _get_court_format(subject)

    layer3 = f"""
=== LAYER 3: USER REQUIREMENTS — GENERATE EXACTLY THIS TEMPLATE ===

TEMPLATE NAME: {template_name}
DOCUMENT TYPE: {subject}
CATEGORY: {category}
{property_context}
JURISDICTION: {jurisdiction}{(' — ' + state) if state else ''}
GOVERNING STATE LAW: {governing_state}
{court_format}

{party_instructions}

DETAIL LEVEL: {detail_instruction}
{urgency_note}

{lang_instruction}

FINANCIAL TERMS:
  - Consideration/Amount: {consideration if consideration else 'Use __consideration_amount__ placeholder'}
  - Duration/Term: {duration if duration else 'Use __duration__ placeholder'}

DISPUTE RESOLUTION MECHANISM: {dispute_resolution}
  - Include a {dispute_resolution} clause with:
    - Seat: {governing_state}
    - Language: English
    - Number of Arbitrators: 1 (sole arbitrator)

{f"CONFIDENTIALITY CLAUSE: Include comprehensive Non-Disclosure and Confidentiality clause." if confidentiality else ""}
{f"NON-COMPETE CLAUSE: Include a time-bound, geographically limited Non-Compete clause." if non_compete else ""}
{f"INTELLECTUAL PROPERTY CLAUSE: Include IP ownership, assignment, and licensing provisions." if ip_clause else ""}
{f"FORCE MAJEURE CLAUSE: Include comprehensive Force Majeure clause covering natural disasters, pandemics, government actions, etc." if force_majeure else ""}
{f"INDEMNIFICATION CLAUSE: Include mutual/unilateral indemnification and hold harmless clause." if indemnity else ""}

{clause_instructions}

{schedule_instructions}

{court_context}

PURPOSE OF DOCUMENT: {purpose if purpose else 'Standard legal template for the stated subject matter'}

ADDITIONAL INSTRUCTIONS FROM USER:
{free_text if free_text else '(None — use professional legal judgment for all unstated aspects)'}

{f"ADDITIONAL CONTEXT: {context_notes}" if context_notes else ""}

---
NOW GENERATE THE COMPLETE LEGAL TEMPLATE.
Start directly with the document title (centered, ALL CAPS).
Use __placeholder__ syntax for ALL variable fields.
"""

    full_prompt = layer1 + layer2 + layer3
    return full_prompt


def extract_template_name(requirements: Dict[str, Any]) -> str:
    """Derive a clean template name from requirements."""
    name = requirements.get("templateName") or requirements.get("subject") or "Legal Template"
    category = requirements.get("category", "")
    jurisdiction = requirements.get("jurisdiction", "")
    parts = [name]
    if category and category.lower() not in name.lower():
        parts.append(f"({category})")
    if jurisdiction and jurisdiction.lower() not in name.lower():
        parts.append(f"— {jurisdiction}")
    return " ".join(parts)
