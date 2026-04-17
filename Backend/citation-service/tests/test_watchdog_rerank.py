"""
Tests for watchdog IK re-ranking and dual-vector Qdrant injection.
"""
import pytest
import json
from unittest.mock import MagicMock


def _make_candidate(i, score=3):
    return {
        "title": f"Case {i}",
        "docsource": "Supreme Court of India",
        "headline": f"Snippet {i}",
        "external_id": f"ik{i}",
        "_jurisdiction_priority": 3,
        "_ik_relevance_score": float(score),
    }


class TestReRankIKCandidates:
    def test_low_score_candidates_dropped(self, monkeypatch):
        from agents.watchdog import _rerank_ik_candidates_gemini
        candidates = [_make_candidate(i) for i in range(5)]
        cm = {"central_controversy": "FIR quashing cheating IPC 420",
              "factual_trigger": "commercial dispute", "legal_claim": "IPC 420"}

        # Scores: [5, 1, 4, 0, 3] → candidates 1 (score=1) and 3 (score=0) dropped
        scores = [5, 1, 4, 0, 3]
        fake_response = json.dumps([{"index": i + 1, "score": s} for i, s in enumerate(scores)])

        # Patch BaseAgent._gemini
        from agents import base_agent
        original = base_agent.BaseAgent._gemini

        def _fake(self_, prompt, **kwargs):
            return fake_response

        monkeypatch.setattr(base_agent.BaseAgent, "_gemini", _fake)

        result = _rerank_ik_candidates_gemini(candidates, cm, run_id=None, user_id="test", min_score=2)
        # scores >= 2: indices 0(5), 2(4), 4(3)
        assert len(result) == 3

    def test_empty_candidates_returned_unchanged(self):
        from agents.watchdog import _rerank_ik_candidates_gemini
        result = _rerank_ik_candidates_gemini([], {}, run_id=None, user_id="test")
        assert result == []

    def test_no_controversy_map_returns_original(self):
        from agents.watchdog import _rerank_ik_candidates_gemini
        candidates = [_make_candidate(1), _make_candidate(2)]
        result = _rerank_ik_candidates_gemini(candidates, None, run_id=None, user_id="test")
        assert result == candidates

    def test_gemini_failure_returns_original_order(self, monkeypatch):
        from agents.watchdog import _rerank_ik_candidates_gemini
        from agents import base_agent

        def _fail(self_, prompt, **kwargs):
            raise RuntimeError("down")

        monkeypatch.setattr(base_agent.BaseAgent, "_gemini", _fail)

        candidates = [_make_candidate(1), _make_candidate(2)]
        cm = {"central_controversy": "test"}
        result = _rerank_ik_candidates_gemini(candidates, cm, run_id=None, user_id="test")
        # Returns original on failure
        assert len(result) == 2

    def test_sorted_by_score_descending(self, monkeypatch):
        from agents.watchdog import _rerank_ik_candidates_gemini
        from agents import base_agent

        candidates = [_make_candidate(i) for i in range(3)]
        cm = {"central_controversy": "test dispute"}

        scores = [2, 5, 3]
        fake_response = json.dumps([{"index": i + 1, "score": s} for i, s in enumerate(scores)])

        def _fake(self_, prompt, **kwargs):
            return fake_response

        monkeypatch.setattr(base_agent.BaseAgent, "_gemini", _fake)

        result = _rerank_ik_candidates_gemini(candidates, cm, run_id=None, user_id="test", min_score=2)
        # 5 > 3 > 2 → candidate 1(5), 2(3), 0(2)
        assert result[0]["title"] == "Case 1"
        assert result[1]["title"] == "Case 2"
        assert result[2]["title"] == "Case 0"
