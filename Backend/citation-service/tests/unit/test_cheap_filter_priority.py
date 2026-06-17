"""cheap_filter priority/query-overlap protection (ADDITIONAL FIX, run 29abe5c0)."""

from __future__ import annotations

import unittest

from models.citation_models import Candidate
from models.issue_models import IssueCard
from pipeline.pipeline_context import PipelineContext
from pipeline.stages import cheap_filter


def _ctx(candidates):
    issue = IssueCard(
        issue_id="issue-1",
        legal_issue="rejection of tender bid for want of experience certificate was arbitrary",
        represented_side="petitioner",
        favorable_position_for_selected_side="x", likely_opposite_position="y",
        phrase_terms=["legitimate expectation", "substantial compliance"],
        doctrines=["promissory estoppel"],
    )
    ctx = PipelineContext("run", "q", "user", None, "petitioner", "facts", issues=[issue])
    ctx.candidates = candidates
    return ctx


def _cand(doc_id, title, headline, matched_query, priority=None):
    c = Candidate(doc_id=doc_id, title=title, headline=headline,
                  matched_issue_id="issue-1", matched_query=matched_query)
    if priority is not None:
        c.metadata["query_priority"] = priority
    return c


class TestCheapFilterProtection(unittest.TestCase):
    def test_doctrine_query_hit_with_weak_headline_is_kept(self):
        # IK headline is an auto-generated fact summary ("construction work tender") that
        # does NOT mention the doctrine, but a priority-1 doctrine query retrieved it.
        c = _cand("1", "Government tender for construction work", "construction work order",
                  '"legitimate expectation" ANDD tender ANDD writ', priority=1)
        kept = cheap_filter.run(_ctx([c]))
        self.assertEqual([k.doc_id for k in kept], ["1"])

    def test_multi_term_query_overlap_keeps_candidate(self):
        # No priority set (defaults to 6), weak headline, but the retrieving query
        # contains >= 2 of the issue's phrase terms → kept via query overlap.
        c = _cand("2", "Some unrelated-looking cause title", "auto summary of facts",
                  '"legitimate expectation" ANDD "substantial compliance" ANDD tender')
        kept = cheap_filter.run(_ctx([c]))
        self.assertEqual([k.doc_id for k in kept], ["2"])

    def test_truly_irrelevant_low_priority_candidate_is_discarded(self):
        c = _cand("3", "tax valuation customs duty", "unrelated", "bail", priority=6)
        ctx = _ctx([c])
        kept = cheap_filter.run(ctx)
        self.assertEqual(kept, [])
        self.assertEqual(len(ctx.rejected), 1)


if __name__ == "__main__":
    unittest.main()
