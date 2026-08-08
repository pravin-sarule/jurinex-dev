"""Anti-invention guard for the issues/grounds stage: provisions and case law
the case material does not contain are struck (high-precision, one-way —
unparseable references are never struck)."""

from schemas import Issue
from tools import verify_issues_against_source

SOURCE = ("FIR registered under Section 420 and Section 34 of the Indian Penal "
          "Code. The applicants rely on the agreement and cite State of Haryana "
          "v. Bhajan Lal in the application. Recovery suit under Order 37.")


def test_supported_references_survive():
    issue = Issue(id=1, issue="Whether the FIR is liable to be quashed?",
                  statutory_hook="Section 420 IPC",
                  legal_framework=["Section 34 Indian Penal Code"],
                  case_law_cited=["State of Haryana v. Bhajan Lal"])
    notes = verify_issues_against_source([issue], SOURCE)
    assert notes == []
    assert issue.statutory_hook == "Section 420 IPC"
    assert issue.legal_framework == ["Section 34 Indian Penal Code"]
    assert issue.case_law_cited == ["State of Haryana v. Bhajan Lal"]


def test_invented_provision_and_case_law_struck():
    issue = Issue(id=2, issue="Whether bail should be granted?",
                  title="Invented Ground",
                  statutory_hook="Section 999 Companies Act",
                  legal_framework=["Section 420 IPC", "Section 777 Evidence Act"],
                  case_law_cited=["Gian Singh v. State of Punjab"])
    notes = verify_issues_against_source([issue], SOURCE)
    assert issue.statutory_hook is None            # invented hook blanked
    assert issue.legal_framework == ["Section 420 IPC"]  # invented entry dropped
    assert issue.case_law_cited == []              # uncited authority dropped
    assert len(notes) == 3
    assert any("999" in n for n in notes)


def test_ocr_spaced_section_is_not_struck():
    # OCR writes 'Section 260 A (2)(a)'; the extractor writes 'Section
    # 260A(2)(a)' — squashed comparison must treat them as the same provision.
    source = ("Appeal under Section 260 A (2)(a) of the Income Tax Act, 1961 "
              "before this Hon'ble Court.")
    issue = Issue(id=4, issue="Whether the appeal is maintainable?",
                  statutory_hook="Section 260A(2)(a) of the Income Tax Act, 1961")
    notes = verify_issues_against_source([issue], source)
    assert issue.statutory_hook is not None
    assert notes == []


def test_abbreviated_act_names_survive():
    # The draft cites 'Section 528 of B.N.S.S.' — the extractor expands the
    # act name. The section number must carry the hook, and the acronym must
    # carry the act-only framework entry.
    source = ("CRIMINAL APPLICATION under Section 528 of B.N.S.S. for quashing "
              "of FIR No. 274/2024.")
    issue = Issue(id=5, issue="Whether the FIR is liable to be quashed?",
                  statutory_hook="Section 528 of Bharatiya Nagarik Suraksha Sanhita 2023",
                  legal_framework=["Bharatiya Nagarik Suraksha Sanhita 2023"])
    notes = verify_issues_against_source([issue], source)
    assert issue.statutory_hook is not None
    assert issue.legal_framework == ["Bharatiya Nagarik Suraksha Sanhita 2023"]
    assert notes == []


def test_unparseable_reference_is_never_struck():
    # "Order 37" carries no Section/Act pattern — the guard must keep it
    # (one-way precision: never delete what it cannot positively disprove).
    issue = Issue(id=3, issue="Whether leave to defend should be refused?",
                  statutory_hook="Order 37 CPC")
    notes = verify_issues_against_source([issue], SOURCE)
    assert issue.statutory_hook == "Order 37 CPC"
    assert notes == []
