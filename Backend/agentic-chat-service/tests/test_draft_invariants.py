"""Regression harness for the drafting pipeline.

Run on EVERY prompt/rule change, before merge:

    cd Backend/agentic-chat-service && python -m pytest tests/test_draft_invariants.py -q

Two layers:
1. Defect-injection cases — every defect class reviewers ever found, as a
   synthetic fixture that MUST be caught, next to a clean twin that MUST pass.
2. Golden fixtures — anonymized real drafts in tests/golden/*.json
   ({"sections": [...], "digest": "..."}); every invariant must pass on them.
"""
from __future__ import annotations

import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from app.services.draft_invariants import (  # noqa: E402
    ALL_CHECKS,
    check_12a_not_in_cause_of_action,
    check_annexure_series_contiguous,
    check_attestation_dates_order,
    check_attestation_restarts,
    check_chronology_neutral,
    check_interim_relief_coherence,
    check_no_cross_field_literal_collision,
    check_no_notice_in_invoice_table,
    check_prayer_letters_contiguous,
    check_single_exhibit_terminology,
    check_single_mark_per_document,
    check_unique_paragraph_numbers,
    check_verification_matches_statement_of_truth,
    run_all,
)

GOLDEN_DIR = pathlib.Path(__file__).parent / "golden"


def sec(sid, idx, heading, content):
    return {"section_id": sid, "index": idx, "heading": heading, "content": content}


# ── 1. duplicate paragraph numbers ──
def test_duplicate_numbers_caught():
    bad = [sec("a", 0, "FACTS", "11. One.\n12. Two."),
           sec("b", 1, "BREACH", "11. Again.\n12. More.")]
    assert check_unique_paragraph_numbers(bad)
    clean = [sec("a", 0, "FACTS", "1. One.\n2. Two."),
             sec("b", 1, "BREACH", "3. Three.")]
    assert not check_unique_paragraph_numbers(clean)


# ── 2. attestation numbering restarts at 1 ──
def test_attestation_restart():
    bad = [sec("st", 0, "STATEMENT OF TRUTH", "32. I state.\n33. Signed.")]
    assert check_attestation_restarts(bad)
    assert not check_attestation_restarts(
        [sec("st", 0, "STATEMENT OF TRUTH", "1. I state.\n2. Signed.")])


# ── 3. prayer letter gaps ──
def test_prayer_letters():
    bad = [sec("p", 0, "PRAYER", "(a) decree;\n(b) interest;\n(g) costs;\n(k) omnibus.")]
    assert check_prayer_letters_contiguous(bad)
    assert not check_prayer_letters_contiguous(
        [sec("p", 0, "PRAYER", "(a) decree;\n(b) interest;\n(c) costs.")])


# ── 4. annexure gaps / terminology / duplicate marks ──
def test_annexure_series():
    bad = [sec("a", 0, "FACTS", "See ANNEXURE P-1 and ANNEXURE P-3 and ANNEXURE P-5.")]
    assert check_annexure_series_contiguous(bad)
    assert not check_annexure_series_contiguous(
        [sec("a", 0, "FACTS", "See ANNEXURE P-1 and ANNEXURE P-2.")])


def test_mixed_terminology():
    bad = [sec("a", 0, "FACTS", "the said notice (ANNEXURE P-1); the invoice (Exhibit P-2)")]
    assert check_single_exhibit_terminology(bad)


def test_same_document_two_marks():
    bad = [sec("a", 0, "FACTS",
               "Invoice No. NEX/INV/2025/26/041 (ANNEXURE P-3) was raised."),
           sec("b", 1, "TABLE",
               "| Invoice No. NEX/INV/2025/26/041 | ANNEXURE P-14 |")]
    assert check_single_mark_per_document(bad)
    clean = [sec("a", 0, "FACTS",
                 "Invoice No. NEX/INV/2025/26/041 (ANNEXURE P-3); later the said invoice (ANNEXURE P-3).")]
    assert not check_single_mark_per_document(clean)


