"""Tests for LegalInferenceEngine."""

import re
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from src.population.legal_inference_engine import LegalInferenceEngine, PopulationResult

SAMPLE_FACTS = """
The petitioner, Rajesh Kumar Singh, is a retired government servant.
The State of Maharashtra illegally withheld his pension.
The Union of India through the Ministry of Finance failed to act.
The Pension Commissioner, Maharashtra, passed an arbitrary order.
The Government of Maharashtra has not responded to representations.
"""


class TestWritToArticleMapping:
    def setup_method(self):
        self.engine = LegalInferenceEngine()

    def test_mandamus_maps_to_32(self):
        r = self.engine.infer_article_from_writ("MANDAMUS")
        assert r.value == "32"
        assert r.confidence == 1.0

    def test_certiorari_maps_to_32(self):
        r = self.engine.infer_article_from_writ("CERTIORARI")
        assert r.value == "32"

    def test_prohibition_maps_to_32(self):
        r = self.engine.infer_article_from_writ("PROHIBITION")
        assert r.value == "32"

    def test_quo_warranto_maps_to_32(self):
        r = self.engine.infer_article_from_writ("QUO WARRANTO")
        assert r.value == "32"

    def test_habeas_corpus_maps_to_32(self):
        r = self.engine.infer_article_from_writ("HABEAS CORPUS")
        assert r.value == "32"

    def test_lowercase_handled(self):
        r = self.engine.infer_article_from_writ("mandamus")
        assert r.value == "32"

    def test_mixed_case_handled(self):
        r = self.engine.infer_article_from_writ("Mandamus")
        assert r.value == "32"

    def test_unknown_writ_returns_default_with_low_confidence(self):
        r = self.engine.infer_article_from_writ("UNKNOWN_WRIT")
        assert r.value == "32"
        assert r.confidence < 1.0

    def test_result_is_confident(self):
        r = self.engine.infer_article_from_writ("MANDAMUS")
        assert r.is_confident(0.70)
        assert r.is_confident(0.99)


class TestCourtInference:
    def setup_method(self):
        self.engine = LegalInferenceEngine()

    def test_article_32_infers_supreme_court(self):
        r = self.engine.infer_court_from_article("32")
        assert "SUPREME COURT" in r.value
        assert r.confidence >= 0.90

    def test_article_226_infers_high_court(self):
        r = self.engine.infer_court_from_article("226")
        assert "HIGH COURT" in r.value

    def test_unknown_article_returns_default(self):
        r = self.engine.infer_court_from_article("999")
        assert r.value  # has some default
        assert r.confidence <= 0.60


class TestQuestionGeneration:
    def setup_method(self):
        self.engine = LegalInferenceEngine()

    def test_questions_generated_with_articles(self):
        r = self.engine.generate_questions_from_context(
            facts=SAMPLE_FACTS,
            relief="issue writ of mandamus",
            articles=["14", "21"],
        )
        assert r.value
        assert r.confidence >= 0.70
        assert "Article" in r.value

    def test_question_mentions_primary_article(self):
        r = self.engine.generate_questions_from_context(
            SAMPLE_FACTS, "", articles=["21"]
        )
        assert "21" in r.value

    def test_entitlement_question_present(self):
        r = self.engine.generate_questions_from_context(SAMPLE_FACTS, "", ["14"])
        assert "entitled" in r.value.lower() or "14" in r.value

    def test_default_articles_used_when_none_provided(self):
        r = self.engine.generate_questions_from_context(SAMPLE_FACTS, "")
        assert r.value
        assert r.confidence >= 0.70

    def test_lettered_format_used(self):
        r = self.engine.generate_questions_from_context(SAMPLE_FACTS, "", ["14"])
        assert "(a)" in r.value


class TestReliefGeneration:
    def setup_method(self):
        self.engine = LegalInferenceEngine()

    def test_mandamus_relief_generated(self):
        r = self.engine.generate_relief_from_writ("MANDAMUS")
        assert r.value
        assert "mandamus" in r.value.lower()
        assert r.confidence >= 0.70

    def test_certiorari_relief_generated(self):
        r = self.engine.generate_relief_from_writ("CERTIORARI")
        assert "certiorari" in r.value.lower()

    def test_habeas_corpus_relief_generated(self):
        r = self.engine.generate_relief_from_writ("HABEAS CORPUS")
        assert "habeas corpus" in r.value.lower()

    def test_standard_closing_prayer_appended(self):
        r = self.engine.generate_relief_from_writ("MANDAMUS")
        assert "other order" in r.value.lower() or "deem fit" in r.value.lower()

    def test_roman_numeral_format(self):
        r = self.engine.generate_relief_from_writ("MANDAMUS")
        assert "(i)" in r.value


class TestRespondentInference:
    def setup_method(self):
        self.engine = LegalInferenceEngine()

    def test_respondents_extracted_from_facts(self):
        r = self.engine.infer_respondents_from_facts(SAMPLE_FACTS)
        assert r.value
        assert "1." in r.value

    def test_state_name_extracted(self):
        r = self.engine.infer_respondents_from_facts(SAMPLE_FACTS)
        assert "Maharashtra" in r.value

    def test_union_of_india_extracted(self):
        r = self.engine.infer_respondents_from_facts(SAMPLE_FACTS)
        assert "Union of India" in r.value or "Ministry" in r.value

    def test_empty_facts_returns_empty(self):
        r = self.engine.infer_respondents_from_facts("")
        assert not r.value
        assert r.confidence == 0.0


class TestDateHelpers:
    def setup_method(self):
        self.engine = LegalInferenceEngine()

    def test_current_year_is_integer_string(self):
        r = self.engine.get_current_year()
        assert r.value.isdigit()
        assert int(r.value) >= 2024
        assert r.confidence == 1.0

    def test_current_date_correct_format(self):
        r = self.engine.get_current_date()
        assert re.match(r'\d{2}\.\d{2}\.\d{4}', r.value)
        assert r.confidence == 1.0

    def test_petition_number_generated(self):
        r = self.engine.generate_petition_number("2024")
        assert "2024" in r.value
        assert "WP" in r.value


class TestPopulationResult:
    def test_is_confident_true(self):
        r = PopulationResult(value="test", source="x", confidence=0.85)
        assert r.is_confident(0.70)
        assert r.is_confident(0.85)

    def test_is_confident_false(self):
        r = PopulationResult(value="test", source="x", confidence=0.60)
        assert not r.is_confident(0.70)

    def test_default_metadata_is_dict(self):
        r = PopulationResult(value="v", source="s", confidence=0.9)
        assert isinstance(r.metadata, dict)
