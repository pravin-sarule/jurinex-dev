"""
LLM Field Extractor: Uses Anthropic Claude to intelligently identify ALL fields
from a legal document template and enrich them with metadata for auto-population.

Model: claude-sonnet-4-6
Temperature: 0.1 (for consistency)
"""

import json
import logging
import os
import re
from typing import List, Dict, Optional, Any

try:
    import anthropic
    ANTHROPIC_AVAILABLE = True
except ImportError:
    ANTHROPIC_AVAILABLE = False

from .field_extractor import FieldExtractor, FieldDefinition, ExtractionResult, WRIT_PETITION_SEED_FIELDS

logger = logging.getLogger(__name__)

MODEL = "claude-sonnet-4-6"
TEMPERATURE = 0.1
MAX_TOKENS = 4000

# ---------------------------------------------------------------------------
# Comprehensive mappings for common Writ Petition fields
# ---------------------------------------------------------------------------

FIELD_VECTOR_KEY_MAP: Dict[str, List[str]] = {
    "petition_number": ["petition_number", "writ_petition_number", "case_number", "petition_no", "wp_number", "case_no"],
    "year": ["year", "filing_year", "case_year", "petition_year"],
    "petitioner_name": ["petitioner_name", "petitioner", "applicant_name", "plaintiff_name", "client_name", "party_name"],
    "petitioner_address": ["petitioner_address", "address", "residence", "petitioner_residence", "client_address", "domicile"],
    "respondent_name": ["respondent_name", "respondents", "opposite_party", "defendant", "government_party", "authority"],
    "writ_type": ["writ_type", "type_of_writ", "writ", "remedy_type", "constitutional_remedy"],
    "constitutional_article": ["constitutional_article", "article", "article_number", "under_article", "article_32", "article_226"],
    "facts_of_case": ["facts_of_case", "case_facts", "factual_background", "case_summary", "incident_details", "background", "narration"],
    "questions_of_law": ["questions_of_law", "legal_questions", "questions", "issues_for_consideration", "legal_issues"],
    "grounds": ["grounds", "legal_grounds", "grounds_of_challenge", "reasons", "arguments", "submissions"],
    "prayer_reliefs": ["prayer_reliefs", "relief_sought", "prayers", "remedies", "orders_sought", "directions_sought"],
    "interim_relief": ["interim_relief", "stay_application", "urgent_relief", "temporary_relief", "ad_interim_relief"],
    "advocate_name": ["advocate_name", "lawyer_name", "counsel", "filed_by", "attorney_name", "advocate_on_record"],
    "filing_date": ["filing_date", "date_of_filing", "filed_on", "petition_date", "date"],
    "court_name": ["court_name", "court", "tribunal", "forum", "high_court", "supreme_court"],
    "opposite_party_advocate": ["opposite_party_advocate", "respondent_counsel", "government_pleader", "ags"],
}

VALIDATION_RULES_MAP: Dict[str, Dict] = {
    "petition_number": {"pattern": r"WP\([A-Z]+\)\s*\d+/\d{4}"},
    "year": {"min": 2000, "max": 2035, "type": "integer"},
    "petitioner_name": {"min_length": 3, "max_length": 200},
    "petitioner_address": {"min_length": 10, "max_length": 500},
    "respondent_name": {"min_length": 3},
    "writ_type": {"enum": ["MANDAMUS", "CERTIORARI", "PROHIBITION", "QUO WARRANTO", "HABEAS CORPUS"]},
    "constitutional_article": {"enum": ["32", "226"]},
    "facts_of_case": {"min_length": 200, "max_length": 10000},
    "questions_of_law": {"min_length": 50, "max_length": 3000},
    "grounds": {"min_length": 100, "max_length": 10000},
    "prayer_reliefs": {"min_length": 50, "max_length": 3000},
    "filing_date": {"format": "DD.MM.YYYY"},
    "court_name": {"min_length": 5},
}

FALLBACK_MAP: Dict[str, List[str]] = {
    "petition_number": ["auto_generate"],
    "year": ["current_year"],
    "petitioner_name": ["ask_user"],
    "petitioner_address": ["ask_user"],
    "respondent_name": ["infer_from_facts", "ask_user"],
    "writ_type": ["infer_from_relief"],
    "constitutional_article": ["infer_from_writ"],
    "facts_of_case": ["synthesize_from_context"],
    "questions_of_law": ["generate_from_facts", "synthesize_from_context"],
    "grounds": ["synthesize_from_context"],
    "prayer_reliefs": ["infer_from_writ", "synthesize_from_context"],
    "interim_relief": ["infer_from_prayer"],
    "advocate_name": ["ask_user"],
    "filing_date": ["current_date"],
    "court_name": ["infer_from_article"],
    "opposite_party_advocate": ["leave_blank"],
}

