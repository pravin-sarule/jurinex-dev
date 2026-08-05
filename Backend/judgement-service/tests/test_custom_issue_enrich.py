"""User-typed custom issues are normalized into the same shape as
system-suggested ones (short Whether-question + doctrine + statutory hook)
before searching; on any enrichment failure the issue searches as typed."""

import asyncio

import agents
from schemas import CaseContext, Issue, SpottedIssue


def _context() -> CaseContext:
    return CaseContext(
        document_type="note",
        facts="Cheque for supplies dishonoured; complaint filed.",
        procedural_history="Complaint under Section 138 NI Act pending.",
        relief_sought="Quashing of the criminal proceedings.",
        raw_case_summary="Cheque dishonour dispute given criminal colour.",
    )


def test_claude_unavailable_returns_issue_as_typed(monkeypatch):
    monkeypatch.setattr(agents, "claude_available", lambda: False)
    original = Issue(id=7, issue="whether my client's FIR can be quashed?")
    out = asyncio.run(agents.enrich_custom_issue(original, _context()))
    assert out is original


def test_parse_failure_returns_issue_as_typed(monkeypatch):
    monkeypatch.setattr(agents, "claude_available", lambda: True)

    async def _none(*args, **kwargs):
        return None

    monkeypatch.setattr(agents, "claude_parse", _none)
    original = Issue(id=7, issue="whether my client's FIR can be quashed?")
    out = asyncio.run(agents.enrich_custom_issue(original, _context()))
    assert out is original


def test_enrichment_maps_all_fields_and_keeps_id(monkeypatch):
    monkeypatch.setattr(agents, "claude_available", lambda: True)

    async def _spotted(*args, **kwargs):
        return SpottedIssue(
            title="Civil Dispute Given Criminal Colour",
            issue="Whether the criminal proceedings are liable to be quashed "
                  "where the allegations arise primarily from a contractual dispute?",
            explanation="The complaint stems from a dishonoured cheque for supplies.",
            doctrine="quashing — abuse of process",
            statutory_hook="Section 482 CrPC",
            perspective="petitioner",
        )

    monkeypatch.setattr(agents, "claude_parse", _spotted)
    original = Issue(id=9, issue="whether my client's FIR can be quashed, it is a money dispute?")
    out = asyncio.run(agents.enrich_custom_issue(original, _context()))
    assert out.id == 9
    assert out.issue.startswith("Whether the criminal proceedings")
    assert out.title == "Civil Dispute Given Criminal Colour"
    assert out.doctrine == "quashing — abuse of process"
    assert out.statutory_hook == "Section 482 CrPC"
    assert out.perspective == "petitioner"
