"""
Field Extractor: Pattern-based and structural extraction of input fields
from legal document templates (PDF).

Handles Writ Petition template format specifically, extracting fields via:
1. Regex patterns (underscores, dots, blanks, colons)
2. Structural analysis (numbered sections, ALL-CAPS labels)
3. Field enrichment with vector_db_keys, validation rules, fallback strategies
"""

import re
import json
import logging
from pathlib import Path
from dataclasses import dataclass, field, asdict
from typing import List, Dict, Optional, Any

try:
    import pypdf
    PYPDF_AVAILABLE = True
except ImportError:
    PYPDF_AVAILABLE = False

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Regex patterns
# ---------------------------------------------------------------------------

# Underscore fields:  ARTICLE________OF  or  ____________
UNDERSCORE_PATTERN = re.compile(
    r'([A-Z][A-Za-z\s]*?)?\s*_{3,}\s*([A-Za-z\s]*?)?(?=\s|$|\n)',
    re.MULTILINE,
)

# Dot fields: .....Petitioner  or  ............
DOT_PATTERN = re.compile(
    r'\.{3,}([A-Za-z\s]*?)?(?=\s|$|\n)',
    re.MULTILINE,
)

# Blank/bracket fields: [      ]  or  (          )
BLANK_BRACKET_PATTERN = re.compile(
    r'[\[\(]\s{3,}[\]\)]',
    re.MULTILINE,
)

# Colon fields: FILED BY:   or   Court:
COLON_FIELD_PATTERN = re.compile(
    r'^([A-Z][A-Za-z\s/]{2,50}):\s*$',
    re.MULTILINE,
)

# Numbered section headers: 1. Facts of the case
NUMBERED_SECTION_PATTERN = re.compile(
    r'^(\d+)\.\s+([A-Z][A-Za-z\s,&]{3,80})$',
    re.MULTILINE,
)

# ---------------------------------------------------------------------------
# Seed field definitions for Writ Petition
# ---------------------------------------------------------------------------

