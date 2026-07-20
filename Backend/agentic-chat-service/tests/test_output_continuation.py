"""MAX_TOKENS auto-continuation: long answers must never reach the user truncated.

The DB `llm_chat_config.max_output_tokens` budget is applied per round; when a
round ends with finish_reason=MAX_TOKENS, `_stream_with_continuation` feeds the
partial answer back as a model turn and asks the model to continue, until the
answer completes or the attempt cap is reached.
"""
from __future__ import annotations

import asyncio
import pathlib
import sys
from types import SimpleNamespace

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from app.services import llm_service  # noqa: E402
from app.services.llm_service import (  # noqa: E402
    _RepetitionGuard,
    _looks_like_restart,
    _stream_with_continuation,
    _trim_overlap,
    continuation_attempts,
    continuation_time_budget,
)


class _Usage:
    def __init__(self, prompt: int, out: int, total: int):
        self.prompt_token_count = prompt
        self.candidates_token_count = out
        self.total_token_count = total


class _Chunk:
    def __init__(self, text: str = "", finish: str | None = None, usage: _Usage | None = None):
        self.text = text
        self.usage_metadata = usage
        self.candidates = (
            [SimpleNamespace(finish_reason=finish, delta=None, content=None)] if finish else []
        )


class _FakeModels:
    def __init__(self, rounds):
        self.rounds = rounds
        self.calls: list[list] = []

    def generate_content_stream(self, *, model, contents, config):
        self.calls.append(list(contents))
        return iter(self.rounds[min(len(self.calls) - 1, len(self.rounds) - 1)])


class _FakeClient:
    def __init__(self, rounds):
        self.models = _FakeModels(rounds)


def _run(client, metadata=None):
    async def _collect():
        events = []
        async for ev in _stream_with_continuation(
            client=client,
            model="gemini-2.5-flash",
            contents=[],
            config=None,
            metadata=metadata or {"modelName": "gemini-2.5-flash"},
            endpoint="/test",
        ):
            events.append(ev)
        return events

    return asyncio.run(_collect())


def _answer(events):
    return "".join(e["text"] for e in events if e["type"] == "chunk")


def _usage(events):
    found = [e for e in events if e["type"] == "usage"]
    assert len(found) == 1, "exactly one aggregated usage event expected"
    return found[0]


def test_trim_overlap_drops_duplicated_restart():
    prior = "x" * 100 + "The quick brown fox jumps over"
    new = "The quick brown fox jumps over the lazy dog"
    assert _trim_overlap(prior, new) == " the lazy dog"


def test_trim_overlap_keeps_short_and_missing_overlaps():
    assert _trim_overlap("ends with | ", "| next cell") == "| next cell"
    assert _trim_overlap("no overlap here", "totally different") == "totally different"
    assert _trim_overlap("", "abc") == "abc"
    assert _trim_overlap("abc", "") == ""


def test_continuation_attempts_env(monkeypatch):
    monkeypatch.setenv("CHAT_CONTINUATION_ATTEMPTS", "5")
    assert continuation_attempts() == 5
    monkeypatch.setenv("CHAT_CONTINUATION_ATTEMPTS", "bogus")
    assert continuation_attempts() == 3
    monkeypatch.setenv("CHAT_CONTINUATION_ATTEMPTS", "-2")
    assert continuation_attempts() == 0


def test_no_continuation_on_normal_stop():
    client = _FakeClient([[_Chunk("done.", finish="STOP", usage=_Usage(3, 4, 7))]])
    events = _run(client)
    assert _answer(events) == "done."
    assert len(client.models.calls) == 1
    usage = _usage(events)
    assert usage["outputTruncated"] is False
    assert "continuationRounds" not in usage
    assert not [e for e in events if e["type"] == "status"]


def test_max_tokens_answer_is_completed_and_usage_aggregated():
    client = _FakeClient(
        [
            [_Chunk("Part one ", finish="MAX_TOKENS", usage=_Usage(10, 20, 30))],
            [_Chunk("and part two.", finish="STOP", usage=_Usage(5, 7, 12))],
        ]
    )
    events = _run(client)
    assert _answer(events) == "Part one and part two."
    assert len(client.models.calls) == 2
    # Continuation call must carry the partial answer as a model turn.
    cont = client.models.calls[1]
    assert any(getattr(c, "role", "") == "model" for c in cont)
    usage = _usage(events)
    assert usage["inputTokens"] == 15
    assert usage["outputTokens"] == 27
    assert usage["totalTokens"] == 42
    assert usage["outputTruncated"] is False
    assert usage["continuationRounds"] == 1
    statuses = [e for e in events if e["type"] == "status"]
    assert statuses and statuses[0]["status"] == "continuing"


