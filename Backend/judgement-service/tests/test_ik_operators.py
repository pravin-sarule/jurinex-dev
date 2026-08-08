"""Indian Kanoon wire-format operators: queries are authored/displayed as
AND / OR / NOT but IK only understands ANDD / ORR / NOTT (case-sensitive,
space-delimited, per the official API docs). to_ik_operators translates at
fetch time; quoted phrases and lowercase words are never touched, and
undocumented parentheses are stripped."""

from tools import build_ik_query, to_ik_operators


def test_boolean_operators_translate_to_ik_wire_format():
    q = '"quashing of FIR" AND "civil dispute" AND ("malafide" OR "ulterior motive")'
    assert to_ik_operators(q) == (
        '"quashing of FIR" ANDD "civil dispute" ANDD "malafide" ORR "ulterior motive"')


def test_not_translates_and_doubled_forms_are_not_redoubled():
    assert to_ik_operators('murder AND NOT kidnapping') == 'murder ANDD NOTT kidnapping'
    # Already-wire queries pass through unchanged (word boundary blocks ANDD).
    assert to_ik_operators('murder ANDD NOTT kidnapping') == 'murder ANDD NOTT kidnapping'


def test_quoted_phrases_and_lowercase_words_untouched():
    # 'AND' inside a quoted phrase is part of the phrase; lowercase 'and'
    # is an ordinary word — neither may become an operator.
    assert to_ik_operators('"BRAND AND CO" and partners NOT liable') == (
        '"BRAND AND CO" and partners NOTT liable')


def test_build_ik_query_translates_then_appends_doctypes():
    out = build_ik_query('("quash the FIR" OR "Section 482") AND "purely civil nature"',
                         doctypes="bombay")
    assert out == '"quash the FIR" ORR "Section 482" ANDD "purely civil nature" doctypes:bombay'


def test_simple_keyword_queries_pass_through_unchanged():
    out = build_ik_query('"civil dispute given criminal colour" quash', doctypes="bombay")
    assert out == '"civil dispute given criminal colour" quash doctypes:bombay'


def test_generated_queries_are_stored_in_wire_format():
    # The cards must show byte-for-byte what hits the API: _wire_queries
    # converts anchors/contras once at generation time.
    from agents import _wire_queries
    from schemas import KeywordSet
    kw = KeywordSet(anchor_queries=['"Section 271AAB(1A)" AND ("nexus" OR "correlation")'],
                    contra_queries=['penalty AND NOT deleted'])
    out = _wire_queries(kw)
    assert out.anchor_queries == ['"Section 271AAB(1A)" ANDD "nexus" ORR "correlation"']
    assert out.contra_queries == ['penalty ANDD NOTT deleted']
