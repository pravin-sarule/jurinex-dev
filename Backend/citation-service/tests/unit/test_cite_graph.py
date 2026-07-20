"""Tier 2 — cite-graph expansion.

After the seed judgments are full-doc'd, the stage harvests their cited/citing cases (already in
doc_data), ranks them by co-citation frequency, promotes the strongest into new candidates,
full-docs + scores them, and merges the survivors into the shortlist for the judge. These tests
lock in the harvest/rank/dedup/statute-filter logic and the end-to-end run() (with a stub client
and patched scoring, so the test isolates cite-graph's own behaviour from scoring internals).
"""

from __future__ import annotations

import unittest
from typing import Any
from unittest.mock import patch

from core.config import settings
from models.citation_models import Candidate
from models.issue_models import IssueCard
from pipeline.pipeline_context import PipelineContext
import pipeline.stages.cite_graph_expand as cg


def _issue(issue_id="i1"):
    return IssueCard(
        issue_id=issue_id, legal_issue="forfeiture of land", represented_side="petitioner",
        favorable_position_for_selected_side="x", likely_opposite_position="y",
        statutes=[], must_have_terms=["forfeiture"], phrase_terms=[], optional_synonyms=[],
        doctrines=[], outcome_terms=[], fact_terms=[], preferred_courts=[],
        landmark_cases=[], opponent_phrase_terms=[], is_main_issue=True,
    )


def _seed(doc_id, cites=None, citedby=None, conf=0.6, issue_id="i1"):
    c = Candidate(doc_id=doc_id, title=f"Seed {doc_id} vs State", matched_issue_id=issue_id,
                  matched_query='"forfeiture of land" ANDD industrial', confidence=conf)
    c.metadata["doc_data"] = {"cites": cites or [], "citedby": citedby or []}
    return c


def _ctx(seeds, **kw):
    ctx = PipelineContext(
        run_id="test-run", query="q", user_id="u", case_id=None,
        perspective="petitioner", case_context="x" * 200,
    )
    ctx.issues = [_issue()]
    ctx.shortlisted = list(seeds)
    for k, v in kw.items():
        setattr(ctx, k, v)
    return ctx


class _StubClient:
    """Stands in for IndianKanoonClient.fetch_full_document — populates full_text + doc_data."""
    def __init__(self, court="Supreme Court of India", fail_ids=None, empty_ids=None):
        self.court = court
        self.fail_ids = set(fail_ids or [])
        self.empty_ids = set(empty_ids or [])
        self.fetched: list[str] = []

    def fetch_full_document(self, candidate: Candidate) -> Candidate:
        self.fetched.append(candidate.doc_id)
        if candidate.doc_id in self.fail_ids:
            raise RuntimeError("boom")
        candidate.full_text = "" if candidate.doc_id in self.empty_ids else ("HELD that the appeal is allowed. " * 100)
        candidate.metadata["doc_data"] = {"docsource": self.court, "title": candidate.title, "publishdate": "2020-01-01"}
        return candidate


def _fake_sims(_case_context, candidates, *_a, **_k):
    return {c.doc_id: 0.9 for c in candidates}


def _fake_score(candidate, _issue, _query, _perspective, _case_context, _same_court="", semantic_score=None, run_id=""):
    # high relevance when a semantic score is present; lets the floor be exercised via overrides
    candidate.relevance_score = 0.8 if semantic_score else 0.1
    candidate.confidence = 0.7
    candidate.authority_score = 0.9
    return candidate


class TestStatuteFilter(unittest.TestCase):
    def test_statutes_skipped_cases_kept(self):
        for stat in ("The Punjab Tenancy Rules", "Bombay Stamp Act", "Code of Civil Procedure",
                     "The Constitution of India", "Some Notification 2019"):
            self.assertTrue(cg._looks_like_statute(stat), stat)
        for case in ("K C Prakash vs State of Karnataka", "Maneka Gandhi v. Union of India",
                     "State of Gujarat versus Shivganaga Farms"):
            self.assertFalse(cg._looks_like_statute(case), case)

    def test_empty_title_is_non_promotable(self):
        self.assertTrue(cg._looks_like_statute(""))


