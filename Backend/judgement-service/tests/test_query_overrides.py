"""User query curation on /search/run: checked system queries + user-typed
queries REPLACE an issue's anchor queries; axes/contra are untouched; an
empty selection is honoured; custom issues (no stored keywords) are skipped."""

from agents import apply_query_overrides
from schemas import KeywordSet


def _kw() -> KeywordSet:
    return KeywordSet(
        anchor_queries=['"civil dispute given criminal colour" quash',
                        '"purely civil nature" quash FIR'],
        contra_queries=['"quashing petition" dismissed'],
        doctrinal=["abuse of process"], statutory=["Section 482 CrPC"],
        factual=["supply contract dispute"], outcome=["FIR quashed"],
    )


def test_checked_plus_own_queries_replace_anchors():
    keywords_map = {"1": _kw()}
    out = apply_query_overrides(keywords_map, {
        "1": ['"civil dispute given criminal colour" quash',
              '"mala fide intention" quash FIR'],  # one kept + one user-typed
    })
    assert out["1"].anchor_queries == [
        '"civil dispute given criminal colour" quash',
        '"mala fide intention" quash FIR',
    ]
    # Curated = STRICT: contra queries are cleared too — the user's list is
    # the WHOLE query set (they were never fetched in curated mode, and
    # displaying them read as "the system used queries I didn't pick").
    assert out["1"].contra_queries == []
    # Axis terms stay — they score, they don't fetch.
    assert out["1"].statutory == ["Section 482 CrPC"]


def test_empty_selection_is_honoured():
    keywords_map = {"1": _kw()}
    out = apply_query_overrides(keywords_map, {"1": []})
    assert out["1"].anchor_queries == []


def test_unknown_issue_and_blank_queries_are_skipped():
    keywords_map = {"1": _kw()}
    out = apply_query_overrides(keywords_map, {
        "99": ["anything"],                # custom issue — nothing stored
        "1": ["  ", "", "\t", "kept query", "kept query"],  # blanks + dupes
    })
    assert out["1"].anchor_queries == ["kept query"]


def test_cap_at_eight_queries():
    keywords_map = {"1": _kw()}
    out = apply_query_overrides(keywords_map, {"1": [f"query {i}" for i in range(12)]})
    assert len(out["1"].anchor_queries) == 8


def test_none_overrides_is_a_no_op():
    keywords_map = {"1": _kw()}
    out = apply_query_overrides(keywords_map, None)
    assert out["1"].anchor_queries == _kw().anchor_queries


def test_anchors_only_fanout_sends_no_contra_or_axis_queries(monkeypatch):
    """Curated issues fetch with EXACTLY the user's queries: contra and
    axis-term IK searches are not sent (axis terms still score locally)."""
    import asyncio

    from tools import ik_client

    sent: list[str] = []

    async def _fake_search(query, pagenum=0):
        sent.append(query)
        return []

    monkeypatch.setattr(ik_client, "search", _fake_search)

    kw = _kw()
    asyncio.run(ik_client.fanout_and_fetch(kw, anchors_only=True))
    assert len(sent) == len(kw.anchor_queries)
    assert all(any(anchor.split()[0].strip('"') in wire for wire in sent)
               for anchor in kw.anchor_queries)
    for wire in sent:
        assert "dismissed" not in wire       # contra not sent
        assert "abuse of process" not in wire  # axis terms not sent

    sent.clear()
    asyncio.run(ik_client.fanout_and_fetch(kw, anchors_only=False))
    assert len(sent) > len(kw.anchor_queries)  # full fan-out unchanged
