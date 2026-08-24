"""Deterministic anchor-format guard: every generated query is held to the
locked exemplar shape ('"Section NNN" "quoted settled formula" outcome') in
CODE — bad model output is rebuilt or dropped, never sent to IK broken."""

from agents import _anchor_format_ok, _enforce_anchor_format
from schemas import KeywordSet


def test_good_exemplar_queries_pass_unchanged():
    good = [
        '"Section 482" "mala fide" "ulterior motive"',
        '"Section 528" "mala fide" "ulterior motive" quash FIR',
        '"Section 482" "civil dispute given criminal colour" quashing',
        '"Section 482" "wreaking vengeance" "cheque"',
    ]
    for q in good:
        assert _anchor_format_ok(q), q
    kw = KeywordSet(anchor_queries=list(good), doctrinal=["abuse of process"])
    _enforce_anchor_format(kw)
    assert kw.anchor_queries == good


def test_bad_queries_from_the_field_are_caught():
    # The exact failures the user screenshotted.
    bad = [
        '"Section 482" CrPC mala fide intentions ulterior motive',
        '"Section 528" BNSS commercial dispute criminal prosecution',
        '"Section 482" "Negotiable Instruments Act" civil suit pending FIR quashing',
        '"Section 138" NI Act counter blast civil recovery proceedings',
    ]
    for q in bad:
        assert not _anchor_format_ok(q), q


def test_bad_query_is_rebuilt_in_exemplar_shape():
    kw = KeywordSet(
        anchor_queries=['"Section 482" CrPC mala fide intentions ulterior motive'],
        doctrinal=["civil dispute given criminal colour"],
        outcome=["FIR quashed"],
    )
    _enforce_anchor_format(kw)
    assert kw.anchor_queries == [
        '"Section 482" "civil dispute given criminal colour" fir']


def test_unrepairable_bad_query_is_dropped_not_sent():
    kw = KeywordSet(
        anchor_queries=['"Section 482" "mala fide" quash',  # good — kept
                        'purely descriptive words with no section at all here'],
        doctrinal=[],
    )
    _enforce_anchor_format(kw)
    assert kw.anchor_queries == ['"Section 482" "mala fide" quash']


def test_boolean_advanced_queries_bypass_the_guard():
    q = '"quashing of FIR" AND "civil dispute" AND ("malafide" OR "ulterior motive")'
    kw = KeywordSet(anchor_queries=[q], doctrinal=["abuse of process"])
    _enforce_anchor_format(kw)
    assert kw.anchor_queries == [q]


# ─── Quote-character normalization (smart quotes break IK phrase search) ─────

def test_curly_quoted_anchors_are_normalized_not_mangled():
    """An LLM emitting typographic quotes must not lose the phrase: the
    wire pass converts “…” to "…" BEFORE the guard, so the query counts as
    3-4 units and passes untouched — previously each curly-quoted phrase
    read as scattered bare words."""
    from agents import _wire_queries
    kw = KeywordSet(
        anchor_queries=['“Section 31” “bonafide adjudication” quash stamp'],
        doctrinal=["finality of adjudication"])
    _wire_queries(kw)
    assert kw.anchor_queries == ['"Section 31" "bonafide adjudication" quash stamp']


def test_screenshot_queries_pass_guard_verbatim():
    # The four stamp-act queries the user screenshotted — proper ASCII
    # quoting must flow through the guard and the wire pass byte-identical.
    from agents import _wire_queries
    good = [
        '"Section 31" "bonafide adjudication" quash stamp',
        '"Section 53A" "suo motu revision" quash order',
        '"Section 31" "finality of adjudication" quashing',
        '"Section 53A" "subsequent enhancement" quash',
    ]
    kw = KeywordSet(anchor_queries=list(good), doctrinal=["finality of adjudication"])
    _wire_queries(kw)
    assert kw.anchor_queries == good


def test_wire_conversion_normalizes_quotes_and_drops_strays():
    from tools import build_ik_query, to_ik_operators
    # Curly quotes → ASCII at the IK boundary (covers stored legacy queries).
    assert to_ik_operators('“suo motu revision” quash') == '"suo motu revision" quash'
    # exact=True must recognize the (normalized) existing quotes — no double wrap.
    wired = build_ik_query('“bonafide adjudication”', exact=True, doctypes="")
    assert wired == '"bonafide adjudication"'
    # A stray unpaired quote degrades to plain words, never reaches IK glued on.
    assert to_ik_operators('"Section 31 quash stamp') == 'Section 31 quash stamp'


def test_es_parser_sees_curly_quoted_phrases():
    from tools import parse_legal_query
    parsed = parse_legal_query('“suo motu revision” quash')
    assert "suo motu revision" in parsed["phrases"]
