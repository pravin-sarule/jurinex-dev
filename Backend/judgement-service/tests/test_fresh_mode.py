"""Fresh mode: a case with NO drafted pleading gets PROPOSED grounds built
from its source documents anchored to the lawyer's stated objective, riding
the same GroundsExtractResult → Issue contract as every other mode."""

import asyncio

import agents
from schemas import (
    AnalyzeResponse,
    CaseContext,
    ExtractedGround,
    GroundsExtractResult,
)


def _context() -> CaseContext:
    return CaseContext(
        document_type="mixed",
        facts="Supplier delivered software; invoices unpaid; buyer alleges defects.",
        procedural_history="",
        relief_sought="",
        raw_case_summary="Unpaid software invoices dispute.",
    )


def _result() -> GroundsExtractResult:
    return GroundsExtractResult(
        document_type_label="Fresh matter — no draft on record",
        party="the supplier",
        forum="",
        procedural_stage="summary suit for recovery",
        grounds=[
            ExtractedGround(
                ground_label="Proposed Ground 1",
                title="Admitted Liability in Written Acknowledgements",
                summary="The buyer's emails acknowledge the invoices...",
                research_question="Whether a summary decree can follow where liability stands admitted in written correspondence?",
                doctrine="summary suit — leave to defend",
                sub_doctrine="triable_issue",
                statutory_hook="Order 37 CPC",
                statutes=["Order 37 CPC"],
                origin="pleaded",   # model forgot — backstop must fix
            ),
            ExtractedGround(
                ground_label="",    # model forgot the label — backstop must fill
                title="Interest on Delayed Payment",
                summary="Invoices carry an interest clause...",
                research_question="Whether contractual interest is recoverable where invoices stipulate a rate accepted by conduct?",
                doctrine="contractual interest",
                sub_doctrine="interest_stipulation",
                statutory_hook="Section 34 CPC",
            ),
        ],
    )


def test_fresh_extraction_labels_and_maps(monkeypatch):
    captured = {}

    async def _fake_parse(system, user, model, **kwargs):
        captured["system"] = system
        captured["user"] = user
        return _result()

    monkeypatch.setattr(agents, "claude_available", lambda: True)
    monkeypatch.setattr(agents, "claude_parse", _fake_parse)
    context = _context()
    issues, meta = asyncio.run(agents.extract_fresh(
        "SOURCE DOC TEXT", context, "we act for the supplier; recover the unpaid invoices"))

    assert "CLIENT'S OBJECTIVE" in captured["user"]
    assert "recover the unpaid invoices" in captured["user"]
    assert len(issues) == 2
    assert issues[0].ground_label == "Proposed Ground 1"
    # Blank label from the model gets the deterministic backstop label.
    assert issues[1].ground_label == "Proposed Ground 2"
    assert context.procedural_stage == "summary suit for recovery"
    # Objective fills the missing relief for downstream prompts.
    assert "recover the unpaid" in context.relief_sought
    assert meta["totalGrounds"] == 2
    assert meta["objective"].startswith("we act for the supplier")


def test_fresh_empty_result_asks_for_clarification(monkeypatch):
    async def _fake_parse(*args, **kwargs):
        return GroundsExtractResult(insufficient_material=True)

    monkeypatch.setattr(agents, "claude_available", lambda: True)
    monkeypatch.setattr(agents, "claude_parse", _fake_parse)
    context = _context()
    issues, meta = asyncio.run(agents.extract_fresh("x", context, "quash it"))
    assert issues == []
    assert context.needs_clarification is True
    assert "fresh matter" in (context.clarification_question or "")


def test_fresh_mode_is_a_valid_research_mode():
    response = AnalyzeResponse(sessionId="s1", caseContext=_context(), researchMode="fresh")
    assert response.researchMode == "fresh"
    ground = ExtractedGround(origin="proposed")
    assert ground.origin == "proposed"
