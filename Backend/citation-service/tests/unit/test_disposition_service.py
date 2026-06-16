"""Unit tests for outcome-aware adverse detection (services/disposition_service)."""

from __future__ import annotations

import unittest

from core.enums import Classification, Disposition
from models.citation_models import Candidate
from services import disposition_service as d

_FILLER = "The petitioner challenges the impugned order of the State Government. " * 60


def _judgment(operative: str) -> str:
    return _FILLER + "\n\n" + operative


class TestRegexDisposition(unittest.TestCase):
    def test_dismissal_is_detected(self):
        r = d.detect_disposition_regex(_judgment(
            "In the result, we find no merit in the writ petition. "
            "The prayer to quash the impugned order is rejected and the State is entitled to proceed. "
            "The writ petition is accordingly dismissed."
        ))
        self.assertEqual(r.disposition, Disposition.DISMISSED.value)
        self.assertGreaterEqual(r.confidence, 0.7)

    def test_allowed_is_detected(self):
        r = d.detect_disposition_regex(_judgment(
            "In the result, the writ petition is allowed. The impugned order is quashed and set aside."
        ))
        self.assertEqual(r.disposition, Disposition.ALLOWED.value)
        self.assertGreaterEqual(r.confidence, 0.7)

    def test_partly_allowed(self):
        r = d.detect_disposition_regex(_judgment(
            "In the result, the petition is partly allowed. The penalty is set aside; the rest is upheld."
        ))
        self.assertEqual(r.disposition, Disposition.PARTLY_ALLOWED.value)

    def test_remand(self):
        r = d.detect_disposition_regex(_judgment(
            "In view of the above, the matter is remanded for fresh consideration in accordance with law."
        ))
        self.assertEqual(r.disposition, Disposition.REMANDED.value)

    def test_quoted_precedent_does_not_flip_the_outcome(self):
        # A judgment that repeatedly QUOTES a precedent which was "allowed" but is itself
        # dismissed must be DISMISSED (operative-span scoping).
        text = ("In Tata Cellular the writ petition was allowed and the impugned order quashed. " * 25
                + "\n\nIn the result, for the reasons recorded above, this writ petition is dismissed "
                  "as being devoid of merit.")
        r = d.detect_disposition_regex(text)
        self.assertEqual(r.disposition, Disposition.DISMISSED.value)

    def test_too_short_is_unknown(self):
        r = d.detect_disposition_regex("Order reserved.")
        self.assertEqual(r.disposition, Disposition.UNKNOWN.value)
        self.assertEqual(r.confidence, 0.0)


class TestRoleMapping(unittest.TestCase):
    def test_petitioner_mapping(self):
        m = d.map_disposition_to_classification
        self.assertEqual(m(Disposition.ALLOWED.value, "petitioner"), Classification.SUPPORTING)
        self.assertEqual(m(Disposition.DISMISSED.value, "petitioner"), Classification.ADVERSE)
        self.assertEqual(m(Disposition.PARTLY_ALLOWED.value, "petitioner"), Classification.DISTINGUISHABLE)
        self.assertEqual(m(Disposition.REMANDED.value, "petitioner"), Classification.WEAK_CONTEXTUAL)

    def test_respondent_mapping_is_inverted(self):
        m = d.map_disposition_to_classification
        self.assertEqual(m(Disposition.ALLOWED.value, "respondent"), Classification.ADVERSE)
        self.assertEqual(m(Disposition.DISMISSED.value, "state"), Classification.SUPPORTING)

    def test_neutral_and_unknown_never_override(self):
        m = d.map_disposition_to_classification
        self.assertIsNone(m(Disposition.DISMISSED.value, "neutral"))
        self.assertIsNone(m(Disposition.UNKNOWN.value, "petitioner"))

    def test_role_buckets(self):
        self.assertEqual(d.client_role("appellant"), "PETITIONER")
        self.assertEqual(d.client_role("state"), "RESPONDENT")
        self.assertEqual(d.client_role("accused"), "NEUTRAL")


class TestOverrideAndVeto(unittest.TestCase):
    def test_punjab_homeopathic_flips_supporting_to_adverse(self):
        # The headline acceptance: a dismissed petition wrongly pre-labelled SUPPORTING
        # must flip to ADVERSE for a petitioner once the disposition is known.
        c = Candidate(doc_id="1", title="Punjab Homeopathic", classification=Classification.SUPPORTING,
                      disposition=Disposition.DISMISSED.value, outcome_confidence=0.9)
        flipped, new_label = d.apply_override(c, "petitioner")
        self.assertTrue(flipped)
        self.assertEqual(new_label, Classification.ADVERSE)
        self.assertEqual(c.classification, Classification.ADVERSE)
        self.assertTrue(c.outcome_overridden)
        self.assertFalse(c.supports_selected_side)
        self.assertTrue(c.adverse_to_selected_side)

    def test_low_confidence_does_not_override(self):
        c = Candidate(doc_id="1", classification=Classification.SUPPORTING,
                      disposition=Disposition.DISMISSED.value, outcome_confidence=0.5)
        flipped, _ = d.apply_override(c, "petitioner")
        self.assertFalse(flipped)
        self.assertEqual(c.classification, Classification.SUPPORTING)

    def test_veto_corrects_judge_after_the_fact(self):
        # Judge (wrongly) marked it SUPPORTING; a confident DISMISSED disposition vetoes it.
        c = Candidate(doc_id="1", classification=Classification.SUPPORTING,
                      disposition=Disposition.DISMISSED.value, outcome_confidence=0.9)
        corrected = d.apply_disposition_veto([c], "petitioner")
        self.assertEqual(corrected, 1)
        self.assertEqual(c.classification, Classification.ADVERSE)


if __name__ == "__main__":
    unittest.main()
