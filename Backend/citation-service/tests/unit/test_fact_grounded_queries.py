"""Phase 2 — fact-grounded query building + flat-recipe validation.

Verifies the core fix for the user's complaint: queries are grounded in the case's OWN
facts (not "doctrine ANDD quashed"), recall uses ORR, landmarks are title-routed, and
AI-authored recipes are validated for IK's flat-operator rules before use.
"""

from __future__ import annotations

import unittest

from models.issue_models import IssueCard
from services.query_service import _statute_token, _validate_recipe, generate_ik_queries


def _land_issue(**over) -> IssueCard:
    base = dict(
        issue_id="issue-1",
        legal_issue="Whether forfeiture of land for non-utilisation is valid",
        represented_side="petitioner",
        favorable_position_for_selected_side="authority for the petitioner",
        likely_opposite_position="authority for the respondent",
        statutes=["Section 63-1A of the Maharashtra Tenancy Act", "Article 226"],
        must_have_terms=["forfeiture", "tenancy", "nazarana"],
        phrase_terms=["non-utilisation of land", "change of user"],
        doctrines=["forfeiture of land for non-utilisation", "natural justice"],
        landmark_cases=["State of Maharashtra v. Laxmanrao"],
        fact_terms=["non-utilisation", "change of user", "forfeiture of land"],
        ai_query_recipes=[],
    )
    base.update(over)
    return IssueCard(**base)


class TestValidateRecipe(unittest.TestCase):
    def test_rejects_parentheses(self):
        self.assertEqual(_validate_recipe('("a" ORR "b") ANDD c'), "")

    def test_rejects_mixed_operators(self):
        self.assertEqual(_validate_recipe('"non-utilisation" ANDD forfeiture ORR resumption'), "")

    def test_keeps_valid_andd(self):
        out = _validate_recipe('"non-utilisation" ANDD "forfeiture of land"')
        self.assertIn(" ANDD ", out)
        self.assertNotIn("(", out)

    def test_keeps_valid_orr(self):
        out = _validate_recipe('non-utilisation ORR non-user ORR "land not utilised"')
        self.assertIn(" ORR ", out)
        self.assertNotIn(" ANDD ", out)

    def test_truncates_long_phrase_to_four_words(self):
        out = _validate_recipe('"one two three four five six" ANDD forfeiture')
        first = out.split(" ANDD ")[0].strip().strip('"')
        self.assertLessEqual(len(first.split()), 4)

    def test_empty_or_blank_returns_empty(self):
        self.assertEqual(_validate_recipe(""), "")
        self.assertEqual(_validate_recipe("   "), "")


class TestFactGroundedDeterministic(unittest.TestCase):
    def test_no_precision_query_collapses_to_doctrine_andd_quashed(self):
        qs = generate_ik_queries([_land_issue()])
        for q in qs:
            if q["query_type"] == "doctrine":
                self.assertNotIn(" andd quashed", q["formInput"].lower(),
                                 f"ungrounded query: {q['formInput']}")

    def test_precision_queries_contain_a_case_fact(self):
        qs = generate_ik_queries([_land_issue()])
        doctrine_forms = [q["formInput"].lower() for q in qs if q["query_type"] == "doctrine"]
        self.assertTrue(doctrine_forms)
        facts = ("non-utilisation", "change of user", "forfeiture")
        self.assertTrue(
            any(any(f in form for f in facts) for form in doctrine_forms),
            f"no case fact in precision queries: {doctrine_forms}",
        )

    def test_orr_recall_query_present(self):
        qs = generate_ik_queries([_land_issue()])
        recall = [q for q in qs if q.get("is_fallback")]
        self.assertTrue(recall, "expected a fact-grounded ORR recall query")
        self.assertIn(" ORR ", recall[0]["formInput"])

    def test_landmark_is_title_routed_to_distinctive_party(self):
        qs = generate_ik_queries([_land_issue()])
        lm = [q for q in qs if q["query_type"] == "landmark"]
        self.assertTrue(lm)
        self.assertTrue(all(q.get("case_name_search") for q in lm))
        self.assertTrue(any("laxmanrao" in q["formInput"].lower() for q in lm))
        self.assertTrue(all(" andd " not in q["formInput"].lower() for q in lm))


class TestLooseGroundedQueries(unittest.TestCase):
    """The retrieval-quality fix: queries must NOT ANDD two rare phrases (-> 0 hits),
    must include favourable-outcome queries (-> Recommended bucket), and statute tokens
    must be short."""

    def test_no_query_andds_three_or_more_terms(self):
        qs = generate_ik_queries([_land_issue()])
        for q in qs:
            self.assertLess(q["formInput"].count(" ANDD "), 2,
                            f"3+ term ANDD query returns ~0 hits: {q['formInput']}")

    def test_precision_queries_are_two_terms(self):
        qs = generate_ik_queries([_land_issue()])
        for q in qs:
            if q["query_type"] == "doctrine":
                self.assertEqual(q["formInput"].count(" ANDD "), 1, q["formInput"])

    def test_favourable_outcome_queries_present(self):
        qs = generate_ik_queries([_land_issue(outcome_terms=["set aside", "quashed"])])
        outcome = [q for q in qs if q["query_type"] == "outcome"]
        self.assertTrue(outcome, "expected favourable-outcome queries")
        joined = " || ".join(q["formInput"].lower() for q in outcome)
        self.assertTrue("set aside" in joined or "quashed" in joined)

    def test_statute_token_is_short(self):
        self.assertEqual(_statute_token("Section 63-1A of the Maharashtra Tenancy Act 1948"), "section 63-1A")
        self.assertEqual(_statute_token("Article 226 of the Constitution of India"), "article 226")


class TestAIRecipeConsumption(unittest.TestCase):
    def test_valid_recipes_used_invalid_dropped(self):
        issue = _land_issue(ai_query_recipes=[
            {"kind": "precision", "q": '"non-utilisation" ANDD "resumption of land"'},
            {"kind": "recall", "q": 'non-user ORR "land not utilised"'},
            {"kind": "precision", "q": '("a" ORR "b") ANDD c'},  # invalid → dropped
            {"kind": "landmark", "q": "Motilal Padampat Sugar Mills v. State of U.P."},
        ])
        qs = generate_ik_queries([issue])
        forms = [q["formInput"] for q in qs]
        joined = " || ".join(forms).lower()
        # valid precision recipe present
        self.assertIn("resumption of land", joined)
        # no parenthesised recipe leaked through anywhere
        self.assertFalse(any("(" in f or ")" in f for f in forms))
        # landmark recipe reduced to the distinctive party and title-routed
        lm = [q for q in qs if q["query_type"] == "landmark"]
        self.assertTrue(any("motilal padampat" in q["formInput"].lower() for q in lm))


if __name__ == "__main__":
    unittest.main()
