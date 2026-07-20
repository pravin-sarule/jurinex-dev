"""Locks in the de-overfit / dynamic-retrieval redesign (C1-C3, #6).

The query builder must work for ANY matter (criminal, tax, stamp-duty, contract) — never
leak tender/land vocab, always anchor on the case's OWN statute/keyword, drop bare generic
landmark names, and collapse common-order duplicates.
"""

from __future__ import annotations

import types
import unittest

from models.issue_models import IssueCard
import services.query_service as q
from services.query_service import generate_ik_queries, _clean_landmark_name
from pipeline.stages.shortlist_candidates import _collapse_common_orders, _respondent_sig

_TENDER_LAND_VOCAB = (
    "tata cellular", "motilal padampat", "reliance energy", "tender", "e-tender",
    "non-utilisation", "level playing field", "nazarana", "forfeiture of land",
)


def _issue(**kw) -> IssueCard:
    base = dict(
        issue_id="i1", legal_issue="x", represented_side="petitioner",
        favorable_position_for_selected_side="x", likely_opposite_position="y",
        statutes=[], must_have_terms=[], phrase_terms=[], optional_synonyms=[],
        doctrines=[], outcome_terms=[], fact_terms=[], preferred_courts=[],
        landmark_cases=[], opponent_phrase_terms=[], is_main_issue=True,
    )
    base.update(kw)
    return IssueCard(**base)


class TestNoOverfit(unittest.TestCase):
    def test_overfit_symbols_removed(self):
        # The hardcoded tender/land tables must be gone (replaced by case-derived anchors).
        self.assertFalse(hasattr(q, "DOMAIN_ANCHORS"))
        self.assertFalse(hasattr(q, "get_narrowing_terms"))
        self.assertFalse(hasattr(q, "_DEFAULT_TENDER_LANDMARKS"))
        self.assertTrue(hasattr(q, "_domain_anchor"))
        self.assertTrue(hasattr(q, "_core_anchor"))

    def test_stamp_duty_case_no_tender_leak_and_anchored(self):
        iss = _issue(
            legal_issue="suo motu revision of stamp duty valuation",
            statutes=["Section 53A of the Bombay Stamp Act"],
            must_have_terms=["stamp duty", "revision"], doctrines=["suo motu revision"],
            fact_terms=["under valuation", "market value"], outcome_terms=["set aside"],
        )
        forms = [x["formInput"].lower() for x in generate_ik_queries([iss])]
        blob = " || ".join(forms)
        for w in _TENDER_LAND_VOCAB:
            self.assertNotIn(w, blob, f"tender/land vocab leaked: {w}")
        # Every non-fallback ANDD query carries a case term (statute token or a fact word).
        anchored = [f for f in forms if " andd " in f and ("section 53a" in f or "stamp" in f
                    or "revision" in f or "valuation" in f or "market value" in f)]
        self.assertGreaterEqual(len(anchored), 2)

    def test_criminal_case_anchored_no_leak(self):
        iss = _issue(
            legal_issue="conviction on circumstantial evidence",
            statutes=["Section 302 IPC"], must_have_terms=["circumstantial evidence"],
            doctrines=["benefit of doubt"], fact_terms=["broken chain"], outcome_terms=["acquitted"],
        )
        blob = " || ".join(x["formInput"].lower() for x in generate_ik_queries([iss]))
        for w in _TENDER_LAND_VOCAB:
            self.assertNotIn(w, blob)
        self.assertTrue("section 302" in blob or "circumstantial" in blob)


class TestLandmarkGate(unittest.TestCase):
    def test_rejects_bare_generic_names(self):
        for n in ("Ramesh", "Sanjeevani", "Singh", "Kumar", "Rao"):
            self.assertEqual(_clean_landmark_name(n), "", n)

    def test_keeps_distinctive_names(self):
        self.assertEqual(_clean_landmark_name("State of Maharashtra v. Laxmanrao"), "Laxmanrao")
        self.assertEqual(_clean_landmark_name("Maneka Gandhi"), "Maneka Gandhi")
        self.assertEqual(_clean_landmark_name("Vishaka"), "Vishaka")  # single but long & uncommon

    def test_bare_generic_landmark_emits_no_query(self):
        qs = generate_ik_queries([_issue(must_have_terms=["x y"], landmark_cases=["Ramesh"])])
        self.assertEqual([x for x in qs if x["query_type"] == "landmark"], [])


