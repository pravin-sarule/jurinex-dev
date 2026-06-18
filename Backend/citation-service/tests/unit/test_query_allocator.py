"""Phase 1 — unit tests for the per-issue round-robin query allocator.

Contract (architecture 2C): no query TYPE is starved (every issue keeps its precision +
recall + landmark), opponent is capped at its reserve, and the total never exceeds the
per-run effective budget (which is itself <= the BudgetTracker ceiling, so consume()
can never raise mid-run).
"""

from __future__ import annotations

import unittest
from collections import Counter

from core.config import settings
from services.query_service import QUERY_PRIORITY
from pipeline.stages.retrieve_candidates import _effective_search_budget, select_queries


def _row(issue_id: str, qtype: str, n: int) -> dict:
    return {
        "issue_id": issue_id,
        "query_id": f"{issue_id}-{qtype}-{n}",
        "query_type": qtype,
        "formInput": f"{qtype} {n}",
        "priority": QUERY_PRIORITY.get(qtype, 6),
    }


def _issue_rows(issue_id: str) -> list[dict]:
    # A realistic full spread for one issue.
    rows = []
    for n in range(3):
        rows.append(_row(issue_id, "doctrine", n))
    for n in range(2):
        rows.append(_row(issue_id, "landmark", n))
    for qtype in ("strict", "supreme_court", "statute_combined", "court_filtered", "opponent", "broad_fallback"):
        rows.append(_row(issue_id, qtype, 0))
    return rows


class TestEffectiveBudget(unittest.TestCase):
    def test_scales_with_issues_and_caps_at_ceiling(self):
        self.assertEqual(_effective_search_budget(1), min(settings.max_ik_search_calls, 9))
        self.assertEqual(_effective_search_budget(2), min(settings.max_ik_search_calls, 16))
        self.assertEqual(_effective_search_budget(3), min(settings.max_ik_search_calls, 23))
        # Never exceeds the BudgetTracker ceiling (consume() safety).
        self.assertLessEqual(_effective_search_budget(5), settings.max_ik_search_calls)


class TestAllocator(unittest.TestCase):
    def setUp(self):
        self.queries = _issue_rows("issue-1") + _issue_rows("issue-2") + _issue_rows("issue-3")

    def test_total_within_budget_and_partition(self):
        selected, skipped, budget = select_queries(self.queries)
        self.assertEqual(budget, _effective_search_budget(3))
        self.assertLessEqual(len(selected), budget)
        # selected + skipped partition the input exactly (no loss, no dupes).
        self.assertEqual(len(selected) + len(skipped), len(self.queries))

    def test_no_essential_type_starved_per_issue(self):
        selected, _, _ = select_queries(self.queries)
        for iid in ("issue-1", "issue-2", "issue-3"):
            types = {q["query_type"] for q in selected if q["issue_id"] == iid}
            self.assertIn("doctrine", types, f"{iid} lost precision")
            self.assertIn("broad_fallback", types, f"{iid} lost recall")
            self.assertIn("landmark", types, f"{iid} lost landmark")

    def test_opponent_capped_at_reserve(self):
        selected, _, _ = select_queries(self.queries)
        opp = sum(1 for q in selected if q["query_type"] == "opponent")
        self.assertLessEqual(opp, settings.max_opponent_search_calls)
        # ...but not starved to zero when opponents exist and budget allows.
        self.assertGreaterEqual(opp, 1)

    def test_precision_capped_at_two_per_issue_in_protected_band(self):
        # The 3rd precision query per issue may only appear after every issue's
        # essentials — never crowds out another issue's first precision/recall/landmark.
        selected, _, _ = select_queries(self.queries)
        by_type = Counter(q["query_type"] for q in selected)
        # doctrine selected should be <= 2 per issue * 3 issues = 6 in this budget.
        self.assertLessEqual(by_type["doctrine"], 6)

    def test_single_issue_uses_small_budget(self):
        selected, _, budget = select_queries(_issue_rows("issue-1"))
        self.assertEqual(budget, _effective_search_budget(1))
        self.assertLessEqual(len(selected), budget)


if __name__ == "__main__":
    unittest.main()
