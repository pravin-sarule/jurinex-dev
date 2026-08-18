"""Single-round policy: ONE fetch round per issue per run — one IK call per
display query, NO automatic reformulation retry (total calls must equal the
displayed query count). Empty rounds return honestly; re-running the search
advances the per-query page ledger instead of regenerating queries."""

import pytest

import agents
from schemas import CaseContext, Issue, KeywordSet


def _ctx() -> CaseContext:
    return CaseContext(document_type="note", relief_sought="quashing of FIR",
                       raw_case_summary="summary")


@pytest.mark.asyncio
async def test_empty_round_returns_honest_empty_without_reformulation(monkeypatch):
    issue = Issue(id=1, issue="Whether the FIR is liable to be quashed?")
    kw = KeywordSet(statutory=["Section 482 CrPC"], anchor_queries=["a1"],
                    contra_queries=["c1"])
    calls = {"round": 0}

    async def fake_generate(*args, **kwargs):  # pragma: no cover
        raise AssertionError("no reformulation: stored keywords must be used as-is")

    async def fake_round(issue_arg, ctx_arg, kw_arg, exclude=None, page_map=None):
        calls["round"] += 1
        assert kw_arg is kw
        return {"candidates": {"d1": "cand1"}, "scored": []}

    monkeypatch.setattr(agents, "generate_queries", fake_generate)
    monkeypatch.setattr(agents, "_issue_round", fake_round)

    out = await agents._process_issue(issue, _ctx(), pre_keywords=kw)
    assert out["scored"] == []          # honest empty — never padded
    assert calls["round"] == 1          # exactly ONE round, ever
    assert out["keywords"] is kw


@pytest.mark.asyncio
async def test_results_pass_through_single_round(monkeypatch):
    issue = Issue(id=2, issue="Whether bail should be granted?")
    kw = KeywordSet(statutory=["Section 439 CrPC"], anchor_queries=["a1"])

    async def fake_round(issue_arg, ctx_arg, kw_arg, exclude=None, page_map=None):
        return {"candidates": {"d9": "cand"}, "scored": ["HIT"]}

    monkeypatch.setattr(agents, "_issue_round", fake_round)
    out = await agents._process_issue(issue, _ctx(), pre_keywords=kw)
    assert out["scored"] == ["HIT"]
    assert out["keywords"] is kw


@pytest.mark.asyncio
async def test_curated_empty_selection_fetches_nothing(monkeypatch):
    """The user unchecked every query for this issue — zero IK calls."""
    issue = Issue(id=3, issue="Whether the order is appealable?")
    kw = KeywordSet(statutory=["Section 96 CPC"], anchor_queries=[])

    async def boom(*args, **kwargs):  # pragma: no cover
        raise AssertionError("must not fetch when the user unchecked every query")

    monkeypatch.setattr(agents, "_issue_round", boom)
    out = await agents._process_issue(issue, _ctx(), pre_keywords=kw, curated=True)
    assert out["scored"] == [] and out["candidates"] == {}


@pytest.mark.asyncio
async def test_page_map_reaches_the_round(monkeypatch):
    issue = Issue(id=4, issue="Whether the suit is barred by limitation?")
    kw = KeywordSet(anchor_queries=["a1"], statutory=["s1"])
    seen = {}

    async def fake_round(issue_arg, ctx_arg, kw_arg, exclude=None, page_map=None):
        seen["page_map"] = page_map
        return {"candidates": {}, "scored": []}

    monkeypatch.setattr(agents, "_issue_round", fake_round)
    page_map = {"some wire": 3}
    await agents._process_issue(issue, _ctx(), pre_keywords=kw, page_map=page_map)
    assert seen["page_map"] is page_map


@pytest.mark.asyncio
async def test_page_ledger_is_per_issue(monkeypatch):
    """The ledger is keyed per issue: an issue that already used a query
    advances ITS pages; a different issue sharing the same query starts at
    page one (its sub-ledger is empty)."""
    issues = [Issue(id=1, issue="Whether A?"), Issue(id=2, issue="Whether B?")]
    captured = {}

    async def fake_process(issue, context, pre_keywords=None, curated=False,
                           query_style="simple", page_map=None):
        captured[issue.id] = page_map
        return {"issue": issue, "keywords": None, "candidates": {}, "scored": []}

    monkeypatch.setattr(agents, "_process_issue", fake_process)
    master = {"1": {'"shared query" doctypes:x': 0}}  # issue 1 already used page one
    await agents.issue_fanout(issues, _ctx(), page_map=master)
    assert captured[1] == {'"shared query" doctypes:x': 0}  # its own history
    assert captured[2] == {}                                # fresh — starts at page one
    assert set(master) == {"1", "2"}                        # sub-ledgers persist
