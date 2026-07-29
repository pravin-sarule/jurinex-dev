"""fanout_and_fetch: union across anchor + axis queries, dedupe by docId,
cap, and matched-term accumulation — with the network mocked out."""

import pytest

from schemas import KeywordSet
from tools import IndianKanoonClient, build_ik_query


def _doc(tid: int, title: str = "Some Case v. State", citedby: int = 3):
    return {"tid": tid, "title": title, "headline": "…relevant snippet…",
            "docsource": "Supreme Court of India", "publishdate": "2019-04-05",
            "numcitedby": citedby}


def _undecorate(query: str) -> str:
    """Strip the doctypes filter and exact-phrase quotes the query builder
    adds, recovering the raw term the pipeline searched for."""
    return query.split(" doctypes:")[0].strip().strip('"')


def test_build_ik_query_quotes_and_filters():
    wire = build_ik_query("inherent powers to quash", exact=True, doctypes="supremecourt")
    assert wire == '"inherent powers to quash" doctypes:supremecourt'
    # single words never get quoted; existing quotes are left alone
    assert build_ik_query("quashing", exact=True, doctypes="") == "quashing"
    anchor = build_ik_query('"Section 482" quashing matrimonial', doctypes="supremecourt")
    assert anchor == '"Section 482" quashing matrimonial doctypes:supremecourt'
    # empty doctypes disables the filter; an existing filter is never doubled
    assert "doctypes:" not in build_ik_query("bail parity", doctypes="")
    assert build_ik_query("murder doctypes:supremecourt",
                          doctypes="highcourts") == "murder doctypes:supremecourt"


@pytest.mark.asyncio
async def test_fanout_dedupes_unions_and_caps(monkeypatch):
    client = IndianKanoonClient()

    async def fake_search(query: str, pagenum: int = 0):
        term = _undecorate(query)
        if term == "Section 482 CrPC":
            return [_doc(1), _doc(2)]
        if term == "inherent powers to quash":
            return [_doc(2), _doc(3)]          # doc 2 repeats → union, not dup
        return [_doc(100 + i) for i in range(30)]  # would blow past the cap

    monkeypatch.setattr(client, "search", fake_search)

    keywords = KeywordSet(
        statutory=["Section 482 CrPC"],
        doctrinal=["inherent powers to quash"],
        factual=["civil dispute criminal colour"],
    )
    pool = await client.fanout_and_fetch(keywords, cap=22)

    ids = [c.doc_id for c in pool]
    assert len(ids) == len(set(ids)), "docIds must be deduped"
    assert len(pool) <= 22, "pool must respect the cap"

    doc2 = next(c for c in pool if c.doc_id == "2")
    assert set(doc2.matched_terms) == {"Section 482 CrPC", "inherent powers to quash"}
    # multi-term matches must survive the cap first
    assert ids[0] == "2"


@pytest.mark.asyncio
async def test_anchor_queries_search_first_with_extra_weight(monkeypatch):
    client = IndianKanoonClient()
    seen: list[str] = []

    async def fake_search(query: str, pagenum: int = 0):
        seen.append(query)
        if "matrimonial" in query:
            return [_doc(7)]
        return [_doc(8)]

    monkeypatch.setattr(client, "search", fake_search)
    keywords = KeywordSet(
        anchor_queries=['"Section 482" quashing matrimonial dispute'],
        statutory=["Section 482 CrPC"],
    )
    pool = await client.fanout_and_fetch(keywords, cap=22)

    # anchor query goes out first, decorated with the doctypes filter
    assert seen[0].startswith('"Section 482" quashing matrimonial dispute')
    anchor_hit = next(c for c in pool if c.doc_id == "7")
    # matched_terms carries the RAW anchor (for keyword_signal), not the wire query
    assert anchor_hit.matched_terms == ['"Section 482" quashing matrimonial dispute']


@pytest.mark.asyncio
async def test_empty_keywords_fetch_nothing(monkeypatch):
    client = IndianKanoonClient()

    async def boom(query, pagenum=0):  # pragma: no cover
        raise AssertionError("must not hit IK with no terms")

    monkeypatch.setattr(client, "search", boom)
    assert await client.fanout_and_fetch(KeywordSet()) == []


def test_candidate_parsing_fields():
    from tools import strip_html, year_from_text
    assert strip_html("<b>FIR</b> quashed") == " FIR  quashed"
    assert year_from_text("2019-04-05") == 2019
    assert year_from_text("", "Ambadas v. State (1997)") == 1997
