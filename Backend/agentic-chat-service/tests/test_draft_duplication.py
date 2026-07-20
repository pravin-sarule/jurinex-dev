"""Regression tests for the "draft repeats itself below" defect class.

    cd Backend/agentic-chat-service && python -m pytest tests/test_draft_duplication.py -q

Three duplication paths are guarded:
1. continuation calls (MAX_TOKENS / mid-stream cut / completeness) whose
   output restarts the document instead of appending — `_dedupe_continuation`;
2. false-positive "missing section" detection triggering pointless
   continuations — alnum-normalized `find_missing_template_sections`;
3. anything that still slips through — `_strip_restarted_document`, the final
   deterministic net (strategy end + repairs chain).
"""
from __future__ import annotations

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from app.services.drafting_monolithic import (  # noqa: E402
    _completeness_continuation_prompt,
    _dedupe_continuation,
    _join_continuation,
    _norm_match,
    _trim_overlap,
    find_missing_template_sections,
)
from app.services.draft_repairs import (  # noqa: E402
    _strip_restarted_document,
)

CAPTION = (
    "IN THE HIGH COURT OF DELHI AT NEW DELHI\n"
    "CIVIL SUIT NO. ____ OF 2026\n\n"
    "M/s Acme Industries Private Limited, a company incorporated under the "
    "Companies Act, 2013, having its registered office at 12 Industrial Area, "
    "New Delhi\n…PLAINTIFF\n\nVERSUS\n\n"
    "M/s Globex Trading LLP, a limited liability partnership having its "
    "principal office at 44 Market Road, Mumbai\n…DEFENDANT\n"
)

BODY = (
    "1. That the Plaintiff is a company engaged in the manufacture and supply "
    "of industrial pumps and allied equipment, and has been so engaged since "
    "its incorporation on 15 March 2012.\n\n"
    "2. That the Defendant placed Purchase Order No. PO/2025/091 dated "
    "12 January 2025 upon the Plaintiff for the supply of forty industrial "
    "pumps at an aggregate consideration of Rs. 12,50,000.00.\n\n"
    "3. That the Plaintiff duly supplied the goods under Invoice No. "
    "NEX/INV/2025/26/041 dated 20 February 2025, which invoice was received "
    "and accepted by the Defendant without demur or protest whatsoever.\n\n"
    "PRAYER\n\n"
    "(a) pass a decree of Rs. 12,50,000.00 in favour of the Plaintiff;\n"
    "(b) award interest at 18% per annum from the due date;\n"
)

DOC = CAPTION + "\n" + BODY
NEW_TAIL = (
    "VERIFICATION\n\n"
    "Verified at New Delhi on this day that the contents of paragraphs 1 to 3 "
    "are true to my personal knowledge and belief, and nothing material has "
    "been concealed therefrom by the deponent herein."
)


# ── 1. continuation deduplication ──────────────────────────────────────────

def test_full_restart_keeps_only_new_tail():
    continuation = DOC + "\n\n" + NEW_TAIL
    out = _dedupe_continuation(DOC, continuation)
    assert "VERIFICATION" in out
    assert "IN THE HIGH COURT" not in out
    assert "Purchase Order No. PO/2025/091" not in out


def test_pure_restart_with_nothing_new_is_dropped():
    assert _dedupe_continuation(DOC, DOC) == ""
    assert _dedupe_continuation(DOC, CAPTION) == ""


def test_genuinely_new_continuation_returned_verbatim():
    out = _dedupe_continuation(DOC, NEW_TAIL)
    assert out == NEW_TAIL


def test_repeated_last_paragraph_then_new_content():
    continuation = (
        "(a) pass a decree of Rs. 12,50,000.00 in favour of the Plaintiff;\n"
        "(b) award interest at 18% per annum from the due date;\n\n" + NEW_TAIL
    )
    out = _dedupe_continuation(DOC, continuation)
    assert out.strip().startswith("VERIFICATION")


def test_lightly_reworded_replay_dropped_by_shingles():
    # Same long paragraph with a short tail appended — no longer an exact
    # substring, but 8-word-shingle containment stays >= 0.8, so it is
    # recognized as a replay and dropped.
    reworded = BODY.split("\n\n")[1] + " with costs throughout."
    assert reworded not in DOC  # not exact containment — exercises shingles
    out = _dedupe_continuation(DOC, reworded + "\n\n" + NEW_TAIL)
    assert "VERIFICATION" in out
    assert "Purchase Order No. PO/2025/091" not in out


def test_short_heading_before_new_body_is_kept():
    continuation = "PRAYER ANNEX\n\n" + NEW_TAIL  # short unseen heading + new body
    out = _dedupe_continuation(DOC, continuation)
    assert out.startswith("PRAYER ANNEX")


def test_empty_existing_passes_through():
    assert _dedupe_continuation("", NEW_TAIL) == NEW_TAIL


