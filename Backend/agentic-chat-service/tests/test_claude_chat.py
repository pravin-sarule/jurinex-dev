"""Claude chat models (DB llm_chat_config.llm_model = claude-*): uncached
streaming with DB max_output_tokens and prefill-based MAX_TOKENS continuation.
"""
from __future__ import annotations

import asyncio
import pathlib
import sys
from types import SimpleNamespace

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from app.services.llm_service import (  # noqa: E402
    _claude_output_cap,
    _is_claude_model,
    _stream_claude_chat,
)


class _FakeClaudeStream:
    def __init__(self, texts, stop_reason, usage):
        self._texts = texts
        self._final = SimpleNamespace(stop_reason=stop_reason, usage=usage)
        self.text_stream = self._gen()

    async def _gen(self):
        for t in self._texts:
            yield t

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    async def get_final_message(self):
        return self._final


class _FakeMessages:
    def __init__(self, rounds):
        self.rounds = rounds
        self.calls: list[dict] = []

    def stream(self, **kwargs):
        self.calls.append(kwargs)
        texts, stop, usage = self.rounds[min(len(self.calls) - 1, len(self.rounds) - 1)]
        return _FakeClaudeStream(texts, stop, usage)


class _FakeAnthropic:
    def __init__(self, rounds):
        self.messages = _FakeMessages(rounds)


def _usage(n_in, n_out):
    return SimpleNamespace(input_tokens=n_in, output_tokens=n_out)


def _run(client, model="claude-sonnet-5", mot=60000):
    async def _collect():
        events = []
        async for ev in _stream_claude_chat(
            model=model,
            system_instruction="You are a legal assistant.",
            user_content="Analyse this matter.",
            llm_config={"max_output_tokens": mot},
            metadata={},
            endpoint="/test",
            client=client,
        ):
            events.append(ev)
        return events

    return asyncio.run(_collect())


def _answer(events):
    return "".join(e["text"] for e in events if e["type"] == "chunk")


def test_is_claude_model():
    assert _is_claude_model("claude-sonnet-5") is True
    assert _is_claude_model("Claude-Opus-4-8") is True
    assert _is_claude_model("gemini-2.5-flash") is False
    assert _is_claude_model(None) is False


def test_simple_claude_answer_uses_db_max_tokens():
    client = _FakeAnthropic([(["The answer."], "end_turn", _usage(10, 5))])
    events = _run(client)
    assert _answer(events) == "The answer."
    call = client.messages.calls[0]
    assert call["max_tokens"] == 60000  # DB value, under the sonnet 64k cap
    assert call["thinking"] == {"type": "disabled"}  # minimum thinking
    usage = [e for e in events if e["type"] == "usage"][0]
    assert usage["outputTruncated"] is False
    assert usage["inputTokens"] == 10 and usage["outputTokens"] == 5


def test_opus_output_cap_applied():
    assert _claude_output_cap("claude-opus-4-8") == 32000
    client = _FakeAnthropic([(["ok"], "end_turn", _usage(1, 1))])
    _run(client, model="claude-opus-4-8", mot=60000)
    assert client.messages.calls[0]["max_tokens"] == 32000


def test_max_tokens_continuation_uses_assistant_prefill():
    client = _FakeAnthropic(
        [
            (["Part one of the judgment analysis"], "max_tokens", _usage(100, 200)),
            ([" and part two, complete."], "end_turn", _usage(50, 60)),
        ]
    )
    events = _run(client)
    assert _answer(events) == "Part one of the judgment analysis and part two, complete."
    assert len(client.messages.calls) == 2
    cont_msgs = client.messages.calls[1]["messages"]
    assert cont_msgs[-1]["role"] == "assistant"  # prefill continuation
    assert cont_msgs[-1]["content"] == "Part one of the judgment analysis"
    usage = [e for e in events if e["type"] == "usage"][0]
    assert usage["inputTokens"] == 150 and usage["outputTokens"] == 260
    assert usage["outputTruncated"] is False
    assert usage["continuationRounds"] == 1
    statuses = [e for e in events if e["type"] == "status"]
    assert statuses and statuses[0]["status"] == "continuing"


def test_pdf_with_text_layer_is_sent_as_text(monkeypatch):
    """A PDF with a text layer must go to Claude as extracted text (true token
    size), not as a document block (which bills ~2k tokens per page as images)."""
    from app.services import gcs_service, llm_service

    monkeypatch.setattr(gcs_service, "download_object_buffer", lambda b, p: b"%PDF-fake")
    monkeypatch.setattr(
        llm_service, "_pdf_text_for_claude", lambda data: "[Page 1]\n" + "Real body text. " * 200
    )
    blocks = llm_service._claude_file_blocks(["gs://bucket/case.pdf"])
    assert blocks[0]["type"] == "text"
    assert blocks[0]["text"].startswith("DOCUMENT: case.pdf")
    assert "[Page 1]" in blocks[0]["text"]


def test_scanned_pdf_falls_back_to_document_block(monkeypatch):
    from app.services import gcs_service, llm_service

    monkeypatch.setattr(gcs_service, "download_object_buffer", lambda b, p: b"%PDF-fake")
    monkeypatch.setattr(llm_service, "_pdf_text_for_claude", lambda data: "  \n ")
    blocks = llm_service._claude_file_blocks(["gs://bucket/scan.pdf"])
    assert blocks[0]["type"] == "document"
    assert blocks[0]["source"]["media_type"] == "application/pdf"


def test_huge_text_pdf_raises_so_gemini_takes_over(monkeypatch):
    import pytest
    from app.services import gcs_service, llm_service

    monkeypatch.setattr(gcs_service, "download_object_buffer", lambda b, p: b"%PDF-fake")
    monkeypatch.setattr(llm_service, "_pdf_text_for_claude", lambda data: "x" * 700_000)
    with pytest.raises(RuntimeError, match="exceeds Claude"):
        llm_service._claude_file_blocks(["gs://bucket/huge.pdf"])