class TestCommonOrderCollapse(unittest.TestCase):
    def _c(self, doc_id, title, conf=0.5):
        return types.SimpleNamespace(
            doc_id=doc_id, title=title, docsource="Rajasthan High Court",
            publishdate="2025-03-10", confidence=conf, authority_score=0.0,
            relevance_score=0.0, rejection_reason="",
        )

    def test_same_order_collapsed_to_one(self):
        cands = [
            self._c("d1", "Ajit Singh Sahariya vs State Of Rajasthan & Ors", 0.4),
            self._c("d2", "Sunil Kumar Meena vs State Of Rajasthan & Ors", 0.7),
            self._c("d3", "Adesh Kumar Meena vs State Of Rajasthan", 0.3),
        ]
        kept, collapsed = _collapse_common_orders(cands)
        self.assertEqual(len(kept), 1)
        self.assertEqual(kept[0].doc_id, "d2")  # strongest by confidence
        self.assertEqual(len(collapsed), 2)
        self.assertTrue(all("common order" in c.rejection_reason for c in collapsed))

    def test_distinct_respondents_not_collapsed(self):
        cands = [
            self._c("d1", "A vs State Of Rajasthan"),
            self._c("d2", "B vs Union Of India"),
        ]
        kept, collapsed = _collapse_common_orders(cands)
        self.assertEqual(len(kept), 2)
        self.assertEqual(collapsed, [])

    def test_missing_date_never_merges(self):
        a = self._c("d1", "A vs State"); a.publishdate = ""
        b = self._c("d2", "B vs State"); b.publishdate = ""
        kept, collapsed = _collapse_common_orders([a, b])
        self.assertEqual(len(kept), 2)

    def test_respondent_sig(self):
        self.assertEqual(_respondent_sig("X vs State Of Rajasthan & Ors"), "state of rajasthan")
        self.assertEqual(_respondent_sig("No split title"), "")


class TestQueryHygiene(unittest.TestCase):
    def test_operator_casing_normalized(self):
        from services.query_service import _validate_recipe
        # mis-cased + dangling trailing operator -> clean ORR query (was a 0-hit literal phrase)
        self.assertEqual(_validate_recipe("non-utilisation ORr non-user ORr"),
                         "non-utilisation ORR non-user")
        self.assertEqual(_validate_recipe("forfeiture andd land"), "forfeiture ANDD land")
        # mixed ANDD+ORR still rejected (flat engine)
        self.assertEqual(_validate_recipe("a ANDD b ORR c"), "")

    def test_quoted_phrase_capped_to_three_words(self):
        from services.query_service import _clean_term
        self.assertEqual(_clean_term("bona fide industrial use"), '"bona fide industrial"')
        self.assertEqual(_clean_term("forfeiture of land"), '"forfeiture of land"')  # 3 words kept
        self.assertEqual(_clean_term("tahsildar"), "tahsildar")  # single word unquoted

    def test_no_four_word_quoted_phrase_emitted(self):
        iss = _issue(
            legal_issue="forfeiture for non-utilisation",
            statutes=["Section 63-1A"], must_have_terms=["industrial", "forfeiture"],
            phrase_terms=["bona fide industrial use", "principles of natural justice"],
            doctrines=["bona fide industrial use"], fact_terms=["non utilisation"],
        )
        for q in generate_ik_queries([iss]):
            for part in q["formInput"].split('"'):
                self.assertLessEqual(len(part.split()), 3, f"4+ word quoted phrase: {q['formInput']}")

    def test_no_repeated_keyword_in_any_query(self):
        # No single keyword may repeat within one query (e.g. not '"bona fide industrial" ANDD
        # industrial'). The anchor selection + _dedup_terms_by_word guarantee distinct words.
        iss = _issue(
            legal_issue="forfeiture for non-utilisation of land industrial use",
            statutes=["Section 63-1A"], must_have_terms=["industrial", "forfeiture"],
            phrase_terms=["bona fide industrial use", "forfeiture of land"],
            doctrines=["bona fide industrial use"], fact_terms=["non utilisation"],
        )
        for q in generate_ik_queries([iss]):
            words = (q["formInput"].replace('"', "").lower()
                     .replace(" andd ", " ").replace(" orr ", " ").split())
            self.assertEqual(len(words), len(set(words)), f"repeated keyword: {q['formInput']}")

    def test_dedup_terms_by_word(self):
        from services.query_service import _dedup_terms_by_word
        self.assertEqual(_dedup_terms_by_word(['"bona fide industrial"', "industrial"]),
                         ['"bona fide industrial"'])
        self.assertEqual(_dedup_terms_by_word(['"forfeiture of land"', "industrial"]),
                         ['"forfeiture of land"', "industrial"])

    def test_redundant_supreme_court_skipped_under_multicourt(self):
        # When a local court is named and multi_court_doctypes is on, the standalone SC query
        # is skipped (court_filtered's "<court>,supremecourt" superset covers it).
        iss = _issue(
            legal_issue="forfeiture industrial", statutes=["Section 63"],
            must_have_terms=["industrial", "forfeiture"], phrase_terms=["forfeiture of land"],
            preferred_courts=["Bombay High Court", "Supreme Court"],
        )
        qs = generate_ik_queries([iss])
        types = {q["query_type"] for q in qs}
        all_tokens = {tok for q in qs for tok in q["doctypes"].split(",")}
        self.assertNotIn("supreme_court", types)          # redundant SC query dropped
        self.assertIn("supremecourt", all_tokens)         # ...but SC scope still covered
        self.assertIn("bombay", all_tokens)


