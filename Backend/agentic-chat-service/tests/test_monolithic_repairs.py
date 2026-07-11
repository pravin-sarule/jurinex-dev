"""Unit tests for monolithic deterministic repair helpers."""
from __future__ import annotations

import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from app.services.draft_repairs import (  # noqa: E402
    _dedupe_cause_title,
    _fix_admitted_dues_wording,
    _fix_deponent_age_placeholder,
    _fix_proceedings_placeholder,
    _merge_chronology_from_digest,
    _narrow_slash_option_menus,
    _polish_exhibit_citations,
    _rebuild_list_of_documents,
    _resolve_remaining_placeholders,
    _sanitize_statute_years,
    _strip_prayer_placeholders,
)
from app.services.draft_invariants import (  # noqa: E402
    check_caption_duplication,
    check_relief_has_placeholders,
    check_slash_option_menu_unnarrowed,
    check_unsafe_admissions,
)


def test_dedupe_cause_title_removes_double_versus():
    text = (
        "IN THE COURT AT PUNE\n"
        "Alpha Pvt Ltd\nPlaintiff\n"
        "VERSUS\n"
        "Beta Ltd\nDefendant\n"
        "VERSUS\n"
        "Alpha Pvt Ltd\nPlaintiff\n"
        "1. Facts begin."
    )
    out, changed = _dedupe_cause_title(text)
    assert changed
    assert out.count("VERSUS") == 1
    assert "1. Facts begin." in out


def test_narrow_slash_option_menu():
    text = (
        "RECOVERY OF MONEY / DAMAGES / DECLARATION / INJUNCTION / SPECIFIC PERFORMANCE\n"
        "1. Facts.\n"
        "PRAYER\n"
        "(a) decree for Rs. 10,00,000;\n"
        "(b) interest;\n"
        "(c) costs."
    )
    out, changed = _narrow_slash_option_menus(text)
    assert changed
    assert "DAMAGES" not in out.split("PRAYER")[0]


def test_narrow_slash_option_menu_keeps_used_segment():
    text = (
        "WRIT OF MANDAMUS / CERTIORARI / HABEAS CORPUS\n"
        "1. Facts.\n"
        "PRAYER\n"
        "(a) issue a writ of mandamus;\n"
        "(b) costs."
    )
    out, changed = _narrow_slash_option_menus(text)
    # mandamus appears in prayer — certiorari/habeas should be dropped if not in prayer
    assert "MANDAMUS" in out.split("PRAYER")[0]
    assert "HABEAS" not in out.split("PRAYER")[0] or not changed


def test_narrow_multiline_slash_title_like_template():
    """Template titles wrap across lines — must still narrow to money recovery."""
    text = (
        "PLAINT UNDER ORDER VII OF THE CODE OF CIVIL\n"
        "PROCEDURE, 1908 READ WITH SECTION 2(1)(C) AND\n"
        "OTHER APPLICABLE PROVISIONS OF THE COMMERCIAL\n"
        "COURTS ACT, 2015 FOR RECOVERY OF MONEY / DAMAGES\n"
        "/ DECLARATION / INJUNCTION / SPECIFIC PERFORMANCE\n"
        "/ OTHER COMMERCIAL RELIEFS\n\n"
        "1. The Plaintiff claims unpaid invoices.\n\n"
        "PRAYER\n"
        "(a) decree for the principal amount;\n"
        "(b) interest at 18% p.a.;\n"
        "(c) costs.\n"
    )
    digest = "AMOUNTS — Invoice unpaid Rs. 20,06,000\nADMISSIONS AND DENIALS — Defendant denied liability"
    out, changed = _narrow_slash_option_menus(
        text, facts_digest=digest,
        user_instructions="Commercial suit for recovery of money only",
    )
    assert changed
    head = out.split("PRAYER")[0].upper()
    assert "RECOVERY OF MONEY" in head
    assert "OTHER COMMERCIAL" not in head
    assert "DECLARATION" not in head
    assert "SPECIFIC PERFORMANCE" not in head


def test_strip_prayer_placeholders():
    text = (
        "PRAYER\n"
        "(a) decree;\n"
        "(b) damages of [DATA NOT PROVIDED: Damages Amount];\n"
        "(c) costs.\n"
        "VERIFICATION"
    )
    out, removed = _strip_prayer_placeholders(text)
    assert removed == ["b"]
    assert "DATA NOT PROVIDED" not in out
    assert "(b) costs" in out


