"""
Template Generation Router — Claude-powered
--------------------------------------------
POST /analysis/get-questions     → Claude generates document-specific questions (JSON)
POST /analysis/generate-template → Claude drafts the full legal template
POST /analysis/save-generated    → Save generated template to user's library

Flow:
  1. User picks document type
  2. Frontend calls GET-QUESTIONS → Claude returns 5-7 tailored questions as JSON
  3. User answers each question one-by-one in the chat UI
  4. Frontend calls GENERATE-TEMPLATE with document_type + answers
  5. Claude drafts the complete template with __placeholder__ syntax
  6. User reviews, then saves via SAVE-GENERATED
"""

import uuid
import re
import json
import logging
from typing import Any, Dict, List, Optional
from datetime import datetime

import anthropic
from fastapi import APIRouter, HTTPException, Header, Depends
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models.db_models import UserTemplate, UserTemplateField, UserTemplateAnalysisSection
from ..config import settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/analysis", tags=["Template Generation"])

# ── Claude client ──────────────────────────────────────────────────────────────
_claude = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)
CLAUDE_MODEL = "claude-sonnet-4-5"


# ──────────────────────────────────────────────────────────────────────────────
# Pydantic Schemas
# ──────────────────────────────────────────────────────────────────────────────

class GetQuestionsRequest(BaseModel):
    document_type: str = Field(..., description="The type of legal document, e.g. 'Leave and Licence Agreement'")


class DynamicQuestion(BaseModel):
    id: str
    question: str
    placeholder: Optional[str] = ""
    type: str = "text"          # text | textarea | date | number | select
    required: bool = True
    hint: Optional[str] = None
    options: Optional[List[str]] = None

    def model_post_init(self, __context: Any) -> None:
        if self.placeholder is None:
            object.__setattr__(self, 'placeholder', '')


class GetQuestionsResponse(BaseModel):
    success: bool
    document_type: str
    questions: List[DynamicQuestion]


class GenerateTemplateRequest(BaseModel):
    document_type: str
    answers: Dict[str, str]               # question_id → answer
    questions: List[Dict[str, Any]]       # original questions for context
    jurisdiction: Optional[str] = "India"
    language: Optional[str] = "English"


class GenerateResponse(BaseModel):
    success: bool
    templateText: str
    fields: List[Dict[str, Any]]
    sections: List[Dict[str, Any]]
    metadata: Dict[str, Any]


class SaveGeneratedRequest(BaseModel):
    templateText: str
    fields: List[Dict[str, Any]]
    sections: List[Dict[str, Any]]
    metadata: Dict[str, Any]
    requirements: Optional[Dict[str, Any]] = {}


class SaveGeneratedResponse(BaseModel):
    success: bool
    templateId: str
    message: str


# ──────────────────────────────────────────────────────────────────────────────
# Field Extraction
# ──────────────────────────────────────────────────────────────────────────────

# Matches __FIELD_NAME__, __field_name__, __FieldName__ — any valid identifier between __
# Case-insensitive; normalised to lowercase snake_case after matching.
_PLACEHOLDER_RE = re.compile(r'__([A-Za-z][A-Za-z0-9_]*)__')


def _normalise_id(raw: str) -> str:
    """Convert ANY casing to lowercase snake_case: PARTY_A_NAME → party_a_name."""
    return raw.lower()


def _label(fid: str) -> str:
    return fid.replace("_", " ").title()


def _field_type(fid: str) -> str:
    n = fid.lower()
    if any(k in n for k in ("date", "day", "month", "year", "dob", "expiry")): return "date"
    if any(k in n for k in ("amount", "rent", "deposit", "fee", "salary", "price", "cost",
                             "consideration", "sum", "value", "penalty", "royalty", "interest")): return "number"
    if any(k in n for k in ("address", "description", "purpose", "details", "notes",
                             "clause", "terms", "recital", "background", "schedule",
                             "obligation", "condition", "provision")): return "textarea"
    return "text"


