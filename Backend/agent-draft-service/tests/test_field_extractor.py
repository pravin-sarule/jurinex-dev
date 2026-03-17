"""Tests for FieldExtractor – pattern-based and structural extraction."""

import json
import sys
from pathlib import Path

import pytest

# Ensure the project root is on sys.path
sys.path.insert(0, str(Path(__file__).parent.parent))

from src.extraction.field_extractor import FieldExtractor, FieldDefinition, ExtractionResult


SAMPLE_TEMPLATE_TEXT = """
IN THE SUPREME COURT OF INDIA
WRIT PETITION (CIVIL) NO. _________ OF THE YEAR _________

IN THE MATTER OF:

.....Petitioner

VERSUS

.....Respondent

FILED BY:
PETITION NO. ___

1. Facts of the case
2. Questions of Law
3. Grounds
4. Prayer
"""


class TestPatternExtraction:
    def setup_method(self):
        self.extractor = FieldExtractor()

    def test_extract_from_text_returns_result(self):
        result = self.extractor.extract_from_text(SAMPLE_TEMPLATE_TEXT)
        assert isinstance(result, ExtractionResult)
        assert len(result.fields) > 0

    def test_extracts_numbered_sections(self):
        result = self.extractor.extract_from_text(SAMPLE_TEMPLATE_TEXT)
        field_ids = [f.field_id for f in result.fields]
        assert any("fact" in fid for fid in field_ids), \
            f"No 'facts' field found. Got: {field_ids}"

    def test_extracts_colon_fields(self):
        result = self.extractor.extract_from_text(SAMPLE_TEMPLATE_TEXT)
        field_ids = [f.field_id for f in result.fields]
        assert any("filed" in fid or "petition" in fid for fid in field_ids), \
            f"No 'filed by' or 'petition' field found. Got: {field_ids}"

    def test_seed_fields_returns_16_plus_fields(self):
        result = self.extractor.use_seed_fields()
        assert len(result.fields) >= 16, \
            f"Expected >=16 seed fields, got {len(result.fields)}"

    def test_seed_fields_have_vector_db_keys(self):
        result = self.extractor.use_seed_fields()
        for f in result.fields:
            assert len(f.vector_db_keys) >= 3, \
                f"Field '{f.field_id}' has only {len(f.vector_db_keys)} vector_db_keys"

    def test_seed_fields_have_fallback_strategies(self):
        result = self.extractor.use_seed_fields()
        for f in result.fields:
            assert len(f.fallback_strategies) >= 1, \
                f"Field '{f.field_id}' missing fallback_strategies"

    def test_writ_type_has_enum_validation(self):
        result = self.extractor.use_seed_fields()
        writ_field = next((f for f in result.fields if f.field_id == "writ_type"), None)
        assert writ_field is not None, "writ_type field not found in seed"
        assert "enum" in writ_field.validation_rules, \
            f"writ_type.validation_rules missing 'enum': {writ_field.validation_rules}"

    def test_facts_of_case_is_long_text(self):
        result = self.extractor.use_seed_fields()
        facts = next((f for f in result.fields if f.field_id == "facts_of_case"), None)
        assert facts is not None
        assert facts.field_type == "long_text"

    def test_facts_of_case_formatting_is_numbered_paragraphs(self):
        result = self.extractor.use_seed_fields()
        facts = next((f for f in result.fields if f.field_id == "facts_of_case"), None)
        assert facts is not None
        assert facts.formatting == "numbered_paragraphs"

    def test_snake_case_conversion(self):
        assert FieldExtractor._to_snake_case("Facts of the Case") == "facts_of_the_case"
        assert FieldExtractor._to_snake_case("PETITION NO") == "petition_no"
        assert FieldExtractor._to_snake_case("Filed By") == "filed_by"
        assert FieldExtractor._to_snake_case("") == "unknown_field"

    def test_save_schema_creates_valid_json(self, tmp_path):
        result = self.extractor.use_seed_fields()
        output_path = str(tmp_path / "test_schema.json")
        self.extractor.save_schema(result, output_path)

        assert Path(output_path).exists()
        with open(output_path) as fh:
            data = json.load(fh)

        assert "fields" in data
        assert "total_fields" in data
        assert data["total_fields"] == len(result.fields)

    def test_required_seed_fields_present(self):
        result = self.extractor.use_seed_fields()
        field_ids = {f.field_id for f in result.fields}
        required = {
            "petitioner_name", "respondent_name", "writ_type",
            "constitutional_article", "facts_of_case", "prayer_reliefs",
            "questions_of_law", "grounds", "advocate_name", "filing_date",
        }
        missing = required - field_ids
        assert not missing, f"Missing required seed fields: {missing}"

    def test_field_definition_to_dict(self):
        result = self.extractor.use_seed_fields()
        d = result.fields[0].to_dict()
        assert isinstance(d, dict)
        assert "field_id" in d
        assert "vector_db_keys" in d
        assert "validation_rules" in d

    def test_extraction_result_to_dict(self):
        result = self.extractor.use_seed_fields()
        d = result.to_dict()
        assert isinstance(d["fields"], list)
        assert d["total_fields"] == len(result.fields)


class TestStructuralExtraction:
    def setup_method(self):
        self.extractor = FieldExtractor()

    def test_all_caps_label_detected(self):
        text = "PETITIONER NAME\n__________\nsome other text"
        result = self.extractor.extract_from_text(text)
        field_ids = [f.field_id for f in result.fields]
        # Should find petitioner_name in structural or seed
        assert any("petitioner" in fid for fid in field_ids)
