from __future__ import annotations

import unittest
from unittest.mock import patch

from core.budgets import BudgetTracker
from core.config import settings
from core.enums import Classification
from models.citation_models import Candidate
from pipeline.pipeline_context import PipelineContext
from pipeline.stages import cheap_filter, classify_results, fetch_full_documents, normalize_perspective, shortlist_candidates
from services.issue_service import build_case_profile, build_issue_cards
from services.query_service import generate_ik_queries
from services.report_service import build_report


QUERY = "whether bail should be granted; whether arrest was lawful; whether evidence is sufficient"


def candidate(doc_id: str, issue_id: str = "issue-1", classification: Classification = Classification.SUPPORTING) -> Candidate:
    item = Candidate(
        doc_id=doc_id,
        title="bail arrest evidence relief granted",
        headline="bail relief granted after unlawful arrest",
        docsource="Supreme Court",
        matched_issue_id=issue_id,
        matched_query="bail ANDD arrest",
        fragment="bail arrest evidence relief granted",
        full_text="retrieved judgment text " * 40,
        relevance_score=0.9,
        authority_score=1.0,
        confidence=0.8,
        classification=classification,
    )
    item.supports_selected_side = classification == Classification.SUPPORTING
    item.adverse_to_selected_side = classification == Classification.ADVERSE
    return item


class TestPerspectiveAndQueries(unittest.TestCase):
    def test_supported_perspectives_are_not_replaced_with_neutral(self):
        for side in ("petitioner", "respondent", "appellant", "accused"):
            self.assertEqual(normalize_perspective.run(side), side)

    def test_petitioner_and_respondent_propagate_into_all_issue_cards(self):
        for side in ("petitioner", "respondent"):
            profile = build_case_profile(QUERY, "facts", side)
            issues = build_issue_cards(QUERY, profile, side)
            self.assertGreaterEqual(len(issues), 3)
            self.assertTrue(all(issue.represented_side == side for issue in issues))
            self.assertTrue(all(side in issue.favorable_position_for_selected_side for issue in issues))

    def test_query_limits_and_multi_issue_mapping(self):
        profile = build_case_profile(QUERY, "facts", "petitioner")
        issues = build_issue_cards(QUERY, profile, "petitioner")
        queries = generate_ik_queries(issues)
        self.assertGreaterEqual(len(queries), 6)
        # Generation is bounded per issue (the round-robin allocator caps EXECUTION).
        self.assertLessEqual(len(queries), (settings.max_queries_per_issue + 1) * len(issues))
        self.assertEqual({issue.issue_id for issue in issues}, {row["issue_id"] for row in queries})
        self.assertTrue(all(row["query_string"] for row in queries))
        initial = [row for row in queries if not row.get("is_fallback")]
        fallbacks = [row for row in queries if row.get("is_fallback")]
        self.assertTrue(initial)
        # Initial full-text queries combine terms with ANDD; landmark title queries are a
        # single bare name (case_name_search); broad fallbacks are single ORR strings.
        self.assertTrue(all(" ANDD " in row["query_string"] for row in initial if not row.get("case_name_search")))
        self.assertTrue(all(" ANDD " not in row["query_string"] for row in fallbacks))


class TestFilteringClassificationAndBudgets(unittest.TestCase):
    def test_cheap_filter_never_fails_open(self):
        profile = build_case_profile(QUERY, "facts", "petitioner")
        issues = build_issue_cards(QUERY, profile, "petitioner")
        context = PipelineContext("run", QUERY, "user", None, "petitioner", "facts", case_profile=profile, issues=issues)
        context.candidates = [Candidate(doc_id="unrelated", title="tax valuation customs", headline="unrelated", matched_issue_id=issues[0].issue_id, matched_query="bail")]
        self.assertEqual(cheap_filter.run(context), [])
        self.assertEqual(len(context.rejected), 1)

    def test_no_fallback_and_empty_recommendations(self):
        report = build_report("run", "petitioner", {}, [], [], [], [], [], {}, {})
        self.assertEqual(report["recommended_citations"], [])
        self.assertEqual(report["citations"], [])
        # With zero candidates retrieved, the report says so (substring keeps this robust
        # to minor wording changes).
        self.assertIn("No candidate judgments were retrieved", report["message"])

    def test_adverse_citations_are_separated(self):
        # Isolate the classification-separation behaviour: disable rerank (needs
        # context.issues) and the opposition bundle (would make a Gemini call) so this
        # unit test stays offline and focused on which bucket each candidate lands in.
        from core.config import settings as _settings
        saved = (_settings.enable_rerank, _settings.enable_opposition_bundle)
        object.__setattr__(_settings, "enable_rerank", False)
        object.__setattr__(_settings, "enable_opposition_bundle", False)
        try:
            ctx = type("Context", (), {"run_id": "run", "shortlisted": [
                candidate("s"),
                candidate("a", classification=Classification.ADVERSE),
                candidate("c", classification=Classification.DISTINGUISHABLE),
            ]})()
            supporting, adverse, caution = classify_results.run(ctx)
        finally:
            object.__setattr__(_settings, "enable_rerank", saved[0])
            object.__setattr__(_settings, "enable_opposition_bundle", saved[1])
        self.assertEqual([row.doc_id for row in supporting], ["s"])
        self.assertEqual([row.doc_id for row in adverse], ["a"])
        self.assertEqual([row.doc_id for row in caution], ["c"])

    def test_full_document_and_cost_budgets_are_hard_limits(self):
        context = PipelineContext("run", QUERY, "user", None, "petitioner", "facts")
        context.candidates = [candidate(str(index)) for index in range(15)]
        shortlist_candidates.run(context)
        self.assertLessEqual(len(context.shortlisted), 7)

        class Client:
            def __init__(self):
                self.calls = 0
            def fetch_full_document(self, item):
                self.calls += 1
                return item

        client = Client()
        fetch_full_documents.run(context, client)
        self.assertLessEqual(client.calls, 7)
        budget = BudgetTracker()
        for _ in range(budget.config.max_ik_search_calls):
            budget.consume("ik_search")
        self.assertEqual(budget.counts["ik_search"], budget.config.max_ik_search_calls)
        with self.assertRaises(Exception):
            budget.consume("ik_search")


