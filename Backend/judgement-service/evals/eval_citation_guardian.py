"""
Adversarial eval for the CitationGuardian — fully offline, no model, no
network. Mirrors tests/test_citation_guardian.py so the guardian can be
demonstrated standalone: a fake docId forced into a scored result set
MUST be dropped and logged; a fabricated pinpoint MUST be dropped; a
legitimate set MUST pass unmodified.

Run:  venv\\Scripts\\python.exe -m evals.eval_citation_guardian
"""

import logging
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from schemas import Candidate, ScoredResult, SignalSet  # noqa: E402
from tools import CitationGuardian  # noqa: E402

logging.basicConfig(level=logging.ERROR, format="%(levelname)s %(message)s")
guardian = CitationGuardian()


def scored(doc_id, pinpoint=None):
    return ScoredResult(doc_id=doc_id, score=0.95, band="GREEN", pinpoint=pinpoint,
                        breakdown=SignalSet(semantic_match=0.95, keyword_match=0.9))


def main() -> int:
    failures = 0
    pool = {
        "111": Candidate(doc_id="111", title="Real Case A",
                         doc_text="The FIR discloses no offence. The proceedings are quashed."),
        "222": Candidate(doc_id="222", title="Real Case B"),
    }

    # 1. Fake docId injected — never fetched from IK in this request.
    clean, drops = guardian.verify([scored("111"), scored("424242")], pool)
    ok = [r.doc_id for r in clean] == ["111"] and drops[0]["reason"] == "not_in_fetched_pool"
    print(f"1. fake docId dropped: {'PASS' if ok else 'FAIL'}")
    failures += not ok

    # 2. Real docId, fabricated pinpoint text.
    clean, drops = guardian.verify(
        [scored("111", pinpoint="mens rea is irrelevant to Section 420")], pool)
    ok = clean == [] and drops[0]["reason"] == "pinpoint_not_in_document"
    print(f"2. fabricated pinpoint dropped: {'PASS' if ok else 'FAIL'}")
    failures += not ok

    # 3. Fully legitimate set passes through unmodified.
    legit = [scored("111", pinpoint="The proceedings are quashed"), scored("222")]
    clean, drops = guardian.verify(legit, pool)
    ok = len(clean) == 2 and drops == []
    print(f"3. legitimate set untouched: {'PASS' if ok else 'FAIL'}")
    failures += not ok

    print("ALL PASS" if failures == 0 else f"{failures} FAILURE(S)")
    return failures


if __name__ == "__main__":
    raise SystemExit(main())