def test_trailing_replay_after_new_section_is_dropped():
    # Completeness continuation: new list-of-documents table, then the model
    # re-emits already-present PRAYER / body clauses verbatim.
    new_table = (
        "LIST OF DOCUMENTS\n\n"
        "| S.No. | Particulars | Page |\n"
        "| --- | --- | --- |\n"
        "| 1 | Purchase order PO/2025/091 | 1-2 |\n"
        "| 2 | Invoice NEX/INV/2025/26/041 | 3-4 |\n"
    )
    prayer_replay = (
        "PRAYER\n\n"
        "(a) pass a decree of Rs. 12,50,000.00 in favour of the Plaintiff;\n"
        "(b) award interest at 18% per annum from the due date;\n"
    )
    continuation = new_table + "\n\n" + prayer_replay
    out = _dedupe_continuation(DOC, continuation)
    assert "LIST OF DOCUMENTS" in out
    assert "Purchase order PO/2025/091" in out
    assert "PRAYER" not in out
    assert "pass a decree" not in out


def test_lightly_altered_short_caption_line_does_not_keep_full_replay():
    # Restart whose early short line is lightly altered (filled blank) must still
    # be dropped — a single short False flag must not commit the whole replay.
    existing = (
        "IN THE HIGH COURT OF DELHI AT NEW DELHI\n\n"
        "No. ____ of 2026\n\n" + BODY
    )
    altered = (
        "IN THE HIGH COURT OF DELHI AT NEW DELHI\n\n"
        "No. 482 of 2026\n\n" + BODY
    )
    assert _norm_match("No. 482 of 2026") not in _norm_match(existing)
    assert len(_norm_match("No. 482 of 2026")) < 20
    assert _dedupe_continuation(existing, altered) == ""
    out = _dedupe_continuation(existing, altered + "\n\n" + NEW_TAIL)
    assert "VERIFICATION" in out
    assert "Purchase Order No. PO/2025/091" not in out


# ── 2. overlap trim + stitching ────────────────────────────────────────────

def test_trim_overlap_removes_reemitted_words():
    existing = DOC + "\n4. That despite repeated requests the Defendant fail"
    new_part = "the Defendant failed and neglected to make payment of the said sum."
    # heads that repeat the tail get trimmed
    trimmed = _trim_overlap(existing, new_part)
    assert not trimmed.startswith("the Defendant")
    assert trimmed.endswith("said sum.")


def test_trim_overlap_no_overlap_unchanged():
    assert _trim_overlap(DOC, NEW_TAIL) == NEW_TAIL


def test_join_mid_sentence_uses_space():
    joined = _join_continuation("…the Defendant fail", "ed to pay the amount.")
    assert "fail ed" in joined or "failed" in joined  # space-join, not paragraph
    assert "\n\n" not in joined[-40:]


def test_join_new_section_uses_paragraph_break():
    joined = _join_continuation(DOC, "VERIFICATION\n\nVerified at New Delhi.")
    assert joined.endswith("VERIFICATION\n\nVerified at New Delhi.")
    assert joined[len(DOC.rstrip()):].startswith("\n\n")


def test_join_table_rows_uses_single_newline():
    existing = (
        "| S.No. | Date | Particulars |\n"
        "| --- | --- | --- |\n"
        "| 2 | 15.05.2023 | First invoice raised |"
    )
    new_rows = "| 3 | 20.06.2023 | Reminder notice |\n| 4 | 01.07.2023 | Final demand |"
    joined = _join_continuation(existing, new_rows)
    assert "\n\n|" not in joined
    assert "| First invoice raised |\n| 3 |" in joined


# ── 3. missing-section detection tolerance ─────────────────────────────────

SECTIONS = [
    {"section_id": "s1", "index": 0, "heading": "FACTS",
     "heading_verbatim": True, "original_text": "1. That ____"},
    {"section_id": "s2", "index": 1, "heading": "STATEMENT OF TRUTH",
     "heading_verbatim": True, "original_text": "STATEMENT OF TRUTH\nI, ____"},
]


def test_bolded_wrapped_heading_not_flagged_missing():
    draft = (
        "1. That the plaintiff supplied the goods as agreed and the amounts "
        "remain unpaid in full.\n\n**STATEMENT  OF\nTRUTH**\n\nI, the deponent, "
        "state that the contents are true."
    )
    missing = find_missing_template_sections(SECTIONS, draft)
    assert missing == []


def test_genuinely_missing_tail_still_detected():
    draft = "1. That the plaintiff supplied the goods as agreed."
    missing = find_missing_template_sections(SECTIONS, draft)
    assert any(s["section_id"] == "s2" for s in missing)


# ── 4. completeness prompt is append-only ──────────────────────────────────

