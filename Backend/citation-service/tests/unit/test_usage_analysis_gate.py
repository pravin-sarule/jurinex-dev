"""Usage-analysis relevance gate + helpers (2026-06-17 feature)."""

from __future__ import annotations

import unittest
from unittest.mock import patch

from core.enums import Classification
from models.citation_models import Candidate
from pipeline.pipeline_context import PipelineContext
from pipeline.stages import generate_usage_analysis
from services.analysis_service import (
    ADVERSE, NOT_RELEVANT, PARTIALLY_RELEVANT, RELEVANT, category_for, generate_usage_analyses,
)


def _cand(doc_id, classification, relevance=""):
    c = Candidate(doc_id=doc_id, title=f"Case {doc_id}", classification=classification)
    c.relevance_verdict = relevance
    return c


class TestCategoryMapping(unittest.TestCase):
    def test_classification_to_bucket(self):
        self.assertEqual(category_for(_cand("1", Classification.SUPPORTING)), "recommended")
        self.assertEqual(category_for(_cand("2", Classification.ADVERSE)), "adverse")
        self.assertEqual(category_for(_cand("3", Classification.DISTINGUISHABLE)), "caution")
        self.assertEqual(category_for(_cand("4", Classification.WEAK_CONTEXTUAL)), "caution")


class TestRelevanceGate(unittest.TestCase):
    def _ctx(self):
        return PipelineContext("run", "q", "user", None, "petitioner", "facts about the matter")

    def test_gate_cleans_recommended_and_drops_not_relevant(self):
        ctx = self._ctx()
        c1 = _cand("1", Classification.SUPPORTING, RELEVANT)
        c2 = _cand("2", Classification.SUPPORTING, PARTIALLY_RELEVANT)
        c3 = _cand("3", Classification.SUPPORTING, NOT_RELEVANT)
        c4 = _cand("4", Classification.ADVERSE, RELEVANT)
        c5 = _cand("5", Classification.ADVERSE, NOT_RELEVANT)
        c6 = _cand("6", Classification.WEAK_CONTEXTUAL, RELEVANT)

        # No-op the Gemini call so the pre-set verdicts drive the gate deterministically.
        with patch.object(generate_usage_analysis, "generate_usage_analyses", return_value=0):
            supporting, adverse, caution = generate_usage_analysis.run(
                ctx, [c1, c2, c3], [c4, c5], [c6],
            )

        self.assertEqual([c.doc_id for c in supporting], ["1"])              # only RELEVANT stays
        self.assertEqual([c.doc_id for c in adverse], ["4"])                # NOT_RELEVANT dropped
        self.assertEqual(sorted(c.doc_id for c in caution), ["2", "6"])     # partial demoted in
        self.assertEqual(ctx.timings.get("_relevance_filtered"), 2)         # c3 + c5 dropped
        self.assertEqual(ctx.timings.get("_relevance_demoted"), 1)          # c2 demoted

    def _set_flag(self, name, value):
        # Settings is a frozen dataclass — bypass with object.__setattr__, restore after.
        s = generate_usage_analysis.settings
        original = getattr(s, name)
        object.__setattr__(s, name, value)
        self.addCleanup(object.__setattr__, s, name, original)

    def test_adverse_verdict_in_recommended_is_routed_to_adverse(self):
        # A case mis-sorted into Recommended but judged ADVERSE must move to the
        # Adverse bucket (surfaced as opponent authority), NOT be dropped.
        ctx = self._ctx()
        c = _cand("9", Classification.SUPPORTING, ADVERSE)
        with patch.object(generate_usage_analysis, "generate_usage_analyses", return_value=0):
            supporting, adverse, caution = generate_usage_analysis.run(ctx, [c], [], [])
        self.assertEqual([x.doc_id for x in supporting], [])
        self.assertEqual([x.doc_id for x in adverse], ["9"])
        self.assertEqual(c.classification, Classification.ADVERSE)
        self.assertTrue(c.adverse_to_selected_side)
        self.assertFalse(c.supports_selected_side)
        self.assertEqual(ctx.timings.get("_relevance_to_adverse"), 1)
        self.assertEqual(ctx.timings.get("_relevance_filtered"), 0)

    def test_gate_disabled_passes_through(self):
        ctx = self._ctx()
        c1 = _cand("1", Classification.SUPPORTING, NOT_RELEVANT)
        self._set_flag("enable_relevance_gate", False)
        with patch.object(generate_usage_analysis, "generate_usage_analyses", return_value=0):
            supporting, adverse, caution = generate_usage_analysis.run(ctx, [c1], [], [])
        self.assertEqual([c.doc_id for c in supporting], ["1"])  # untouched when gate off

    def test_feature_disabled_is_noop(self):
        ctx = self._ctx()
        c1 = _cand("1", Classification.SUPPORTING, NOT_RELEVANT)
        self._set_flag("enable_usage_analysis", False)
        supporting, _, _ = generate_usage_analysis.run(ctx, [c1], [], [])
        self.assertEqual([c.doc_id for c in supporting], ["1"])


class TestServiceGracefulSkip(unittest.TestCase):
    def test_no_client_returns_zero_without_touching_candidates(self):
        c = _cand("1", Classification.SUPPORTING, "")
        from core.budgets import BudgetTracker
        with patch("integrations.gemini.client.get_client", return_value=None):
            n = generate_usage_analyses([c], [], "petitioner", "facts", "run", "user", BudgetTracker())
        self.assertEqual(n, 0)
        self.assertEqual(c.usage_analysis, [])
        self.assertEqual(c.relevance_verdict, "")


if __name__ == "__main__":
    unittest.main()
