"""Court scope (issues-step Advanced-search boxes): the selected courts must
hold deterministically — in the wire queries (doctypes override), as a
post-fetch guard on whatever Indian Kanoon returns, and each query must hit
IK exactly ONCE per scoped run (no forum-restricted duplicate re-run)."""

import asyncio

from schemas import KeywordSet
from tools import (build_ik_query, ik_client, scope_allows_court,
                   set_court_scope, set_date_scope)


def teardown_function():
    set_court_scope(None)
    set_date_scope(None)


def test_no_scope_allows_everything():
    set_court_scope(None)
    assert scope_allows_court("Madras High Court")
    assert scope_allows_court("Supreme Court of India")
    assert scope_allows_court("")


def test_supreme_plus_case_court_blocks_other_high_courts():
    # The exact reported bug: SC + Bombay ticked, other HCs must be dropped.
    set_court_scope("supremecourt,bombay")
    assert scope_allows_court("Supreme Court of India")
    assert scope_allows_court("Bombay High Court")
    assert not scope_allows_court("Madras High Court")
    assert not scope_allows_court("Allahabad High Court")
    assert not scope_allows_court("Gauhati High Court")
    assert not scope_allows_court("Jammu & Kashmir High Court")
    assert not scope_allows_court("Delhi District Court")


def test_highcourts_aggregate_allows_any_hc_but_not_sc():
    set_court_scope("supremecourt,highcourts")
    assert scope_allows_court("Madras High Court")
    assert scope_allows_court("Supreme Court of India")
    set_court_scope("highcourts")
    assert not scope_allows_court("Supreme Court of India")


def test_hc_token_requires_an_actual_high_court():
    set_court_scope("bombay")
    assert scope_allows_court("Bombay High Court")
    assert not scope_allows_court("Bombay City Civil Court")


def test_bench_variant_tokens_map_to_their_high_court():
    set_court_scope("jaipur")
    assert scope_allows_court("Rajasthan High Court")
    assert not scope_allows_court("Bombay High Court")


def test_unmapped_tokens_stay_permissive_for_non_court_forums():
    # Tribunal tokens have no docsource pattern — IK's own filter is the
    # authority; the guard must not eat tribunal results, but still blocks
    # courts outside the selected ones.
    set_court_scope("supremecourt,itat")
    assert scope_allows_court("Income Tax Appellate Tribunal")
    assert scope_allows_court("Supreme Court of India")
    assert not scope_allows_court("Madras High Court")


def test_build_ik_query_scope_override_and_reset():
    set_court_scope("supremecourt,bombay")
    assert build_ik_query('"civil dispute" quash').endswith(
        "doctypes:supremecourt,bombay")
    set_court_scope(None)
    assert "doctypes:supremecourt,bombay" not in build_ik_query('"civil dispute" quash')


def test_date_scope_rides_on_every_query():
    set_date_scope("fromdate:1-1-2020 todate:31-12-2023")
    q = build_ik_query('"civil dispute" quash')
    assert q.endswith("fromdate:1-1-2020 todate:31-12-2023")
    assert "doctypes:" in q  # court filter and dates compose
    set_court_scope("supremecourt,bombay")
    q = build_ik_query('"civil dispute" quash')
    assert "doctypes:supremecourt,bombay" in q
    assert q.endswith("fromdate:1-1-2020 todate:31-12-2023")
    set_date_scope(None)
    assert "fromdate:" not in build_ik_query('"civil dispute" quash')


def _fanout_wires(monkeypatch, page_map=None):
    """Run fanout_and_fetch with a recording fake search; return the
    (wire query, pagenum) pairs actually sent to IK."""
    sent: list[tuple[str, int]] = []

    async def fake_search(query, pagenum=0):
        sent.append((query, pagenum))
        return []

    monkeypatch.setattr(ik_client, "search", fake_search)
    keywords = KeywordSet(anchor_queries=['"civil dispute" quash', '"Section 482" quash'])
    asyncio.run(ik_client.fanout_and_fetch(keywords, page_map=page_map))
    return sent


def test_scoped_run_sends_each_query_exactly_once(monkeypatch):
    # Every display query goes out once, with the combined court list.
    set_court_scope("supremecourt,bombay")
    sent = _fanout_wires(monkeypatch)
    wires = [q for q, _ in sent]
    assert len(wires) == len(set(wires)) == 2, f"duplicate IK calls: {wires}"
    assert all(q.endswith("doctypes:supremecourt,bombay") for q in wires)


def test_default_run_also_sends_each_query_exactly_once(monkeypatch):
    # The nationwide/forum duplicate re-run is GONE for good: displayed
    # queries == IK calls, scoped or not.
    set_court_scope(None)
    sent = _fanout_wires(monkeypatch)
    wires = [q for q, _ in sent]
    assert len(wires) == len(set(wires)) == 2, f"duplicate IK calls: {wires}"


def test_repeat_runs_advance_to_the_next_ik_page(monkeypatch):
    # Run #1 fetches IK page one (pagenum 0); Run #2 of the SAME queries
    # fetches page two (pagenum 1) — deeper results, never a re-buy.
    set_court_scope(None)
    page_map: dict[str, int] = {}
    first = _fanout_wires(monkeypatch, page_map)
    assert all(page == 0 for _, page in first)
    second = _fanout_wires(monkeypatch, page_map)
    assert all(page == 1 for _, page in second)
    assert [q for q, _ in first] == [q for q, _ in second]
