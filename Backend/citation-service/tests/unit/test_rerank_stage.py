"""Phase 3 — unit tests for the embedding-rerank cull stage.

Exercises the deterministic priority-fallback path (embeddings stubbed out) so the cull
math is verified offline: pool is reduced to <= rerank_top_k, every issue keeps at least
rerank_min_per_issue survivors, and the stage no-ops when disabled or the pool is small.
"""

from __future__ import annotations

import unittest
from collections import Counter
from unittest.mock import patch

from core.config import settings
from models.citation_models import Candidate
from models.issue_models import IssueCard
from pipeline.pipeline_context import PipelineContext
from pipeline.stages import rerank_candidates


def _cand(doc_id: str, issue_id: str, prio: int) -> Candidate:
    return Candidate(
        doc_id=doc_id,
        title="forfeiture of land tenancy",
        headline="non-utilisation change of user",
        docsource="Bombay High Court",
        matched_issue_id=issue_id,
        matched_query="q",
        metadata={"query_priority": prio},
    )


def _issue(i: int) -> IssueCard:
    return IssueCard(
        issue_id=f"issue-{i}", legal_issue=f"land issue {i}", represented_side="petitioner",
        favorable_position_for_selected_side="x", likely_opposite_position="y",
        must_have_terms=["forfeiture", "tenancy"], fact_terms=["non-utilisation", "change of user"],
    )


def _ctx(candidates, issues) -> PipelineContext:
    ctx = PipelineContext("run", "q", "user", None, "petitioner", "C" * 200, issues=issues)
    ctx.candidates = candidates
    return ctx


class TestRerankStage(unittest.TestCase):
    def test_noop_when_pool_already_small(self):
        ctx = _ctx([_cand(f"d{i}", "issue-1", 1) for i in range(3)], [_issue(1)])
        with patch.object(rerank_candidates, "case_similarity_scores", return_value={}):
            out = rerank_candidates.run(ctx)
        self.assertEqual(len(out), 3)

    def test_culls_to_top_k_with_per_issue_floor(self):
        issues = [_issue(1), _issue(2), _issue(3)]
        cands = []
        for iss in ("issue-1", "issue-2", "issue-3"):
            for j in range(10):
                cands.append(_cand(f"{iss}-{j}", iss, prio=1 if j < 2 else 5))
        ctx = _ctx(cands, issues)
        with patch.object(rerank_candidates, "case_similarity_scores", return_value={}):
            out = rerank_candidates.run(ctx)
        self.assertLessEqual(len(out), settings.rerank_top_k)
        per = Counter(c.matched_issue_id for c in out)
        for iss in ("issue-1", "issue-2", "issue-3"):
            self.assertGreaterEqual(per[iss], settings.rerank_min_per_issue)
        # culled candidates are recorded as rejected (transparency, not silently dropped)
        self.assertEqual(len(out) + len(ctx.rejected), len(cands))

    def test_disabled_is_passthrough(self):
        ctx = _ctx([_cand(f"d{i}", "issue-1", 5) for i in range(30)], [_issue(1)])
        saved = settings.enable_rerank_stage
        object.__setattr__(settings, "enable_rerank_stage", False)
        try:
            out = rerank_candidates.run(ctx)
        finally:
            object.__setattr__(settings, "enable_rerank_stage", saved)
        self.assertEqual(len(out), 30)


if __name__ == "__main__":
    unittest.main()
