from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass

from app.schemas.contracts import DocumentReference, DocumentType
from app.services.llm_chat_config import get_llm_chat_config, resolve_model_name

logger = logging.getLogger("agentic_document_service.document_ai")
_gemini_extract_unavailable_logged = False
_gemini_qa_unavailable_logged = False

_EXTRACTION_PROMPT = """You are an expert legal document analyst. Extract ALL case information from the document using semantic understanding and intelligent field matching.

INSTRUCTIONS:
1. Read the entire document carefully and understand the context
2. Look for fields even if they are written with different names, synonyms, or abbreviations
3. Use semantic understanding to match field names - for example:
   - "Case Title" could be: "Title", "Subject Matter", "Matter Title", "Case Name", "Cause Title", "Petition Title"
   - "Case Number" could be: "Case No.", "Suit No.", "Petition No.", "Application No.", "Writ Petition No.", "Criminal Case No."
   - "Court" could be: "Court Name", "Forum", "Adjudicating Forum", "Court of", "Before", "Hon'ble Court"
   - "Jurisdiction" could be: "Jurisdiction", "Adjudicating Authority", "Territorial Jurisdiction", "Jurisdictional Area"
   - "Petitioner" could be: "Petitioner", "Plaintiff", "Applicant", "Appellant", "Complainant", "Party"
   - "Respondent" could be: "Respondent", "Defendant", "Opposite Party", "Opponent", "Accused"
   - "Filing Date" could be: "Date of Filing", "Date Filed", "Filed On", "Instituted On", "Registration Date"
   - "Hearing Date" could be: "Next Date", "Next Date of Hearing", "Date of Hearing", "Listed On", "Posted On"
   - "Judge" could be: "Judge", "Hon'ble Justice", "Hon'ble Judge", "Bench", "Presiding Officer"

4. Extract ALL available information - be thorough and comprehensive
5. For dropdown fields (caseType, jurisdiction, courtName, etc.), extract the EXACT value even if written differently
6. For dates, convert to YYYY-MM-DD format
7. For monetary values, extract numeric value only (remove currency symbols, commas)
8. For arrays (petitioners, respondents, judges), extract ALL entries

EXTRACT THE FOLLOWING FIELDS:
{
  "caseTitle": "Generate as 'Plaintiff Name vs Defendant Name' format. Use title from document or construct from petitioners/respondents",
  "caseNumber": "Case number (Case No., Suit No., Petition No., WP No., Criminal Case No.)",
  "casePrefix": "Case prefix like WP, CR, WP(C), SLP, etc.",
  "caseYear": "Year from case number or filing date (YYYY format)",
  "caseType": "Type of case (Civil, Criminal, Writ, Arbitration, etc.)",
  "caseNature": "Case nature (Civil, Criminal, Constitutional/Writ, Arbitration, Commercial, etc.)",
  "subType": "Subtype or category of the case",
  "courtName": "Full court name",
  "courtLevel": "Court level (High Court, District Court, Supreme Court, etc.)",
  "benchDivision": "Bench or division name (e.g., Aurangabad Bench, Principal Bench, Mumbai Bench)",
  "jurisdiction": "Jurisdiction or Adjudicating Authority (territorial area)",
  "state": "State name if mentioned",
  "filingDate": "Filing date in YYYY-MM-DD format",
  "judges": ["Array of judge names"],
  "courtRoom": "Court room number if mentioned",
  "petitioners": [{"fullName": "Petitioner/Plaintiff name (REQUIRED)", "role": "Individual/Company/Government", "advocateName": "Advocate name", "barRegistration": "", "contact": ""}],
  "respondents": [{"fullName": "Respondent/Defendant name (REQUIRED)", "role": "Individual/Company/Government", "advocateName": "Advocate name", "barRegistration": "", "contact": ""}],
  "categoryType": "Category type if mentioned",
  "primaryCategory": "Primary category",
  "subCategory": "Sub category",
  "complexity": "Complexity level (Simple, Medium, Complex)",
  "monetaryValue": "Monetary value (numeric only)",
  "priorityLevel": "Priority level (Low, Medium, High)",
  "currentStatus": "Current status (Active, Pending, Closed, Disposed, etc.)",
  "nextHearingDate": "Next hearing date in YYYY-MM-DD format",
  "documentType": "Type of document (Petition, Affidavit, Notice, Order, etc.)",
  "filedBy": "Who filed the case (Plaintiff, Defendant, Both, or advocate name)"
}

Return ONLY valid JSON without markdown formatting. If a field is not found, use null or empty string.

=== DOCUMENT CONTENT ===
"""


@dataclass(slots=True)
class ExtractionResult:
    text: str
    entities: dict[str, str]
    confidence_by_field: dict[str, float]
    quality_score: float


