"""Unit tests for direction-aware principle detection (FAILURE 3)."""

from __future__ import annotations

import unittest

from core.enums import Classification
from models.citation_models import Candidate
from models.issue_models import IssueCard
from services import direction_service as ds
from services.scoring_service import score

_RANA = ("The petitioner, having unilaterally withdrawn from the tender process, "
         "is yet seeking to take advantage of its own wrong by claiming a refund of "
         "the earnest money deposit, which cannot be permitted.")
_AUTHORITY = ("The State authority cannot be permitted to take advantage of its own wrong "
              "in cancelling the allotment after having accepted the bid.")


class TestCheckDirection(unittest.TestCase):
    def test_reversed_principle_against_petitioner(self):
        d = ds.check_principle_direction(_RANA, "advantage of its own wrong")
        self.assertEqual(d, ds.WRONG_DIRECTION)

    def test_correct_principle_against_authority(self):
        d = ds.check_principle_direction(_AUTHORITY, "advantage of its own wrong")
        self.assertEqual(d, ds.CORRECT_DIRECTION)

    def test_non_directional_doctrine(self):
        d = ds.check_principle_direction("the principle of legitimate expectation applies",
                                         "legitimate expectation")
        self.assertEqual(d, ds.CORRECT_DIRECTION)

    def test_absent_principle_is_unclear(self):
        self.assertEqual(ds.check_principle_direction("a case about bail", "advantage of its own wrong"),
                         ds.UNCLEAR)

    def test_assess_fragment_returns_wrong_first(self):
        direction, principle, evidence = ds.assess_fragment_direction(_RANA)
        self.assertEqual(direction, ds.WRONG_DIRECTION)
        self.assertIn("own wrong", principle)
        self.assertTrue(evidence)


class TestScoringPenalty(unittest.TestCase):
    def _issue(self):
        return IssueCard(
            issue_id="issue-1",
            legal_issue="authority cannot take advantage of its own wrong in the tender",
            represented_side="petitioner",
            favorable_position_for_selected_side="x", likely_opposite_position="y",
            phrase_terms=["advantage of its own wrong"],
            doctrines=["advantage of its own wrong"],
        )

    def test_rana_is_penalised_and_not_supporting(self):
        # Rana Construction: principle applied against the bidder → must be penalised.
        c = Candidate(
            doc_id="rana", title="Rana Construction And Engineers vs FCI",
            headline="earnest money refund tender withdrawal",
            fragment=_RANA, docsource="Gauhati High Court",
        )
        score(c, self._issue(), "tender earnest money", "petitioner",
              "tender experience certificate dispute", run_id="testrun123456")
        self.assertEqual(c.direction_flag, "PRINCIPLE_REVERSED")
        self.assertLessEqual(c.favorability_score, 0.4)
        self.assertNotEqual(c.classification, Classification.SUPPORTING)

    def test_correctly_directed_case_not_penalised(self):
        c = Candidate(
            doc_id="ok", title="ABC vs State", headline="tender allotment",
            fragment=_AUTHORITY, docsource="Bombay High Court",
        )
        score(c, self._issue(), "tender allotment", "petitioner",
              "tender dispute", run_id="testrun123456")
        self.assertNotEqual(c.direction_flag, "PRINCIPLE_REVERSED")


if __name__ == "__main__":
    unittest.main()
