"""
Tests for RelevanceRankerAgent.
Uses monkeypatching to avoid real Gemini API calls.
"""
import pytest
import json
from unittest.mock import patch, MagicMock


def _make_context(jids, controversy_map=None, dimensions=None, hints=None):
    from agents.base_agent import AgentContext
    ctx = AgentContext()
    ctx.judgement_ids = list(jids)
    ctx.dimensions = dimensions or []
    ctx.metadata = {
        "controversy_map": controversy_map or {
            "central_controversy": "FIR quashing cheating IPC 420",
            "controversy_query": "quashing FIR cheating commercial dispute section 420",
        },
        "local_judgement_hints": hints or {},
    }
    return ctx


def _fake_score_response(jids, scores):
    """Return a fake Gemini JSON response assigning scores to jids by index."""
    items = [{"id": jid, "score": scores[i], "tier": "RELEVANT", "reasoning": "test"}
             for i, jid in enumerate(jids)]
    return json.dumps(items)


class TestRelevanceRankerSorting:
    def test_ranked_by_score_descending(self, monkeypatch):
        from agents.relevance_ranker import RelevanceRankerAgent
        agent = RelevanceRankerAgent()
        jids = ["a", "b", "c"]

        def _fake_gemini(self_, prompt, **kwargs):
            return _fake_score_response(jids, [3.0, 9.0, 5.0])

        monkeypatch.setattr(RelevanceRankerAgent, "_gemini", _fake_gemini)

        ctx = _make_context(jids)
        # Provide hints so no DB fetch is needed
        ctx.metadata["local_judgement_hints"] = {
            jid: {"title": f"Title {jid}", "ratio": f"Ratio {jid}"}
            for jid in jids
        }
        result = agent.run(ctx)
        assert result.success
        # b(9) > c(5) > a(3)
        assert ctx.judgement_ids == ["b", "c", "a"]

    def test_irrelevant_dropped(self, monkeypatch):
        from agents.relevance_ranker import RelevanceRankerAgent
        agent = RelevanceRankerAgent()
        jids = ["x", "y", "z"]

        def _fake_gemini(self_, prompt, **kwargs):
            return _fake_score_response(jids, [0.5, 7.0, 1.0])

        monkeypatch.setattr(RelevanceRankerAgent, "_gemini", _fake_gemini)

        ctx = _make_context(jids)
        ctx.metadata["local_judgement_hints"] = {
            jid: {"title": f"T {jid}", "ratio": f"R {jid}"} for jid in jids
        }
        agent.run(ctx)
        # x(0.5) and z(1.0) both below threshold 2.0 → dropped
        assert "x" not in ctx.judgement_ids
        assert "z" not in ctx.judgement_ids
        assert "y" in ctx.judgement_ids

    def test_admin_bypasses_drop(self, monkeypatch):
        from agents.relevance_ranker import RelevanceRankerAgent
        agent = RelevanceRankerAgent()
        jids = ["admin1", "normal1"]

        def _fake_gemini(self_, prompt, **kwargs):
            return _fake_score_response(jids, [0.0, 8.0])

        monkeypatch.setattr(RelevanceRankerAgent, "_gemini", _fake_gemini)

        ctx = _make_context(
            jids,
            hints={"admin1": {"title": "Admin upload", "ratio": "test", "is_local_admin": True},
                   "normal1": {"title": "Normal", "ratio": "test"}}
        )
        agent.run(ctx)
        # admin1 score=0.0 but is admin → kept
        assert "admin1" in ctx.judgement_ids
        assert "normal1" in ctx.judgement_ids

    def test_empty_list_returns_immediately(self):
        from agents.relevance_ranker import RelevanceRankerAgent
        agent = RelevanceRankerAgent()
        ctx = _make_context([])
        result = agent.run(ctx)
        assert result.success
        assert result.data["ranked"] == 0
        assert result.data["dropped"] == 0


class TestRelevanceRankerGeminiFailure:
    def test_gemini_failure_gives_default_scores(self, monkeypatch):
        from agents.relevance_ranker import RelevanceRankerAgent
        agent = RelevanceRankerAgent()
        jids = ["p", "q"]

        def _fail_gemini(self_, prompt, **kwargs):
            raise RuntimeError("API down")

        monkeypatch.setattr(RelevanceRankerAgent, "_gemini", _fail_gemini)

        ctx = _make_context(jids)
        ctx.metadata["local_judgement_hints"] = {
            jid: {"title": f"T {jid}", "ratio": f"R {jid}"} for jid in jids
        }
        result = agent.run(ctx)
        # Fallback score 5.0 is above threshold 2.0 → all kept
        assert result.success
        assert set(ctx.judgement_ids) == set(jids)