class TestQueryRerank(unittest.TestCase):
    def test_statute_query_outranks_generic_and_runs_first(self):
        from pipeline.stages.retrieve_candidates import select_queries
        iss = _issue(
            legal_issue="forfeiture for non-utilisation of land industrial use",
            statutes=["Section 63-1A of the Maharashtra Tenancy Act"],
            must_have_terms=["industrial", "forfeiture"], doctrines=["bona fide industrial use"],
            fact_terms=["non utilisation"], outcome_terms=["set aside"],
        )
        selected, _, _ = select_queries(generate_ik_queries([iss]))
        quals = [q["quality"] for q in selected]
        # best-first: execution order is sorted by quality (desc)
        self.assertEqual(quals, sorted(quals, reverse=True))
        # the governing-statute query (statute token + main issue) is the TOP-ranked query
        self.assertEqual(selected[0]["query_type"], "statute_combined")
        self.assertIn("section 63", selected[0]["formInput"].lower())

    def test_quality_rewards_statute_token_and_main_issue(self):
        from services.query_service import _query_quality
        with_token_main = _query_quality("statute_combined", '"x" ANDD "section 63"', True, "section 63")
        generic_fallback = _query_quality("broad_fallback", "a ORR b ORR c", False, "section 63")
        self.assertGreater(with_token_main, generic_fallback)


class TestFragmentFallback(unittest.TestCase):
    """IK's /docfragment/ boolean evaluator errors ('Error in evaluting the fragments') for docs
    that ranked into search but don't strictly satisfy the ANDD/quoted query — even though each
    operand alone evaluates fine. The fetcher must retry single operands so a relevant doc is
    enriched (not dropped), which is what collapsed the funnel to ~8 candidates / 5 citations."""

    def test_failed_detects_errmsg_empty_and_missing_headline(self):
        from services.indiankanoon_client import _fragment_failed
        self.assertTrue(_fragment_failed(None))
        self.assertTrue(_fragment_failed({}))
        self.assertTrue(_fragment_failed({"errmsg": "Error in evaluting the fragments"}))
        self.assertTrue(_fragment_failed({"headline": []}))
        self.assertFalse(_fragment_failed({"headline": ["<p>snippet</p>"]}))

    def test_boolean_query_splits_into_single_operands(self):
        from services.indiankanoon_client import _fragment_fallback_queries
        fb = _fragment_fallback_queries('"promissory estoppel" ANDD tenancy')
        # quoted phrase tried first (most specific), then its unquoted form, then the other operand
        self.assertEqual(fb, ['"promissory estoppel"', "promissory estoppel", "tenancy"])

    def test_plain_single_term_has_no_fallback(self):
        from services.indiankanoon_client import _fragment_fallback_queries
        self.assertEqual(_fragment_fallback_queries("Laxmanrao"), [])
        self.assertEqual(_fragment_fallback_queries("forfeiture industrial"), [])

    def test_fallback_never_repeats_the_original_query(self):
        from services.indiankanoon_client import _fragment_fallback_queries
        for q in ('"a b" ORR "c d"', "tahsildar ANDD \"without jurisdiction\""):
            self.assertNotIn(q.strip().lower(), [f.lower() for f in _fragment_fallback_queries(q)])


if __name__ == "__main__":
    unittest.main()
