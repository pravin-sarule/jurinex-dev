"""Anti-invention guard: the extraction model can never quietly add
sections/statutes that were not in the source document."""

from schemas import CaseContextDraft
from tools import verify_context_against_source

SOURCE = (
    "FIR No. 212/2023 was registered against the petitioner under Section 420 "
    "and Section 406 of the Indian Penal Code alleging cheating in a property "
    "transaction. The petitioner seeks quashing of the FIR under Section 482 "
    "of the Code of Criminal Procedure. The dispute arises from an agreement "
    "to sell dated 12.03.2022."
)


def test_clean_extraction_passes_with_high_confidence():
    draft = CaseContextDraft(
        parties=[{"role": "petitioner", "name": "A"}, {"role": "respondent", "name": "State"}],
        facts="FIR No. 212/2023 was registered under Section 420 and Section 406 "
              "of the Indian Penal Code over a property transaction.",
        procedural_history="FIR registered; petitioner approached the High Court "
                           "under Section 482 of the Code of Criminal Procedure.",
        relief_sought="Quashing of the FIR.",
        raw_case_summary="Petitioner seeks quashing of FIR under S.482 CrPC.",
    )
    ctx = verify_context_against_source(draft, SOURCE, "petition")
    assert ctx.source_confidence == "high"
    assert ctx.needs_clarification is False
    assert "Section 420" in ctx.facts


def test_invented_section_is_excised_and_confidence_drops():
    draft = CaseContextDraft(
        facts="FIR No. 212/2023 was registered under Section 420 of the Indian "
              "Penal Code over a property transaction; He was also charged under "
              "Section 307 of the Indian Penal Code for attempt to murder.",
        procedural_history="Petitioner approached the High Court under Section 482 "
                           "of the Code of Criminal Procedure.",
        relief_sought="Quashing of the FIR.",
        raw_case_summary="x" * 50,
    )
    ctx = verify_context_against_source(draft, SOURCE, "petition")
    assert "Section 307" not in ctx.facts          # invented — excised
    assert "Section 420" in ctx.facts              # real — kept
    assert ctx.source_confidence in ("medium", "low")


def test_ambiguous_input_triggers_clarification_not_a_guess():
    draft = CaseContextDraft(facts="", relief_sought="", raw_case_summary="")
    ctx = verify_context_against_source(draft, "help with my case", "note")
    assert ctx.needs_clarification is True
    assert ctx.clarification_question  # a specific question, not silence


def test_missing_relief_triggers_clarification():
    draft = CaseContextDraft(
        facts="FIR No. 212/2023 was registered under Section 420 of the Indian "
              "Penal Code alleging cheating in a property transaction.",
        relief_sought="",
        raw_case_summary="FIR under 420 IPC over property deal.",
    )
    ctx = verify_context_against_source(draft, SOURCE, "note")
    assert ctx.needs_clarification is True
    assert "outcome" in (ctx.clarification_question or "").lower()