def test_fix_admitted_dues_when_liability_denied():
    digest = "ADMISSIONS — Defendant denied liability to pay the invoices."
    text = "The Defendant admitted dues of Rs. 10,00,000."
    out, changed = _fix_admitted_dues_wording(text, digest)
    assert changed
    assert "outstanding dues" in out.lower()


def test_sanitize_statute_year():
    digest = "Plaintiff incorporated under the Companies Act, 2013."
    text = "Plaintiff is a company under the Companies Act, 2020."
    out, changed = _sanitize_statute_years(text, digest)
    assert changed
    assert "Companies Act, 2013" in out
    assert "2020" not in out


def test_fix_proceedings_placeholder():
    text = "There are no other proceedings save and except [particulars, if any]."
    out, changed = _fix_proceedings_placeholder(text)
    assert changed
    assert "[particulars" not in out.lower()


def test_fix_deponent_age_placeholder():
    text = "I, John Doe, aged [DATA NOT PROVIDED: Deponent Age], state that…"
    out, changed = _fix_deponent_age_placeholder(text)
    assert changed
    assert "DATA NOT PROVIDED" not in out


def test_invariant_relief_placeholders():
    bad = [{"section_id": "p", "index": 0, "heading": "PRAYER",
            "content": "(a) decree;\n(b) [DATA NOT PROVIDED: x];"}]
    assert check_relief_has_placeholders(bad)


def test_invariant_unsafe_admissions():
    digest = "Defendant denied liability in the reply."
    bad = [{"section_id": "f", "index": 0, "heading": "FACTS",
            "content": "admitted dues of Rs. 1."}]
    assert check_unsafe_admissions(bad, digest)


def test_invariant_caption_dup():
    bad = [{"section_id": "c", "index": 0, "heading": "CAUSE TITLE",
            "content": "A\nVERSUS\nB\nVERSUS\nA"}]
    assert check_caption_duplication(bad)


def test_merge_chronology_adds_missing_rows():
    digest = (
        "| S.No | Date | Particulars |\n|:-----|:-----|:------------|\n"
        "| 1. | 12-Feb-2025 | Advance invoice issued |\n"
        "| 2. | 30-Apr-2025 | Phase I completion |\n"
        "| 3. | 05-Jan-2026 | Board Resolution passed |\n"
    )
    text = (
        "LIST OF DATES AND EVENTS\n"
        "| S.No | Date | Particulars |\n"
        "|:-----|:-----|:------------|\n"
        "| 1. | 12-Feb-2025 | Advance invoice issued |\n"
        "1. Facts follow."
    )
    out, added = _merge_chronology_from_digest(text, digest)
    assert 2 in added and 3 in added
    assert "30-Apr-2025" in out
    assert "05-Jan-2026" in out


def test_rebuild_list_of_documents():
    text = (
        "body text … marked as ANNEXURE P-1\n"
        "later … marked as ANNEXURE P-2\n"
        "LIST OF DOCUMENTS\n"
        "| S.No | Document | Status |\n"
        "|:-----|:---------|:-------|\n"
        "| 1 | Agreement | Filed herewith |\n"
        "VERIFICATION"
    )
    out, changed = _rebuild_list_of_documents(text)
    assert changed
    assert "ANNEXURE P-1" in out
    assert "ANNEXURE P-2" in out
    assert "Filed herewith" not in out.split("LIST OF DOCUMENTS")[1].split("VERIFICATION")[0]


def test_resolve_placeholders_from_digest():
    digest = "PARTIES — Plaintiff registered office at 123 MG Road, Pune."
    text = "having its office at [DATA NOT PROVIDED: registered office address]."
    out, n = _resolve_remaining_placeholders(text, digest)
    assert n >= 1
    assert "DATA NOT PROVIDED" not in out


def test_polish_exhibit_citations():
    digest = "DOCUMENT REFERENCES — Invoice No. INV/2025/041 dated 04-Jun-2025"
    text = "The Plaintiff raised Invoice No. INV/2025/041 for services."
    reg = [{"mark": "P-3", "desc": "Invoice No. INV/2025/041 dated 04-Jun-2025"}]
    out, n = _polish_exhibit_citations(text, digest, reg)
    assert n >= 1
    assert "ANNEXURE P-3" in out


def test_invariant_slash_menu():
    secs = [
        {"section_id": "c", "index": 0, "heading": "CAUSE TITLE",
         "content": "RECOVERY OF MONEY / DAMAGES / DECLARATION / INJUNCTION"},
        {"section_id": "p", "index": 1, "heading": "PRAYER",
         "content": "(a) decree for principal;\n(b) interest;\n(c) costs."},
    ]
    assert check_slash_option_menu_unnarrowed(secs)