class TestActivePipeline(unittest.TestCase):
    def test_single_run_id_perspective_multi_issue_and_limits(self):
        from pipeline.orchestrator import run_v2_pipeline
        counters = {"search": 0, "full": 0}

        def fake_search(_self, query, _doctypes, issue_id):
            counters["search"] += 1
            return [candidate(f"{issue_id}-{counters['search']}", issue_id)]
        def fake_fragment(_self, item):
            return item
        def fake_meta(_self, item):
            item.metadata["meta_data"] = {"title": item.title}
            return item
        def fake_full(_self, item):
            counters["full"] += 1
            return item

        with patch("pipeline.orchestrator.ensure_run") as ensure, \
             patch("pipeline.orchestrator.save_report"), \
             patch("pipeline.orchestrator.complete_run") as complete, \
             patch("pipeline.orchestrator.summarize_cost", return_value={"runCostInr": 0}), \
             patch("integrations.indian_kanoon.client.IndianKanoonClient.search", fake_search), \
             patch("integrations.indian_kanoon.client.IndianKanoonClient.fetch_fragment", fake_fragment), \
             patch("integrations.indian_kanoon.client.IndianKanoonClient.fetch_meta", fake_meta), \
             patch("integrations.indian_kanoon.client.IndianKanoonClient.fetch_full_document", fake_full), \
             patch("pipeline.stages.final_ai_judge.evaluate_batch", side_effect=lambda rows, *args: rows):
            result = run_v2_pipeline(
                QUERY, "user", case_file_context=[{"content": "case facts"}], case_id="case-173",
                perspective="respondent", run_id="same-run",
            )

        self.assertEqual(result["run_id"], "same-run")
        self.assertEqual(result["report_format"]["run_id"], "same-run")
        self.assertEqual(result["report_format"]["perspective"], "respondent")
        self.assertEqual(result["report_format"]["pipeline_diagnostics"]["case_name"], QUERY)
        self.assertEqual(result["report_format"]["pipeline_diagnostics"]["case_context_chars"], len("case facts"))
        self.assertGreaterEqual(len(result["report_format"]["issue_cards"]), 3)
        self.assertLessEqual(counters["search"], 10)
        self.assertLessEqual(counters["full"], 7)
        ensure.assert_called_once()
        complete.assert_called_once()


class TestDetailedCostRecord(unittest.TestCase):
    def test_paid_call_metadata_contains_run_provider_endpoint_and_success(self):
        import sys
        from types import SimpleNamespace
        from unittest.mock import Mock
        from services.cost_service import record_ik_call

        record = Mock()
        with patch.dict(sys.modules, {"utils.usage_tracker": SimpleNamespace(record=record)}):
            record_ik_call("run-cost", "user", "search", endpoint="/search/", issue_id="issue-2", success=True)
        metadata = record.call_args.kwargs["metadata"]
        self.assertEqual(metadata["run_id"], "run-cost")
        self.assertEqual(metadata["provider"], "indian_kanoon")
        self.assertEqual(metadata["endpoint"], "/search/")
        self.assertEqual(metadata["issue_id"], "issue-2")
        self.assertTrue(metadata["success"])
        self.assertGreater(metadata["estimated_cost"], 0)


if __name__ == "__main__":
    unittest.main()