# ── 5. legal notice in invoice table ──
def test_notice_in_invoice_table():
    bad = [sec("t", 0, "7. INVOICES", "\n".join([
        "| Invoice No. | Date | Amount |",
        "|---|---|---|",
        "| 041 | 12-Feb-2025 | 15,04,500 |",
        "| Legal Notice dated 25-Jul-2025 | 25-Jul-2025 | 35,10,500 |",
    ]))]
    assert check_no_notice_in_invoice_table(bad)
    clean = [sec("t", 0, "7. INVOICES", "\n".join([
        "| Invoice No. | Date | Amount |",
        "|---|---|---|",
        "| 041 | 12-Feb-2025 | 15,04,500 |",
    ]))]
    assert not check_no_notice_in_invoice_table(clean)


# ── 6. 12A as cause-of-action accrual ──
def test_12a_placement():
    bad = [sec("c", 0, "LIMITATION AND CAUSE OF ACTION",
               "4.2. The cause of action further arose on 22 October 2025 when the "
               "Section 12A mediation was declared a non-starter.")]
    assert check_12a_not_in_cause_of_action(bad)
    ok = [sec("c", 0, "LIMITATION AND CAUSE OF ACTION",
              "4.3. The period of mediation under Section 12A(3) is liable to be "
              "excluded for computing limitation.")]
    assert not check_12a_not_in_cause_of_action(ok)


# ── 7. interim-relief contradiction ──
def test_interim_relief():
    bad = [sec("a", 0, "NECESSITY", "22. No urgent interim relief is being sought at this stage."),
           sec("b", 1, "INTERIM", "23. The Defendant is attempting to defeat the decree; "
                                  "a Court Receiver and attachment before judgment are warranted.")]
    assert check_interim_relief_coherence(bad)
    clean = [sec("a", 0, "NECESSITY", "22. No urgent interim relief is being sought at this "
                                      "stage, with liberty to apply.")]
    assert not check_interim_relief_coherence(clean)


# ── 8. verification ↔ statement of truth ──
def test_attestation_mirroring():
    bad = [sec("v", 0, "VERIFICATION", "paragraphs 1 to 5 are true to my personal knowledge and "
                                       "paragraphs 6 to 30 on legal advice."),
           sec("s", 1, "STATEMENT OF TRUTH", "paragraphs 1 to 8 are from business records and "
                                             "paragraphs 9 to 30 on legal advice.")]
    assert check_verification_matches_statement_of_truth(bad)


# ── 9. attestation dated before its documents ──
def test_attestation_date_order():
    digest = "| 1. | 15-Jan-2026 | BSA Certificate issued |"
    bad = [sec("v", 0, "VERIFICATION", "Verified at Nagpur on this 5th day of January, 2026.")]
    assert check_attestation_dates_order(bad, digest)
    ok = [sec("v", 0, "VERIFICATION", "Verified at Nagpur on this 20th day of January, 2026.")]
    assert not check_attestation_dates_order(ok, digest)


# ── 10. chronology neutrality ──
def test_chronology_neutral():
    bad = [sec("d", 0, "LIST OF DATES AND EVENTS",
               "| 05-Aug-2025 | Reply denying liability based on vague and unsubstantiated allegations |")]
    assert check_chronology_neutral(bad)


