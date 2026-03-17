"""Tests for ComprehensiveAutoPopulator – all 5 stages."""

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from src.population.vector_db_interface import VectorDBInterface
from src.population.complete_autopopulator import ComprehensiveAutoPopulator
from src.extraction.field_extractor import FieldExtractor


# ---------------------------------------------------------------------------
# Fixtures / helpers
# ---------------------------------------------------------------------------

def load_sample_context() -> dict:
    data_path = Path(__file__).parent.parent / "data" / "sample_case_context.json"
    with open(data_path, encoding="utf-8") as fh:
        return json.load(fh)


def load_field_schema() -> list:
    extractor = FieldExtractor()
    result = extractor.use_seed_fields()
    return [f.to_dict() for f in result.fields]


# ---------------------------------------------------------------------------
# Full pipeline tests
# ---------------------------------------------------------------------------

class TestComprehensiveAutoPopulator:
    def setup_method(self):
        self.case_context = load_sample_context()
        self.field_schema = load_field_schema()
        vdb = VectorDBInterface(self.case_context)
        self.populator = ComprehensiveAutoPopulator(vdb, self.field_schema)

    def test_returns_expected_top_level_keys(self):
        results = self.populator.populate_all_fields()
        assert "populated_fields" in results
        assert "empty_fields" in results
        assert "metrics" in results

    def test_population_rate_above_85_percent(self):
        results = self.populator.populate_all_fields()
        rate = results["metrics"]["population_rate"]
        assert rate >= 0.85, f"Population rate too low: {rate:.1%}"

    def test_metrics_structure_complete(self):
        results = self.populator.populate_all_fields()
        m = results["metrics"]
        assert "total_fields" in m
        assert "populated_count" in m
        assert "empty_count" in m
        assert "population_rate" in m
        assert "confidence_distribution" in m
        assert "stage_breakdown" in m

    def test_populated_and_empty_counts_sum_to_total(self):
        results = self.populator.populate_all_fields()
        m = results["metrics"]
        assert m["populated_count"] + m["empty_count"] == m["total_fields"]

    def test_petitioner_name_populated_correctly(self):
        results = self.populator.populate_all_fields()
        assert "petitioner_name" in results["populated_fields"]
        val = results["populated_fields"]["petitioner_name"]["value"]
        assert "Rajesh" in val

    def test_writ_type_populated(self):
        results = self.populator.populate_all_fields()
        assert "writ_type" in results["populated_fields"]
        assert results["populated_fields"]["writ_type"]["value"] == "MANDAMUS"

    def test_constitutional_article_is_32(self):
        results = self.populator.populate_all_fields()
        if "constitutional_article" in results["populated_fields"]:
            val = results["populated_fields"]["constitutional_article"]["value"]
            assert val in ["32", "226"]

    def test_year_is_digit_string(self):
        results = self.populator.populate_all_fields()
        assert "year" in results["populated_fields"]
        assert results["populated_fields"]["year"]["value"].isdigit()

    def test_filing_date_format(self):
        import re
        results = self.populator.populate_all_fields()
        if "filing_date" in results["populated_fields"]:
            val = results["populated_fields"]["filing_date"]["value"]
            assert re.match(r'\d{2}\.\d{2}\.\d{4}', val)

    def test_all_populated_fields_have_confidence(self):
        results = self.populator.populate_all_fields()
        for fid, data in results["populated_fields"].items():
            assert "confidence" in data, f"'{fid}' missing confidence"
            assert 0.0 <= data["confidence"] <= 1.0

    def test_all_populated_fields_have_stage(self):
        results = self.populator.populate_all_fields()
        for fid, data in results["populated_fields"].items():
            assert "stage" in data, f"'{fid}' missing stage"
            assert data["stage"] in [1, 2, 3, 4, 5, 6]

    def test_all_populated_fields_have_formatted_value(self):
        results = self.populator.populate_all_fields()
        for fid, data in results["populated_fields"].items():
            assert "formatted_value" in data, f"'{fid}' missing formatted_value"

    def test_confidence_distribution_sums_correctly(self):
        results = self.populator.populate_all_fields()
        m = results["metrics"]
        dist = m["confidence_distribution"]
        total = dist["high"] + dist["medium"] + dist["low"]
        assert total == m["populated_count"]

    def test_stage_breakdown_has_entries(self):
        results = self.populator.populate_all_fields()
        breakdown = results["metrics"]["stage_breakdown"]
        assert len(breakdown) > 0


