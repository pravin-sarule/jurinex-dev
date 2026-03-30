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
import io
import zipfile
import textwrap
from typing import Any, Dict, List, Optional
from datetime import datetime
from xml.etree import ElementTree

import anthropic
from fastapi import APIRouter, HTTPException, Header, Depends, UploadFile, File, Form, BackgroundTasks
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models.db_models import UserTemplate, UserTemplateField
from ..config import settings
from ..services.document_ai_service import DocumentAIService
from .analysis import enqueue_template_analysis, _normalize_placeholder_spacing

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/analysis", tags=["Template Generation"])

# ── Claude client ──────────────────────────────────────────────────────────────
_claude = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)
CLAUDE_MODEL = "claude-sonnet-4-5"
doc_ai = DocumentAIService()


# ──────────────────────────────────────────────────────────────────────────────
# Pydantic Schemas
# ──────────────────────────────────────────────────────────────────────────────

class GetQuestionsRequest(BaseModel):
    document_type: str = Field(..., description="The type of legal document, e.g. 'Leave and Licence Agreement'")


class DynamicQuestion(BaseModel):
    id: str
    question: str
    placeholder: Optional[str] = ""
    type: str = "text"          # text | textarea | date | number | select | single_select | multi_select | yes_no | range
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
    reference_document_text: Optional[str] = None
    reference_document_name: Optional[str] = None


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


class GetStructureQuestionsRequest(BaseModel):
    description: str = Field(..., description="User's free-text description of the document they want")
    jurisdiction: Optional[str] = "India"
    reference_document_text: Optional[str] = None
    reference_document_name: Optional[str] = None


class GetStructureQuestionsResponse(BaseModel):
    success: bool
    description: str
    questions: List[DynamicQuestion]


# ──────────────────────────────────────────────────────────────────────────────
def _extract_docx_text(file_content: bytes) -> str:
    with zipfile.ZipFile(io.BytesIO(file_content)) as archive:
        document_xml = archive.read("word/document.xml")

    root = ElementTree.fromstring(document_xml)
    namespace = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
    paragraphs: List[str] = []

    for paragraph in root.findall(".//w:p", namespace):
        runs = [node.text for node in paragraph.findall(".//w:t", namespace) if node.text]
        text = "".join(runs).strip()
        if text:
            paragraphs.append(text)

    return "\n".join(paragraphs)


async def _extract_reference_document_text(reference_document: UploadFile) -> str:
    file_content = await reference_document.read()
    filename = (reference_document.filename or "").lower()
    content_type = (reference_document.content_type or "").lower()

    if not file_content:
        raise HTTPException(status_code=400, detail="Uploaded reference document is empty")

    if filename.endswith(".pdf") or content_type == "application/pdf":
        return await doc_ai.parallel_process_pdf(file_content)

    if filename.endswith(".docx") or content_type in {
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/msword",
    }:
        try:
            return _extract_docx_text(file_content)
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"Could not read DOCX reference document: {exc}") from exc

    if filename.endswith(".txt") or content_type.startswith("text/") or not content_type:
        return file_content.decode("utf-8", errors="ignore")

    raise HTTPException(status_code=400, detail="Unsupported reference document type. Use PDF, DOCX, or TXT.")


async def _extract_reference_documents_text(reference_documents: List[UploadFile]) -> tuple[str, List[str]]:
    texts: List[str] = []
    names: List[str] = []

    for document in reference_documents:
        text = await _extract_reference_document_text(document)
        if text.strip():
            names.append(document.filename or "uploaded reference document")
            texts.append(f'DOCUMENT: {document.filename or "uploaded reference document"}\n{text.strip()}')

    if not texts:
        raise HTTPException(status_code=400, detail="Uploaded reference documents did not contain readable text")

    return "\n\n".join(texts), names


def _truncate_reference_text(reference_document_text: Optional[str], limit: int = 12000) -> str:
    text = (reference_document_text or "").strip()
    if not text:
        return ""
    if len(text) <= limit:
        return text
    return f"{text[:limit]}\n\n[TRUNCATED: reference document shortened for prompt safety]"


def _reference_document_block(reference_document_text: Optional[str], reference_document_name: Optional[str]) -> str:
    excerpt = _truncate_reference_text(reference_document_text)
    if not excerpt:
        return ""

    name = reference_document_name or "uploaded reference document"
    return (
        f'REFERENCE DOCUMENT PROVIDED: "{name}"\n'
        "Treat this as the factual ceiling for what data and sections the eventual template should expect.\n"
        "Do not introduce extra tables, schedules, party blocks, or data-heavy fields unless the document clearly supports them.\n"
        "If the document reflects only a smaller set of facts, keep the template lean and aligned to that scope.\n\n"
        f"REFERENCE DOCUMENT EXCERPT:\n{excerpt}\n"
    )


def _reference_scope_rules(reference_document_text: Optional[str]) -> str:
    text = (reference_document_text or "").strip()
    if not text:
        return ""

    lower = text.lower()
    party_indices = set()
    for m in re.finditer(r'\b(?:petitioner|respondent|party)\s*(?:no\.?\s*)?(\d+)\b', lower):
        try:
            party_indices.add(int(m.group(1)))
        except Exception:
            continue

    max_party_index = max(party_indices) if party_indices else 0
    has_annexure = bool(re.search(r'\bannexure\b', lower))
    has_schedule = bool(re.search(r'\bschedule\b', lower))

    rules = [
        "BINDING REFERENCE SCOPE LIMITS:",
        "- Only include sections and placeholders that are clearly supported by the uploaded reference document(s).",
        "- Do not invent extra party blocks, extra factual tracks, or speculative compliance sections.",
        "- Keep the fill-up field set minimal and proportional to the reference document scope.",
    ]
    if max_party_index > 0:
        rules.append(f"- Maximum numbered party/person profile blocks: {max_party_index}. Do not exceed this count.")
    if not has_annexure:
        rules.append("- Do not create Annexure lists unless expressly required by user answers or statute.")
    if not has_schedule:
        rules.append("- Do not create additional Schedules unless expressly required by user answers.")

    return "\n".join(rules)