FORMATTING_MAP: Dict[str, str] = {
    "facts_of_case": "numbered_paragraphs",
    "questions_of_law": "lettered_list",
    "grounds": "lettered_list",
    "prayer_reliefs": "roman_numerals",
    "interim_relief": "roman_numerals",
    "respondent_name": "numbered_list",
}

EXTRACTION_PROMPT = """You are a legal document analysis expert. Analyze the following Writ Petition template text and identify ALL input fields that need to be filled in.

For each field, provide:
1. field_id: snake_case identifier (e.g., petitioner_name)
2. field_name: Human readable name (e.g., Petitioner Name)
3. field_type: one of [text, number, date, long_text, list]
4. page_number: approximate page number (integer)
5. location_marker: the text surrounding the blank field
6. surrounding_text: context around where the field appears
7. is_required: true/false
8. example_value: realistic example value for this field

IMPORTANT: Return ONLY valid JSON array. No markdown, no explanation.

Format:
[
  {{
    "field_id": "petitioner_name",
    "field_name": "Petitioner Name",
    "field_type": "text",
    "page_number": 1,
    "location_marker": "...Petitioner",
    "surrounding_text": "...versus...Respondent",
    "is_required": true,
    "example_value": "Rajesh Kumar Singh"
  }}
]

Template text:
{template_text}

Identify all {expected_count} or more fields. Include: petition_number, year, petitioner_name, petitioner_address, respondent_name, writ_type, constitutional_article, facts_of_case, questions_of_law, grounds, prayer_reliefs, interim_relief, advocate_name, filing_date, court_name, opposite_party_advocate."""