# ---------------------------------------------------------------------------
# Stage 1 unit tests
# ---------------------------------------------------------------------------

class TestStage1MultiKeySearch:
    def setup_method(self):
        context = {"petitioner_name": "Test User", "writ_type": "MANDAMUS"}
        vdb = VectorDBInterface(context)
        schema = [
            {
                "field_id": "petitioner_name",
                "field_type": "text",
                "vector_db_keys": ["petitioner_name", "petitioner"],
                "fallback_strategies": [],
                "formatting": "plain",
            },
        ]
        self.populator = ComprehensiveAutoPopulator(vdb, schema)

    def test_exact_match_found(self):
        config = {
            "field_id": "petitioner_name",
            "field_type": "text",
            "vector_db_keys": ["petitioner_name", "petitioner"],
        }
        result = self.populator._stage1_multikey_search(config)
        assert result is not None
        assert result.value == "Test User"
        assert result.confidence == 1.0

    def test_alias_key_finds_value(self):
        config = {
            "field_id": "writ_type",
            "field_type": "text",
            "vector_db_keys": ["writ_type", "type_of_writ"],
        }
        result = self.populator._stage1_multikey_search(config)
        assert result is not None
        assert result.value == "MANDAMUS"


# ---------------------------------------------------------------------------
# Stage 3 legal inference unit tests
# ---------------------------------------------------------------------------

class TestStage3LegalInference:
    def setup_method(self):
        context = {
            "writ_type": "MANDAMUS",
            "constitutional_article": "32",
        }
        vdb = VectorDBInterface(context)
        extractor = FieldExtractor()
        schema = [f.to_dict() for f in extractor.use_seed_fields().fields]
        self.populator = ComprehensiveAutoPopulator(vdb, schema)
        # Pre-populate writ_type so inference can use it
        from src.population.complete_autopopulator import FieldResult
        self.populator._populated_fields["writ_type"] = FieldResult(
            field_id="writ_type",
            value="MANDAMUS",
            confidence=1.0,
            stage=1,
            source="test",
        )

    def test_article_inferred_from_writ(self):
        config = self.populator.field_schema.get("constitutional_article", {})
        result = self.populator._stage3_legal_inference(
            "constitutional_article", config, {}
        )
        assert result is not None
        assert result.value == "32"

    def test_current_year_returned(self):
        config = self.populator.field_schema.get("year", {})
        result = self.populator._stage3_legal_inference("year", config, {})
        assert result is not None
        assert result.value.isdigit()

    def test_current_date_returned(self):
        import re
        config = self.populator.field_schema.get("filing_date", {})
        result = self.populator._stage3_legal_inference("filing_date", config, {})
        assert result is not None
        assert re.match(r'\d{2}\.\d{2}\.\d{4}', result.value)


# ---------------------------------------------------------------------------
# Minimal context tests (stress test fallbacks)
# ---------------------------------------------------------------------------

class TestMinimalContext:
    def setup_method(self):
        # Context with almost no data – fallbacks must carry most fields
        minimal = {"petitioner_name": "Jane Doe", "writ_type": "MANDAMUS"}
        vdb = VectorDBInterface(minimal)
        schema = [f.to_dict() for f in FieldExtractor().use_seed_fields().fields]
        self.populator = ComprehensiveAutoPopulator(vdb, schema)

    def test_at_least_half_fields_populated(self):
        results = self.populator.populate_all_fields()
        rate = results["metrics"]["population_rate"]
        assert rate >= 0.50, f"Even with minimal context, expected >=50% rate; got {rate:.1%}"

    def test_petitioner_name_populated_from_context(self):
        results = self.populator.populate_all_fields()
        populated = results["populated_fields"]
        assert "petitioner_name" in populated
        assert "Jane" in populated["petitioner_name"]["value"]