def test_completeness_prompt_has_no_full_draft_instruction():
    p = _completeness_continuation_prompt(
        DOC, [SECTIONS[1]], facts_digest="| 1. | 20 Feb 2025 | Invoice raised |",
        digest_cached=False, verified_fields_block="- amount = Rs. 12,50,000.00",
    )
    assert "COMPLETE filing-ready document" not in p
    assert "APPEND-ONLY" in p
    assert "Do NOT output the court caption" in p
    assert "STATEMENT OF TRUTH" in p
    assert "<<<PARTIAL" in p and "FACT INVENTORY" in p and "LEDGER" in p


def test_completeness_prompt_cached_digest_reference():
    p = _completeness_continuation_prompt(DOC, [SECTIONS[1]], digest_cached=True)
    assert "cached context" in p
    assert "<<<FACTS" not in p


# ── 5. final net: restarted-document strip ─────────────────────────────────

def test_single_duplicate_copy_removed():
    doubled = DOC + "\n\n" + DOC + "\n\n" + NEW_TAIL
    out, removed = _strip_restarted_document(doubled)
    assert removed == 1
    assert out.count("IN THE HIGH COURT OF DELHI") == 1
    assert out.count("Purchase Order No. PO/2025/091") == 1


def test_double_duplicate_copies_removed():
    # One truncation cut removes BOTH trailing copies (everything after the
    # first restart point) — `removed` counts cuts, the doc ends up single.
    tripled = DOC + "\n\n" + DOC + "\n\n" + DOC
    out, removed = _strip_restarted_document(tripled)
    assert removed >= 1
    assert out.count("IN THE HIGH COURT OF DELHI") == 1
    assert out.count("Purchase Order No. PO/2025/091") == 1


def test_clean_document_untouched():
    out, removed = _strip_restarted_document(DOC)
    assert removed == 0
    assert out == DOC


def test_memo_of_parties_restatement_preserved():
    memo = (
        "MEMO OF PARTIES\n\n"
        "IN THE HIGH COURT OF DELHI AT NEW DELHI\n"
        "CIVIL SUIT NO. ____ OF 2026\n\n"
        "M/s Acme Industries Private Limited, a company incorporated under the "
        "Companies Act, 2013, having its registered office at 12 Industrial "
        "Area, New Delhi\n…PLAINTIFF\n\nVERSUS\n\n"
        "M/s Globex Trading LLP, a limited liability partnership having its "
        "principal office at 44 Market Road, Mumbai\n…DEFENDANT\n\n"
        "Filed through counsel for the Plaintiff, advocate on record."
    )
    doc_with_memo = DOC + "\n\n" + BODY + "\n\n" + memo
    out, removed = _strip_restarted_document(doc_with_memo)
    assert removed == 0
    assert "MEMO OF PARTIES" in out


def test_memo_of_parties_court_header_first_preserved():
    # Standard Delhi HC layout: caption restated FIRST, then MEMO OF PARTIES.
    memo = (
        "IN THE HIGH COURT OF DELHI AT NEW DELHI\n"
        "CIVIL SUIT NO. ____ OF 2026\n\n"
        "MEMO OF PARTIES\n\n"
        "M/s Acme Industries Private Limited, a company incorporated under the "
        "Companies Act, 2013, having its registered office at 12 Industrial "
        "Area, New Delhi\n…PLAINTIFF\n\nVERSUS\n\n"
        "M/s Globex Trading LLP, a limited liability partnership having its "
        "principal office at 44 Market Road, Mumbai\n…DEFENDANT\n\n"
        "Filed through counsel for the Plaintiff, advocate on record."
    )
    # Pad so the memo sits past the 0.3 positional threshold and sample >=500.
    pad = "\n\n".join(
        f"{i}. That the Plaintiff records further particulars of the commercial "
        f"relationship under transaction reference TXN-{i:04d} dated "
        f"{10 + (i % 20)}.0{(i % 9) + 1}.2025 for supply of industrial equipment."
        for i in range(4, 20)
    )
    doc_with_memo = DOC + "\n\n" + pad + "\n\n" + memo
    out, removed = _strip_restarted_document(doc_with_memo)
    assert removed == 0
    assert "MEMO OF PARTIES" in out


def test_restart_after_verification_still_stripped():
    # Verbatim whole-document restart sitting immediately after VERIFICATION —
    # the most common end-of-filing restart — must still be cut despite the
    # nearby guard word (raised containment bar, not a hard skip).
    with_verif = DOC + "\n\n" + NEW_TAIL
    doubled = with_verif + "\n\n" + with_verif
    out, removed = _strip_restarted_document(doubled)
    assert removed == 1
    assert out.count("IN THE HIGH COURT OF DELHI") == 1
    assert out.count("Purchase Order No. PO/2025/091") == 1
    assert out.rstrip().endswith("deponent herein.")


def test_repairs_chain_reports_restart_removal():
    from app.services.draft_repairs import _monolithic_deterministic_repairs

    doubled = DOC + "\n\n" + DOC
    fixed, info = _monolithic_deterministic_repairs(doubled)
    assert info.get("restarted_copies_removed") == 1
    assert fixed.count("IN THE HIGH COURT OF DELHI") == 1
