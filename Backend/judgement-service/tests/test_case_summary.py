"""Advocate-grade judgment summary (100-word paragraph + 8-line note): the
generator grounds on the fetched judgment text with head AND tail intact (the
citation/date open the judgment, the operative order closes it), tailors line 8
via the Context line, and returns an empty model — never an exception — when
the agent produces nothing."""

import asyncio

import agents
from schemas import CaseSummaryLine, JudgmentCaseSummary


def _run(coro):
    return asyncio.run(coro)


def test_long_judgment_keeps_head_and_tail(monkeypatch):
    captured = {}

    async def _fake_run(agent, message, keys):
        captured["message"] = message
        return {"case_summary": {"summary100": "ok"}}

    monkeypatch.setattr(agents, "run_agent_once", _fake_run)
    doc = "HEADSTART " + ("x" * 40000) + " TAILEND ordered accordingly."
    out = _run(agents.generate_case_summary("A v B", doc, "quashing issue", "2026-08-05"))
    assert out.summary100 == "ok"
    msg = captured["message"]
    assert "HEADSTART" in msg
    assert "TAILEND ordered accordingly." in msg
    assert "[... middle of judgment omitted ...]" in msg
    assert "TODAY'S DATE: 2026-08-05" in msg
    assert "Context: quashing issue" in msg


def test_no_context_line_when_matter_blank(monkeypatch):
    captured = {}

    async def _fake_run(agent, message, keys):
        captured["message"] = message
        return {"case_summary": None}

    monkeypatch.setattr(agents, "run_agent_once", _fake_run)
    out = _run(agents.generate_case_summary("A v B", "short text", "  ", "2026-08-05"))
    assert isinstance(out, JudgmentCaseSummary)
    assert out.summary100 == ""
    assert out.note == []
    assert "Context:" not in captured["message"]


def test_note_lines_validate_labels():
    model = JudgmentCaseSummary(
        summary100="Case name, citation and holding in one paragraph.",
        note=[CaseSummaryLine(label="Case", text="A v B, not stated in the judgment"),
              CaseSummaryLine(label="Provisions", text="Section 482 CrPC")],
        verify_line="VERIFY: current status of this judgment as on 2026-08-05 before relying on it.",
    )
    assert model.note[0].label == "Case"
    assert model.model_dump()["note"][1]["text"] == "Section 482 CrPC"
