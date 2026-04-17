"""
Tests for ControversyMapperAgent.
Uses monkeypatching to avoid real Gemini API calls.
"""
import pytest
import json
from unittest.mock import patch, MagicMock


def _make_context(**kwargs):
    from agents.base_agent import AgentContext
    ctx = AgentContext(**kwargs)
    ctx.metadata = {}
    return ctx


class TestControversyMapperFastPath:
    """Short query, no context → fast-path without LLM call."""

    def test_short_query_no_context_uses_fastpath(self):
        from agents.root_agent import ControversyMapperAgent
        agent = ControversyMapperAgent()
        ctx = _make_context(query="bail conditions India")
        result = agent.run(ctx)
        assert result.success
        assert result.data["source"] == "fast_path"
        cm = ctx.metadata.get("controversy_map")
        assert cm is not None
        assert cm["central_controversy"] == "bail conditions India"

    def test_fast_path_sets_all_keys(self):
        from agents.root_agent import ControversyMapperAgent
        agent = ControversyMapperAgent()
        ctx = _make_context(query="short query")
        agent.run(ctx)
        cm = ctx.metadata["controversy_map"]
        for key in ("central_controversy", "factual_trigger", "legal_claim",
                    "disputed_outcome", "controversy_query"):
            assert key in cm


class TestControversyMapperGeminiPath:
    """Long query or context → Gemini call."""

    def test_gemini_path_parses_valid_json(self, monkeypatch):
        from agents.root_agent import ControversyMapperAgent
        expected_cm = {
            "central_controversy": "Whether FIR for cheating should be quashed",
            "factual_trigger": "Commercial dispute given criminal colour",
            "legal_claim": "IPC Section 420 cheating",
            "disputed_outcome": "Petitioner seeks quashing",
            "controversy_query": "quashing FIR cheating commercial dispute section 420 IPC dishonest intention",
        }
        agent = ControversyMapperAgent()

        def _fake_gemini(self_, prompt, **kwargs):
            return json.dumps(expected_cm)

        monkeypatch.setattr(ControversyMapperAgent, "_gemini", _fake_gemini)

        ctx = _make_context(query=" ".join(["word"] * 20))  # 20 words → gemini path
        result = agent.run(ctx)
        assert result.success
        assert result.data["source"] == "gemini"
        cm = ctx.metadata["controversy_map"]
        assert cm["central_controversy"] == expected_cm["central_controversy"]

    def test_gemini_failure_falls_back(self, monkeypatch):
        from agents.root_agent import ControversyMapperAgent
        agent = ControversyMapperAgent()

        def _fail_gemini(self_, prompt, **kwargs):
            raise RuntimeError("API down")

        monkeypatch.setattr(ControversyMapperAgent, "_gemini", _fail_gemini)

        ctx = _make_context(query=" ".join(["word"] * 20))
        result = agent.run(ctx)
        assert result.success
        assert result.data["source"] == "fallback"
        assert "controversy_map" in ctx.metadata