def test_continuation_trims_duplicated_head():
    tail = "the agreement shall terminate upon thirty days notice"
    client = _FakeClient(
        [
            [_Chunk(f"Clause 12: {tail}", finish="MAX_TOKENS", usage=_Usage(1, 1, 2))],
            [_Chunk(f"{tail} given in writing.", finish="STOP", usage=_Usage(1, 1, 2))],
        ]
    )
    events = _run(client)
    assert _answer(events) == f"Clause 12: {tail} given in writing."


def test_attempt_cap_stops_infinite_max_tokens(monkeypatch):
    monkeypatch.setenv("CHAT_CONTINUATION_ATTEMPTS", "2")
    client = _FakeClient(
        [
            [_Chunk("First distinct passage of the answer. ", finish="MAX_TOKENS", usage=_Usage(1, 1, 2))],
            [_Chunk("Second wholly different continuation block. ", finish="MAX_TOKENS", usage=_Usage(1, 1, 2))],
            [_Chunk("Third unrelated trailing fragment still cut off ", finish="MAX_TOKENS", usage=_Usage(1, 1, 2))],
        ]
    )
    events = _run(client)
    assert len(client.models.calls) == 3  # initial + 2 continuations
    assert _answer(events) == (
        "First distinct passage of the answer. "
        "Second wholly different continuation block. "
        "Third unrelated trailing fragment still cut off "
    )
    usage = _usage(events)
    assert usage["outputTruncated"] is True  # honestly reported when the cap is hit
    assert usage["continuationRounds"] == 2


def test_repetition_guard_trips_on_looped_lines():
    guard = _RepetitionGuard()
    tripped = False
    for _ in range(15):
        tripped = guard.feed("The same repeated row of text\n")
        if tripped:
            break
    assert tripped and guard.tripped


def test_repetition_guard_trips_on_whitespace_flood():
    guard = _RepetitionGuard()
    tripped = False
    for _ in range(10):
        tripped = guard.feed(" " * 300 + "\n\n")
        if tripped:
            break
    assert tripped  # megabytes of spaces/newlines must not stream for minutes


def test_repetition_guard_whitespace_run_resets_on_content():
    guard = _RepetitionGuard()
    for i in range(50):
        assert guard.feed(" " * 100) is False  # under the flood limit each time…
        assert guard.feed(f"Distinct content line number {i} resets the run\n") is False


def test_repetition_guard_ignores_dividers_and_varied_lines():
    guard = _RepetitionGuard()
    for _ in range(30):
        assert guard.feed("|---|---|---|\n") is False
        assert guard.feed("--------------------\n") is False
    varied = _RepetitionGuard()
    for i in range(40):
        assert varied.feed(f"Line number {i} with distinct content\n") is False


def test_looks_like_restart():
    prior = "".join(f"Point {i}: the tribunal considered submission number {i}.\n" for i in range(8))
    assert _looks_like_restart(prior, prior[:300] + "new tail") is True
    assert _looks_like_restart(prior, "Completely new continuation content that goes on for quite a while longer than the probe minimum.") is False
    assert _looks_like_restart(prior, "short") is False


def test_degenerate_round_aborts_early_then_gives_up_after_one_recovery(monkeypatch):
    monkeypatch.setenv("CHAT_CONTINUATION_ATTEMPTS", "3")
    looped = [_Chunk("The model is stuck repeating this line\n") for _ in range(60)]
    looped.append(_Chunk("", finish="MAX_TOKENS", usage=_Usage(1, 1, 2)))
    client = _FakeClient([looped])  # every round replays the same loop
    events = _run(client)
    chunks = [e for e in events if e["type"] == "chunk"]
    assert len(chunks) < 20  # aborted within seconds, not after 60 repeats
    assert len(client.models.calls) == 2  # one recovery attempt, then give up
    assert _usage(events)["outputTruncated"] is True


