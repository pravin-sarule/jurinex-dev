"""Unit tests for source-document exclusion (FAILURE 2)."""

from __future__ import annotations

import types
import unittest

from models.citation_models import Candidate
from services.exclusion_service import filter_source_documents, title_containment, title_overlap


def _ctx(**kw):
    base = {"run_id": "testrun123456", "excluded_doc_ids": set(), "excluded_titles": [], "case_title": ""}
    base.update(kw)
    return types.SimpleNamespace(**base)


class TestTitleMetrics(unittest.TestCase):
    def test_containment_catches_short_name_in_long_title(self):
        # Uploaded "Lashya Developers" sits inside the full IK cause-title.
        ct = title_containment("M/S Lashya Developers",
                               "M/S Lashya Developers vs The State Of Madhya Pradesh")
        self.assertGreaterEqual(ct, 0.9)

    def test_overlap_symmetric(self):
        self.assertGreater(title_overlap("Tondare vs State of Maharashtra",
                                         "Tondare vs State of Maharashtra"), 0.85)

    def test_unrelated_titles_low(self):
        self.assertLess(title_containment("Lashya Developers",
                                          "Tata Cellular vs Union of India"), 0.9)


class TestFilterSourceDocuments(unittest.TestCase):
    def test_excludes_by_doc_id(self):
        ctx = _ctx(excluded_doc_ids={"12345"})
        cands = [Candidate(doc_id="12345", title="Some Uploaded Case"),
                 Candidate(doc_id="99999", title="A Real Precedent")]
        kept = filter_source_documents(cands, ctx)
        self.assertEqual([c.doc_id for c in kept], ["99999"])

    def test_excludes_uploaded_source_by_title(self):
        # The Lashya / Bundelkhand contamination case.
        ctx = _ctx(excluded_titles=["M/S Lashya Developers.pdf", "Bundelkhand Traders"])
        cands = [
            Candidate(doc_id="1", title="M/S Lashya Developers vs The State Of Madhya Pradesh"),
            Candidate(doc_id="2", title="M/S Bundelkhand Traders vs State Of M.P."),
            Candidate(doc_id="3", title="Tata Cellular vs Union Of India"),
        ]
        kept = filter_source_documents(cands, ctx)
        self.assertEqual([c.doc_id for c in kept], ["3"])

    def test_excludes_case_under_analysis(self):
        ctx = _ctx(case_title="Tondare Constructions vs State of Maharashtra")
        cands = [Candidate(doc_id="1", title="Tondare Constructions vs State of Maharashtra"),
                 Candidate(doc_id="2", title="Reliance Energy vs MSRDC")]
        kept = filter_source_documents(cands, ctx)
        self.assertEqual([c.doc_id for c in kept], ["2"])

    def test_no_registry_keeps_everything(self):
        ctx = _ctx()
        cands = [Candidate(doc_id="1", title="X"), Candidate(doc_id="2", title="Y")]
        self.assertEqual(len(filter_source_documents(cands, ctx)), 2)


if __name__ == "__main__":
    unittest.main()