def test_factual_strength_lint_missing_amount():
    from app.services.draft_repairs import _factual_strength_lint
    digest = (
        "AMOUNTS —\nRs. 20,06,000 for Phase I invoice [Source: inv.pdf]\n"
        "| 1. | 12-Feb-2025 | Advance paid |\n"
    )
    text = "The Plaintiff claims money. No figures stated."
    issues = _factual_strength_lint(text, digest)
    assert issues


def test_factual_strength_lint_missing_party_fields():
    from app.services.draft_repairs import _factual_strength_lint
    digest = (
        "PARTIES —\n"
        "- Full Name: Nexora Infotech Private Limited\n"
        "- Registered Office Address: 12 MG Road, Pune 411001\n"
        "- Nature of Business: IT consulting and software development\n"
        "- CIN: U72900PN2020PTC123456\n"
        "- GSTIN: 27AABCN1234A1Z5\n"
        "- Law of Incorporation / Act: Companies Act, 2013\n"
        "AMOUNTS —\n"
        "Rs. 5,00,000 unpaid\n"
    )
    # Draft has party name + amount but drops address / GSTIN / nature / Act
    text = (
        "Nexora Infotech Private Limited is the Plaintiff. "
        "CIN U72900PN2020PTC123456. Claim for Rs. 5,00,000."
    )
    issues = _factual_strength_lint(text, digest)
    quotes = " | ".join(i.quote for i in issues)
    assert "GSTIN" in quotes or "27AABCN1234A1Z5" in quotes
    assert "Nature of Business" in quotes or "IT consulting" in quotes
    assert "Registered Office" in quotes or "MG Road" in quotes


def test_strip_inventory_source_mentions():
    from app.services.draft_repairs import _strip_inventory_source_mentions
    text = (
        "The Plaintiff is Nexora Infotech [Source: reg.pdf], CIN U72900PN2020PTC123456 "
        "(Source: master_data.docx). The notice dated 01-Jan-2024 (notice.pdf) was served."
    )
    cleaned, n = _strip_inventory_source_mentions(text)
    assert n >= 2
    assert "[Source:" not in cleaned
    assert "(Source:" not in cleaned
    assert "(notice.pdf)" not in cleaned
    assert "Nexora Infotech" in cleaned
    assert "CIN U72900PN2020PTC123456" in cleaned
    prose = "The claim arises from the document dated 01-Jan-2024."
    cleaned2, n2 = _strip_inventory_source_mentions(prose)
    assert n2 == 0
    assert cleaned2 == prose


def test_restart_inline_attestation_numbering():
    from app.services.draft_repairs import _restart_inline_attestation_numbering
    text = (
        "48. The Plaintiff claims costs.\n\n"
        "STATEMENT OF TRUTH\n\n"
        "49. I am the deponent.\n"
        "50. The facts in paragraphs 1 to 48 are true.\n\n"
        "Place: ____\n"
    )
    out, changed = _restart_inline_attestation_numbering(text)
    assert changed
    assert "49." not in out.split("STATEMENT OF TRUTH", 1)[1]
    assert re.search(r"(?m)^1\.\s+I am the deponent", out)
    assert re.search(r"(?m)^2\.\s+The facts", out)
    assert "48. The Plaintiff claims costs." in out


def test_fix_unsupported_authorized_signatory():
    from app.services.draft_repairs import _fix_unsupported_authorized_signatory
    digest = (
        "PARTIES —\n"
        "- Full Name: Nexora Infotech Private Limited\n"
        "- Authorized Signatory Name: REQUIRED-BUT-ABSENT\n"
        "Kavya Mehta – Head – Digital Transformation of the Defendant\n"
    )
    text = (
        "The Plaintiff is represented by Kavya Mehta, the authorized signatory of the "
        "Plaintiff, who is conversant with the facts."
    )
    out, changed = _fix_unsupported_authorized_signatory(text, digest)
    assert changed
    assert "authorized signatory" not in out.lower()
    assert "Head – Digital Transformation" in out or "representative" in out.lower()


def test_fix_overstated_defendant_reply():
    from app.services.draft_repairs import _fix_overstated_defendant_reply
    digest = "ADMISSIONS AND DENIALS — Defendant denied liability and disputed the claim."
    text = (
        "The Defendant admitted the dues and admitted its liability vide reply dated "
        "01-Mar-2025."
    )
    out, changed = _fix_overstated_defendant_reply(text, digest)
    assert changed
    assert "admitted the dues" not in out.lower()
    assert "admitted its liability" not in out.lower()


