"""Unit tests for represented-side detection (FAILURE 3, run 29abe5c0)."""

from __future__ import annotations

import unittest

from services.perspective_service import detect_represented_side

# A Tondare-style writ petition: filed BY the petitioner under Article 226.
_TONDARE = (
    "IN THE HIGH COURT OF JUDICATURE AT BOMBAY. WRIT PETITION NO 11104 OF 2024 "
    "under Article 226 of the Constitution of India. "
    "M/s K.S. Tondare Tours ... PETITIONER versus The State of Maharashtra ... RESPONDENTS. "
    "The petitioner herein has approached this Court aggrieved by rejection of its bid. "
    "The present writ petition is filed by the petitioner praying the impugned order be quashed."
)

# A respondent-side document: counter-affidavit defending the impugned action.
_COUNTER = (
    "Counter affidavit on behalf of the respondent. The answering respondent submits that "
    "this writ petition under Article 226 is misconceived and the petitioner has approached "
    "this court with unclean hands."
)


class TestPerspectiveDetection(unittest.TestCase):
    def setUp(self):
        # Pin autocorrect ON so these logic tests are deterministic regardless of the
        # deployment .env (CITATION_V2_ENABLE_PERSPECTIVE_AUTOCORRECT may be set false).
        # frozen dataclass → object.__setattr__ (same pattern as test_autocorrect_can_be_disabled).
        from core import config
        self._ac_original = config.settings.enable_perspective_autocorrect
        object.__setattr__(config.settings, "enable_perspective_autocorrect", True)

    def tearDown(self):
        from core import config
        object.__setattr__(config.settings, "enable_perspective_autocorrect", self._ac_original)

    def test_thin_document_keeps_user_perspective(self):
        # The test_pipeline_v2 contract: a thin doc must not flip the user's choice.
        self.assertEqual(detect_represented_side("respondent", "case facts", "q", "r1"), "respondent")

    def test_wrong_respondent_corrected_to_petitioner_on_petitioner_writ(self):
        # CHECK 4: Tondare's client is the petitioner; a wrong "respondent" is corrected.
        self.assertEqual(detect_represented_side("respondent", _TONDARE, "Tondare", "r2"), "petitioner")

    def test_bare_writ_without_cue_phrases_is_decisive_petitioner(self):
        # R8 (the Hitesh land-forfeiture case): a writ petition that lacks the exact
        # petitioner cue phrases but is clearly an Article 226 petition (and has ZERO
        # counter-affidavit framing) must still correct a wrong "respondent". Before the
        # fix this returned "respondent" (confidence capped at 0.4, below the override).
        doc = (
            "IN THE HON'BLE HIGH COURT OF JUDICATURE OF BOMBAY. WRIT PETITION NO. OF 2024. "
            "Hitesh Lahoti ... PETITIONER versus The State of Maharashtra ... RESPONDENTS. "
            "Memo of Writ Petition under Article 226 of the Constitution of India."
        )
        self.assertEqual(detect_represented_side("respondent", doc, "Hitesh", "r8"), "petitioner")

    def test_genuine_respondent_document_is_not_flipped(self):
        # A real respondent-side counter-affidavit must stay respondent (no catastrophic flip).
        self.assertEqual(detect_represented_side("respondent", _COUNTER, "x", "r3"), "respondent")

    def test_explicit_petitioner_unchanged(self):
        self.assertEqual(detect_represented_side("petitioner", _TONDARE, "x", "r4"), "petitioner")

    def test_neutral_stays_neutral(self):
        self.assertEqual(detect_represented_side("neutral", _TONDARE, "x", "r5"), "neutral")

    def test_state_perspective_not_flipped(self):
        # Only the literal "respondent" perspective is eligible for correction.
        self.assertEqual(detect_represented_side("state", _TONDARE, "x", "r6"), "state")

    def test_autocorrect_can_be_disabled(self):
        from core import config
        original = config.settings.enable_perspective_autocorrect
        object.__setattr__(config.settings, "enable_perspective_autocorrect", False)
        try:
            self.assertEqual(detect_represented_side("respondent", _TONDARE, "x", "r7"), "respondent")
        finally:
            object.__setattr__(config.settings, "enable_perspective_autocorrect", original)


if __name__ == "__main__":
    unittest.main()