def _group(fid: str) -> str:
    n = fid.lower()
    if any(p in n for p in ("party_a", "party1", "party_1", "lessor", "licensor", "vendor",
                             "employer", "seller", "owner", "lender", "plaintiff",
                             "petitioner", "disclosing", "assignor", "licensor")): return "Party 1"
    if any(p in n for p in ("party_b", "party2", "party_2", "lessee", "licensee", "buyer",
                             "employee", "purchaser", "borrower", "defendant",
                             "respondent", "receiving", "assignee")): return "Party 2"
    if any(k in n for k in ("date", "day", "month", "year", "duration", "term",
                             "period", "validity", "expiry", "commencement", "notice")): return "Dates & Duration"
    if any(k in n for k in ("amount", "rent", "deposit", "fee", "salary", "price",
                             "consideration", "payment", "sum", "penalty", "interest",
                             "royalty", "advance", "compensation")): return "Financial"
    if any(k in n for k in ("address", "property", "location", "city", "state",
                             "pin", "district", "premises", "plot", "survey")): return "Location"
    if any(k in n for k in ("court", "case", "suit", "petitioner", "respondent",
                             "advocate", "judge", "tribunal", "fir", "section")): return "Court Details"
    if any(k in n for k in ("witness", "sign", "signature", "notary",
                             "attested", "seal", "stamp")): return "Signatures"
    return "General"


def extract_fields(text: str) -> List[Dict[str, Any]]:
    """
    Extract all __placeholder__ fields from template text.
    - Case-insensitive matching (handles __PARTY_NAME__, __party_name__, __PartyName__)
    - Normalises all field IDs to lowercase snake_case
    - Deduplicates
    """
    seen: set = set()
    fields = []
    for m in _PLACEHOLDER_RE.finditer(text):
        raw_id = m.group(1)
        fid = _normalise_id(raw_id)
        if fid in seen:
            continue
        seen.add(fid)
        fields.append({
            "fieldId": fid,
            "label": _label(fid),
            "type": _field_type(fid),
            "required": True,
            "group": _group(fid),
        })
    return fields


# ──────────────────────────────────────────────────────────────────────────────
# Section Parsing
# ──────────────────────────────────────────────────────────────────────────────

def _detect_heading(line: str) -> Optional[str]:
    """
    Return the section name if this line is a TOP-LEVEL section heading, else None.

    Only recognises:
      1. Markdown level-1 heading:  # HEADING
      2. Top-level numbered section: 1. HEADING  (NOT sub-clauses 1.1, 2.3 etc.)
      3. ALL-CAPS standalone title:  PARTIES / RECITALS / DEFINITIONS
         — must be 6+ chars, no trailing colon (colons mark labels/sub-items,
           not section headings), no lowercase, no __placeholders__

    Deliberately excluded:
      - ##/### markdown (sub-headings)
      - **bold** lines  (inline emphasis, not section markers)
      - Numbered sub-clauses: 1.1, 2.3, 10.4 …
      - Short labels ending in colon: VENDOR 1:  BY AND BETWEEN:  NAME:
    """
    s = line.strip()
    if not s or len(s) < 4:
        return None

    # 1. Markdown level-1 only: # HEADING
    md = re.match(r'^#\s+(.+)$', s)
    if md:
        clean = re.sub(r'\*\*', '', md.group(1)).strip()
        return clean.upper() if clean else None

    # 2. Top-level numbered section: "1. HEADING" — but NOT "1.1 ..." or "10.4 ..."
    numbered = re.match(r'^(\d{1,2})\.\s+([A-Za-z][A-Za-z0-9\s\/&,\-]{2,})$', s)
    if numbered:
        return f"{numbered.group(1)}. {numbered.group(2).strip().upper()}"

    # 3. ALL-CAPS title line:
    #    - 6+ chars
    #    - no lowercase letters
    #    - no __placeholders__
    #    - does NOT end with ':' (colon = label/sub-item, not a heading)
    if (
        len(s) >= 6
        and not re.search(r'[a-z]', s)
        and '__' not in s
        and not s.endswith(':')
        and re.match(r'^[A-Z][A-Z0-9\s\/&,\-\.\(\)]{5,}$', s)
    ):
        return s

    return None


