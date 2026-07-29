"""
Adversarial tests for the CitationGuardian (spec Section 12).

These exist to prove the closed-world citation rule is mechanically
enforced: a docId that was never fetched from Indian Kanoon in this
request can NEVER reach a response, and neither can a pinpoint that is
not literally present in the fetched document text.
"""

import logging

from schemas import Candidate, ScoredResult, SignalSet
from tools import CitationGuardian

guardian = CitationGuardian()


def _candidate(doc_id: str, doc_text: str | None = None) -> Candidate:
    return Candidate(doc_id=doc_id, title=f"Case {doc_id}", court="Supreme Court of India",
                     year=2019, headline="quashing of FIR", doc_text=doc_text)


def _scored(doc_id: str, pinpoint: str | None = None) -> ScoredResult:
    return ScoredResult(doc_id=doc_id, score=0.9, band="GREEN",
                        breakdown=SignalSet(semantic_match=0.9, keyword_match=0.8),
                        pinpoint=pinpoint)


def test_fake_doc_id_is_dropped_and_logged(caplog):
    """Inject a docId that was never in the fetched candidate pool —
    it must be dropped, no matter how high its score."""
    pool = {"111": _candidate("111"), "222": _candidate("222")}
    results = [_scored("111"), _scored("999999")]  # 999999 was never fetched

    with caplog.at_level(logging.ERROR):
        clean, drops = guardian.verify(results, pool)

    assert [r.doc_id for r in clean] == ["111"]
    assert drops == [{"docId": "999999", "reason": "not_in_fetched_pool"}]
    assert any("999999" in record.message for record in caplog.records)


def test_pinpoint_not_in_document_is_dropped():
    """Real docId, but the cited pinpoint paragraph does not appear in the
    fetched document text — must be dropped."""
    pool = {
        "111": _candidate("111", doc_text="The FIR discloses no cognizable offence. "
                                          "The proceedings are hereby quashed."),
    }
    fabricated = "The Court held that mens rea is entirely irrelevant to Section 420."
    clean, drops = guardian.verify([_scored("111", pinpoint=fabricated)], pool)

    assert clean == []
    assert drops == [{"docId": "111", "reason": "pinpoint_not_in_document"}]


def test_pinpoint_against_missing_doc_text_is_dropped():
    """A pinpoint can only be trusted if we hold the fetched text it came
    from. No text → no pinpoint → drop."""
    pool = {"111": _candidate("111", doc_text=None)}
    clean, drops = guardian.verify([_scored("111", pinpoint="some paragraph")], pool)

    assert clean == []
    assert drops[0]["reason"] == "pinpoint_not_in_document"


def test_legitimate_results_pass_unmodified():
    text = ("1. The complaint arises from a commercial transaction. "
            "34. Criminal proceedings cannot be used as a shortcut for civil recovery. "
            "The petition is allowed and the FIR is quashed.")
    pool = {"111": _candidate("111", doc_text=text), "222": _candidate("222")}
    results = [
        _scored("111", pinpoint="Criminal proceedings cannot be used as a shortcut"),
        _scored("222"),  # no pinpoint claimed — existence check only
    ]
    clean, drops = guardian.verify(results, pool)

    assert drops == []
    assert [r.doc_id for r in clean] == ["111", "222"]
    assert clean[0].pinpoint == "Criminal proceedings cannot be used as a shortcut"


def test_pinpoint_match_is_whitespace_tolerant_but_content_exact():
    pool = {"111": _candidate("111", doc_text="The  FIR\n\nis   quashed accordingly.")}
    clean, drops = guardian.verify([_scored("111", pinpoint="The FIR is quashed")], pool)
    assert drops == []
    assert len(clean) == 1
