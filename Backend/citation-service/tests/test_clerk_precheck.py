"""
Tests for _clerk_relevance_precheck in root_agent.py.
"""
import pytest
import json
from unittest.mock import MagicMock


def _make_doc(i):
    return {"title": f"Judgment {i}", "headline": f"Snippet {i}"}


class TestClerkPrecheck:
    def _run_precheck(self, monkeypatch, ik_docs, go_docs, scores, cm=None, dims=None):
        from agents.root_agent import _clerk_relevance_precheck
        from agents.base_agent import BaseAgent

        fake_resp = json.dumps([{"index": i + 1, "score": s}
                                for i, s in enumerate(scores)])

        def _fake_gemini(self_, prompt, **kwargs):
            return fake_resp

        monkeypatch.setattr(BaseAgent, "_gemini", _fake_gemini)

        agent = BaseAgent()
        cm = cm or {"central_controversy": "test"}
        dims = dims or []
        return _clerk_relevance_precheck(ik_docs, go_docs, cm, dims,
                                        run_id=None, user_id="test", agent=agent)

    def test_all_pass_when_scores_above_threshold(self, monkeypatch):
        ik = [_make_doc(i) for i in range(3)]
        go = [_make_doc(10)]
        kept_ik, kept_go = self._run_precheck(monkeypatch, ik, go, [4, 3, 5, 4])
        assert len(kept_ik) == 3
        assert len(kept_go) == 1

    def test_low_score_docs_excluded(self, monkeypatch):
        ik = [_make_doc(i) for i in range(3)]
        go = []
        # Scores: [4, 1, 3] → doc 1 (score=1) excluded
        kept_ik, kept_go = self._run_precheck(monkeypatch, ik, go, [4, 1, 3])
        assert len(kept_ik) == 2
        assert kept_ik[0]["title"] == "Judgment 0"
        assert kept_ik[1]["title"] == "Judgment 2"

    def test_empty_docs_returned_unchanged(self, monkeypatch):
        from agents.root_agent import _clerk_relevance_precheck
        from agents.base_agent import BaseAgent
        agent = BaseAgent()
        result_ik, result_go = _clerk_relevance_precheck([], [], {}, [],
                                                         run_id=None, user_id="test",
                                                         agent=agent)
        assert result_ik == []
        assert result_go == []

    def test_gemini_failure_passes_all_docs(self, monkeypatch):
        from agents.root_agent import _clerk_relevance_precheck
        from agents.base_agent import BaseAgent

        def _fail(self_, prompt, **kwargs):
            raise RuntimeError("API down")

        monkeypatch.setattr(BaseAgent, "_gemini", _fail)

        ik = [_make_doc(0), _make_doc(1)]
        go = [_make_doc(10)]
        agent = BaseAgent()
        kept_ik, kept_go = _clerk_relevance_precheck(ik, go, {"c": "test"}, [],
                                                     run_id=None, user_id="test",
                                                     agent=agent)
        assert len(kept_ik) == 2
        assert len(kept_go) == 1