def parse_sections(text: str) -> List[Dict[str, Any]]:
    """
    Parse the template into named sections.
    Handles markdown, bold, numbered, and ALL-CAPS headings.
    """
    lines = text.split("\n")
    sections: List[Dict[str, Any]] = []
    current: Optional[Dict[str, Any]] = None
    order = 0

    for line in lines:
        name = _detect_heading(line)
        if name:
            if current:
                current["content"] = current["content"].strip()
                sections.append(current)
            current = {
                "section_name": name,
                "section_purpose": f"Section: {name.title()}",
                "section_intro": "",
                "section_prompts": [],
                "order_index": order,
                "content": "",
            }
            order += 1
        elif current is not None:
            current["content"] += line + "\n"

    if current:
        current["content"] = current["content"].strip()
        sections.append(current)

    if not sections:
        sections.append({
            "section_name": "FULL DOCUMENT",
            "section_purpose": "Complete template content",
            "section_intro": "",
            "section_prompts": [],
            "order_index": 0,
            "content": text.strip(),
        })

    return sections


# ──────────────────────────────────────────────────────────────────────────────
# Claude helpers
# ──────────────────────────────────────────────────────────────────────────────

_QUESTIONS_SYSTEM = """You are an expert Indian legal document specialist.
Generate specific questions to collect all information needed to draft a legal document.

Return ONLY a valid JSON array (no markdown, no explanation, no code fences).
Each object must have exactly these keys:
  "id"          : snake_case identifier (e.g. "party1_name", "property_address")
  "question"    : clear, specific question text
  "placeholder" : realistic example answer
  "type"        : one of "text" | "textarea" | "date" | "number" | "select"
  "required"    : true or false
  "hint"        : helpful legal tip or null
  "options"     : array of string options only when type=="select", else null

Rules:
- 5 to 7 questions only
- Cover: party details, key terms, dates/duration, financial terms, jurisdiction, any special conditions
- Use precise legal terminology appropriate to the document type
- Make questions specific enough that answers give Claude everything needed to draft the document"""


_GENERATION_SYSTEM = """You are an expert Indian legal document drafter with 25 years of experience across all areas of Indian law: Contract Act 1872, Transfer of Property Act 1882, Companies Act 2013, Family Law, CrPC, CPC, and all other relevant statutes.

Your task: Draft a complete, professional, legally enforceable template.

CRITICAL PLACEHOLDER RULES — follow EXACTLY:
1. Every variable field MUST use __lowercase_snake_case__ format (double underscores on BOTH sides, NO capitals)
   CORRECT:  __party1_name__  __agreement_date__  __rent_amount__  __property_address__  __governing_state__
   WRONG:    __PartyName__    __PARTY_NAME__       __Party_Name__   [party name]         {party_name}
2. ALWAYS use lowercase snake_case inside placeholders — never uppercase, never spaces
3. Every single variable — names, dates, amounts, addresses, numbers, court names — MUST be a __placeholder__
4. Use descriptive names: __party1_full_name__, __party1_address__, __monthly_rent_amount__, __agreement_start_date__
5. Signature block must have: __party1_signature__, __party1_name__, __party1_date__, __witness1_name__, etc.

DOCUMENT STRUCTURE RULES:
6. Start with document TITLE in ALL CAPS on its own line (no # symbols, no **)
7. Use numbered main sections: 1. DEFINITIONS  2. PARTIES  3. RECITALS  4. OBLIGATIONS  etc.
8. Use numbered sub-clauses: 1.1  1.2  2.1  2.2  etc.
9. ALL section headings must be in ALL CAPS
10. Include all standard sections: Title, Parties, Recitals/Background, Definitions, Operative Clauses, Representations & Warranties, Term & Termination, Governing Law, Dispute Resolution, Miscellaneous, Signature Block
11. Minimum 1500 words — be thorough, comprehensive and professionally worded
12. The document must be ready to use in Indian courts and for official registration"""