# ── golden fixtures (anonymized real drafts) ──
def test_golden_fixtures():
    if not GOLDEN_DIR.exists():
        return
    for path in sorted(GOLDEN_DIR.glob("*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        card = run_all(data.get("sections", []), data.get("digest", ""))
        assert card["checks_failed"] == 0, f"{path.name}: {card['issues']}"


def test_one_document_per_mark():
    from app.services.draft_invariants import check_one_document_per_mark
    bad = [sec("s", 0, "FACTS",
               "The Board Resolution is annexed hereto and marked as ANNEXURE P-1. "
               "The Registration Certificate is annexed hereto and marked as ANNEXURE P-1. "
               "The Agreement is annexed hereto and marked as ANNEXURE P-2.")]
    issues = check_one_document_per_mark(bad)
    assert issues and "P-1" in issues[0]
    ok = [sec("s", 0, "FACTS",
              "The Board Resolution is annexed hereto and marked as ANNEXURE P-1. "
              "The Agreement is annexed hereto and marked as ANNEXURE P-2.")]
    assert not check_one_document_per_mark(ok)
    colly = [sec("s", 0, "FACTS",
                 "Invoices marked as ANNEXURE P-1 (Colly). Ledger marked as ANNEXURE P-1 (Colly).")]
    assert not check_one_document_per_mark(colly)


def test_registry_complete():
    assert len(ALL_CHECKS) >= 15
    assert "no_cross_field_literal_collision" in ALL_CHECKS


# ── Nexora Infotech v. Aarav Retail Solutions — known hallucination classes ──
# Synthetic digest + known-bad draft fragments. Confirms Stage-4 / invariant
# gates catch the four defect classes that slipped through on the real fixture.

_NEXORA_DIGEST = """
PARTIES —
Nexora Infotech Private Limited, Plaintiff
- Law of Incorporation: Companies Act, 2013
- Date of Incorporation: 18 September 2020
- CIN: U72900PN2020PTC123456
Aarav Retail Solutions Private Limited, Defendant
- Law of Incorporation: Companies Act, 2013
- Date of Incorporation: 05 March 2018
- CIN: U52100PN2018PTC654321

AMOUNTS —
Invoice INV/2025/041 dated 04-May-2025, due 04-Jun-2025: Rs. 20,06,000 [Source: inv041.pdf]
Invoice INV/2025/058 dated 10-Jun-2025, due 10-Jul-2025: Rs. 15,04,500 [Source: inv058.pdf]

DOCUMENT REFERENCES —
Master Services Agreement dated 12-Feb-2025 [Source: msa.pdf]
Company Registration Details of Plaintiff [Source: pl_reg.pdf]
UAT acceptance email dated 30-Apr-2025 — Phase I acceptance [Source: uat.pdf]
Deployment confirmation dated 01-Jul-2025 — ERP go-live logs [Source: deploy.pdf]
Legal notice dated 15-Aug-2025 demanding payment [Source: notice.pdf]

TERMS AND CONDITIONS —
Interest at 18% p.a. on overdue invoices from each invoice's due date.

ADMISSIONS AND DENIALS —
Defendant acknowledged the Agreement and invoices but denied liability to pay.
"""


def test_nexora_companies_act_year_wrong_caught():
    """Companies Act year pulled from Date of Incorporation (2020/2018) not Act (2013)."""
    from app.services.draft_invariants import check_no_cross_field_literal_collision
    bad = [sec("p", 0, "PARTIES",
               "The Plaintiff is a company incorporated under the Companies Act, 2020.\n"
               "The Defendant is a company incorporated under the Companies Act, 2018.")]
    issues = check_no_cross_field_literal_collision(bad, _NEXORA_DIGEST)
    assert issues, "field-swap Companies Act year must be caught"
    assert any("2020" in i or "2018" in i for i in issues)


def test_nexora_companies_act_year_fixed_deterministically():
    from app.services.draft_provenance import fix_cross_field_act_years
    text = (
        "The Plaintiff is a company incorporated under the Companies Act, 2020. "
        "The Defendant is a company incorporated under the Companies Act, 2018."
    )
    fixed, swaps = fix_cross_field_act_years(text, _NEXORA_DIGEST)
    assert swaps
    assert "Companies Act, 2013" in fixed
    assert "Companies Act, 2020" not in fixed
    assert "Companies Act, 2018" not in fixed


def test_nexora_exhibit_p2_dual_use_caught():
    """Same mark P-2 used for Agreement and Company Registration."""
    from app.services.draft_invariants import check_one_document_per_mark
    bad = [sec("f", 0, "FACTS",
               "The Master Services Agreement is annexed hereto and marked as ANNEXURE P-2. "
               "The Company Registration Details are annexed hereto and marked as ANNEXURE P-2.")]
    issues = check_one_document_per_mark(bad)
    assert issues and "P-2" in issues[0]


def test_nexora_unsupported_interim_relief_caught():
    """Body declines interim relief but also argues asset alienation / attachment."""
    bad = [sec("i", 0, "INTERIM RELIEF",
               "No interim relief is sought at this stage, with liberty to apply.\n"
               "However, the Defendant is likely to alienate its assets to defeat the decree "
               "and attachment before judgment is necessary.")]
    assert check_interim_relief_coherence(bad)


def test_nexora_blended_interest_detectable_via_pairing_table():
    """Interest pairing table must list per-invoice from-dates, not a single blend."""
    from app.services.draft_provenance import build_interest_pairing_table
    table = build_interest_pairing_table(_NEXORA_DIGEST)
    assert "INTEREST PAIRING TABLE" in table
    assert "20,06,000" in table
    assert "15,04,500" in table
    # Both due dates present — model must not blend onto earliest alone
    assert "04-Jun-2025" in table or "04-Jun" in table
    assert "10-Jul-2025" in table or "10-Jul" in table


def test_nexora_provenance_rejects_wrong_act_year():
    """Extractor invents 'Companies Act, 2020' citing a source that only has 2013."""
    from app.services.draft_provenance import _value_in_source
    source = (
        "Law of Incorporation: Companies Act, 2013\n"
        "Date of Incorporation: 18 September 2020\n"
        "CIN: U72900PN2020PTC123456\n"
    )
    assert _value_in_source("Companies Act, 2013", source)
    assert not _value_in_source("Companies Act, 2020", source)


def test_provenance_verify_drops_bad_line():
    from app.services.draft_provenance import verify_fact_provenance
    # Simulate docs with in-memory text via monkeypatch of _doc_texts_by_name
    digest = (
        "PARTIES —\n"
        "Plaintiff under Companies Act, 2013 [Source: reg.pdf]\n"
        "Plaintiff under Companies Act, 2020 [Source: reg.pdf]\n"
        "Nature of Business: IT services and software [Source: reg.pdf]\n"
    )
    import app.services.draft_provenance as prov
    original = prov._doc_texts_by_name
    prov._doc_texts_by_name = lambda docs: {
        "reg.pdf": "Law of Incorporation: Companies Act, 2013\nDate of Incorporation: 18 September 2020\n"
    }
    try:
        cleaned, flags = verify_fact_provenance(digest, [{"name": "reg.pdf", "gcs_path": "x"}])
    finally:
        prov._doc_texts_by_name = original
    assert flags and any("2020" in f.get("value", "") for f in flags)
    assert "Companies Act, 2020" not in cleaned
    assert "Companies Act, 2013" in cleaned
    # Soft-keep: paraphrased business line is retained (not hard-dropped)
    assert "Nature of Business: IT services" in cleaned
    soft = [f for f in flags if f.get("flag") == "UNVERIFIED_PROVENANCE_SOFT"]
    assert soft


def test_field_coverage_checklist_lists_party_fields():
    from app.services.draft_provenance import build_field_coverage_checklist
    digest = (
        "PARTIES —\n"
        "- Full Name: Nexora Infotech Private Limited\n"
        "- Registered Office Address: 12 MG Road, Pune 411001\n"
        "- Nature of Business: IT consulting and software development\n"
        "- CIN: U72900PN2020PTC123456\n"
        "- GSTIN: 27AABCN1234A1Z5\n"
        "- Law of Incorporation / Act: Companies Act, 2013\n"
        "- Date of Incorporation: 18 September 2020\n"
        "AMOUNTS —\n"
        "- Invoice INV-001 dated 01-Jan-2024 for Rs. 5,00,000 unpaid\n"
    )
    checklist = build_field_coverage_checklist(digest)
    assert "FIELD COVERAGE CHECKLIST" in checklist
    assert "Nexora Infotech" in checklist
    assert "U72900PN2020PTC123456" in checklist
    assert "27AABCN1234A1Z5" in checklist
    assert "Companies Act, 2013" in checklist
    assert "5,00,000" in checklist


if __name__ == "__main__":
    import inspect
    failed = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and inspect.isfunction(fn):
            try:
                fn()
                print(f"PASS {name}")
            except AssertionError as exc:
                failed += 1
                print(f"FAIL {name}: {exc}")
    raise SystemExit(1 if failed else 0)