WRIT_PETITION_SEED_FIELDS: List[Dict] = [
    {
        "field_id": "petition_number",
        "field_name": "Petition Number",
        "field_type": "text",
        "location_marker": "PETITION NO.",
        "example_value": "WP(C) 1234/2024",
        "vector_db_keys": ["petition_number", "writ_petition_number", "case_number", "petition_no", "wp_number"],
        "validation_rules": {"pattern": r"WP\([A-Z]+\)\s*\d+/\d{4}"},
        "fallback_strategies": ["auto_generate"],
        "formatting": "plain",
        "is_required": True,
    },
    {
        "field_id": "year",
        "field_name": "Year",
        "field_type": "number",
        "location_marker": "OF THE YEAR",
        "example_value": "2024",
        "vector_db_keys": ["year", "filing_year", "case_year", "petition_year"],
        "validation_rules": {"min": 2000, "max": 2035},
        "fallback_strategies": ["current_year"],
        "formatting": "plain",
        "is_required": True,
    },
    {
        "field_id": "petitioner_name",
        "field_name": "Petitioner Name",
        "field_type": "text",
        "location_marker": "Petitioner",
        "example_value": "Rajesh Kumar Singh",
        "vector_db_keys": ["petitioner_name", "petitioner", "applicant_name", "plaintiff_name", "client_name"],
        "validation_rules": {"min_length": 3, "max_length": 200},
        "fallback_strategies": ["ask_user"],
        "formatting": "plain",
        "is_required": True,
    },
    {
        "field_id": "petitioner_address",
        "field_name": "Petitioner Address",
        "field_type": "text",
        "location_marker": "R/o",
        "example_value": "123, Main Street, New Delhi - 110001",
        "vector_db_keys": ["petitioner_address", "address", "residence", "petitioner_residence", "client_address"],
        "validation_rules": {"min_length": 10},
        "fallback_strategies": ["ask_user"],
        "formatting": "plain",
        "is_required": True,
    },
    {
        "field_id": "respondent_name",
        "field_name": "Respondent(s)",
        "field_type": "list",
        "location_marker": "Respondent",
        "example_value": "1. Union of India\n2. Ministry of Finance",
        "vector_db_keys": ["respondent_name", "respondents", "opposite_party", "defendant", "government_party"],
        "validation_rules": {"min_length": 3},
        "fallback_strategies": ["infer_from_facts", "ask_user"],
        "formatting": "numbered_list",
        "is_required": True,
    },
    {
        "field_id": "writ_type",
        "field_name": "Writ Type",
        "field_type": "text",
        "location_marker": "WRIT OF",
        "example_value": "MANDAMUS",
        "vector_db_keys": ["writ_type", "type_of_writ", "writ", "remedy_type", "constitutional_remedy"],
        "validation_rules": {"enum": ["MANDAMUS", "CERTIORARI", "PROHIBITION", "QUO WARRANTO", "HABEAS CORPUS"]},
        "fallback_strategies": ["infer_from_relief"],
        "formatting": "plain",
        "is_required": True,
    },
    {
        "field_id": "constitutional_article",
        "field_name": "Constitutional Article",
        "field_type": "text",
        "location_marker": "ARTICLE",
        "example_value": "32",
        "vector_db_keys": ["constitutional_article", "article", "article_number", "under_article", "article_32", "article_226"],
        "validation_rules": {"enum": ["32", "226"]},
        "fallback_strategies": ["infer_from_writ"],
        "formatting": "plain",
        "is_required": True,
    },
    {
        "field_id": "facts_of_case",
        "field_name": "Facts of the Case",
        "field_type": "long_text",
        "location_marker": "Facts of the case",
        "example_value": "The petitioner is a citizen of India...",
        "vector_db_keys": ["facts_of_case", "case_facts", "factual_background", "case_summary", "incident_details", "background"],
        "validation_rules": {"min_length": 200, "max_length": 5000},
        "fallback_strategies": ["synthesize_from_context"],
        "formatting": "numbered_paragraphs",
        "is_required": True,
    },
    {
        "field_id": "questions_of_law",
        "field_name": "Questions of Law",
        "field_type": "long_text",
        "location_marker": "Questions of Law",
        "example_value": "Whether the action of the respondent violates Article 14?",
        "vector_db_keys": ["questions_of_law", "legal_questions", "questions", "issues_for_consideration"],
        "validation_rules": {"min_length": 50},
        "fallback_strategies": ["generate_from_facts", "synthesize_from_context"],
        "formatting": "lettered_list",
        "is_required": True,
    },
    {
        "field_id": "grounds",
        "field_name": "Grounds",
        "field_type": "long_text",
        "location_marker": "Grounds",
        "example_value": "A. That the impugned order is arbitrary...",
        "vector_db_keys": ["grounds", "legal_grounds", "grounds_of_challenge", "reasons", "arguments"],
        "validation_rules": {"min_length": 100},
        "fallback_strategies": ["synthesize_from_context"],
        "formatting": "lettered_list",
        "is_required": True,
    },
    {
        "field_id": "prayer_reliefs",
        "field_name": "Prayer / Relief Sought",
        "field_type": "long_text",
        "location_marker": "Prayer",
        "example_value": "(i) issue a writ of mandamus...",
        "vector_db_keys": ["prayer_reliefs", "relief_sought", "prayers", "remedies", "orders_sought"],
        "validation_rules": {"min_length": 50},
        "fallback_strategies": ["infer_from_writ", "synthesize_from_context"],
        "formatting": "roman_numerals",
        "is_required": True,
    },
    {
        "field_id": "interim_relief",
        "field_name": "Interim Relief",
        "field_type": "long_text",
        "location_marker": "Interim Relief",
        "example_value": "Stay of the impugned order dated...",
        "vector_db_keys": ["interim_relief", "stay_application", "urgent_relief", "temporary_relief"],
        "validation_rules": {"min_length": 20},
        "fallback_strategies": ["infer_from_prayer"],
        "formatting": "roman_numerals",
        "is_required": False,
    },
    {
        "field_id": "advocate_name",
        "field_name": "Advocate Name",
        "field_type": "text",
        "location_marker": "Filed by",
        "example_value": "Adv. Priya Sharma",
        "vector_db_keys": ["advocate_name", "lawyer_name", "counsel", "filed_by", "attorney_name"],
        "validation_rules": {"min_length": 3},
        "fallback_strategies": ["ask_user"],
        "formatting": "plain",
        "is_required": True,
    },
    {
        "field_id": "filing_date",
        "field_name": "Date of Filing",
        "field_type": "date",
        "location_marker": "Date",
        "example_value": "15.03.2024",
        "vector_db_keys": ["filing_date", "date_of_filing", "filed_on", "petition_date"],
        "validation_rules": {"format": "DD.MM.YYYY"},
        "fallback_strategies": ["current_date"],
        "formatting": "plain",
        "is_required": True,
    },
    {
        "field_id": "court_name",
        "field_name": "Court Name",
        "field_type": "text",
        "location_marker": "IN THE",
        "example_value": "SUPREME COURT OF INDIA",
        "vector_db_keys": ["court_name", "court", "tribunal", "forum", "high_court"],
        "validation_rules": {"min_length": 5},
        "fallback_strategies": ["infer_from_article"],
        "formatting": "plain",
        "is_required": True,
    },
    {
        "field_id": "opposite_party_advocate",
        "field_name": "Opposite Party Advocate",
        "field_type": "text",
        "location_marker": "Advocate for Respondent",
        "example_value": "Additional Solicitor General",
        "vector_db_keys": ["opposite_party_advocate", "respondent_counsel", "government_pleader"],
        "validation_rules": {},
        "fallback_strategies": ["leave_blank"],
        "formatting": "plain",
        "is_required": False,
    },
]


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------