def _escape_pdf_text(value: str) -> str:
    return value.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def _build_text_pdf_bytes(text: str) -> bytes:
    """
    Create a simple, dependency-free PDF from plain text.
    This preserves line structure and placeholder tokens for archival/GCS storage.
    """
    safe_text = (text or "").replace("\r\n", "\n").replace("\r", "\n")
    lines: List[str] = []
    for raw in safe_text.split("\n"):
        wrapped = textwrap.wrap(raw, width=95, break_long_words=False, break_on_hyphens=False)
        lines.extend(wrapped if wrapped else [""])

    lines_per_page = 50
    pages = [lines[i:i + lines_per_page] for i in range(0, len(lines), lines_per_page)] or [[""]]
    objects: Dict[int, bytes] = {
        1: b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",  # Font
    }

    next_id = 3  # 2 is reserved for /Pages
    page_ids: List[int] = []

    for page_lines in pages:
        text_commands = ["BT", "/F1 11 Tf", "50 800 Td", "14 TL"]
        first_line = True
        for line in page_lines:
            try:
                line_latin = line.encode("latin-1", errors="replace").decode("latin-1")
            except Exception:
                line_latin = line
            escaped = _escape_pdf_text(line_latin)
            if first_line:
                text_commands.append(f"({escaped}) Tj")
                first_line = False
            else:
                text_commands.append("T*")
                text_commands.append(f"({escaped}) Tj")
        text_commands.append("ET")
        stream_data = "\n".join(text_commands).encode("latin-1", errors="replace")
        stream_obj = b"<< /Length " + str(len(stream_data)).encode("ascii") + b" >>\nstream\n" + stream_data + b"\nendstream"
        content_id = next_id
        next_id += 1
        objects[content_id] = stream_obj

        page_id = next_id
        next_id += 1
        page_obj = f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents {content_id} 0 R /Resources << /Font << /F1 1 0 R >> >> >>".encode("ascii")
        objects[page_id] = page_obj
        page_ids.append(page_id)

    kids = " ".join(f"{pid} 0 R" for pid in page_ids)
    objects[2] = f"<< /Type /Pages /Kids [{kids}] /Count {len(page_ids)} >>".encode("ascii")

    catalog_id = next_id
    objects[catalog_id] = b"<< /Type /Catalog /Pages 2 0 R >>"

    output = io.BytesIO()
    output.write(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")

    offsets = [0]
    total_objects = catalog_id
    for idx in range(1, total_objects + 1):
        obj = objects[idx]
        offsets.append(output.tell())
        output.write(f"{idx} 0 obj\n".encode("ascii"))
        output.write(obj)
        output.write(b"\nendobj\n")

    xref_start = output.tell()
    output.write(f"xref\n0 {total_objects + 1}\n".encode("ascii"))
    output.write(b"0000000000 65535 f \n")
    for off in offsets[1:]:
        output.write(f"{off:010d} 00000 n \n".encode("ascii"))
    output.write(
        f"trailer\n<< /Size {total_objects + 1} /Root {catalog_id} 0 R >>\nstartxref\n{xref_start}\n%%EOF".encode("ascii")
    )
    return output.getvalue()


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


def _normalize_generated_template_text(text: str) -> str:
    """
    Normalize common markdown-like artifacts into professional legal text.
    Keeps __placeholder__ tokens intact.
    """
    if not text:
        return ""

    t = text.replace("\r\n", "\n").replace("\r", "\n")
    t = re.sub(r"^```[a-zA-Z]*\s*", "", t)
    t = re.sub(r"\n```$", "", t)
    t = t.replace("**", "")
    t = t.replace("`", "")

    normalized_lines: List[str] = []
    for raw_line in t.split("\n"):
        line = raw_line
        line = re.sub(r"^\s{0,3}#{1,6}\s+", "", line)  # markdown headings
        if re.match(r"^\s*[-*]\s+(?!\|)", line):       # markdown bullets (not tables)
            line = re.sub(r"^\s*[-*]\s+", "", line)
        if re.match(r"^\s*[-_]{3,}\s*$", line):        # markdown horizontal rules
            line = ""
        normalized_lines.append(line.rstrip())

    t = "\n".join(normalized_lines)
    t = re.sub(r"\n{3,}", "\n\n", t)
    return t.strip()


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


_STRUCTURE_QUESTIONS_SYSTEM = """You are a legal template architect specializing in Indian law.
Generate questions that determine TEMPLATE STRUCTURE and CLAUSE COMPOSITION.

CRITICAL: Ask about TYPES, RANGES, and CLAUSE PRESENCE — NOT specific data values.

CORRECT structure questions (determine what the template contains):
✓ "What type of property?" → Residential/Commercial → different clause sets
✓ "Who are the typical parties?" → Individual/Company/NRI → different legal sections
✓ "Transaction value range?" → triggers stamp duty calculations, court jurisdiction
✓ "Which clauses to include?" → multi-select → which sections appear in template
✓ "Payment structure type?" → Lumpsum/Installments → triggers payment schedule annexure
✓ "Witness and notarization requirements?" → adds witness/notary blocks

WRONG data questions (NEVER ask these):
✗ "What is the party's name?" → data, collected when filling the template
✗ "What is the rent amount?" → data, collected when filling the template
✗ "What is the property address?" → data, collected when filling the template

Generate 8-12 questions. Jurisdiction is already known, so do NOT ask about it.

MANDATORY questions to always include:
1. Party types (select) — Individual/Company/NRI/Trust/Government etc.
2. Clause selection (select) — which sections/clauses to include
3. Detail level (select) — Concise (5-8 pages)/Standard (8-15 pages)/Detailed (15-25 pages)

Return ONLY a valid JSON array. Each question object:
{
  "id": "snake_case_id",
  "question": "Question text?",
  "placeholder": "",
  "type": "select",
  "required": true,
  "hint": "Brief tip or null",
  "options": ["Option 1", "Option 2", "Option 3"]
}

Rules:
- type must always be "select" (renders as a chip selector in the UI)
- EVERY question MUST have options array with 3-8 practical choices
- Options must be relevant to Indian legal context
- No markdown, no explanation — return ONLY the JSON array"""


_STRUCTURE_QUESTIONS_SYSTEM_V2 = """You are a legal template architecture expert. Generate questions that determine TEMPLATE STRUCTURE, not data to fill later.

CRITICAL:
- Ask about WHAT GOES IN THE TEMPLATE, not actual values.
- Ask about TYPES, RANGES, CLAUSE PRESENCE, SECTION PRESENCE, COMPLEXITY, and FORMAT.
- Do NOT ask for names, exact dates, addresses, exact amounts, document numbers, or party-specific facts.

CORRECT QUESTION EXAMPLES:
- "What type of property is involved?"
- "Who are the typical parties?"
- "Which clauses should be included?"
- "What payment structure should the template support?"
- "What duration range should the template accommodate?"
- "How detailed should the template be?"

WRONG QUESTION EXAMPLES:
- "What is the landlord's name?"
- "What is the rent amount?"
- "What is the property address?"
- "What is the agreement date?"

QUESTION CATEGORIES TO COVER:
1. Structural questions
2. Clause inclusion questions
3. Legal framework questions
4. Format and complexity questions
5. Value or duration range questions

RESPONSE FORMAT:
Return ONLY a valid JSON array with 8-12 questions.
Each object must contain exactly:
{
  "id": "snake_case_id",
  "question": "Question text?",
  "placeholder": "",
  "type": "single_select" | "multi_select" | "yes_no" | "range",
  "required": true,
  "hint": "Why this changes the template structure" | null,
  "options": ["Option 1", "Option 2", "Option 3"]
}

RULES:
- Jurisdiction is already known, so do NOT ask about jurisdiction.
- Every question must be structure-focused.
- Every question must be answerable via chips/options only.
- Every question must have 3-8 practical Indian-law-relevant options.
- Include at least: party types, clause or section inclusion, and detail level.
- No markdown, no prose, no explanation outside the JSON array."""


_DATA_INDICATORS = (
    "what is the name",
    "party name",
    "enter the amount",
    "exact amount",
    "provide the address",
    "property address",
    "specify the date",
    "agreement date",
    "landlord name",
    "tenant name",
)


_GENERATION_SYSTEM = """You are an expert Indian legal document drafter with 25 years of experience across all areas of Indian law: Contract Act 1872, Transfer of Property Act 1882, Companies Act 2013, Family Law, BNSS/CrPC, CPC, and all other relevant statutes.

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
6. Output clean final document text only. Do NOT use markdown syntax, code fences, bullets for narration, or separator lines like ---.
7. Start with the document title in uppercase, centered-style plain text on its own line.
8. Use properly ordered main headings and sub-clauses only where appropriate for the document type.
9. ALL formal section headings must be in uppercase or standard Indian court/registration style.
10. Preserve formal Indian legal drafting tone, alignment logic, and document flow suitable for filing, review, stamping, notarization, or registration.
11. LENGTH: Strictly follow the length instruction given in the user message. Do NOT add extra sections or padding beyond what the user asked for. If no length is specified, default to 3-5 pages.
12. The document must be ready to use in Indian courts and for official registration.
13. LANGUAGE: Strictly follow the language instruction given in the user message. If a non-English language is specified, write the ENTIRE document — every section, clause, heading, and paragraph — in that language. Do NOT default to English. Only __placeholder__ field names may remain in English.
14. USER ANSWERS ARE BINDING: Every answer the user provided must be reflected exactly in the document. Do not invent, substitute, or ignore any user-provided detail.
15. For court pleadings, applications, petitions, plaints, written statements, and family-court filings, use authentic Indian court-document structure: court heading, cause title, party description blocks, jurisdiction, facts, grounds, prayers, interim relief if applicable, verification, place, date, advocate block, and signature block.
16. For deeds and agreements, use recital-driven Indian drafting style with proper operative clauses, schedules, witness blocks, and execution language.
17. Keep numbering consistent. Never jump clause numbers, never repeat heading numbers, and never mix markdown headings with legal clause numbering.
18. INDIAN COURTS ONLY: For any court/family filing, use only Indian court nomenclature and procedural structure. Do not use foreign styles (e.g., "Plaintiff v. Defendant" US style, "County Court", "Circuit Court", "Claimant", "Statement of Claim"). Use "Petitioner/Applicant" and "Respondent(s)" unless user explicitly requires another Indian label.
19. WHEN REFERENCE DOCUMENTS ARE PROVIDED: treat them as strict scope boundaries. Do not introduce extra sections or extra fill-up placeholders beyond what those documents and user answers justify."""


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


def _call_claude_template_stream(system: str, user_msg: str):
    """Stream long template generation as text chunks."""
    try:
        with _claude.messages.stream(
            model=CLAUDE_MODEL,
            max_tokens=8192,
            system=system,
            messages=[{"role": "user", "content": user_msg}],
        ) as stream:
            for text in stream.text_stream:
                if text:
                    yield text
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Claude API error: {e}")


def _category_generation_guidance(doc_type: str) -> str:
    category = _infer_category(doc_type)
    if category in {"Court", "Criminal"}:
        return (
            "COURT FORMAT REQUIREMENTS:\n"
            "- Use INDIAN COURT FORMAT ONLY.\n"
            "- Use formal Indian court pleading structure, not generic prose.\n"
            "- Begin with court title and jurisdiction line, then cause title with petitioner/applicant and respondent blocks.\n"
            "- Include properly labeled sections such as facts, grounds, jurisdiction, limitation if relevant, prayers, interim relief if relevant, and verification.\n"
            "- Use respectful Indian court phrasing such as 'MOST RESPECTFULLY SHOWETH' only where contextually suitable.\n"
            "- Do not output essay-style paragraphs without pleading structure."
        )
    if category == "Family":
        return (
            "FAMILY COURT FORMAT REQUIREMENTS:\n"
            "- Use INDIAN FAMILY COURT FORMAT ONLY.\n"
            "- Use Indian family-court petition structure with court heading, marriage facts, jurisdiction, cause of action, statutory basis, grounds, prayer, verification, and signature blocks.\n"
            "- Do not produce a general article or advisory note.\n"
            "- Ensure the petition reads like a file-ready Indian family-law pleading."
        )
    if category in {"Property", "Agreement", "Trust", "Employment"}:
        return (
            "TRANSACTIONAL FORMAT REQUIREMENTS:\n"
            "- Use formal Indian deed/agreement formatting with title, parties, recitals, definitions if needed, operative clauses, boilerplate, schedules, execution block, and witnesses.\n"
            "- Preserve alignment logic for signature and witness blocks.\n"
            "- Use schedule headings only when the user requirements call for them."
        )
    return (
        "GENERAL LEGAL FORMAT REQUIREMENTS:\n"
        "- Produce a file-ready Indian legal template, not explanatory prose.\n"
        "- Maintain professional heading hierarchy, clause numbering, and execution-ready closing sections."
    )


def _court_pleading_skeleton(doc_type: str) -> str:
    category = _infer_category(doc_type)
    if category not in {"Court", "Family", "Criminal"}:
        return ""
    return (
        "MANDATORY INDIAN COURT PLEADING SKELETON (DO NOT SKIP/REORDER WITHOUT LEGAL REASON):\n"
        "1. COURT HEADING (e.g., IN THE FAMILY COURT AT __district_name__, __state_name__)\n"
        "2. CASE TYPE / PETITION TITLE WITH STATUTORY BASIS\n"
        "3. CASE NUMBER LINE (if applicable)\n"
        "4. IN THE MATTER OF / BETWEEN (Petitioner/Applicant block)\n"
        "5. VERSUS (Respondent block)\n"
        "6. JURISDICTION PARAGRAPH\n"
        "7. BRIEF FACTS / CHRONOLOGY\n"
        "8. GROUNDS / LEGAL SUBMISSIONS\n"
        "9. PRAYER CLAUSE(S)\n"
        "10. INTERIM RELIEF (if applicable)\n"
        "11. LIST OF ANNEXURES (numbered, filing-ready)\n"
        "12. VERIFICATION\n"
        "13. PLACE, DATE, ADVOCATE DETAILS, SIGNATURE BLOCKS\n"
        "Use Indian pleading labels and language conventions only."
    )


def _build_generation_user_message(body: GenerateTemplateRequest) -> str:
    qa_lines = []
    for q in body.questions:
        qid = q.get("id", "")
        question_text = q.get("question", qid)
        answer = body.answers.get(qid, "Not provided")
        qa_lines.append(f"  • {question_text}\n    Answer: {answer}")

    _page_re = re.compile(
        r'(\d+)\s*(?:to|-)\s*(\d+)\s*pages?'
        r'|(\d+)\s*\+?\s*pages?'
        r'|(\d+)\s*(?:to|-)\s*(\d+)\s*pg'
        r'|(\d+)\s*pg\b',
        re.IGNORECASE
    )
    page_directive = ""
    for ans in body.answers.values():
        m = _page_re.search(ans)
        if m:
            if m.group(1) and m.group(2):
                page_directive = f"DOCUMENT LENGTH: {m.group(1)}-{m.group(2)} pages (~{int(m.group(1))*350}-{int(m.group(2))*350} words). Do NOT exceed this range."
            elif m.group(3):
                approx = int(m.group(3)) * 350
                page_directive = f"DOCUMENT LENGTH: Approximately {m.group(3)} pages (~{approx} words). Do NOT produce more or fewer pages."
            elif m.group(4) and m.group(5):
                page_directive = f"DOCUMENT LENGTH: {m.group(4)}-{m.group(5)} pages (~{int(m.group(4))*350}-{int(m.group(5))*350} words). Do NOT exceed this range."
            elif m.group(6):
                approx = int(m.group(6)) * 350
                page_directive = f"DOCUMENT LENGTH: Approximately {m.group(6)} pages (~{approx} words). Do NOT produce more or fewer pages."
            break

    selected_language = body.language or "English"
    if selected_language.lower() == "english":
        lang_directive = "Language: English (formal legal English)"
    elif "+" in selected_language or "bilingual" in selected_language.lower():
        parts = selected_language.split("+")
        lang1 = parts[0].strip()
        lang2 = parts[1].strip() if len(parts) > 1 else "Hindi"
        lang_directive = (
            f"BILINGUAL DOCUMENT REQUIRED: Draft every section TWICE — "
            f"first in {lang1}, then immediately the {lang2} translation of the same section. "
            f"Label each: '{lang1} Version:' and '{lang2} Version:'. "
            f"Both versions must be complete and legally accurate."
        )
    else:
        lang_directive = (
            f"CRITICAL LANGUAGE REQUIREMENT: The ENTIRE document MUST be written ONLY in {selected_language}. "
            f"Do NOT use English anywhere in the document body. "
            f"All section headings, clauses, recitals, definitions, obligations, and the signature block "
            f"must be in {selected_language}. "
            f"Only __placeholder__ field names may remain in English."
        )

    category_guidance = _category_generation_guidance(body.document_type)
    court_skeleton = _court_pleading_skeleton(body.document_type)
    reference_block = _reference_document_block(body.reference_document_text, body.reference_document_name)
    reference_scope_limits = _reference_scope_rules(body.reference_document_text)
    return f"""Draft a complete "{body.document_type}" legal template for Indian jurisdiction.

*** {lang_directive} ***
{f"*** {page_directive} ***" if page_directive else ""}

{category_guidance}
{court_skeleton if court_skeleton else ""}

{reference_block}
{reference_scope_limits if reference_scope_limits else ""}

BINDING USER REQUIREMENTS — YOU MUST FOLLOW EVERY ANSWER EXACTLY:
{chr(10).join(qa_lines)}

IMPORTANT INSTRUCTIONS:
1. Every answer above is a strict requirement — reflect each one exactly in the document.
2. Do not add clauses, sections, or content that contradicts what the user specified.
3. Do not output markdown headings, markdown bullets, separator lines, bold markers (**), commentary, notes to the user, or drafting explanations.
4. Use authentic Indian legal format for the relevant document category.
5. Respect the page count and level of detail exactly.
6. If a reference document is provided, keep the template limited to the scope and data density supported by that document.
  • Jurisdiction: {body.jurisdiction}
  • Language: {selected_language}

Use __placeholder__ syntax for all variable fields throughout the document."""


def _make_question(
    qid: str,
    question: str,
    qtype: str,
    options: List[str],
    hint: Optional[str],
) -> Dict[str, Any]:
    return {
        "id": qid,
        "question": question,
        "placeholder": "",
        "type": qtype,
        "required": True,
        "hint": hint,
        "options": options,
    }


def _category_mandatory_questions(category: str) -> List[Dict[str, Any]]:
    common = [
        _make_question(
            "party_types",
            "Who are the typical parties involved?",
            "single_select",
            [
                "Individual to Individual",
                "Individual to Company",
                "Company to Company",
                "NRI Party Involved",
                "Government / Authority",
                "Keep generic placeholders",
            ],
            "Determines party-capacity clauses and compliance sections.",
        ),
        _make_question(
            "detail_level",
            "How detailed should the template be?",
            "single_select",
            [
                "Concise (5-8 pages)",
                "Standard (8-15 pages)",
                "Detailed (15-25 pages)",
            ],
            "Controls clause depth, structure, and annexure detail.",
        ),
    ]

    category_specific = {
        "Property": [
            _make_question(
                "property_type",
                "What type of property is involved?",
                "single_select",
                [
                    "Residential Flat / Apartment",
                    "Independent House / Bungalow",
                    "Commercial Office",
                    "Shop / Showroom",
                    "Agricultural Land",
                    "Industrial / Warehouse",
                    "Plot / Open Land",
                ],
                "Determines property-specific clauses and schedules.",
            ),
            _make_question(
                "transaction_value_range",
                "Typical transaction value range?",
                "range",
                [
                    "Below Rs. 10 Lakhs",
                    "Rs. 10-50 Lakhs",
                    "Rs. 50 Lakhs-2 Cr",
                    "Rs. 2-10 Cr",
                    "Above Rs. 10 Cr",
                    "Varies - keep flexible",
                ],
                "Guides value-linked clauses and stamp-duty-related drafting.",
            ),
            _make_question(
                "clauses_to_include",
                "Which clauses should be included?",
                "multi_select",
                [
                    "Payment terms section",
                    "Termination conditions",
                    "Penalty / Liquidated damages",
                    "Force majeure",
                    "Arbitration clause",
                    "Inventory / Furnishing schedule",
                    "Registration / compliance note",
                ],
                "Determines which sections and annexures appear in the template.",
            ),
        ],
        "Agreement": [
            _make_question(
                "agreement_party_types",
                "Who are the parties to this agreement?",
                "single_select",
                [
                    "Individual to Individual",
                    "Individual to Company",
                    "Company to Company",
                    "Freelancer / Consultant to Company",
                    "Startup to Investor",
                    "Employer to Employee",
                ],
                "Determines party definitions and company-specific clauses.",
            ),
            _make_question(
                "duration_type",
                "Duration / tenure of the agreement?",
                "single_select",
                [
                    "One-time / project-based",
                    "Short-term (up to 12 months)",
                    "Long-term (1-3 years)",
                    "Evergreen / auto-renewal",
                    "Flexible / keep generic",
                ],
                "Determines renewal and termination structure.",
            ),
            _make_question(
                "consideration_range",
                "Expected annual value / consideration?",
                "range",
                [
                    "Below Rs. 5 Lakhs",
                    "Rs. 5-25 Lakhs",
                    "Rs. 25 Lakhs-1 Cr",
                    "Above Rs. 1 Cr",
                    "Varies - keep flexible",
                ],
                "Guides indemnity, security, and performance-protection drafting.",
            ),
        ],
        "Court": [
            _make_question(
                "filing_court",
                "Which court will this be filed in?",
                "single_select",
                [
                    "Supreme Court",
                    "High Court",
                    "District Court",
                    "Sessions Court",
                    "Tribunal / NCLT",
                    "Keep forum generic",
                ],
                "Determines court-format structure and filing-specific sections.",
            ),
            _make_question(
                "dispute_nature",
                "Nature of dispute?",
                "single_select",
                [
                    "Constitutional / Writ",
                    "Property dispute",
                    "Contract / Commercial",
                    "Employment / Service",
                    "Consumer",
                    "Regulatory / Public law",
                ],
                "Drives prayer structure and issue-specific sections.",
            ),
            _make_question(
                "opposing_party_type",
                "Who is the opposing party?",
                "single_select",
                [
                    "Central Government",
                    "State Government",
                    "Authority / Corporation",
                    "Private Individual",
                    "Private Company",
                    "Multiple Respondents",
                ],
                "Determines party-capacity language and pleading clauses.",
            ),
        ],
    }

    return common + category_specific.get(category, [
        _make_question(
            "template_structure_focus",
            "Which structural focus should the template have?",
            "single_select",
            [
                "Protection-heavy",
                "Balanced and standard",
                "Compliance-heavy",
                "Relationship-first",
                "Keep flexible",
            ],
            "Adjusts clause density and drafting posture.",
        ),
        _make_question(
            "clauses_to_include",
            "Which clauses should be included?",
            "multi_select",
            [
                "Confidentiality",
                "Termination",
                "Arbitration",
                "Penalty / damages",
                "Force majeure",
                "Compliance section",
                "Schedules / annexures",
            ],
            "Determines the main section list for the template.",
        ),
    ])


def _sanitize_structure_questions(raw_questions: List[Dict[str, Any]], category: str) -> List[DynamicQuestion]:
    sanitized: List[Dict[str, Any]] = []

    for q in raw_questions:
        question_text = str(q.get("question") or "").strip()
        if not question_text:
            continue

        lowered = question_text.lower()
        if any(indicator in lowered for indicator in _DATA_INDICATORS):
            continue

        qtype = str(q.get("type") or "single_select").strip().lower()
        if qtype not in {"single_select", "multi_select", "yes_no", "range"}:
            qtype = "single_select"

        options = q.get("options") or []
        if not isinstance(options, list):
            options = []
        options = [str(opt).strip() for opt in options if str(opt).strip()]
        if len(options) < 2:
            continue

        sanitized.append({
            "id": str(q.get("id") or f"q_{len(sanitized) + 1}").strip().lower(),
            "question": question_text,
            "placeholder": "",
            "type": qtype,
            "required": bool(q.get("required", True)),
            "hint": q.get("hint"),
            "options": options[:8],
        })

    existing_ids = {q["id"] for q in sanitized}
    existing_questions = {q["question"].strip().lower() for q in sanitized}

    for mandatory in _category_mandatory_questions(category):
        if mandatory["id"] in existing_ids or mandatory["question"].strip().lower() in existing_questions:
            continue
        sanitized.append(mandatory)
        existing_ids.add(mandatory["id"])
        existing_questions.add(mandatory["question"].strip().lower())

    return [DynamicQuestion(**q) for q in sanitized[:12]]


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
# Endpoint 1b: Get structure questions (for custom-description dynamic mode)
# ──────────────────────────────────────────────────────────────────────────────

@router.post("/get-structure-questions", response_model=GetStructureQuestionsResponse)
async def get_structure_questions(
    body: GetStructureQuestionsRequest,
    x_user_id: Optional[str] = Header(None),
):
    """
    AI generates 8-12 structure-focused questions from the user's free-text description.
    These determine TEMPLATE STRUCTURE (clause presence, party types, value ranges),
    NOT the actual data to fill into the template later.
    Jurisdiction is already known, so the AI skips it and focuses on document specifics.
    """
    if not x_user_id:
        raise HTTPException(status_code=400, detail="X-User-Id header is required")

    logger.info(f"[GetStructureQuestions] user={x_user_id} desc={body.description[:80]!r} jurisdiction={body.jurisdiction!r} reference_doc={bool(body.reference_document_text)}")

    category = _infer_category(body.description)
    reference_block = _reference_document_block(body.reference_document_text, body.reference_document_name)
    user_msg = (
        f'User wants: "{body.description}"\n\n'
        f'Detected category: {category}\n'
        f'Jurisdiction is already set to: {body.jurisdiction or "India"}\n\n'
        f'{reference_block}\n'
        f'Generate 8-12 structure questions for this template.\n'
        f'Remember: ask about TYPES, RANGES, and CLAUSE PRESENCE — not specific data values.'
        f'\nFocus on: party types, section or clause inclusion, schedules or annexures, '
        f'value or duration ranges, relief or forum structure where relevant, and detail level.\n'
        f'Remember: ask about structure only, never about data to fill later.\n'
        f'If a reference document is provided, keep the template scope aligned to that document and avoid suggesting extra sections that the document does not support.'
    )

    raw = await _call_claude_json(_STRUCTURE_QUESTIONS_SYSTEM_V2, user_msg)

    raw = re.sub(r'^```(?:json)?\s*', '', raw, flags=re.MULTILINE)
    raw = re.sub(r'\s*```$', '', raw, flags=re.MULTILINE)

    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        logger.error(f"[GetStructureQuestions] JSON parse error: {e}\nRaw: {raw[:500]}")
        raise HTTPException(status_code=502, detail=f"Failed to parse structure questions from AI: {e}")

    questions = _sanitize_structure_questions(data, category)
    logger.info(f"[GetStructureQuestions] Generated {len(questions)} questions")
    return GetStructureQuestionsResponse(success=True, description=body.description, questions=questions)


@router.post("/get-structure-questions-with-document", response_model=GetStructureQuestionsResponse)
async def get_structure_questions_with_document(
    description: str = Form(...),
    jurisdiction: str = Form("India"),
    reference_documents: List[UploadFile] = File(...),
    x_user_id: Optional[str] = Header(None),
):
    reference_document_text, reference_document_names = await _extract_reference_documents_text(reference_documents)
    body = GetStructureQuestionsRequest(
        description=description,
        jurisdiction=jurisdiction,
        reference_document_text=reference_document_text,
        reference_document_name=", ".join(reference_document_names),
    )
    return await get_structure_questions(body=body, x_user_id=x_user_id)


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
    user_msg = _build_generation_user_message(body)
    template_text = await _call_claude_template(_GENERATION_SYSTEM, user_msg)
    template_text = _normalize_generated_template_text(template_text)
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
        "referenceDocumentUsed": bool(body.reference_document_text),
        "referenceDocumentName": body.reference_document_name,
        "referenceDocumentNames": [name.strip() for name in (body.reference_document_name or "").split(",") if name.strip()],
    }

    return GenerateResponse(success=True, templateText=template_text, fields=fields, sections=sections, metadata=metadata)

    # Build the user message with all collected answers
    qa_lines = []
    for q in body.questions:
        qid = q.get("id", "")
        question_text = q.get("question", qid)
        answer = body.answers.get(qid, "Not provided")
        qa_lines.append(f"  • {question_text}\n    Answer: {answer}")

    # Detect page/length constraint from any answer
    _page_re = re.compile(
        r'(\d+)\s*(?:to|-)\s*(\d+)\s*pages?'      # "5 to 8 pages" / "5-8 pages"
        r'|(\d+)\s*\+?\s*pages?'                   # "10 pages" / "10+ pages"
        r'|(\d+)\s*(?:to|-)\s*(\d+)\s*pg'          # "5-8 pg"
        r'|(\d+)\s*pg\b',                           # "5 pg"
        re.IGNORECASE
    )
    page_directive = ""
    for ans in body.answers.values():
        m = _page_re.search(ans)
        if m:
            if m.group(1) and m.group(2):
                page_directive = f"DOCUMENT LENGTH: {m.group(1)}-{m.group(2)} pages (~{int(m.group(1))*350}-{int(m.group(2))*350} words). Do NOT exceed this range."
            elif m.group(3):
                approx = int(m.group(3)) * 350
                page_directive = f"DOCUMENT LENGTH: Approximately {m.group(3)} pages (~{approx} words). Do NOT produce more or fewer pages."
            elif m.group(4) and m.group(5):
                page_directive = f"DOCUMENT LENGTH: {m.group(4)}-{m.group(5)} pages (~{int(m.group(4))*350}-{int(m.group(5))*350} words). Do NOT exceed this range."
            elif m.group(6):
                approx = int(m.group(6)) * 350
                page_directive = f"DOCUMENT LENGTH: Approximately {m.group(6)} pages (~{approx} words). Do NOT produce more or fewer pages."
            break

    # Build language directive — make it prominent when non-English is selected
    selected_language = body.language or "English"
    if selected_language.lower() == "english":
        lang_directive = "Language: English (formal legal English)"
    elif "+" in selected_language or "bilingual" in selected_language.lower():
        parts = selected_language.split("+")
        lang1 = parts[0].strip()
        lang2 = parts[1].strip() if len(parts) > 1 else "Hindi"
        lang_directive = (
            f"BILINGUAL DOCUMENT REQUIRED: Draft every section TWICE — "
            f"first in {lang1}, then immediately the {lang2} translation of the same section. "
            f"Label each: '{lang1} Version:' and '{lang2} Version:'. "
            f"Both versions must be complete and legally accurate."
        )
    else:
        lang_directive = (
            f"CRITICAL LANGUAGE REQUIREMENT: The ENTIRE document MUST be written ONLY in {selected_language}. "
            f"Do NOT use English anywhere in the document body. "
            f"All section headings, clauses, recitals, definitions, obligations, and the signature block "
            f"must be in {selected_language}. "
            f"Only __placeholder__ field names may remain in English (e.g. __party1_name__)."
        )

    user_msg = f"""Draft a complete "{body.document_type}" legal template for Indian jurisdiction.

*** {lang_directive} ***
{f"*** {page_directive} ***" if page_directive else ""}

BINDING USER REQUIREMENTS — YOU MUST FOLLOW EVERY ANSWER EXACTLY:
{chr(10).join(qa_lines)}

IMPORTANT INSTRUCTIONS:
1. Every answer above is a strict requirement — reflect each one verbatim in the document.
2. Do not add clauses, sections, or content that contradicts or expands beyond what the user specified.
3. If the user named parties, use those exact names as the basis for __placeholder__ labels.
4. If the user specified a page count or length in their answers, respect it exactly.
  • Jurisdiction: {body.jurisdiction}
  • Language: {selected_language}

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

def _infer_category(doc_type: str) -> str:
    t = doc_type.lower()
    if any(k in t for k in ("lease", "rent", "sale deed", "gift deed", "property", "mortgage", "licence")): return "Property"
    if any(k in t for k in ("employment", "offer letter", "appointment", "termination", "non-compete")): return "Employment"
    if any(k in t for k in ("bail", "writ", "petition", "suit", "complaint", "plaint", "cpc", "crpc")): return "Court"
    if any(k in t for k in ("will", "testament", "divorce", "custody", "maintenance", "family", "marriage")): return "Family"
    if any(k in t for k in ("trust", "charity", "society", "foundation")): return "Trust"
    if any(k in t for k in ("nda", "non-disclosure", "service", "mou", "joint venture", "partnership", "shareholders", "agreement", "contract")): return "Agreement"
    return "General"


def _split_gs_uri(gs_uri: str) -> tuple[str, str]:
    """
    Split gs://bucket/path into (bucket, path).
    If parsing fails, returns ("", "").
    """
    if not gs_uri or not gs_uri.startswith("gs://"):
        return "", ""
    rest = gs_uri[5:].strip()
    if "/" not in rest:
        return "", ""
    bucket, _, path = rest.partition("/")
    return bucket, path


@router.post("/generate-template-stream")
async def generate_template_stream(
    body: GenerateTemplateRequest,
    x_user_id: Optional[str] = Header(None),
):
    if not x_user_id:
        raise HTTPException(status_code=400, detail="X-User-Id header is required")

    logger.info(f"[GenerateStream] user={x_user_id} doc={body.document_type!r} answers={len(body.answers)}")
    user_msg = _build_generation_user_message(body)

    def event_stream():
        try:
            yield json.dumps({
                "type": "start",
                "message": f"Drafting {body.document_type} in {body.language or 'English'}...",
            }) + "\n"

            collected_parts: List[str] = []
            for chunk in _call_claude_template_stream(_GENERATION_SYSTEM, user_msg):
                collected_parts.append(chunk)
                yield json.dumps({
                    "type": "chunk",
                    "text": chunk,
                }) + "\n"

            template_text = "".join(collected_parts).strip()
            template_text = _normalize_generated_template_text(template_text)
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
                "referenceDocumentUsed": bool(body.reference_document_text),
                "referenceDocumentName": body.reference_document_name,
                "referenceDocumentNames": [name.strip() for name in (body.reference_document_name or "").split(",") if name.strip()],
            }

            yield json.dumps({
                "type": "complete",
                "templateText": template_text,
                "fields": fields,
                "sections": sections,
                "metadata": metadata,
            }) + "\n"
        except HTTPException as e:
            yield json.dumps({
                "type": "error",
                "message": str(e.detail),
            }) + "\n"
        except Exception as e:
            logger.exception("[GenerateStream] Unexpected error")
            yield json.dumps({
                "type": "error",
                "message": str(e),
            }) + "\n"

    return StreamingResponse(event_stream(), media_type="application/x-ndjson")


@router.post("/generate-template-stream-with-document")
async def generate_template_stream_with_document(
    document_type: str = Form(...),
    answers: str = Form(...),
    questions: str = Form(...),
    jurisdiction: str = Form("India"),
    language: str = Form("English"),
    reference_documents: List[UploadFile] = File(...),
    x_user_id: Optional[str] = Header(None),
):
    try:
        parsed_answers = json.loads(answers)
        parsed_questions = json.loads(questions)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid JSON payload in multipart request: {exc}") from exc

    reference_document_text, reference_document_names = await _extract_reference_documents_text(reference_documents)
    body = GenerateTemplateRequest(
        document_type=document_type,
        answers=parsed_answers,
        questions=parsed_questions,
        jurisdiction=jurisdiction,
        language=language,
        reference_document_text=reference_document_text,
        reference_document_name=", ".join(reference_document_names),
    )
    return await generate_template_stream(body=body, x_user_id=x_user_id)


# ──────────────────────────────────────────────────────────────────────────────
# Endpoint 3: Save generated template
# ──────────────────────────────────────────────────────────────────────────────

@router.post("/save-generated", response_model=SaveGeneratedResponse)
async def save_generated_template(
    background_tasks: BackgroundTasks,
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

    normalized_template_text = _normalize_placeholder_spacing(body.templateText or "")
    if not normalized_template_text.strip():
        raise HTTPException(status_code=400, detail="templateText is required to save generated template")

    template_uuid = uuid.uuid4()
    generated_pdf_bytes = _build_text_pdf_bytes(normalized_template_text)
    file_url = await doc_ai.upload_to_gcs(
        generated_pdf_bytes,
        f"user_uploads/{user_id_int}/{template_uuid}/generated_template.pdf",
        "application/pdf",
    )
    generated_txt_url = await doc_ai.upload_to_gcs(
        normalized_template_text.encode("utf-8"),
        f"user_uploads/{user_id_int}/{template_uuid}/generated_template.txt",
        "text/plain",
    )

    new_template = UserTemplate(
        template_id=template_uuid,
        template_name=name,
        category=category,
        sub_category="AI Generated",
        language=lang_code,
        status="processing",
        description=f"AI-generated {name} template. Jurisdiction: {meta.get('jurisdiction', 'India')}. Model: {meta.get('model', CLAUDE_MODEL)}.",
        user_id=user_id_int,
        image_url=None,
        file_url=file_url or generated_txt_url,
    )
    db.add(new_template)
    await db.flush()
    tid = new_template.template_id

    # Persist "initial" fields immediately so downstream services (chat-draft)
    # can load template text even while background analysis is still running.
    # This also stores the generated PDF's GCS URI/path for later use.
    pdf_bucket, pdf_path = _split_gs_uri(file_url or "")
    txt_bucket, txt_path = _split_gs_uri(generated_txt_url or "")
    initial_fields: Dict[str, Any] = {
        "original_template_text": normalized_template_text,
        "template_text": normalized_template_text,
        "generated_template_pdf_gcs_uri": file_url,
        "generated_template_pdf_gcs_bucket": pdf_bucket,
        "generated_template_pdf_gcs_path": pdf_path,
        "generated_template_txt_gcs_uri": generated_txt_url,
        "generated_template_txt_gcs_bucket": txt_bucket,
        "generated_template_txt_gcs_path": txt_path,
    }
    db.add(UserTemplateField(template_id=tid, template_fields=initial_fields, is_active=True))

    await db.commit()
    signed_file_url = doc_ai.generate_signed_url(new_template.file_url) if new_template.file_url else None
    enqueue_template_analysis(background_tasks, tid, normalized_template_text, signed_file_url)
    logger.info(f"[Save] Saved template {tid} for user {user_id_int} ({name})")
    return SaveGeneratedResponse(success=True, templateId=str(tid), message=f'Template "{name}" saved to your library.')
