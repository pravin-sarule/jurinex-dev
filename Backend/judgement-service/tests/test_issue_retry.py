"""Per-issue reformulation retry: an issue with NO usable judgment gets a
genuinely different query set and ONE fresh round; already-fetched docs are
excluded; an issue that found results never triggers a retry."""

import pytest

import agents
from schemas import CaseContext, Issue, KeywordSet


def _ctx() -> CaseContext:
    return CaseContext(document_type="note", relief_sought="quashing of FIR",
                       raw_case_summary="summary")


@pytest.mark.asyncio
async def test_empty_issue_triggers_reformulated_retry(monkeypatch):
    issue = Issue(id=1, issue="Whether the FIR is liable to be quashed?")
    first_kw = KeywordSet(statutory=["Section 482 CrPC"], anchor_queries=["a1"],
                          contra_queries=["c1"])
    retry_kw = KeywordSet(statutory=["482 Cr.P.C."], anchor_queries=["b1"])
    calls = {"gen": 0, "round": 0}

    async def fake_generate(issue_arg, ctx_arg, failed_queries=None, style="simple"):
        calls["gen"] += 1
        # the reformulation call must carry every previously tried query
        assert failed_queries is not None
        assert "a1" in failed_queries and "c1" in failed_queries
        assert "Section 482 CrPC" in failed_queries
        return retry_kw

    async def fake_round(issue_arg, ctx_arg, kw, exclude=None, anchors_only=False):
        calls["round"] += 1
        if calls["round"] == 1:
            assert kw is first_kw
            return {"candidates": {"d1": "cand1"}, "scored": []}
        assert kw is retry_kw
        # round 2 must never re-fetch round 1's documents
        assert exclude == {"d1"}
        return {"candidates": {"d2": "cand2"}, "scored": ["SURVIVOR"]}

    monkeypatch.setattr(agents, "generate_queries", fake_generate)
    monkeypatch.setattr(agents, "_issue_round", fake_round)

    out = await agents._process_issue(issue, _ctx(), pre_keywords=first_kw)
    assert out["scored"] == ["SURVIVOR"]
    # guardian pool carries BOTH rounds (closed world)
    assert set(out["candidates"]) == {"d1", "d2"}
    assert out["keywords"] is retry_kw
    assert calls == {"gen": 1, "round": 2}


@pytest.mark.asyncio
async def test_no_retry_when_first_round_has_results(monkeypatch):
    issue = Issue(id=2, issue="Whether bail should be granted?")
    kw = KeywordSet(statutory=["Section 439 CrPC"], anchor_queries=["a1"])
    calls = {"gen": 0, "round": 0}

    async def fake_generate(*args, **kwargs):  # pragma: no cover
        calls["gen"] += 1
        raise AssertionError("must not reformulate when results exist")

    async def fake_round(issue_arg, ctx_arg, kw_arg, exclude=None, anchors_only=False):
        calls["round"] += 1
        return {"candidates": {"d9": "cand"}, "scored": ["HIT"]}

    monkeypatch.setattr(agents, "generate_queries", fake_generate)
    monkeypatch.setattr(agents, "_issue_round", fake_round)

    out = await agents._process_issue(issue, _ctx(), pre_keywords=kw)
    assert out["scored"] == ["HIT"]
    assert out["keywords"] is kw
    assert calls == {"gen": 0, "round": 1}


@pytest.mark.asyncio
async def test_retry_gives_up_honestly_when_still_empty(monkeypatch):
    issue = Issue(id=3, issue="Whether the order is appealable?")
    kw = KeywordSet(statutory=["Section 96 CPC"], anchor_queries=["a1"])
    retry_kw = KeywordSet(statutory=["Section 104 CPC"])

    async def fake_generate(issue_arg, ctx_arg, failed_queries=None, style="simple"):
        return retry_kw

    async def fake_round(issue_arg, ctx_arg, kw_arg, exclude=None, anchors_only=False):
        return {"candidates": {}, "scored": []}

    monkeypatch.setattr(agents, "generate_queries", fake_generate)
    monkeypatch.setattr(agents, "_issue_round", fake_round)

    out = await agents._process_issue(issue, _ctx(), pre_keywords=kw)
    assert out["scored"] == []  # honest empty â€” never padded
