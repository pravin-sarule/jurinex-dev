"""Chat thinking must run at each model family's minimum (speed + output budget).

On Gemini 2.5, thinking tokens count against max_output_tokens and delay the
first visible token, so chat paths send the smallest thinking config the model
allows: 0 for Flash, the 128 floor for 2.5 Pro, thinking_level=low for 3.x,
and nothing at all for models without thinking support.
"""
from __future__ import annotations

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from app.services.llm_service import _build_generation_config, _chat_thinking_config  # noqa: E402


def _budget(cfg):
    tc = cfg.get("thinking_config")
    return None if tc is None else tc.thinking_budget


def test_flash_thinking_disabled_by_default(monkeypatch):
    monkeypatch.delenv("CHAT_THINKING_BUDGET", raising=False)
    assert _budget(_chat_thinking_config("gemini-2.5-flash")) == 0
    assert _budget(_chat_thinking_config("gemini-2.5-flash-lite")) == 0


def test_pro_clamps_to_its_minimum(monkeypatch):
    monkeypatch.delenv("CHAT_THINKING_BUDGET", raising=False)
    assert _budget(_chat_thinking_config("gemini-2.5-pro")) == 128
    monkeypatch.setenv("CHAT_THINKING_BUDGET", "64")
    assert _budget(_chat_thinking_config("gemini-2.5-pro")) == 128


def test_env_raises_budget(monkeypatch):
    monkeypatch.setenv("CHAT_THINKING_BUDGET", "4096")
    assert _budget(_chat_thinking_config("gemini-2.5-flash")) == 4096
    assert _budget(_chat_thinking_config("gemini-2.5-pro")) == 4096


def test_gemini3_uses_low_thinking_level(monkeypatch):
    monkeypatch.delenv("CHAT_THINKING_BUDGET", raising=False)
    cfg = _chat_thinking_config("gemini-3.1-pro-preview")
    assert str(cfg["thinking_config"].thinking_level).upper().endswith("LOW")
    assert cfg["thinking_config"].thinking_budget is None


def test_non_thinking_models_get_no_config(monkeypatch):
    monkeypatch.delenv("CHAT_THINKING_BUDGET", raising=False)
    assert _chat_thinking_config("gemini-2.0-flash") == {}
    assert _chat_thinking_config("gemini-2.0-flash-lite") == {}
    assert _chat_thinking_config("claude-sonnet-5") == {}


def test_empty_env_means_model_default(monkeypatch):
    monkeypatch.setenv("CHAT_THINKING_BUDGET", "")
    assert _chat_thinking_config("gemini-2.5-flash") == {}
    assert _chat_thinking_config("gemini-2.5-pro") == {}


def test_generation_config_carries_model_thinking(monkeypatch):
    monkeypatch.delenv("CHAT_THINKING_BUDGET", raising=False)
    cfg = _build_generation_config({"max_output_tokens": 60000}, "gemini-2.5-flash")
    assert cfg["max_output_tokens"] == 60000
    assert cfg["thinking_config"].thinking_budget == 0
    cfg_pro = _build_generation_config({"max_output_tokens": 60000}, "gemini-2.5-pro")
    assert cfg_pro["thinking_config"].thinking_budget == 128
