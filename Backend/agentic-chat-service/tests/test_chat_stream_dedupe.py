"""Regression: ADK cumulative stream pieces must not explode answer length."""
from __future__ import annotations

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from app.services.llm_service import (  # noqa: E402
    _append_stream_piece,
    _build_generation_config,
    _is_max_tokens_finish,
)


def test_append_stream_piece_handles_cumulative_snapshots():
    full, d1 = _append_stream_piece("", "Hello")
    assert full == "Hello" and d1 == "Hello"
    full, d2 = _append_stream_piece(full, "Hello world")
    assert full == "Hello world" and d2 == " world"
    full, d3 = _append_stream_piece(full, "Hello world")
    assert full == "Hello world" and d3 == ""


def test_append_stream_piece_handles_true_deltas():
    full, d1 = _append_stream_piece("", "Hel")
    full, d2 = _append_stream_piece(full, "lo")
    full, d3 = _append_stream_piece(full, "!")
    assert full == "Hello!"
    assert d1 == "Hel" and d2 == "lo" and d3 == "!"


def test_append_stream_piece_does_not_double_suffix():
    full, _ = _append_stream_piece("", "SUMMARY:\n| A | B |")
    full, delta = _append_stream_piece(full, "| A | B |")
    assert delta == ""
    assert full.count("| A | B |") == 1


def test_is_max_tokens_finish_accepts_enum_forms():
    assert _is_max_tokens_finish("MAX_TOKENS") is True
    assert _is_max_tokens_finish("FinishReason.MAX_TOKENS") is True
    assert _is_max_tokens_finish("FinishReason.STOP") is False
    assert _is_max_tokens_finish(None) is False


def test_build_generation_config_honours_admin_max_output_tokens():
    cfg = _build_generation_config(
        {"max_output_tokens": 60000, "max_output_tokens_cap": 60000, "model_temperature": 0.2}
    )
    assert cfg["max_output_tokens"] == 60000
    assert cfg["temperature"] == 0.2


def test_map_row_raises_tiny_max_output_tokens_floor():
    from app.services.llm_config_service import _map_row

    mapped = _map_row({"max_output_tokens": 5, "max_output_tokens_cap": 5})
    assert mapped["max_output_tokens"] == 20000
    assert mapped["max_output_tokens_cap"] == 20000


def test_wants_judgement_search_not_hijacked_by_long_templates():
    from app.services.chat_helpers import wants_judgement_search

    # Explicit flag always wins (frontend Citation toggle)
    assert wants_judgement_search({"web_search": True, "question": "x"}) is True
    # Short query-like intent still triggers
    assert wants_judgement_search({"question": "find judgements on cheque bounce"}) is True
    # A long analysis template that merely CONTAINS such words must stay in chat
    template = (
        "# ROLE You are an expert legal analyst. ... 14. Case Law (if Applicable) "
        "List: All cited precedents (case law). Supporting precedents. "
        "Find judgements is not what we ask here. " + "x" * 400
    )
    assert wants_judgement_search({"question": template}) is False
    # Bare mention of 'precedents' in a normal short question does not trigger
    assert wants_judgement_search({"question": "explain precedents in this order"}) is False
