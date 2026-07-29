"""Issue source refs ('file, page N') are attributed deterministically by
lexical overlap — never written by the LLM, never invented."""

from schemas import Issue, SourcePage
from tools import attribute_issue_sources, parse_document_pages


def test_issue_attributed_to_best_supporting_page():
    pages = [
        SourcePage(file="MFL_v_Kulkarni.pdf", page=1,
                   text="Reference of the industrial dispute to the Industrial Tribunal."),
        SourcePage(file="MFL_v_Kulkarni.pdf", page=204,
                   text="The union demanded wage revision after expiry of the wage "
                        "agreement; the company failed to provide further wage revision "
                        "to the union after the expiration of the previous agreement."),
    ]
    issues = [Issue(id=1, issue="Whether the company failed to provide further wage "
                                "revision to the union after the expiration of the "
                                "previous agreement.")]
    attribute_issue_sources(issues, pages)
    assert issues[0].source == "MFL_v_Kulkarni.pdf, page 204"


def test_unsupported_issue_keeps_source_none():
    pages = [SourcePage(file="doc.pdf", page=1, text="entirely unrelated boilerplate index page")]
    issues = [Issue(id=1, issue="Whether maintenance under Section 125 CrPC is payable "
                                "to an earning wife unable to sustain herself")]
    attribute_issue_sources(issues, pages)
    assert issues[0].source is None  # no guessed reference, ever


def test_no_pages_is_a_noop():
    issues = [Issue(id=1, issue="Whether the FIR should be quashed")]
    attribute_issue_sources(issues, [])
    assert issues[0].source is None


def test_parse_document_pages_non_pdf_single_page():
    pages = parse_document_pages(b"plain text case note about wage revision", "note.txt")
    assert len(pages) == 1
    assert pages[0].page == 1 and pages[0].file == "note.txt"