def _gemini_client():
    """Return a configured google.genai client, or None if unavailable."""
    try:
        from google import genai  # type: ignore
        from app.core.config import get_settings

        api_key = get_settings().gemini_api_key
        if not api_key:
            return None
        return genai.Client(api_key=api_key)
    except Exception:
        return None


def _generation_config(*, for_summary: bool = False) -> tuple[str, dict[str, float | int]]:
    config = get_llm_chat_config()
    model_name = resolve_model_name(config, for_summary=for_summary) or "gemini-2.0-flash"
    max_tokens = int(
        config.get("max_summarization_output_tokens") if for_summary else config.get("max_output_tokens") or 0
    )
    max_cap = max(1, int(config.get("max_output_tokens_cap") or 65536))
    min_tokens = max(1, int(config.get("min_output_tokens") or 1))
    if max_tokens <= 0:
        max_tokens = 15000 if for_summary else 20000
    max_tokens = max(min_tokens, min(max_tokens, max_cap))
    temperature = float(config.get("model_temperature") or 0.7)
    temperature = min(max(temperature, float(config.get("temperature_min") or 0.0)), float(config.get("temperature_max") or 2.0))
    return model_name, {"temperature": temperature, "max_output_tokens": max_tokens}


def _generate_text(prompt: str, *, for_summary: bool = False) -> str:
    client = _gemini_client()
    if client is None:
        return ""
    model_name, generation_config = _generation_config(for_summary=for_summary)
    response = client.models.generate_content(
        model=model_name,
        contents=prompt,
        config=generation_config,
    )
    return (getattr(response, "text", None) or "").strip()


def _call_gemini_for_extraction(text: str) -> dict:
    """Use Gemini to extract all case fields from document text."""
    try:
        limited_text = text[:80000]  # stay within token limits
        prompt = _EXTRACTION_PROMPT + limited_text
        raw = _generate_text(prompt)
        if not raw:
            return {}
        # Try to extract JSON
        json_match = re.search(r"```(?:json)?\s*(\{[\s\S]*?\})\s*```", raw) or re.search(r"\{[\s\S]*\}", raw)
        if json_match:
            return json.loads(json_match.group(1) if json_match.lastindex else json_match.group(0))
        return {}
    except Exception as exc:
        global _gemini_extract_unavailable_logged
        if not _gemini_extract_unavailable_logged:
            logger.warning("[DocumentAI] Gemini extraction unavailable, using regex fallback: %s", exc)
            _gemini_extract_unavailable_logged = True
        return {}


def _call_gemini_for_qa(
    question: str,
    document_texts: list[dict[str, str]],
    *,
    query_intent: str | None = None,
    output_format: str | None = None,
    extra_instructions: str | None = None,
    system_instruction: str | None = None,
) -> dict[str, str]:
    """
    Ask Gemini a question grounded in the provided document texts.

    Args:
        question: The user's question.
        document_texts: List of dicts with keys 'name' and 'text'.

    Returns:
        Dict with keys 'answer' and 'source_documents'.
    """
    try:
        # Build the document context block
        context_parts = []
        source_names = []
        running_chars = 0
        char_limit = 80000
        for doc in document_texts:
            name = doc.get("name", "document")
            text = (doc.get("text") or "").strip()
            if not text:
                continue
            block = f"[Document: {name}]\n{text}"
            if running_chars + len(block) > char_limit:
                block = block[: char_limit - running_chars]
                context_parts.append(block)
                source_names.append(name)
                break
            context_parts.append(block)
            source_names.append(name)
            running_chars += len(block)

        if not context_parts:
            return {
                "answer": "No document text is available to answer this question.",
                "source_documents": "",
            }

        context = "\n\n---\n\n".join(context_parts)
        intent_hint = (query_intent or "general").strip().lower()
        format_hint = (output_format or "plain").strip().lower()
        instruction_parts = [
            "You are a legal expert assistant.",
            "Answer the user's question based ONLY on the following legal documents.",
            "Do not invent facts, dates, names, holdings, or procedural history.",
            "If the answer is not supported by the documents, say so clearly.",
            "Prefer precise legal writing over generic filler.",
            "Cite the document name inline when materially helpful.",
        ]
        if intent_hint == "timeline":
            instruction_parts.append("Organize the answer chronologically and focus on procedural sequence and dates.")
        elif intent_hint == "risk":
            instruction_parts.append("Focus on legal, procedural, evidentiary, and strategic risks supported by the record.")
        elif intent_hint == "evidence":
            instruction_parts.append("Focus on exhibits, proof, contradictions, admissions, and evidentiary support in the record.")
        elif intent_hint == "summary":
            instruction_parts.append("Provide a structured summary that captures the most material facts and issues from the record.")
        if format_hint == "structured":
            instruction_parts.append("Use a structured format with short headings and bullet points where useful.")
        if extra_instructions:
            instruction_parts.append(extra_instructions.strip())

        prompt = (
            f"{' '.join(instruction_parts)}\n\n"
            f"=== DOCUMENTS ===\n{context}\n\n"
            f"=== QUESTION ===\n{question}\n\n"
            "=== ANSWER ==="
        )
        if system_instruction:
            prompt = f"SYSTEM INSTRUCTION:\n{system_instruction}\n\n{prompt}"
        answer = _generate_text(prompt, for_summary=intent_hint == "summary")
        return {
            "answer": answer,
            "source_documents": ", ".join(source_names),
        }
    except Exception as exc:
        global _gemini_qa_unavailable_logged
        if not _gemini_qa_unavailable_logged:
            logger.warning("[DocumentAI] Gemini Q&A unavailable, returning fallback response: %s", exc)
            _gemini_qa_unavailable_logged = True
        return {"answer": "", "source_documents": ""}