def test_rebuild_lod_adds_company_registration():
    from app.services.draft_repairs import _rebuild_list_of_documents
    text = (
        "The Agreement is marked as ANNEXURE P-1.\n\n"
        "LIST OF DOCUMENTS\n\n"
        "| S.No | Particulars | Annexure | Status |\n"
        "|:-----|:------------|:---------|:-------|\n"
        "| 1 | Agreement | ANNEXURE P-1 | Annexed herewith |\n"
    )
    digest = (
        "DOCUMENT REFERENCES —\n"
        "- Master Service Agreement dated 01-Jan-2024\n"
        "- Company Registration / Certificate of Incorporation of the Plaintiff\n"
        "TERMS AND CONDITIONS —\n"
        "- Interest 18% p.a.\n"
    )
    out, changed = _rebuild_list_of_documents(text, digest)
    assert changed
    assert re.search(r"Company Registration|Certificate of Incorporation|Incorporation", out, re.I)


def test_placeholders_neutralized_to_blank():
    from app.services.draft_repairs import _resolve_remaining_placeholders
    text = "having its office at [DATA NOT PROVIDED: registered office address]."
    out, n = _resolve_remaining_placeholders(text, "")
    assert n >= 1
    assert "DATA NOT PROVIDED" not in out
    assert "____" in out


def test_strip_markdown_atx_headings():
    from app.services.draft_facts import _strip_markdown_artifacts
    from app.services.drafting_service import _strip_section_markers
    text = (
        "# IN THE COURT OF THE DISTRICT JUDGE (COMMERCIAL COURT) AT PUNE\n"
        "### COMMERCIAL SUIT NO. _____ OF 2026\n"
        "IN THE MATTER OF:\n"
    )
    out = _strip_markdown_artifacts(text)
    assert not out.lstrip().startswith("#")
    assert "###" not in out
    assert "IN THE COURT OF THE DISTRICT JUDGE" in out
    assert "COMMERCIAL SUIT NO." in out
    assert _strip_section_markers(text) == out


def test_remove_internal_note_paragraph():
    from app.services.draft_repairs import _remove_internal_note_paragraphs
    text = (
        "21. The Plaintiff claims the outstanding amount.\n\n"
        "22. [Internal Note: Drafter should verify annexure marks before filing.]\n\n"
        "23. No interim relief is sought at this stage.\n"
    )
    out, removed = _remove_internal_note_paragraphs(text)
    assert removed == [22]
    assert "Internal Note" not in out
    assert "21. The Plaintiff" in out
    assert "23. No interim relief" in out


def test_remove_corrupted_paragraph_table():
    from app.services.draft_repairs import _remove_corrupted_tables
    text = (
        "24. The particulars of claim are as under:\n\n"
        "| Particulars | Amount |\n"
        "|-------------|--------|\n"
        "|-------------|--------|\n"
        "| ---------------- | ------ |\n"
        "| --- | --- | --- | --- |\n\n"
        "25. Cause of action arose at Pune.\n"
    )
    out, n = _remove_corrupted_tables(text)
    assert n >= 1
    assert "-------------" not in out
    assert "24. The particulars" in out
    assert "25. Cause of action" in out


def test_renumber_body_after_gap():
    from app.services.draft_repairs import _renumber_body_paragraphs_continuous
    text = (
        "1. Parties.\n\n"
        "2. Facts.\n\n"
        "5. Jurisdiction.\n\n"
        "8. Limitation.\n\n"
        "PRAYER\n"
        "(a) decree;\n"
    )
    out, changed = _renumber_body_paragraphs_continuous(text)
    assert changed
    assert "1. Parties." in out
    assert "2. Facts." in out
    assert "3. Jurisdiction." in out
    assert "4. Limitation." in out
    assert "5. Jurisdiction." not in out


def test_rebuild_verification_ranges():
    from app.services.draft_repairs import _rebuild_verification_and_sot
    text = (
        "1. The Plaintiff is a company.\n\n"
        "2. Invoice INV-1 for Rs. 10,00,000 was raised.\n\n"
        "3. This Hon'ble Court has jurisdiction.\n\n"
        "PRAYER\n"
        "(a) decree;\n\n"
        "VERIFICATION\n"
        "I say that paragraphs 1 to 10 are true to my personal knowledge, "
        "paragraphs 11 to 20 are based on books of account, and "
        "paragraphs 21 to 25 are based on legal advice.\n\n"
        "STATEMENT OF TRUTH\n"
        "1. I believe paragraphs 1 to 10 are true to personal knowledge.\n"
    )
    out, changed = _rebuild_verification_and_sot(text)
    assert changed
    assert "paragraphs 1" in out.lower() or "paragraph 1" in out.lower()
    # Old inflated ranges should be gone
    assert "1 to 10" not in out
    assert "11 to 20" not in out


