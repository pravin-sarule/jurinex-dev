"""Unit tests for the richer query builder (PART 3)."""

from __future__ import annotations

import unittest

from core.config import settings
from models.issue_models import IssueCard
from services.query_service import SUPREME_COURT_DOCTYPE, generate_ik_queries


def _tender_issue() -> IssueCard:
    return IssueCard(
        issue_id="issue-1",
        legal_issue="Whether rejection of the petitioner's bid was arbitrary",
        represented_side="petitioner",
        favorable_position_for_selected_side="x",
        likely_opposite_position="y",
        statutes=["Article 14", "Article 226"],
        must_have_terms=["tender", "eligibility"],
        phrase_terms=["arbitrary state action", "substantial compliance"],
        optional_synonyms=["bid rejection"],
        doctrines=["promissory estoppel", "legitimate expectation", "level playing field"],
        preferred_courts=["Patna High Court", "Supreme Court"],
        opponent_phrase_terms=["judicial review of tender"],
        is_main_issue=True,
    )


class TestRicherQueryBuilder(unittest.TestCase):
    def setUp(self):
        self.qs = generate_ik_queries([_tender_issue()])
        self.forms = [q["formInput"] for q in self.qs]
        self.doctypes = {q["doctypes"] for q in self.qs}
        self.types = {q["query_type"] for q in self.qs}

    def test_core_doctrines_are_searched(self):
        # FAILURE 2/3 fix: the doctrines must actually appear as queries.
        self.assertTrue(any("promissory estoppel" in f for f in self.forms))
        self.assertTrue(any("legitimate expectation" in f for f in self.forms))

    def test_supreme_court_targeting_is_additive(self):
        self.assertIn(SUPREME_COURT_DOCTYPE, self.doctypes)
        # Local High Court is kept too (additive, not a replacement).
        self.assertIn("patna", self.doctypes)

    def test_opponent_query_present(self):
        self.assertIn("opponent", self.types)

    def test_flat_operators_no_parentheses(self):
        # IK has no grouping — queries must never contain parentheses.
        for f in self.forms:
            self.assertNotIn("(", f)
            self.assertNotIn(")", f)

    def test_per_issue_cap_respected(self):
        initial = [q for q in self.qs if not q.get("is_fallback")]
        self.assertLessEqual(len(initial), settings.max_queries_per_issue)

    def test_doctrine_queries_have_highest_priority(self):
        # FAILURE 1: doctrine=1 must outrank strict=2, opponent=5, fallback=6.
        prio = {q["query_type"]: q["priority"] for q in self.qs}
        self.assertEqual(prio["doctrine"], 1)
        self.assertEqual(prio["strict"], 2)
        self.assertLess(prio["doctrine"], prio.get("opponent", 5))
        self.assertLess(prio["doctrine"], prio.get("broad_fallback", 6))
        # Doctrine queries are emitted before opponent/fallback ones.
        first_doctrine = next(i for i, q in enumerate(self.qs) if q["query_type"] == "doctrine")
        first_opponent = next(i for i, q in enumerate(self.qs) if q["query_type"] == "opponent")
        self.assertLess(first_doctrine, first_opponent)


if __name__ == "__main__":
    unittest.main()
