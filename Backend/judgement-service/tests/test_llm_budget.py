"""Case-material budgeting: every document must reach the issue spotter —
multi-document texts get an even per-document share (head + tail preserved),
never a blind head-slice that hides later files."""

from agents import _budget_case_text


def test_short_text_passes_through():
    assert _budget_case_text("short case note", 1000) == "short case note"


def test_every_document_survives_the_budget():
    text = ("[FILE: plaint.pdf]\n" + ("P" * 10000)
            + "\n\n[FILE: agreement.pdf]\n" + ("A" * 10000)
            + "\n\n[FILE: reply.pdf]\n" + ("R" * 10000))
    out = _budget_case_text(text, 9000)
    # All three documents contribute — the old head-slice would have kept
    # only plaint.pdf.
    assert "[FILE: plaint.pdf]" in out
    assert "[FILE: agreement.pdf]" in out
    assert "[FILE: reply.pdf]" in out
    assert out.count("[... document truncated ...]") == 3
    # Head AND tail of each doc survive (prayers live at the end).
    assert out.rstrip().endswith("R")


def test_single_text_keeps_head_and_tail():
    text = "START " + ("x" * 20000) + " GROUNDS AND PRAYER AT END"
    out = _budget_case_text(text, 5000)
    assert out.startswith("START")
    assert out.rstrip().endswith("PRAYER AT END")
    assert "[... middle of material omitted ...]" in out
