"""Doctrine-label translation + multi-term query tests (FAILURES 1 & 2, run 29abe5c0)."""

from __future__ import annotations

import unittest

from models.issue_models import IssueCard
from services.query_service import (
    DOCTRINE_TO_PHRASES, clean_doctrine_name, generate_ik_queries, is_doctrine_label,
)


class TestDoctrineLabelDetection(unittest.TestCase):
    def test_labels_with_parens_or_slashes_are_detected(self):
        self.assertTrue(is_doctrine_label("Article 14 arbitrariness (Tata Cellular line)"))
        self.assertTrue(is_doctrine_label("Scope of judicial review of tender decisions (Wednesbury unreasonableness)"))
        self.assertTrue(is_doctrine_label("legitimate expectation (oral/written assurance acted upon)"))
        self.assertTrue(is_doctrine_label("essential vs ancillary conditions / substantial compliance"))
        self.assertTrue(is_doctrine_label("authority cannot take advantage of its own wrong"))  # > 5 words

    def test_real_phrases_are_not_labels(self):
        for phrase in ("substantial compliance", "legitimate expectation", "promissory estoppel",
                       "level playing field", "arbitrary and capricious"):
            self.assertFalse(is_doctrine_label(phrase), phrase)

    def test_clean_doctrine_name_strips_descriptions(self):
        self.assertEqual(clean_doctrine_name("Article 14 arbitrariness (Tata Cellular line)"),
                         "article 14 arbitrariness")
        self.assertEqual(clean_doctrine_name("essential vs ancillary conditions / substantial compliance"),
                         "essential vs ancillary conditions")


def _issue(**kw) -> IssueCard:
    base = dict(
        issue_id="issue-1",
        legal_issue="rejection of the bid for want of an experience certificate was arbitrary",
        represented_side="petitioner",
        favorable_position_for_selected_side="x", likely_opposite_position="y",
        statutes=["Article 14 of the Constitution of India"],
        must_have_terms=["tender", "experience certificate", "disqualification"],
        phrase_terms=["Article 14 arbitrariness (Tata Cellular line)",
                      "legitimate expectation (oral/written assurance acted upon)"],
        doctrines=["Article 14 arbitrariness (Tata Cellular line)",
                   "essential vs ancillary conditions / substantial compliance",
                   "authority cannot take advantage of its own wrong"],
        preferred_courts=["Bombay High Court", "Supreme Court"],
        opponent_phrase_terms=["strict compliance mandatory"],
        landmark_cases=["Tata Cellular", "Motilal Padampat"],
        is_main_issue=True,
    )
    base.update(kw)
    return IssueCard(**base)


class TestRealJudgmentQueries(unittest.TestCase):
    def setUp(self):
        self.qs = generate_ik_queries([_issue()])
        self.forms = [q["formInput"] for q in self.qs]

    def test_check1_no_doctrine_labels_reach_indian_kanoon(self):
        for f in self.forms:
            self.assertNotIn("(", f)
            self.assertNotIn(")", f)
            self.assertNotIn(" / ", f)
            self.assertNotIn("line)", f)
            self.assertNotIn("oral/written", f)

    def test_doctrine_labels_translated_to_actual_phrases(self):
        joined = " || ".join(self.forms)
        # The Article-14 label must have become a real judgment phrase.
        self.assertIn("arbitrary and capricious", joined)
        # The "advantage of its own wrong" label maps to a real phrase, not the label.
        self.assertTrue(any(p in joined for p in DOCTRINE_TO_PHRASES["authority cannot benefit from own wrong"]))

    def test_check2_at_least_three_multi_term_queries(self):
        # Multi-term = combines >= 2 terms with ANDD (>= 1 ANDD operator). Queries are now
        # 2-term precision (phrase + one short anchor) — ANDD-ing 3 rare phrases returned
        # ~0 hits, so the contract is "combines terms", not "3+ terms".
        multi = [f for f in self.forms if " ANDD " in f]
        self.assertGreaterEqual(len(multi), 3)

    def test_check3_landmark_queries_present(self):
        joined = " || ".join(self.forms)
        self.assertIn("Tata Cellular", joined)
        self.assertIn("Motilal Padampat", joined)

    def test_all_non_fallback_queries_combine_terms(self):
        # Non-fallback FULL-TEXT queries must combine >= 2 terms with ANDD. Landmark
        # case-name queries (case_name_search=True) are exempt: they are a single bare
        # name routed through IK's title:"..." path (R3), so they carry no ANDD.
        for q in self.qs:
            if q.get("is_fallback") or q.get("case_name_search"):
                continue
            self.assertIn(" ANDD ", q["formInput"])

    def test_landmark_queries_are_bare_title_searches(self):
        # R3 — landmark "A v. B" cause-titles are reduced to a distinctive party name
        # and flagged for the title: path; they must NOT be full-text "name ANDD domain".
        landmarks = [q for q in self.qs if q.get("query_type") == "landmark"]
        self.assertTrue(landmarks, "expected at least one landmark query")
        for q in landmarks:
            self.assertTrue(q.get("case_name_search"), f"landmark not title-routed: {q['formInput']}")
            self.assertNotIn(" ANDD ", q["formInput"])
            self.assertNotIn(" v. ", q["formInput"].lower())


if __name__ == "__main__":
    unittest.main()
