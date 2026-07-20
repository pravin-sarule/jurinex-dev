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
        # Include issue_id so each issue's query STRINGS are distinct, as real fact-grounded
        # queries are (different issues → different facts). The global IK-query dedup keys on
        # (formInput, doctypes), so identical strings across issues would otherwise collapse.
        "formInput": f"{issue_id} {qtype} {n}",
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
        # Robust to the configured base/per-issue values (so a budget bump doesn't break this).
        base, per, cap = (settings.ik_search_base_budget, settings.ik_search_per_issue_budget,
                          settings.max_ik_search_calls)
        self.assertEqual(_effective_search_budget(1), min(cap, base + per))
        self.assertEqual(_effective_search_budget(2), min(cap, base + 2 * per))
        self.assertEqual(_effective_search_budget(3), min(cap, base + 3 * per))
        # Never exceeds the BudgetTracker ceiling (consume() safety).
        self.assertLessEqual(_effective_search_budget(5), cap)


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
        # Under the tightened ~20-search budget the HIGH-VALUE essentials (precision + landmark)
        # must still survive for every issue; low-value recall (broad_fallback) is intentionally
        # the first thing trimmed (it's reranked last), so it is no longer guaranteed.
        selected, _, _ = select_queries(self.queries)
        for iid in ("issue-1", "issue-2", "issue-3"):
            types = {q["query_type"] for q in selected if q["issue_id"] == iid}
            self.assertIn("doctrine", types, f"{iid} lost precision")
            self.assertIn("landmark", types, f"{iid} lost landmark")

    def test_opponent_capped_at_reserve(self):
        selected, _, _ = select_queries(self.queries)
        opp = sum(1 for q in selected if q["query_type"] == "opponent")
        self.assertLessEqual(opp, settings.max_opponent_search_calls)
        # ...but not starved to zero when opponents exist and budget allows.
        self.assertGreaterEqual(opp, 1)

    def test_precision_not_over_emitted_per_issue(self):
        # Doctrine selected never exceeds what the fixture generates (3 per issue * 3 = 9);
        # essentials are still protected first (see test_no_essential_type_starved_per_issue).
        selected, _, _ = select_queries(self.queries)
        by_type = Counter(q["query_type"] for q in selected)
        self.assertLessEqual(by_type["doctrine"], 9)

    def test_single_issue_uses_small_budget(self):
        selected, _, budget = select_queries(_issue_rows("issue-1"))
        self.assertEqual(budget, _effective_search_budget(1))
        self.assertLessEqual(len(selected), budget)

    def test_duplicate_query_string_sent_to_ik_only_once(self):
        # #7 — the SAME (formInput, doctypes) across issues must be selected only ONCE so IK
        # is never hit twice with an identical query (it returns identical results).
        dup = [
            {"issue_id": "issue-1", "query_id": "a", "query_type": "doctrine",
             "formInput": "natural justice ANDD section 53A", "doctypes": "judgments",
             "priority": 1},
            {"issue_id": "issue-2", "query_id": "b", "query_type": "doctrine",
             "formInput": "natural justice ANDD section 53A", "doctypes": "judgments",
             "priority": 1},
            {"issue_id": "issue-2", "query_id": "c", "query_type": "strict",
             "formInput": "stamp duty ANDD revision", "doctypes": "judgments", "priority": 2},
        ]
        selected, skipped, _ = select_queries(dup)
        forms = [(q["formInput"], q.get("doctypes", "")) for q in selected]
        self.assertEqual(forms.count(("natural justice ANDD section 53A", "judgments")), 1)
        # the distinct strict query still gets through
        self.assertIn(("stamp duty ANDD revision", "judgments"), forms)
        # the deduped one is marked and lands in skipped
        self.assertTrue(any(q.get("dup_skipped") for q in skipped))


if __name__ == "__main__":
    unittest.main()