class DocumentAIAdapter:
    CASE_NUMBER_RE = re.compile(r"(case\s*(?:no\.?|number)?\s*[:\-]?\s*[A-Z0-9\/\-]+)", re.I)
    DATE_RE = re.compile(
        r"\b(?:\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|"
        r"\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}|"
        r"[A-Za-z]{3,9}\s+\d{1,2},\s+\d{4})\b"
    )
    PARTY_RE = re.compile(r"([A-Z][A-Za-z0-9&.,'\- ]+)\s+v(?:s\.?|ersus)\s+([A-Z][A-Za-z0-9&.,'\- ]+)", re.I)
    COURT_RE = re.compile(r"(high court|supreme court|district court|sessions court|tribunal)", re.I)

    def extract(self, document: DocumentReference) -> ExtractionResult:
        text = (document.inline_text or document.document_name or "").strip()
        quality_score = 0.97 if len(text) > 100 else 0.25

        # Use Gemini for comprehensive extraction if text is meaningful
        if len(text) > 50:
            gemini_entities = _call_gemini_for_extraction(text)
            if gemini_entities:
                logger.info("[DocumentAI] Gemini extraction succeeded: %d fields", len(gemini_entities))
                return ExtractionResult(
                    text=text,
                    entities=gemini_entities,
                    confidence_by_field={k: 0.90 for k in gemini_entities},
                    quality_score=quality_score,
                )

        # Fallback: regex-based extraction
        entities: dict[str, str] = {}
        confidence: dict[str, float] = {}
        lowered_name = document.document_name.lower()

        case_number_match = self.CASE_NUMBER_RE.search(text)
        if case_number_match:
            entities["caseNumber"] = case_number_match.group(1)
            confidence["caseNumber"] = 0.96

        party_match = self.PARTY_RE.search(text)
        if party_match:
            p = party_match.group(1).strip()
            r = party_match.group(2).strip()
            entities["caseTitle"] = f"{p} vs {r}"
            entities["petitioners"] = [{"fullName": p, "role": "Individual", "advocateName": "", "barRegistration": "", "contact": ""}]
            entities["respondents"] = [{"fullName": r, "role": "Individual", "advocateName": "", "barRegistration": "", "contact": ""}]
            confidence["caseTitle"] = 0.94

        dates = self.DATE_RE.findall(text)
        if dates:
            entities["filingDate"] = dates[0]
            confidence["filingDate"] = 0.91

        court_match = self.COURT_RE.search(text)
        if court_match:
            entities["courtName"] = court_match.group(1).title()
            entities["courtLevel"] = court_match.group(1).title()
            confidence["courtName"] = 0.92

        if "bail" in lowered_name or "bail" in text.lower():
            entities.setdefault("caseType", "Bail")
        elif "petition" in lowered_name or "petition" in text.lower():
            entities.setdefault("caseType", "Petition")

        return ExtractionResult(
            text=text,
            entities=entities,
            confidence_by_field=confidence,
            quality_score=quality_score,
        )

    def classify(self, document: DocumentReference, text: str) -> DocumentType:
        candidate = f"{document.document_name} {text}".lower()
        if "pleading" in candidate or "plaint" in candidate or "written statement" in candidate:
            return DocumentType.pleading
        if "evidence" in candidate or "exhibit" in candidate:
            return DocumentType.evidence
        if "order" in candidate or "judgment" in candidate:
            return DocumentType.order
        if "letter" in candidate or "notice" in candidate or "email" in candidate:
            return DocumentType.correspondence
        if "affidavit" in candidate:
            return DocumentType.affidavit
        if "agreement" in candidate or "contract" in candidate:
            return DocumentType.contract
        return document.declared_doc_type or DocumentType.unknown
