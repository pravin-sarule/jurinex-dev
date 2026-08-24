"""A total LLM outage (Claude down AND the Gemini keyword fallback dying
through its retry loop) during analyze-time query generation must degrade
to an empty KeywordSet — never 500 the whole /analyze request. The empty
set stored in the session triggers live regeneration at /search/run."""

import pytest

import agents
from schemas import CaseContext, Issue


@pytest.mark.asyncio
async def test_safe_generate_queries_swallows_llm_outage(monkeypatch):
    async def boom(issue, context, **kwargs):
        raise RuntimeError("429 RESOURCE_EXHAUSTED (both providers down)")

    monkeypatch.setattr(agents, "generate_queries", boom)
    kw = await agents.safe_generate_queries(
        Issue(id=1, issue="Whether X?"), CaseContext(document_type="note"),
        sibling_issues=["Issue 2: Y"], style="simple")
    assert not kw.all_terms()  # empty set → /run regenerates live


@pytest.mark.asyncio
async def test_safe_generate_queries_passes_results_through(monkeypatch):
    from schemas import KeywordSet

    async def ok(issue, context, **kwargs):
        return KeywordSet(anchor_queries=['"Section 482" quash'])

    monkeypatch.setattr(agents, "generate_queries", ok)
    kw = await agents.safe_generate_queries(
        Issue(id=1, issue="Whether X?"), CaseContext(document_type="note"))
    assert kw.anchor_queries == ['"Section 482" quash']