class TestHarvest(unittest.TestCase):
    def test_cocitation_count_and_outbound_flag(self):
        seeds = [
            _seed("S1", cites=[{"tid": "A", "title": "X vs Y"}, {"tid": "B", "title": "P vs Q"}],
                  citedby=[{"tid": "C", "title": "R vs S"}], conf=0.7),
            _seed("S2", cites=[{"tid": "A", "title": "X vs Y"}, {"tid": "D", "title": "The Foo Act"}],
                  citedby=[], conf=0.5),
        ]
        h = cg._harvest(seeds, seen={"S1", "S2"})
        self.assertEqual(set(h), {"A", "B", "C"})          # D (statute) skipped
        self.assertEqual(h["A"]["support"], 2)             # co-cited by both seeds
        self.assertEqual(h["B"]["support"], 1)
        self.assertTrue(h["A"]["outbound"])                # appears as a cite
        self.assertTrue(h["B"]["outbound"])
        self.assertFalse(h["C"]["outbound"])               # only a citedby
        self.assertEqual(h["A"]["best_conf"], 0.7)         # strongest referencing seed

    def test_skips_already_seen_ids(self):
        seeds = [_seed("S1", cites=[{"tid": "A", "title": "X vs Y"}, {"tid": "EXIST", "title": "M vs N"}])]
        h = cg._harvest(seeds, seen={"S1", "EXIST"})
        self.assertIn("A", h)
        self.assertNotIn("EXIST", h)


class TestRun(unittest.TestCase):
    def setUp(self):
        self._p1 = patch.object(cg, "case_similarity_scores", _fake_sims)
        self._p2 = patch.object(cg, "score", _fake_score)
        self._p1.start(); self._p2.start()
        self.addCleanup(self._p1.stop); self.addCleanup(self._p2.stop)

    def test_disabled_flag_is_noop(self):
        seeds = [_seed("S1", cites=[{"tid": "A", "title": "X vs Y"}])]
        ctx = _ctx(seeds)
        client: Any = _StubClient()
        object.__setattr__(settings, "enable_cite_graph_expansion", False)  # frozen dataclass
        try:
            out = cg.run(ctx, client)
        finally:
            object.__setattr__(settings, "enable_cite_graph_expansion", True)
        self.assertEqual([c.doc_id for c in out], ["S1"])
        self.assertEqual(client.fetched, [])

    def test_promotes_merges_and_sorts(self):
        seeds = [
            _seed("S1", cites=[{"tid": "A", "title": "X vs Y"}, {"tid": "B", "title": "P vs Q"}], conf=0.6),
            _seed("S2", cites=[{"tid": "A", "title": "X vs Y"}], conf=0.6),
        ]
        ctx = _ctx(seeds)
        client: Any = _StubClient()
        out = cg.run(ctx, client)
        ids = {c.doc_id for c in out}
        self.assertIn("A", ids); self.assertIn("B", ids)       # promoted
        self.assertIn("S1", ids); self.assertIn("S2", ids)     # seeds retained
        promoted = [c for c in out if c.metadata.get("_cite_graph")]
        self.assertTrue(promoted and all(c.full_text for c in promoted))
        self.assertEqual(ctx.timings.get("_cite_graph_promoted"), 2)
        # A was co-cited by both seeds → ranked ahead of B among promotions
        self.assertEqual([c.doc_id for c in promoted][0], "A")

    def test_respects_remaining_full_doc_budget(self):
        seeds = [_seed("S1", cites=[{"tid": "A", "title": "X vs Y"}, {"tid": "B", "title": "P vs Q"},
                                    {"tid": "E", "title": "G vs H"}])]
        ctx = _ctx(seeds)
        ctx.budget.counts["ik_full_doc"] = settings.max_ik_full_doc_calls - 1  # only 1 slot left
        client: Any = _StubClient()
        cg.run(ctx, client)
        self.assertEqual(len(client.fetched), 1)               # capped to remaining budget

    def test_relevance_floor_drops_weak_promotions(self):
        seeds = [_seed("S1", cites=[{"tid": "A", "title": "X vs Y"}])]
        ctx = _ctx(seeds)
        client: Any = _StubClient()
        # force the promoted cite below the floor
        def low_sims(_cc, cands, *a, **k):
            return {c.doc_id: 0.0 for c in cands}
        with patch.object(cg, "case_similarity_scores", low_sims):
            out = cg.run(ctx, client)
        self.assertNotIn("A", {c.doc_id for c in out})         # dropped by floor
        self.assertIn("A", {c.doc_id for c in ctx.rejected})

    def test_failed_and_empty_fetches_are_rejected_not_promoted(self):
        seeds = [_seed("S1", cites=[{"tid": "A", "title": "X vs Y"}, {"tid": "B", "title": "P vs Q"}])]
        ctx = _ctx(seeds)
        client: Any = _StubClient(fail_ids={"A"}, empty_ids={"B"})
        out = cg.run(ctx, client)
        ids = {c.doc_id for c in out}
        self.assertNotIn("A", ids); self.assertNotIn("B", ids)
        self.assertEqual({c.doc_id for c in out}, {"S1"})


if __name__ == "__main__":
    unittest.main()
