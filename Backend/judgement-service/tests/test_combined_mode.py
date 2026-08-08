"""Combined mode: the grounds extractor and the exhaustive issue spotter
run concurrently with their full dedicated prompts, then merge — every
pleaded ground kept, spotted issues dropped only when a ground already
raises the same legal question (same sub-doctrine trigger or same
doctrine+statutory-hook shelf)."""

import asyncio

import agents
from agents import _grounds_to_issues, extract_combined
from schemas import CaseContext, ExtractedGround, GroundsExtractResult, Issue


def _ground(label: str, sub: str, doctrine: str = "quashing — abuse of process",
            hook: str = "Section 482 CrPC") -> Issue:
    return Issue(id=0, issue=f"Whether … ({label})?", ground_label=label,
                 title=label, doctrine=doctrine, sub_doctrine=sub,
                 statutory_hook=hook, legal_framework=[hook])


def _issue(iid: int, sub: str, doctrine: str = "quashing — abuse of process",
           hook: str = "Section 482 CrPC") -> Issue:
    return Issue(id=iid, issue=f"Whether … (spotted {iid})?", doctrine=doctrine,
                 sub_doctrine=sub, statutory_hook=hook)


def _patch(monkeypatch, grounds, meta, spotted):
    async def _g(raw, ctx):
        return grounds, meta

    async def _s(raw, ctx, covered=None):
        # Gap-filler pass (covered != None) returns nothing new by default.
        return [] if covered is not None else spotted

    monkeypatch.setattr(agents, "extract_grounds", _g)
    monkeypatch.setattr(agents, "spot_issues", _s)


def test_merge_keeps_all_grounds_and_non_duplicate_issues(monkeypatch):
    grounds = [_ground("Ground A", "repealed_statute_fir", "repeal and savings",
                       "Section 6 General Clauses Act"),
               _ground("Ground B", "civil_colour")]
    spotted = [
        _issue(1, "civil_colour"),                      # dup of Ground B → dropped
        _issue(2, "delay_laches"),                       # new → kept
        _issue(3, "", "cheating — ingredients", "Section 420 IPC"),  # new shelf → kept
    ]
    _patch(monkeypatch, grounds, {"documentType": "Writ Petition"}, spotted)
    context = CaseContext(document_type="petition")
    merged, meta = asyncio.run(extract_combined("text", context))
    assert [i.ground_label for i in merged[:2]] == ["Ground A", "Ground B"]
    assert len(merged) == 4  # 2 grounds + 2 surviving spotted
    assert meta["totalGrounds"] == 2
    assert meta["spottedIssues"] == 2
    assert [i.id for i in merged] == [1, 2, 3, 4]  # renumbered
    assert context.needs_clarification is False


def test_shelf_dedup_drops_same_doctrine_and_hook(monkeypatch):
    grounds = [_ground("Ground A", "", "cheating — ingredients", "Section 420 IPC")]
    spotted = [_issue(1, "", "cheating — ingredients", "Section 420 IPC")]
    _patch(monkeypatch, grounds, {}, spotted)
    merged, meta = asyncio.run(extract_combined("text", CaseContext(document_type="note")))
    assert len(merged) == 1
    assert merged[0].ground_label == "Ground A"


def test_fallback_spotted_issues_never_carry_ground_labels(monkeypatch):
    """A thorough fallback model fills the Issue schema's optional ground
    fields ('Question I' …) — spotted issues must have them force-blanked,
    else they masquerade as pleaded grounds (16/0 counts, cap truncation)."""
    async def _fake_run(agent, message, keys):
        return {"issues": {"issues": [
            {"id": 1, "issue": "Whether the penalty is imposable?",
             "ground_label": "Question I", "ground_ref": "Para 11"},
        ]}}

    monkeypatch.setattr(agents, "claude_available", lambda: False)
    monkeypatch.setattr(agents, "run_agent_once", _fake_run)
    issues = asyncio.run(agents.spot_issues("text", CaseContext(document_type="note")))
    assert len(issues) == 1
    assert issues[0].ground_label is None
    assert issues[0].ground_ref is None


def test_no_grounds_still_returns_spotted_without_clarification(monkeypatch):
    async def _g(raw, ctx):
        ctx.needs_clarification = True  # grounds extractor found nothing
        ctx.clarification_question = "no grounds"
        return [], {}

    async def _s(raw, ctx, covered=None):
        return [] if covered is not None else [_issue(1, "civil_colour")]

    monkeypatch.setattr(agents, "extract_grounds", _g)
    monkeypatch.setattr(agents, "spot_issues", _s)
    context = CaseContext(document_type="note")
    merged, meta = asyncio.run(extract_combined("text", context))
    assert len(merged) == 1
    assert context.needs_clarification is False
    assert meta["totalGrounds"] == 0
    assert meta["spottedIssues"] == 1


def test_text_similarity_dedup_works_without_sub_doctrine(monkeypatch):
    # Degraded (Gemini-fallback) spotter: no sub_doctrine, no doctrine —
    # a near-verbatim restatement of a ground must still be dropped.
    ground = Issue(id=1, issue="Whether an FIR alleging forgery is liable to be "
                               "quashed where no specific forged document is identified?",
                   ground_label="Ground C", title="Absence of forgery ingredients")
    spotted = [
        Issue(id=1, issue="Whether an FIR alleging forgery is liable to be "
                          "quashed when no specific forged document is identified?"),
        Issue(id=2, issue="Whether a stay of investigation should be granted "
                          "pending the decision on quashing the FIR?"),
    ]
    _patch(monkeypatch, [ground], {}, spotted)
    merged, meta = asyncio.run(extract_combined("text", CaseContext(document_type="note")))
    assert len(merged) == 2  # ground + the genuinely new stay issue
    assert merged[0].ground_label == "Ground C"
    assert "stay of investigation" in merged[1].issue


def test_both_empty_asks_for_clarification(monkeypatch):
    _patch(monkeypatch, [], {}, [])
    context = CaseContext(document_type="note")
    merged, meta = asyncio.run(extract_combined("text", context))
    assert merged == []
    assert context.needs_clarification is True


def test_cap_truncation_is_surfaced(monkeypatch):
    grounds = [_ground(f"Ground {c}", f"trigger_{c}") for c in "ABCDEFGH"]
    spotted = [_issue(i, f"spot_{i}") for i in range(1, 13)]
    _patch(monkeypatch, grounds, {}, spotted)
    merged, meta = asyncio.run(extract_combined("text", CaseContext(document_type="note")))
    assert len(merged) == agents.MAX_COMBINED_ITEMS
    assert meta["truncatedGrounds"] == 8 + 12 - agents.MAX_COMBINED_ITEMS


def test_mapping_keeps_ground_extras_only_for_pleaded_items():
    result = GroundsExtractResult(grounds=[
        ExtractedGround(ground_label="Ground A", title="Repealed Statute FIR",
                        summary="s", research_question="Whether …?",
                        doctrine="repeal and savings",
                        sub_doctrine="repealed_statute_fir",
                        statutes=["Section 6 General Clauses Act"]),
    ])
    issues = _grounds_to_issues(result, cap=12)
    assert issues[0].ground_label == "Ground A"
    assert issues[0].sub_doctrine == "repealed_statute_fir"
    assert agents._ground_note(issues[0]) != ""