class LLMFieldExtractor:
    """
    LLM-enhanced field extractor using Anthropic Claude.

    Uses Claude to intelligently identify ALL fields from a template and
    enriches them with vector_db_keys, validation rules, fallback strategies
    and formatting requirements.

    Usage::

        extractor = LLMFieldExtractor(api_key="sk-ant-...")
        result = extractor.extract_from_text(template_text)
        extractor.save_schema(result, "schema.json")
    """

    def __init__(self, api_key: Optional[str] = None):
        if not ANTHROPIC_AVAILABLE:
            raise ImportError("anthropic package not installed. Run: pip install anthropic")

        self._client = anthropic.Anthropic(api_key=api_key or os.environ.get("ANTHROPIC_API_KEY"))
        self._pattern_extractor = FieldExtractor()
        logger.info("LLMFieldExtractor initialised (model=%s)", MODEL)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def extract_from_text(
        self,
        template_text: str,
        source: str = "template",
        use_llm: bool = True,
    ) -> ExtractionResult:
        """
        Extract fields from template text, optionally using Claude.

        Args:
            template_text: Raw text of the legal template
            source: Label for the source document
            use_llm: If False, falls back to pattern-only extraction
        """
        result = ExtractionResult(source_file=source)

        if use_llm:
            try:
                raw_fields = self._call_claude(template_text)
                result.fields = [self._enrich_field(f) for f in raw_fields]
                result.extraction_method = "llm+enrichment"
                logger.info("LLM extracted %d fields from %s", len(result.fields), source)
                return result
            except Exception as exc:
                logger.warning("LLM extraction failed (%s); falling back to pattern", exc)
                result.warnings.append(f"LLM failed: {exc}; used pattern fallback")

        # Fallback: pattern-based
        pattern_result = self._pattern_extractor.extract_from_text(template_text, source)
        result.fields = pattern_result.fields
        result.extraction_method = "pattern_fallback"
        result.warnings.extend(pattern_result.warnings)
        return result

    def extract_from_pdf(self, pdf_path: str, use_llm: bool = True) -> ExtractionResult:
        """Extract fields from a PDF file."""
        try:
            import pypdf
            pages_text: List[str] = []
            with open(pdf_path, "rb") as fh:
                reader = pypdf.PdfReader(fh)
                for page in reader.pages:
                    pages_text.append(page.extract_text() or "")
            full_text = "\n\n--- PAGE BREAK ---\n\n".join(pages_text)
            result = self.extract_from_text(full_text, source=pdf_path, use_llm=use_llm)
            result.total_pages = len(pages_text)
            return result
        except Exception as exc:
            logger.error("PDF read failed: %s", exc)
            result = ExtractionResult(source_file=pdf_path, warnings=[str(exc)])
            result.fields = self._enrich_seed_fields()
            result.extraction_method = "seed"
            return result

    def use_seed_fields(self) -> ExtractionResult:
        """Return the enriched Writ Petition seed field definitions."""
        result = ExtractionResult(source_file="seed", extraction_method="seed+llm_enrichment")
        result.fields = self._enrich_seed_fields()
        return result

    def save_schema(self, result: ExtractionResult, output_path: str) -> None:
        """Save extraction result to JSON."""
        from pathlib import Path
        Path(output_path).parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, "w", encoding="utf-8") as fh:
            json.dump(result.to_dict(), fh, indent=2, ensure_ascii=False)
        logger.info("Schema saved → %s (%d fields)", output_path, len(result.fields))

    # ------------------------------------------------------------------
    # Claude API
    # ------------------------------------------------------------------

    def _call_claude(self, template_text: str) -> List[FieldDefinition]:
        """Send template text to Claude and parse returned JSON field list."""
        if len(template_text) > 12000:
            template_text = template_text[:12000] + "\n...[truncated]"

        prompt = EXTRACTION_PROMPT.format(
            template_text=template_text,
            expected_count=len(WRIT_PETITION_SEED_FIELDS),
        )

        message = self._client.messages.create(
            model=MODEL,
            max_tokens=MAX_TOKENS,
            temperature=TEMPERATURE,
            messages=[{"role": "user", "content": prompt}],
        )

        raw_text = message.content[0].text.strip()
        logger.debug("Claude response (first 200 chars): %s", raw_text[:200])
        return self._parse_llm_response(raw_text)

    def _parse_llm_response(self, raw_text: str) -> List[FieldDefinition]:
        """Parse JSON from Claude response into FieldDefinition list."""
        # Strip markdown code fences
        raw_text = re.sub(r'^```[a-z]*\n?', '', raw_text, flags=re.MULTILINE)
        raw_text = re.sub(r'```$', '', raw_text, flags=re.MULTILINE).strip()

        try:
            data = json.loads(raw_text)
        except json.JSONDecodeError:
            match = re.search(r'\[.*\]', raw_text, re.DOTALL)
            if not match:
                raise ValueError("No JSON array found in LLM response")
            data = json.loads(match.group(0))

        fields = []
        for item in data:
            fd = FieldDefinition(
                field_id=item.get("field_id", "unknown"),
                field_name=item.get("field_name", "Unknown"),
                field_type=item.get("field_type", "text"),
                page_number=int(item.get("page_number", 1)),
                location_marker=item.get("location_marker", ""),
                surrounding_text=item.get("surrounding_text", ""),
                is_required=bool(item.get("is_required", True)),
                example_value=item.get("example_value", ""),
                extraction_method="llm",
            )
            fields.append(fd)

        logger.info("Parsed %d fields from LLM response", len(fields))
        return fields

    # ------------------------------------------------------------------
    # Field enrichment
    # ------------------------------------------------------------------

    def _enrich_field(self, fd: FieldDefinition) -> FieldDefinition:
        """Add vector_db_keys, validation rules, fallback strategies, formatting."""
        fid = fd.field_id
        if not fd.vector_db_keys:
            fd.vector_db_keys = FIELD_VECTOR_KEY_MAP.get(fid, self._generate_vector_keys(fid))
        if not fd.validation_rules:
            fd.validation_rules = VALIDATION_RULES_MAP.get(fid, {})
        if not fd.fallback_strategies:
            fd.fallback_strategies = FALLBACK_MAP.get(fid, ["ask_user"])
        if not fd.formatting:
            fd.formatting = FORMATTING_MAP.get(fid, "plain")
        return fd

    def _enrich_seed_fields(self) -> List[FieldDefinition]:
        """Build enriched FieldDefinitions from seed data."""
        fields = []
        for seed in WRIT_PETITION_SEED_FIELDS:
            fd = FieldDefinition(
                field_id=seed["field_id"],
                field_name=seed["field_name"],
                field_type=seed["field_type"],
                location_marker=seed.get("location_marker", ""),
                example_value=seed.get("example_value", ""),
                is_required=seed.get("is_required", True),
                vector_db_keys=seed.get("vector_db_keys", []),
                validation_rules=seed.get("validation_rules", {}),
                fallback_strategies=seed.get("fallback_strategies", []),
                formatting=seed.get("formatting", "plain"),
                extraction_method="seed",
            )
            fields.append(fd)
        return fields

    @staticmethod
    def _generate_vector_keys(field_id: str) -> List[str]:
        parts = field_id.split('_')
        return list(dict.fromkeys([
            field_id,
            ' '.join(parts),
            ''.join(p.title() for p in parts),
            '_'.join(parts[:2]) if len(parts) > 2 else field_id,
            ' '.join(parts[:2]) if len(parts) > 2 else ' '.join(parts),
        ]))