def test_ensure_company_registration_in_body():
    from app.services.draft_repairs import _ensure_company_registration_in_body
    digest = (
        "PARTIES —\n"
        "- Full Name: Nexora Infotech Private Limited\n"
        "- CIN: U72900PN2020PTC191234\n"
        "- Incorporated under Companies Act, 2013\n"
    )
    text = (
        "1. The Plaintiff is Nexora Infotech Private Limited.\n\n"
        "2. The Defendant failed to pay.\n\n"
        "PRAYER\n"
        "(a) decree;\n"
    )
    out, changed = _ensure_company_registration_in_body(text, digest)
    assert changed
    assert "Company Registration" in out or "CIN" in out
    assert "ANNEXURE P-99" in out


def test_monolithic_repairs_structural_chain():
    from app.services.draft_repairs import _monolithic_deterministic_repairs
    digest = (
        "PARTIES —\n"
        "- Full Name: Nexora Infotech Private Limited\n"
        "- CIN: U72900PN2020PTC191234\n"
        "- Incorporated under Companies Act, 2013\n"
        "DOCUMENT REFERENCES —\n"
        "- Master Service Agreement dated 01-Jan-2024\n"
        "- Invoice INV-101\n"
        "AMOUNTS — Invoice unpaid Rs. 20,06,000\n"
    )
    text = (
        "IN THE COMMERCIAL COURT AT PUNE\n"
        "Nexora Infotech Private Limited\nPlaintiff\n"
        "VERSUS\n"
        "Beta Ltd\nDefendant\n\n"
        "1. The Plaintiff is a company.\n\n"
        "2. The Agreement is annexed hereto and marked as ANNEXURE P-1.\n\n"
        "3. Invoice INV-101 for Rs. 20,06,000 is marked as ANNEXURE P-1.\n\n"
        "22. [Internal Note: Fix annexure mapping before filing.]\n\n"
        "24. Particulars:\n\n"
        "| A | B |\n"
        "|---|---|\n"
        "| ---------------- | ------ |\n"
        "| --- | --- | --- |\n\n"
        "25. This Hon'ble Court has jurisdiction.\n\n"
        "PRAYER\n"
        "(a) decree for Rs. 20,06,000;\n"
        "(b) costs.\n\n"
        "VERIFICATION\n"
        "I say that paragraphs 1 to 20 are true to my personal knowledge, "
        "paragraphs 21 to 30 are based on books of account, and "
        "paragraphs 31 to 40 are based on legal advice.\n\n"
        "LIST OF DOCUMENTS\n\n"
        "| S.No | Particulars | Annexure | Status |\n"
        "|:-----|:------------|:---------|:-------|\n"
        "| 1 | Agreement | ANNEXURE P-1 | Filed herewith |\n"
    )
    out, info = _monolithic_deterministic_repairs(text, digest)
    assert info.get("internal_notes_removed") == [22]
    assert info.get("corrupted_tables_removed", 0) >= 1
    assert "Internal Note" not in out
    assert "----------------" not in out
    # Annexures should be unique marks
    assert "ANNEXURE P-1" in out
    assert "ANNEXURE P-2" in out
    # Company registration added somehow (body or LoD)
    assert re.search(r"Company Registration|Certificate of Incorporation|CIN", out, re.I)
    # Continuous body numbering before PRAYER
    body = out.split("PRAYER")[0]
    nums = [int(m.group(1)) for m in re.finditer(r"(?m)^(\d+)\.\s", body)]
    assert nums == list(range(1, len(nums) + 1))
    assert info.get("body_renumbered") or nums == list(range(1, len(nums) + 1))
    assert info.get("attestation_rebuilt") or "1 to 20" not in out


def test_build_factual_manifest():
    from app.services.draft_facts import _build_factual_manifest
    digest = (
        "PARTIES —\nAcme Solutions Pvt. Ltd., Plaintiff\n"
        "AMOUNTS —\nRs. 10,00,000 for services [Source: a.pdf]\n"
        "U12345AB6784CDE123456\n"
    )
    m = _build_factual_manifest(digest)
    assert "Acme Solutions" in m
    assert "AMOUNTS" in m