@dataclass
class FieldDefinition:
    field_id: str
    field_name: str
    field_type: str           # text | number | date | long_text | list
    page_number: int = 1
    location_marker: str = ""
    surrounding_text: str = ""
    is_required: bool = True
    example_value: str = ""
    vector_db_keys: List[str] = field(default_factory=list)
    validation_rules: Dict[str, Any] = field(default_factory=dict)
    fallback_strategies: List[str] = field(default_factory=list)
    formatting: str = ""      # numbered_paragraphs | lettered_list | roman_numerals | plain
    extraction_method: str = "pattern"

    def to_dict(self) -> Dict:
        return asdict(self)


@dataclass
class ExtractionResult:
    fields: List[FieldDefinition] = field(default_factory=list)
    source_file: str = ""
    total_pages: int = 0
    extraction_method: str = "pattern"
    warnings: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict:
        return {
            "fields": [f.to_dict() for f in self.fields],
            "source_file": self.source_file,
            "total_pages": self.total_pages,
            "extraction_method": self.extraction_method,
            "warnings": self.warnings,
            "total_fields": len(self.fields),
        }


# ---------------------------------------------------------------------------
# FieldExtractor
# ---------------------------------------------------------------------------

class FieldExtractor:
    """
    Extracts input fields from legal document templates using pattern matching
    and structural analysis. Specifically tuned for Writ Petition templates.

    Usage::

        extractor = FieldExtractor()
        result = extractor.extract_from_pdf("template.pdf")
        # or use built-in seed fields:
        result = extractor.use_seed_fields()
        extractor.save_schema(result, "schema.json")
    """

    def __init__(self):
        logger.info("FieldExtractor initialised")

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def extract_from_pdf(self, pdf_path: str) -> ExtractionResult:
        """Extract fields from a PDF template. Falls back to seed fields if parsing fails."""
        result = ExtractionResult(source_file=pdf_path)

        if not PYPDF_AVAILABLE:
            result.warnings.append("pypdf not available – using seed field definitions")
            result.fields = self._seed_fields()
            result.extraction_method = "seed"
            return result

        try:
            pages_text = self._read_pdf(pdf_path)
            result.total_pages = len(pages_text)
            all_text = "\n".join(pages_text)

            pattern_fields = self._extract_by_patterns(pages_text)
            structural_fields = self._extract_by_structure(all_text)
            merged = self._merge_fields(pattern_fields, structural_fields)
            result.fields = [self._enrich_field(f) for f in merged]
            result.extraction_method = "pattern+structural"
            logger.info("Extracted %d fields from %s", len(result.fields), pdf_path)

        except Exception as exc:
            logger.error("PDF extraction failed: %s", exc)
            result.warnings.append(f"PDF extraction failed ({exc}); using seed fields")
            result.fields = self._seed_fields()
            result.extraction_method = "seed"

        return result

    def extract_from_text(self, text: str, source: str = "text_input") -> ExtractionResult:
        """Extract fields from raw text."""
        result = ExtractionResult(source_file=source)
        pages_text = [text]
        result.total_pages = 1

        pattern_fields = self._extract_by_patterns(pages_text)
        structural_fields = self._extract_by_structure(text)
        merged = self._merge_fields(pattern_fields, structural_fields)
        result.fields = [self._enrich_field(f) for f in merged]
        result.extraction_method = "pattern+structural"
        return result

    def use_seed_fields(self) -> ExtractionResult:
        """Return the built-in Writ Petition field definitions."""
        result = ExtractionResult(source_file="seed", extraction_method="seed")
        result.fields = self._seed_fields()
        return result

    def save_schema(self, result: ExtractionResult, output_path: str) -> None:
        """Save extraction result to JSON."""
        Path(output_path).parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, "w", encoding="utf-8") as fh:
            json.dump(result.to_dict(), fh, indent=2, ensure_ascii=False)
        logger.info("Schema saved to %s (%d fields)", output_path, len(result.fields))

    # ------------------------------------------------------------------
    # PDF reading
    # ------------------------------------------------------------------

    def _read_pdf(self, pdf_path: str) -> List[str]:
        pages: List[str] = []
        with open(pdf_path, "rb") as fh:
            reader = pypdf.PdfReader(fh)
            for page in reader.pages:
                pages.append(page.extract_text() or "")
        return pages

    # ------------------------------------------------------------------
    # Pattern extraction
    # ------------------------------------------------------------------

    def _extract_by_patterns(self, pages_text: List[str]) -> List[FieldDefinition]:
        fields: List[FieldDefinition] = []
        for page_num, text in enumerate(pages_text, start=1):
            fields.extend(self._extract_underscore_fields(text, page_num))
            fields.extend(self._extract_dot_fields(text, page_num))
            fields.extend(self._extract_colon_fields(text, page_num))
            fields.extend(self._extract_numbered_sections(text, page_num))
        return fields

    def _extract_underscore_fields(self, text: str, page_num: int) -> List[FieldDefinition]:
        fields = []
        for match in UNDERSCORE_PATTERN.finditer(text):
            prefix = (match.group(1) or "").strip()
            suffix = (match.group(2) or "").strip()
            label = (prefix + " " + suffix).strip() or "blank_field"
            fid = self._to_snake_case(label)
            surrounding = self._get_surrounding(text, match.start(), match.end())
            fields.append(FieldDefinition(
                field_id=fid, field_name=label, field_type="text",
                page_number=page_num, location_marker=match.group(0)[:30],
                surrounding_text=surrounding, extraction_method="underscore_pattern",
            ))
        return fields

    def _extract_dot_fields(self, text: str, page_num: int) -> List[FieldDefinition]:
        fields = []
        for match in DOT_PATTERN.finditer(text):
            suffix = (match.group(1) or "").strip()
            label = suffix or "dot_field"
            fid = self._to_snake_case(label)
            surrounding = self._get_surrounding(text, match.start(), match.end())
            fields.append(FieldDefinition(
                field_id=fid, field_name=label, field_type="text",
                page_number=page_num, location_marker=match.group(0)[:30],
                surrounding_text=surrounding, extraction_method="dot_pattern",
            ))
        return fields

    def _extract_colon_fields(self, text: str, page_num: int) -> List[FieldDefinition]:
        fields = []
        for match in COLON_FIELD_PATTERN.finditer(text):
            label = match.group(1).strip()
            if len(label) < 3:
                continue
            fid = self._to_snake_case(label)
            surrounding = self._get_surrounding(text, match.start(), match.end())
            fields.append(FieldDefinition(
                field_id=fid, field_name=label, field_type="text",
                page_number=page_num, location_marker=label + ":",
                surrounding_text=surrounding, extraction_method="colon_pattern",
            ))
        return fields

    def _extract_numbered_sections(self, text: str, page_num: int) -> List[FieldDefinition]:
        fields = []
        for match in NUMBERED_SECTION_PATTERN.finditer(text):
            section_name = match.group(2).strip()
            fid = self._to_snake_case(section_name)
            fields.append(FieldDefinition(
                field_id=fid, field_name=section_name, field_type="long_text",
                page_number=page_num, location_marker=match.group(0)[:40],
                surrounding_text=match.group(0), extraction_method="numbered_section",
            ))
        return fields

    # ------------------------------------------------------------------
    # Structural extraction
    # ------------------------------------------------------------------

    def _extract_by_structure(self, text: str) -> List[FieldDefinition]:
        fields: List[FieldDefinition] = []
        lines = text.splitlines()
        for i, line in enumerate(lines):
            stripped = line.strip()
            if re.match(r'^[A-Z][A-Z\s]{4,}$', stripped):
                next_line = lines[i + 1].strip() if i + 1 < len(lines) else ""
                if not next_line or re.match(r'^[_\.]{3,}$', next_line):
                    fid = self._to_snake_case(stripped)
                    fields.append(FieldDefinition(
                        field_id=fid, field_name=stripped.title(), field_type="text",
                        surrounding_text=stripped, extraction_method="structural",
                    ))
        return fields

    # ------------------------------------------------------------------
    # Merging & deduplication
    # ------------------------------------------------------------------

    def _merge_fields(
        self,
        pattern_fields: List[FieldDefinition],
        structural_fields: List[FieldDefinition],
    ) -> List[FieldDefinition]:
        seen: Dict[str, FieldDefinition] = {}
        # Seed first
        for f in self._seed_fields():
            seen[f.field_id] = f
        # Pattern/structural fields update page/location of existing
        for f in pattern_fields + structural_fields:
            if f.field_id not in seen:
                seen[f.field_id] = f
            else:
                existing = seen[f.field_id]
                if f.page_number:
                    existing.page_number = f.page_number
                if f.location_marker:
                    existing.location_marker = f.location_marker
                if f.surrounding_text:
                    existing.surrounding_text = f.surrounding_text
        return list(seen.values())

    # ------------------------------------------------------------------
    # Field enrichment
    # ------------------------------------------------------------------

    def _enrich_field(self, f: FieldDefinition) -> FieldDefinition:
        seed_map = {s["field_id"]: s for s in WRIT_PETITION_SEED_FIELDS}
        if f.field_id in seed_map:
            seed = seed_map[f.field_id]
            if not f.vector_db_keys:
                f.vector_db_keys = seed.get("vector_db_keys", [])
            if not f.validation_rules:
                f.validation_rules = seed.get("validation_rules", {})
            if not f.fallback_strategies:
                f.fallback_strategies = seed.get("fallback_strategies", [])
            if not f.formatting:
                f.formatting = seed.get("formatting", "plain")
            if not f.example_value:
                f.example_value = seed.get("example_value", "")
        else:
            if not f.vector_db_keys:
                f.vector_db_keys = self._generate_vector_keys(f.field_id)
            if not f.fallback_strategies:
                f.fallback_strategies = ["ask_user"] if f.is_required else ["leave_blank"]
            if not f.formatting:
                f.formatting = "numbered_paragraphs" if f.field_type == "long_text" else "plain"
        return f

    # ------------------------------------------------------------------
    # Seed fields
    # ------------------------------------------------------------------

    def _seed_fields(self) -> List[FieldDefinition]:
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

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _to_snake_case(text: str) -> str:
        text = text.lower().strip()
        text = re.sub(r'[^a-z0-9\s]', '', text)
        text = re.sub(r'\s+', '_', text)
        return text or "unknown_field"

    @staticmethod
    def _get_surrounding(text: str, start: int, end: int, window: int = 80) -> str:
        s = max(0, start - window)
        e = min(len(text), end + window)
        return text[s:e].replace('\n', ' ').strip()

    @staticmethod
    def _generate_vector_keys(field_id: str) -> List[str]:
        parts = field_id.split('_')
        return list(dict.fromkeys([
            field_id,
            ' '.join(parts),
            ''.join(p.title() for p in parts),
        ]))