async def _call_claude_json(system: str, user_msg: str) -> str:
    """Call Claude and return raw text (expected to be JSON)."""
    try:
        resp = _claude.messages.create(
            model=CLAUDE_MODEL,
            max_tokens=2048,
            system=system,
            messages=[{"role": "user", "content": user_msg}],
        )
        return resp.content[0].text.strip()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Claude API error: {e}")


async def _call_claude_template(system: str, user_msg: str) -> str:
    """Call Claude for long template generation."""
    try:
        resp = _claude.messages.create(
            model=CLAUDE_MODEL,
            max_tokens=8192,
            system=system,
            messages=[{"role": "user", "content": user_msg}],
        )
        return resp.content[0].text.strip()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Claude API error: {e}")


# ──────────────────────────────────────────────────────────────────────────────
# Endpoint 1: Get dynamic questions
# ──────────────────────────────────────────────────────────────────────────────

@router.post("/get-questions", response_model=GetQuestionsResponse)
async def get_questions(
    body: GetQuestionsRequest,
    x_user_id: Optional[str] = Header(None),
):
    """
    Claude generates 5-7 document-specific questions for the selected document type.
    Frontend shows these one-by-one in the Q&A chat.
    """
    if not x_user_id:
        raise HTTPException(status_code=400, detail="X-User-Id header is required")

    logger.info(f"[GetQuestions] user={x_user_id} doc_type={body.document_type!r}")

    user_msg = f'Generate questions for: "{body.document_type}" (Indian jurisdiction)'
    raw = await _call_claude_json(_QUESTIONS_SYSTEM, user_msg)

    # Strip markdown code fences if Claude wraps in ```json ... ```
    raw = re.sub(r'^```(?:json)?\s*', '', raw, flags=re.MULTILINE)
    raw = re.sub(r'\s*```$', '', raw, flags=re.MULTILINE)

    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        logger.error(f"[GetQuestions] JSON parse error: {e}\nRaw: {raw[:500]}")
        raise HTTPException(status_code=502, detail=f"Failed to parse questions from AI: {e}")

    # Coerce null/missing values before Pydantic validation
    for q in data:
        if q.get('placeholder') is None:
            q['placeholder'] = ''
        if q.get('hint') is None:
            q['hint'] = None
        if q.get('options') is None:
            q['options'] = None
    questions = [DynamicQuestion(**q) for q in data]
    logger.info(f"[GetQuestions] Generated {len(questions)} questions for {body.document_type!r}")
    return GetQuestionsResponse(success=True, document_type=body.document_type, questions=questions)


# ──────────────────────────────────────────────────────────────────────────────
# Endpoint 2: Generate template
# ──────────────────────────────────────────────────────────────────────────────

@router.post("/generate-template", response_model=GenerateResponse)
async def generate_template(
    body: GenerateTemplateRequest,
    x_user_id: Optional[str] = Header(None),
):
    """
    Claude generates the complete legal template from user's answers.
    Returns raw template text + extracted fields + parsed sections.
    Does NOT save to DB — user reviews first.
    """
    if not x_user_id:
        raise HTTPException(status_code=400, detail="X-User-Id header is required")

    logger.info(f"[Generate] user={x_user_id} doc={body.document_type!r} answers={len(body.answers)}")

    # Build the user message with all collected answers
    qa_lines = []
    for q in body.questions:
        qid = q.get("id", "")
        question_text = q.get("question", qid)
        answer = body.answers.get(qid, "Not provided")
        qa_lines.append(f"  • {question_text}\n    Answer: {answer}")

    user_msg = f"""Draft a complete "{body.document_type}" legal template for Indian jurisdiction.

User has provided the following information:
{chr(10).join(qa_lines)}

Additional details:
  • Jurisdiction: {body.jurisdiction}
  • Language: {body.language}

Create a comprehensive, production-ready template with all standard legal sections.
Use __placeholder__ syntax for all variable fields throughout the document."""

    template_text = await _call_claude_template(_GENERATION_SYSTEM, user_msg)
    logger.info(f"[Generate] Claude returned {len(template_text)} chars")

    fields = extract_fields(template_text)
    sections = parse_sections(template_text)

    metadata = {
        "generatedAt": datetime.utcnow().isoformat(),
        "documentType": body.document_type,
        "templateName": body.document_type,
        "category": _infer_category(body.document_type),
        "jurisdiction": body.jurisdiction,
        "language": body.language,
        "totalFields": len(fields),
        "totalSections": len(sections),
        "model": CLAUDE_MODEL,
    }

    return GenerateResponse(success=True, templateText=template_text, fields=fields, sections=sections, metadata=metadata)