def test_degenerate_round_recovers_with_fresh_content(monkeypatch):
    monkeypatch.setenv("CHAT_CONTINUATION_ATTEMPTS", "3")
    looped = [_Chunk("| Provision | Purpose | header repeating\n") for _ in range(40)]
    recovery = [_Chunk("| Sec 138 NI Act | Cheque dishonour |\nRemaining sections complete.", finish="STOP", usage=_Usage(2, 3, 5))]
    client = _FakeClient([looped, recovery])
    events = _run(client)
    ans = _answer(events)
    assert ans.endswith("Remaining sections complete.")
    assert len(client.models.calls) == 2
    # The recovery round must use the recovery prompt, not the plain continue prompt.
    cont_texts = [
        p.text
        for c in client.models.calls[1]
        if getattr(c, "parts", None)
        for p in c.parts
        if getattr(p, "text", None)
    ]
    assert any("repeating itself" in t for t in cont_texts)
    assert _usage(events)["outputTruncated"] is False


def test_restarted_continuation_is_discarded(monkeypatch):
    monkeypatch.setenv("CHAT_CONTINUATION_ATTEMPTS", "3")
    intro = "".join(f"Point {i}: the tribunal considered submission number {i}.\n" for i in range(8))
    body = "".join(f"Ruling {i}: the objection was overruled on ground {i}.\n" for i in range(8))
    first = intro + body  # > 600 chars so the restart escapes tail-overlap trimming
    restart = intro + "Fresh ending that differs from the original."
    client = _FakeClient(
        [
            [_Chunk(first, finish="MAX_TOKENS", usage=_Usage(5, 5, 10))],
            [_Chunk(restart, finish="STOP", usage=_Usage(1, 1, 2))],
        ]
    )
    events = _run(client)
    assert _answer(events) == first  # duplicate round discarded, no double text
    assert len(client.models.calls) == 2  # tried once, then gave up
    usage = _usage(events)
    assert usage["outputTruncated"] is True  # still honestly flagged
    assert usage["inputTokens"] == 6  # both rounds' tokens are still accounted


def test_time_budget_stops_continuations(monkeypatch):
    monkeypatch.setenv("CHAT_CONTINUATION_ATTEMPTS", "3")
    monkeypatch.setenv("CHAT_CONTINUATION_TIME_BUDGET", "0.000001")
    client = _FakeClient(
        [
            [_Chunk("First part of a long answer that got cut. ", finish="MAX_TOKENS", usage=_Usage(1, 1, 2))],
            [_Chunk("Second part that would have followed.", finish="STOP", usage=_Usage(1, 1, 2))],
        ]
    )
    events = _run(client)
    assert len(client.models.calls) == 1  # budget exhausted before round 2
    assert _usage(events)["outputTruncated"] is True


def test_continuation_time_budget_env(monkeypatch):
    monkeypatch.setenv("CHAT_CONTINUATION_TIME_BUDGET", "300")
    assert continuation_time_budget() == 300.0
    monkeypatch.setenv("CHAT_CONTINUATION_TIME_BUDGET", "0")
    assert continuation_time_budget() == 0.0  # 0 = unlimited
    monkeypatch.setenv("CHAT_CONTINUATION_TIME_BUDGET", "bogus")
    assert continuation_time_budget() == 150.0
    monkeypatch.setenv("CHAT_CONTINUATION_TIME_BUDGET", "")
    assert continuation_time_budget() == 0.0


def test_failed_continuation_delivers_partial_answer(monkeypatch):
    monkeypatch.setenv("CHAT_CONTINUATION_ATTEMPTS", "2")

    class _ExplodingModels(_FakeModels):
        def generate_content_stream(self, *, model, contents, config):
            if len(self.calls) >= 1:
                raise RuntimeError("boom")
            return super().generate_content_stream(model=model, contents=contents, config=config)

    client = _FakeClient([[_Chunk("partial ", finish="MAX_TOKENS", usage=_Usage(1, 1, 2))]])
    client.models = _ExplodingModels(client.models.rounds)
    events = _run(client)
    assert _answer(events) == "partial "
    usage = _usage(events)
    assert usage["outputTruncated"] is True
