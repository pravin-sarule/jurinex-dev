"""Tests for VectorDBInterface – exact, fuzzy, and semantic search."""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from src.population.vector_db_interface import VectorDBInterface

SAMPLE_CONTEXT = {
    "petitioner_name": "Rajesh Kumar Singh",
    "petitioner": "Rajesh Kumar Singh",
    "writ_type": "MANDAMUS",
    "constitutional_article": "32",
    "case_facts": (
        "The petitioner is a retired government servant whose pension was "
        "illegally withheld by the Pension Commissioner."
    ),
    "facts_of_case": (
        "The petitioner Rajesh Kumar Singh retired on 31.03.2021 from the "
        "Ministry of Finance."
    ),
    "filing_year": "2024",
    "respondents": "1. Union of India\n2. Pension Commissioner",
    "nested": {
        "advocate": "Adv. Priya Sharma",
        "court": "Supreme Court of India",
    },
}


class TestExactSearch:
    def setup_method(self):
        self.vdb = VectorDBInterface(SAMPLE_CONTEXT)

    def test_exact_key_returns_confidence_1(self):
        result = self.vdb.search("petitioner_name")
        assert result is not None
        value, confidence = result
        assert value == "Rajesh Kumar Singh"
        assert confidence == 1.0

    def test_exact_writ_type(self):
        result = self.vdb.search("writ_type")
        assert result is not None
        assert result[0] == "MANDAMUS"
        assert result[1] == 1.0

    def test_exact_article(self):
        result = self.vdb.search("constitutional_article")
        assert result is not None
        assert result[0] == "32"


class TestFuzzySearch:
    def setup_method(self):
        self.vdb = VectorDBInterface(SAMPLE_CONTEXT)

    def test_alias_key_high_confidence(self):
        result = self.vdb.search("petitioner")
        assert result is not None
        value, confidence = result
        assert "Rajesh" in value
        assert confidence >= 0.70

    def test_below_threshold_returns_none(self):
        result = self.vdb.search("completely_unrelated_xyz_abc_field", threshold=0.99)
        assert result is None

    def test_custom_threshold_respected(self):
        # Should find something at low threshold
        result = self.vdb.search("petitioner_name", threshold=0.5)
        assert result is not None

    def test_substring_match_confidence(self):
        # "petitioner" is a substring of "petitioner_name"
        score = VectorDBInterface._calculate_similarity("petitioner", "petitioner_name")
        assert score >= 0.80

    def test_exact_normalised_confidence(self):
        score = VectorDBInterface._calculate_similarity("petitioner_name", "petitioner_name")
        assert score >= 0.97


class TestSemanticSearch:
    def setup_method(self):
        self.vdb = VectorDBInterface(SAMPLE_CONTEXT)

    def test_returns_relevant_chunks(self):
        chunks = self.vdb.semantic_search(["petitioner", "pension", "retired"])
        assert len(chunks) > 0
        for chunk in chunks:
            assert "text" in chunk
            assert "relevance" in chunk
            assert "source_key" in chunk

    def test_top_k_respected(self):
        chunks = self.vdb.semantic_search(["petitioner"], top_k=2)
        assert len(chunks) <= 2

    def test_empty_query_returns_empty(self):
        chunks = self.vdb.semantic_search([])
        assert chunks == []

    def test_relevance_is_float(self):
        chunks = self.vdb.semantic_search(["petitioner"])
        for chunk in chunks:
            assert isinstance(chunk["relevance"], float)

    def test_results_sorted_by_relevance_desc(self):
        chunks = self.vdb.semantic_search(["retired", "pension", "government"])
        relevances = [c["relevance"] for c in chunks]
        assert relevances == sorted(relevances, reverse=True)


class TestHelpers:
    def setup_method(self):
        self.vdb = VectorDBInterface(SAMPLE_CONTEXT)

    def test_get_all_keys(self):
        keys = self.vdb.get_all_keys()
        assert "petitioner_name" in keys
        assert "writ_type" in keys
        assert "filing_year" in keys

    def test_get_value_direct(self):
        assert self.vdb.get_value("writ_type") == "MANDAMUS"
        assert self.vdb.get_value("filing_year") == "2024"

    def test_get_value_missing_returns_none(self):
        assert self.vdb.get_value("nonexistent_field_xyz") is None

    def test_nested_keys_indexed(self):
        # nested.advocate should be accessible
        result = self.vdb.search("nested.advocate", threshold=0.5)
        assert result is not None
        assert "Priya" in result[0]

    def test_tokenize_removes_stop_words(self):
        tokens = VectorDBInterface._tokenize("The petitioner is a citizen of India")
        assert "petitioner" in tokens
        assert "citizen" in tokens
        assert "the" not in tokens
        assert "is" not in tokens
        assert "of" not in tokens

    def test_tokenize_returns_list(self):
        tokens = VectorDBInterface._tokenize("petitioner_name")
        assert isinstance(tokens, list)
        assert len(tokens) > 0

    def test_normalise(self):
        assert VectorDBInterface._normalise("Petitioner Name") == "petitioner_name"
        assert VectorDBInterface._normalise("WRIT_TYPE") == "writ_type"