def _infer_category(doc_type: str) -> str:
    t = doc_type.lower()
    if any(k in t for k in ("lease", "rent", "sale deed", "gift deed", "property", "mortgage", "licence")): return "Property"
    if any(k in t for k in ("employment", "offer letter", "appointment", "termination", "non-compete")): return "Employment"
    if any(k in t for k in ("bail", "writ", "petition", "suit", "complaint", "plaint", "cpc", "crpc")): return "Court"
    if any(k in t for k in ("will", "testament", "divorce", "custody", "maintenance", "family", "marriage")): return "Family"
    if any(k in t for k in ("trust", "charity", "society", "foundation")): return "Trust"
    if any(k in t for k in ("nda", "non-disclosure", "service", "mou", "joint venture", "partnership", "shareholders", "agreement", "contract")): return "Agreement"
    return "General"


# ──────────────────────────────────────────────────────────────────────────────
# Endpoint 3: Save generated template
# ──────────────────────────────────────────────────────────────────────────────

@router.post("/save-generated", response_model=SaveGeneratedResponse)
async def save_generated_template(
    body: SaveGeneratedRequest,
    x_user_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_db),
):
    if not x_user_id:
        raise HTTPException(status_code=400, detail="X-User-Id header is required")
    try:
        user_id_int = int(x_user_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid X-User-Id format")

    meta = body.metadata or {}
    name = meta.get("templateName") or meta.get("documentType") or body.requirements.get("document_type") or "Generated Template"
    category = meta.get("category") or "General"
    language = meta.get("language") or "en"
    lang_code = "en" if "english" in language.lower() else language[:5].lower()

    new_template = UserTemplate(
        template_id=uuid.uuid4(),
        template_name=name,
        category=category,
        sub_category="AI Generated",
        language=lang_code,
        status="active",
        description=f"AI-generated {name} template. Jurisdiction: {meta.get('jurisdiction', 'India')}. Model: {meta.get('model', CLAUDE_MODEL)}.",
        user_id=user_id_int,
        image_url=None,
        file_url=None,
    )
    db.add(new_template)
    await db.flush()
    tid = new_template.template_id

    if body.fields:
        db.add(UserTemplateField(template_id=tid, template_fields=body.fields, is_active=True))

    for sec in body.sections:
        db.add(UserTemplateAnalysisSection(
            template_id=tid,
            section_name=sec.get("section_name", "Section"),
            section_purpose=sec.get("section_purpose", ""),
            section_intro=sec.get("section_intro", ""),
            section_prompts=sec.get("section_prompts", []),
            order_index=sec.get("order_index", 0),
            is_active=True,
        ))

    if not body.sections:
        db.add(UserTemplateAnalysisSection(
            template_id=tid, section_name="FULL DOCUMENT",
            section_purpose="Complete AI-generated template",
            section_intro=body.templateText[:500] if body.templateText else "",
            section_prompts=[{"type": "text", "content": body.templateText}],
            order_index=0, is_active=True,
        ))

    await db.commit()
    logger.info(f"[Save] Saved template {tid} for user {user_id_int} ({name})")
    return SaveGeneratedResponse(success=True, templateId=str(tid), message=f'Template "{name}" saved to your library.')
