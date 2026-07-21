from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import logging
import os
import re
import tempfile
import time
import uuid
from collections.abc import AsyncIterator
from typing import Any

from app.core.config import get_settings
from app.services.gcs_service import mime_from_path
from app.services.llm_config_service import resolve_vertex_model_id
from app.services.llm_usage_service import log_llm_usage

logger = logging.getLogger(__name__)

# Aliases: DB-stored legacy names → canonical Vertex model names
_MODEL_ALIASES: dict[str, str] = {
    "gemini-pro-2.5": "gemini-2.5-pro",
    "gemini-flash-2.5": "gemini-2.5-flash",
    "gemini-flash-lite-2.5": "gemini-2.5-flash-lite",
    "gemini-pro-latest": "gemini-2.5-flash",
    "gemini-pro": "gemini-2.5-flash",
    "gemini-flash-lite": "gemini-2.5-flash-lite",
    # Loose Claude names admins may store → current Anthropic API ids
    "claude": "claude-sonnet-5",
    "claude-sonnet": "claude-sonnet-5",
    "claude-opus": "claude-opus-4-8",
    "claude-opus-latest": "claude-opus-4-8",
    "claude-sonnet-latest": "claude-sonnet-5",
    # versioned aliases that don't exist in the API — normalize to the stable name
    "gemini-2.5-flash-001": "gemini-2.5-flash",
    "gemini-2.0-flash-001": "gemini-2.0-flash",
    "gemini-2.0-flash-lite-001": "gemini-2.0-flash-lite",
}

MODEL_FALLBACKS: dict[str, list[str]] = {
    # Claude (Anthropic API) — drafting mode only; degrade within the family,
    # then to Gemini flagships (covers a missing/invalid ANTHROPIC_API_KEY).
    "claude-sonnet-5": ["claude-sonnet-5", "claude-sonnet-4-6", "gemini-3.1-pro-preview", "gemini-2.5-pro"],
    "claude-sonnet-4-6": ["claude-sonnet-4-6", "claude-sonnet-5", "gemini-3.1-pro-preview", "gemini-2.5-pro"],
    "claude-opus-4-8": ["claude-opus-4-8", "claude-sonnet-5", "gemini-3.1-pro-preview", "gemini-2.5-pro"],
    "claude-opus-4-7": ["claude-opus-4-7", "claude-opus-4-8", "claude-sonnet-5", "gemini-3.1-pro-preview"],
    "claude-opus-4-6": ["claude-opus-4-6", "claude-opus-4-8", "claude-sonnet-5", "gemini-3.1-pro-preview"],
    # Deprecated (EOL Aug 2026) but still admin-selectable — degrade to current Opus
    "claude-opus-4-1": ["claude-opus-4-1", "claude-opus-4-8", "claude-sonnet-5", "gemini-2.5-pro"],
    # Gemini 3.x — degrade within the family, then to the 2.5 tier on failure
    "gemini-3.5-flash": ["gemini-3.5-flash", "gemini-3-flash-preview", "gemini-2.5-flash"],
    "gemini-3.1-pro-preview": ["gemini-3.1-pro-preview", "gemini-2.5-pro", "gemini-2.5-flash"],
    "gemini-3-flash-preview": ["gemini-3-flash-preview", "gemini-2.5-flash", "gemini-2.5-flash-lite"],
    "gemini-flash-lite-latest": ["gemini-2.5-flash-lite", "gemini-2.5-flash", "gemini-2.0-flash-lite"],
    "gemini-flash-lite": ["gemini-2.5-flash-lite", "gemini-2.5-flash", "gemini-2.0-flash-lite"],
    "gemini-pro-latest": ["gemini-2.5-flash", "gemini-2.5-flash-lite"],
    "gemini-pro": ["gemini-2.5-flash", "gemini-2.5-flash-lite"],
    "gemini-2.0-flash-lite": ["gemini-2.0-flash-lite", "gemini-2.5-flash-lite", "gemini-2.5-flash"],
    "gemini-2.0-flash-lite-001": ["gemini-2.0-flash-lite", "gemini-2.5-flash-lite", "gemini-2.5-flash"],
    "gemini-2.0-flash": ["gemini-2.0-flash", "gemini-2.5-flash", "gemini-2.5-flash-lite"],
    "gemini-2.0-flash-001": ["gemini-2.0-flash", "gemini-2.5-flash", "gemini-2.5-flash-lite"],
    "gemini-2.5-flash-lite": ["gemini-2.5-flash-lite", "gemini-2.5-flash"],
    "gemini-2.5-flash": ["gemini-2.5-flash", "gemini-2.5-flash-lite"],
    "gemini-2.5-flash-001": ["gemini-2.5-flash", "gemini-2.5-flash-lite"],
    "gemini-2.5-pro": ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite"],
}

_genai_client = None
_vertex_genai_client = None
_adk_adc_file: str | None = None


def _get_client():
    global _genai_client
    if _genai_client is not None:
        return _genai_client
    from google import genai

    settings = get_settings()
    if settings.gemini_api_key:
        _genai_client = genai.Client(api_key=settings.gemini_api_key)
    else:
        _genai_client = genai.Client(
            vertexai=True,
            project=settings.gcloud_project_id,
            location=settings.gcp_location,
        )
    return _genai_client


def _get_vertex_client():
    """Vertex client for gs:// file parts (API key cannot read private GCS URIs)."""
    global _vertex_genai_client
    if _vertex_genai_client is not None:
        return _vertex_genai_client
    from google import genai

    from app.services.gcs_service import get_service_account_credentials

    settings = get_settings()
    project = (settings.gcloud_project_id or "").strip()
    if not project:
        raise RuntimeError("GCLOUD_PROJECT_ID is required for GCS-backed Gemini calls")
    kwargs: dict[str, Any] = {
        "vertexai": True,
        "project": project,
        "location": settings.gcp_location,
    }
    creds = get_service_account_credentials()
    if creds is not None:
        kwargs["credentials"] = creds
    _vertex_genai_client = genai.Client(**kwargs)
    return _vertex_genai_client


def _ensure_adk_google_client_env() -> None:
    """Expose existing service credentials in the env shape ADK's GoogleLLM reads."""
    global _adk_adc_file
    settings = get_settings()

    if settings.gemini_api_key:
        os.environ.setdefault("GEMINI_API_KEY", settings.gemini_api_key)
        return

    project = (settings.gcloud_project_id or "").strip()
    if not project:
        return

    os.environ.setdefault("GOOGLE_GENAI_USE_VERTEXAI", "true")
    os.environ.setdefault("GOOGLE_CLOUD_PROJECT", project)
    os.environ.setdefault("GOOGLE_CLOUD_LOCATION", settings.gcp_location or "us-central1")

    if settings.gcs_key_base64 and not os.environ.get("GOOGLE_APPLICATION_CREDENTIALS"):
        if _adk_adc_file is None:
            try:
                decoded = base64.b64decode(settings.gcs_key_base64).decode("utf-8")
                json.loads(decoded)
                fd, path = tempfile.mkstemp(prefix="adk-google-adc-", suffix=".json")
                with os.fdopen(fd, "w", encoding="utf-8") as f:
                    f.write(decoded)
                _adk_adc_file = path
            except Exception as exc:
                logger.warning("Could not prepare ADK Google credentials file: %s", exc)
        if _adk_adc_file:
            os.environ.setdefault("GOOGLE_APPLICATION_CREDENTIALS", _adk_adc_file)


def _normalize_model(name: str) -> str:
    stripped = name.strip().removeprefix("models/")
    key = stripped.lower()
    return _MODEL_ALIASES.get(key, _MODEL_ALIASES.get(stripped, stripped))


def _is_claude_model(model: str | None) -> bool:
    return (model or "").strip().lower().startswith("claude")


def _claude_output_cap(model: str) -> int:
    """Hard output ceiling per Claude family — requesting more 400s the API."""
    return 32000 if "opus" in (model or "").lower() else 64000


def _anthropic_api_key() -> str:
    """ANTHROPIC_API_KEY from the env, falling back to the service .env
    (mirrors drafting_monolithic — the key may not be exported to os.environ)."""
    key = (os.environ.get("ANTHROPIC_API_KEY") or "").strip()
    if key:
        return key
    try:
        from dotenv import dotenv_values

        key = (dotenv_values(".env").get("ANTHROPIC_API_KEY") or "").strip()
        if key:
            os.environ["ANTHROPIC_API_KEY"] = key
    except Exception:
        key = ""
    return key


def build_model_list(llm_config: dict[str, Any], override: str | None = None) -> list[str]:
    raw_primary = (
        override
        or resolve_vertex_model_id(llm_config)
        or llm_config.get("llm_model")
        or get_settings().adk_model
        or "gemini-2.5-pro"
    ).strip()
    primary = _normalize_model(raw_primary)
    seen: set[str] = set()
    result: list[str] = []

    def _add(m: str) -> None:
        n = _normalize_model(m)
        if n and n not in seen:
            seen.add(n)
            result.append(n)

    _add(primary)
    for m in MODEL_FALLBACKS.get(primary, MODEL_FALLBACKS.get(primary.lower(), [])):
        _add(m)
    # Always have safe fallbacks at the end
    _add("gemini-2.5-flash-lite")
    _add("gemini-2.5-flash")
    return result


def _build_generation_config(llm_config: dict[str, Any], model: str | None = None) -> dict[str, Any]:
    """Build Gemini generation params from `llm_chat_config` (Document_DB).

    `max_output_tokens` is the configured output budget: if the row says 30000,
    generation may use up to 30000 tokens; if it says 5000, generation is capped
    at 5000. Cap never raises the budget above the configured value unless a
    separate `max_output_tokens_cap` was merged into llm_config already.

    ``model`` selects the minimal thinking config for that model family.
    """
    mot = max(1, int(llm_config.get("max_output_tokens") or 65536))
    # Prefer configured max when cap is missing/zero; never inflate above mot.
    raw_cap = llm_config.get("max_output_tokens_cap")
    try:
        cap = int(raw_cap) if raw_cap is not None else mot
    except (TypeError, ValueError):
        cap = mot
    if cap <= 0:
        cap = mot
    effective = min(mot, cap)
    # Respect an explicit temperature of 0 (deterministic) — `or` would drop it.
    raw_temp = llm_config.get("model_temperature")
    try:
        temperature = float(raw_temp) if raw_temp is not None else 0.7
    except (TypeError, ValueError):
        temperature = 0.7
    logger.debug(
        "LLM generation config max_output_tokens=%s temperature=%.2f (config_mot=%s cap=%s)",
        effective,
        temperature,
        mot,
        cap,
    )
    cfg: dict[str, Any] = {
        "max_output_tokens": effective,
        "temperature": temperature,
    }
    thinking = _chat_thinking_config(model)
    if thinking:
        cfg.update(thinking)
    return cfg


def _inline_file_parts(gcs_uris: list[str]) -> list[Any]:
    """Download GCS objects and build inline parts (fallback when Vertex URI fetch fails)."""
    from google.genai import types as gt

    from app.services.gcs_service import download_object_buffer, parse_gcs_uri

    parts = []
    for uri in gcs_uris:
        parsed = parse_gcs_uri(uri)
        if not parsed:
            continue
        bucket, path = parsed
        data = download_object_buffer(bucket, path)
        parts.append(gt.Part.from_bytes(data=data, mime_type=mime_from_path(path)))
    return parts


def _extract_stream_payload(chunk: Any) -> tuple[str, str]:
    answer = ""
    thought = ""
    text_attr = getattr(chunk, "text", None)
    if callable(text_attr):
        try:
            text_attr = text_attr()
        except Exception:
            text_attr = ""
    if isinstance(text_attr, str) and text_attr:
        answer = text_attr

    candidates = getattr(chunk, "candidates", None) or []
    if candidates:
        cand = candidates[0]
        delta = getattr(cand, "delta", None)
        if delta is not None:
            parts = getattr(getattr(delta, "content", None), "parts", None) or []
        else:
            parts = getattr(getattr(cand, "content", None), "parts", None) or []
        for part in parts:
            t = getattr(part, "text", None) or ""
            if getattr(part, "thought", False):
                thought += t
            else:
                answer += t
    return answer, thought


def _aggregate_candidate_text(chunk: Any) -> str:
    answer, thought = _extract_stream_payload(chunk)
    if answer.strip():
        if thought.strip() and len(thought) > len(answer) * 2 and len(thought) > 400:
            return f"{answer}\n\n{thought}"
        return answer
    return thought


def _append_stream_piece(current: str, piece: str) -> tuple[str, str]:
    """Append a stream piece; return (new_full, delta_to_emit). Handles cumulative chunks."""
    if not piece:
        return current, ""
    if not current:
        return piece, piece
    if piece == current:
        return current, ""

    # 1. Cumulative snapshot check (most common in Gemini)
    if piece.startswith(current):
        delta = piece[len(current) :]
        return current + delta, delta

    # Suffix overlap check (model started slightly before the last chunk)
    # Only check recent tail for performance and to avoid eating legitimate substrings.
    # We require a minimum length of 50 chars for suffix matching to avoid
    # accidentally eating short, legitimate repeats like table pipes or list bullets.
    if len(piece) >= 50:
        tail_len = min(len(current), 1000)
        tail = current[-tail_len:]
        if tail.endswith(piece):
            return current, ""

    # 3. For all other cases, it's a new delta
    return current + piece, piece


def _stream_tail_delta(streamed: str, last_chunk: Any) -> tuple[str, str]:
    """Return (full_text, delta) when the final chunk holds text the stream skipped."""
    if last_chunk is None:
        return streamed, ""
    agg = _aggregate_candidate_text(last_chunk)
    if len(agg) <= len(streamed):
        return streamed, ""
    return agg, agg[len(streamed) :]


def _is_max_tokens_finish(finish: Any) -> bool:
    """True when the model stopped because the output token budget was exhausted.

    Gemini/ADK report this as ``MAX_TOKENS`` or ``FinishReason.MAX_TOKENS`` —
    exact equality against ``"MAX_TOKENS"`` misses the enum form and leaves
    truncated answers marked as successful.
    """
    return bool(finish) and "MAX_TOKENS" in str(finish).upper()


# When Gemini stops with MAX_TOKENS mid-answer, the partial answer is fed back
# as a model turn and the model is asked to continue, so the user receives the
# complete output instead of a truncated one. Shared by every chat path
# (general, GCS document fallback, judgement search, ADK cache).
CHAT_CONTINUATION_PROMPT = (
    "CONTINUE your previous answer EXACTLY from where it stopped. "
    "Do NOT repeat any earlier content. Do NOT restart from the beginning. "
    "Do NOT output any introductory text or preamble. "
    "Complete any unfinished section, table, list, or SUMMARY. "
    "Output ONLY the missing continuation pieces."
)

# Used after a round is aborted because the model fell into a repetition loop
# (e.g. re-emitting a table header forever). Telling it what happened and to
# rewrite the failed structure ONCE recovers the rest of the answer.
CHAT_RECOVERY_PROMPT = (
    "Your previous answer stopped because it started repeating itself (degenerate loop). "
    "CONTINUE the answer from where it went wrong, but DO NOT use the same structure "
    "that caused the repetition. If a table or list was being written, write it again "
    "ONCE with its correct rows — and if the same table keeps failing, present that "
    "section as a bulleted list instead of a table. Then continue with ALL remaining "
    "sections until the answer is complete. "
    "Do NOT repeat any earlier content. Do NOT restart from the beginning. "
    "Be direct and varied in your output to avoid another loop."
)


def build_recovery_prompt(delivered: str) -> str:
    """Recovery prompt with the exact break point quoted, so the model knows
    where to resume instead of guessing (and re-looping).

    The degenerate tail itself (e.g. a table separator that flooded into 1000
    dashes) is trimmed before quoting — echoing it back reads as an invitation
    to resume the flood.
    """
    text = (delivered or "").rstrip()
    text = re.sub(r"[\s|\-:=+_~*#.]{8,}$", "", text)
    snippet = text[-160:]
    if not snippet:
        return CHAT_RECOVERY_PROMPT
    return f'{CHAT_RECOVERY_PROMPT} The answer broke while writing: "…{snippet}".'


def supports_frequency_penalty(model_name: str | None) -> bool:
    """True only for Gemini families that accept penalty sampling params.

    Gemini 2.5+ rejects them outright with
    ``400 INVALID_ARGUMENT: Penalty is not enabled for models/<model>``, which
    kills the whole recovery attempt. Raising temperature is what actually
    breaks a repetition loop; the penalty is a bonus, so when in doubt omit it
    rather than risk a hard 400.
    """
    tail = _normalize_model(model_name or "").lower()
    if "/" in tail:
        tail = tail.split("/")[-1]
    return tail.startswith("gemini-1.5") or tail.startswith("gemini-2.0")


def _recovery_sampling(config: Any, model_name: str | None = None) -> Any:
    """Recovery-round config: raise temperature and, where supported, add a
    frequency penalty.

    Low-temperature runs recreate the exact same repetition loop
    deterministically; changed sampling is what actually escapes it.
    """
    try:
        base_temp = float(getattr(config, "temperature", None) or 0.0)
        update: dict[str, Any] = {"temperature": max(0.7, base_temp)}
        if supports_frequency_penalty(model_name):
            update["frequency_penalty"] = 0.4
        return config.model_copy(update=update)
    except Exception:
        return config

# A continuation round may restart slightly before the cut point; overlap up to
# this many chars against the already-delivered tail is detected and dropped.
_CONTINUATION_TRIM_WINDOW = 1200


def continuation_attempts() -> int:
    """Max auto-continuation rounds after a MAX_TOKENS finish.

    Env ``CHAT_CONTINUATION_ATTEMPTS`` (default 3). Each round gets the full
    admin-configured ``max_output_tokens`` budget again, so 3 rounds cover
    answers up to 4x the configured budget before a truncated answer can reach
    the user.
    """
    raw = os.environ.get("CHAT_CONTINUATION_ATTEMPTS", "3").strip()
    try:
        return max(0, int(raw))
    except ValueError:
        return 3


def continuation_time_budget() -> float:
    """Wall-clock ceiling (seconds) for a chat generation including continuations.

    Env ``CHAT_CONTINUATION_TIME_BUDGET`` (default 150). Once exceeded, no
    further continuation rounds start — the partial answer is delivered and
    honestly flagged truncated instead of keeping the user waiting for many
    minutes. 0 or empty = no time limit.
    """
    raw = os.environ.get("CHAT_CONTINUATION_TIME_BUDGET", "150").strip()
    if not raw:
        return 0.0
    try:
        return max(0.0, float(raw))
    except ValueError:
        return 150.0


# A continuation that restarts the answer from the beginning (instead of
# continuing) is detected by probing this many chars of its head against the
# already-delivered text; probes shorter than the minimum are inconclusive.
_RESTART_PROBE_CHARS = 400
_RESTART_PROBE_MIN = 60


def _looks_like_restart(prior: str, round_head: str) -> bool:
    """True when a continuation round's (overlap-trimmed) head already exists
    verbatim in the delivered answer — i.e. the model restarted from scratch.

    Now uses normalized comparison to catch minor variations in punctuation/case.
    """
    if not prior or not round_head:
        return False

    def _normalize(t: str) -> str:
        # Lowercase and remove all non-alphanumeric chars
        return re.sub(r"[^a-z0-9]", "", t.lower())

    # Take a larger probe but require a reasonable minimum length
    probe_raw = round_head[:_RESTART_PROBE_CHARS]
    probe = _normalize(probe_raw)

    if len(probe) < _RESTART_PROBE_MIN:
        return False

    # Check if the normalized probe exists anywhere in the normalized prior text.
    # We normalize the whole prior (expensive but only happens once per round).
    prior_norm = _normalize(prior)
    return probe in prior_norm


# Consecutive non-empty stream pieces swallowed by the duplicate filter before
# the round is declared degenerate (a looping model repeats one fragment, every
# piece dedupes to nothing, and the stream burns budget without progress).
_STALL_LIMIT = 50


class _RepetitionGuard:
    """Detects degenerate generation: the same line emitted over and over.

    Low-temperature models given huge structured templates sometimes fall into
    a repetition loop and burn the entire ``max_output_tokens`` budget (minutes
    of wall-clock) on duplicated rows. The guard trips when the same
    significant line appears ``threshold`` times within the last ``window``
    lines, so the stream can be aborted within seconds instead.

    Lines made only of table/divider punctuation (``|---|``, ``-----``) and
    lines shorter than 15 chars are ignored — those legitimately repeat.

    ``ws_limit`` is deliberately generous: wide, space-padded markdown tables
    can legitimately emit several hundred consecutive chars of pipes/dashes/
    spaces (separator rows + cell padding), and tripping on those cuts a
    healthy answer off right as its first table starts.
    """

    def __init__(self, threshold: int = 15, window: int = 250, ws_limit: int = 1500):
        self.threshold = threshold
        self._recent: list[str] = []
        self._window = window
        self._buf = ""
        self._ws_run = 0
        self._ws_limit = ws_limit
        self.tripped = False

    def feed(self, piece: str) -> bool:
        if self.tripped:
            return True
        # Whitespace floods: a degenerate model can emit megabytes of pure
        # spaces/newlines, which pass every line-based check.
        # We also count non-printable punctuation as whitespace for this limit.
        if re.sub(r"[\s|\-:=+_~*# .]", "", piece):
            self._ws_run = 0
        else:
            self._ws_run += len(piece)
            if self._ws_run >= self._ws_limit:
                self.tripped = True
                return True
        self._buf += piece
        while "\n" in self._buf:
            line, self._buf = self._buf.split("\n", 1)
            clean = line.strip()
            # Ignore short lines (bullets, table borders, etc.)
            if len(clean) < 30:
                continue
            # Use a normalized key for comparison.
            # Digits are normally stripped, as looping models often increment
            # counts or dates while repeating the same text.
            #
            # Markdown table rows are the exception: in a chronology or ledger
            # the digits ARE the content, and rows legitimately share every word
            # ("| 01-09-2005 | receipt for rent/advance | Page 72 |" repeated
            # per receipt). Stripping digits collapses those to one key and
            # trips the guard on a perfectly healthy table. A genuine loop
            # repeats rows verbatim, so it still trips with digits kept.
            if clean.startswith("|"):
                key = re.sub(r"[^a-z0-9]", "", clean.lower())
            else:
                key = re.sub(r"[^a-z]", "", clean.lower())
            if len(key) < 20:
                continue

            self._recent.append(key)
            if len(self._recent) > self._window:
                self._recent.pop(0)

            if self._recent.count(key) >= self.threshold:
                self.tripped = True
                return True
        return False


def _trim_overlap(prior: str, new: str, *, window: int = _CONTINUATION_TRIM_WINDOW, min_overlap: int = 15) -> str:
    """Drop the longest prefix of ``new`` that duplicates the tail of ``prior``.

    Now uses normalized matching to catch repeats with different spacing/newlines.
    """
    if not prior or not new:
        return new

    def _normalize(t: str) -> str:
        return re.sub(r"[^a-z0-9]", "", t.lower())

    tail = prior[-window:]
    limit = min(len(tail), len(new))

    # 1. Try verbatim match first (fastest and most accurate)
    for k in range(limit, min_overlap - 1, -1):
        if tail.endswith(new[:k]):
            return new[k:]

    # 2. Try normalized match (catches spacing/case variations)
    # We take chunks of the new head and see if they exist in the tail
    norm_tail = _normalize(tail)
    for k in range(limit, min_overlap - 1, -1):
        probe = _normalize(new[:k])
        if len(probe) >= min_overlap and norm_tail.endswith(probe):
            return new[k:]

    return new


def _chat_thinking_config(model: str | None = None) -> dict[str, Any]:
    """Gemini thinking for chat (CHAT_THINKING_BUDGET, default 1024).

    Thinking tokens delay the first visible token AND count against
    ``max_output_tokens`` on 2.5 models, but 2.5-flash with thinking fully
    disabled reliably degenerates into repetition loops on long structured
    outputs (multi-section tabular case summaries), so chat keeps a modest
    budget by default:
    - ``-1``: dynamic thinking — the model decides per request (2.5 family)
    - gemini-2.5-pro: thinking cannot be disabled — clamped to its 128 minimum
    - other gemini-2.5 models: budget as configured (0 = off, discouraged)
    - gemini-3.x: ``thinking_level="low"`` (budget is deprecated there)
    - gemini-2.0 and older / non-Gemini: no thinking support — nothing sent

    Empty env = model default (dynamic).
    """
    raw = os.environ.get("CHAT_THINKING_BUDGET", "1024").strip()
    if not raw:
        return {}
    try:
        budget = int(raw)
    except ValueError:
        budget = 1024
    if budget < 0:
        budget = -1  # dynamic
    m = (model or "").lower()
    if m and not m.startswith("gemini"):
        return {}
    try:
        from google.genai import types as gt

        if m.startswith("gemini-3"):
            return {"thinking_config": gt.ThinkingConfig(thinking_level="low")}
        if "2.5-pro" in m:
            return {"thinking_config": gt.ThinkingConfig(thinking_budget=budget if budget < 0 else max(128, budget))}
        if "2.5" in m or not m:
            return {"thinking_config": gt.ThinkingConfig(thinking_budget=budget)}
        return {}
    except Exception:
        return {}


def _normalize_usage(chunk: Any, streamed_len: int = 0) -> dict[str, Any]:
    um = getattr(chunk, "usage_metadata", None)
    prompt = int(getattr(um, "prompt_token_count", 0) or 0) if um else 0
    candidates = int(getattr(um, "candidates_token_count", 0) or 0) if um else 0
    total = int(getattr(um, "total_token_count", 0) or 0) if um else 0
    if not total and (prompt or candidates):
        total = prompt + candidates
    if not total and streamed_len > 0:
        total = max(1, streamed_len // 4)
        candidates = total
    finish = None
    cands = getattr(chunk, "candidates", None)
    if cands:
        finish = getattr(cands[0], "finish_reason", None)
    return {
        "inputTokens": prompt,
        "outputTokens": candidates or total,
        "totalTokens": total or max(1, prompt + candidates),
        "finishReason": str(finish) if finish else None,
        "outputTruncated": _is_max_tokens_finish(finish),
    }


async def _stream_round(sync_iter, state: dict[str, Any], *, prior_text: str = "") -> AsyncIterator[dict[str, Any]]:
    """Stream one generation round, yielding thought/chunk events.

    Fills ``state`` with ``streamed`` (visible text emitted this round) and
    ``last_chunk`` (final SDK chunk, for usage/finish-reason extraction).

    For continuation rounds (``prior_text`` set), the head of the round is
    buffered and overlap-trimmed against the already-delivered text, so a model
    that restarts slightly before the cut point does not duplicate output.
    """
    loop = asyncio.get_event_loop()
    last_chunk = None
    raw = ""  # deduped text of this round, before overlap trimming
    head_emitted = not prior_text  # continuation rounds buffer the head first
    trim_offset = 0
    guard = _RepetitionGuard()
    aborted = False
    stalls = 0  # consecutive non-empty pieces fully eaten by the dedupe

    def _next():
        try:
            return next(sync_iter)
        except StopIteration:
            return None

    while True:
        chunk = await loop.run_in_executor(None, _next)
        if chunk is None:
            break
        last_chunk = chunk
        answer, thought = _extract_stream_payload(chunk)
        if thought:
            yield {"type": "thought", "text": thought}
        piece = answer
        thought_as_answer = False
        if not piece and thought and not raw.strip():
            piece = thought
            thought_as_answer = True
        if not piece:
            continue
        raw, delta = _append_stream_piece(raw, piece)
        if not delta:
            # `_append_stream_piece` drops pieces that already exist in the
            # text. A looping model repeats the same fragment forever — every
            # piece gets dropped, the answer stops growing, and the stream
            # silently burns the whole output budget. Abort on a long run of
            # swallowed pieces instead of stalling for minutes.
            if len(piece) >= 15:
                stalls += 1
                if stalls >= _STALL_LIMIT:
                    state["degenerate"] = True
                    aborted = True
                    logger.warning(
                        "Stream stalled: %s consecutive duplicate pieces — aborting round.", stalls
                    )
                    break
            continue
        stalls = 0
        if thought_as_answer:
            logger.warning("Stream chunk had only thought text; using as visible answer.")
        if not head_emitted:
            if guard.feed(delta):
                state["degenerate"] = True
                aborted = True
                logger.warning("Degenerate repetition while buffering continuation head — aborting round.")
                break
            if len(raw) < _CONTINUATION_TRIM_WINDOW:
                continue  # keep buffering until the overlap window is full
            head = _trim_overlap(prior_text, raw)
            if _looks_like_restart(prior_text, head):
                state["restarted"] = True
                aborted = True
                logger.warning("Continuation restarted from the beginning — discarding round.")
                break
            trim_offset = len(raw) - len(head)
            head_emitted = True
            if head:
                yield {"type": "chunk", "text": head}
            continue
        yield {"type": "chunk", "text": delta}
        if guard.feed(delta):
            # Same significant line repeated many times — the model is stuck in
            # a loop that would burn the whole output budget for minutes. Stop
            # pulling the stream now; the caller will not continue this answer.
            state["degenerate"] = True
            aborted = True
            logger.warning("Degenerate repetition detected — aborting stream round early.")
            break

    if not aborted:
        raw, tail = _stream_tail_delta(raw, last_chunk)
        if not head_emitted:
            head = _trim_overlap(prior_text, raw)
            if _looks_like_restart(prior_text, head):
                state["restarted"] = True
                head = ""
                raw = ""
            trim_offset = len(raw) - len(head)
            if head:
                yield {"type": "chunk", "text": head}
        elif tail:
            yield {"type": "chunk", "text": tail}
            logger.warning("Flushed %s chars from final candidate (stream missed tail).", len(tail))

    if state.get("restarted") or (aborted and not head_emitted):
        state["streamed"] = ""  # nothing (new) was delivered this round
    else:
        state["streamed"] = raw[trim_offset:]
    state["last_chunk"] = last_chunk


async def _stream_with_continuation(
    *,
    client: Any,
    model: str,
    contents: list[Any],
    config: Any,
    metadata: dict[str, Any],
    endpoint: str,
) -> AsyncIterator[dict[str, Any]]:
    """Stream a generation and auto-continue while it finishes with MAX_TOKENS.

    Each round runs with the full admin-configured ``max_output_tokens`` budget;
    when the model exhausts it mid-answer, the partial answer is appended as a
    model turn and the model is asked to continue, so the user always receives
    the complete output. Emits a single aggregated usage event at the end.

    We only auto-continue if the budget is reasonably large (> 1000 tokens);
    small budgets imply the user explicitly wants a short/truncated response.

    A failure in round 0 propagates (so the caller's model-fallback loop can try
    the next model); a failure mid-continuation delivers the partial answer.
    """
    from google.genai import types as gt

    loop = asyncio.get_event_loop()
    attempts = continuation_attempts()
    if config.max_output_tokens and config.max_output_tokens < 1000:
        attempts = 0

    t0 = time.monotonic()
    full = ""
    agg_in = agg_out = agg_total = 0
    finish: str | None = None
    truncated = False
    had_chunk = False
    rounds_run = 0

    use_recovery = False
    consec_degen = 0
    for round_i in range(attempts + 1):
        convo = list(contents)
        round_config = config
        if round_i > 0:
            if use_recovery:
                follow_up = build_recovery_prompt(full)
                round_config = _recovery_sampling(config, model)
            else:
                follow_up = CHAT_CONTINUATION_PROMPT
            convo.append(gt.Content(role="model", parts=[gt.Part(text=full.rstrip())]))
            convo.append(gt.Content(role="user", parts=[gt.Part(text=follow_up)]))
            yield {
                "type": "status",
                "status": "continuing",
                "message": (
                    f"Recovering answer after repetition ({round_i}/{attempts})..."
                    if use_recovery
                    else f"Completing truncated answer ({round_i}/{attempts})..."
                ),
            }
            logger.info(
                "Continuation round %s/%s (recovery=%s) model=%s answer_chars=%s",
                round_i,
                attempts,
                use_recovery,
                model,
                len(full),
            )

        def _open(c=convo):
            return client.models.generate_content_stream(model=model, contents=c, config=config)

        state: dict[str, Any] = {"streamed": "", "last_chunk": None}
        try:
            sync_iter = await loop.run_in_executor(None, _open)
            async for ev in _stream_round(iter(sync_iter), state, prior_text=full):
                yield ev
        except Exception:
            if round_i == 0:
                raise
            logger.exception("Continuation round %s failed — delivering partial answer", round_i)
            break

        rounds_run += 1
        round_text = state.get("streamed", "")
        restarted = bool(state.get("restarted"))
        degenerate = bool(state.get("degenerate"))

        # ── CRITICAL: Only append to the answer if the round was VALID ──
        if not restarted and not degenerate:
            full += round_text
        
        if state.get("last_chunk") is not None:
            had_chunk = True
            usage = _normalize_usage(state["last_chunk"], len(round_text))
            # Input is cumulative within round; take max.
            agg_in = max(agg_in, usage["inputTokens"])
            # Output is additive
            agg_out += usage["outputTokens"]
            agg_total = agg_in + agg_out
            if not restarted and not degenerate:
                finish = usage["finishReason"]
                truncated = usage["outputTruncated"]
        elif not restarted and not degenerate:
            truncated = False

        if degenerate:
            # We cut a repetition loop. Try ONE recovery round that tells the
            # model what went wrong; two degenerate rounds in a row means it
            # cannot recover — deliver the partial answer, flagged honestly.
            truncated = True
            consec_degen += 1
            if consec_degen >= 2 or not full.strip():
                logger.warning("Repetition persisted across rounds — delivering partial answer.")
                break
            use_recovery = True
            continue # Try recovery
        
        if restarted:
            # The model ignored the continue instruction and restarted; the
            # duplicate round was discarded. More rounds would do the same.
            logger.warning("Continuation restarted — stopping further rounds.")
            break

        # Round was successful
        consec_degen = 0
        use_recovery = False
        if not truncated or not full.strip():
            break
        if round_i > 0 and not round_text.strip():
            # Continuation added nothing new — stop instead of spinning.
            break
        budget = continuation_time_budget()
        if budget and (time.monotonic() - t0) > budget:
            logger.info(
                "Continuation time budget (%.0fs) exhausted after round %s — delivering partial answer.",
                budget,
                round_i + 1,
            )
            break

    if not had_chunk:
        return

    usage_ev: dict[str, Any] = {
        "type": "usage",
        "inputTokens": agg_in,
        "outputTokens": agg_out,
        "totalTokens": agg_in + agg_out,
        "finishReason": finish,
        "outputTruncated": truncated,
        "modelName": metadata.get("modelName"),
    }
    if rounds_run > 1:
        usage_ev["continuationRounds"] = rounds_run - 1
    if metadata.get("userId"):
        await log_llm_usage(
            user_id=int(metadata["userId"]),
            model_name=usage_ev.get("modelName") or get_settings().adk_model or "gemini-2.5-pro",
            input_tokens=usage_ev["inputTokens"],
            output_tokens=usage_ev["outputTokens"],
            total_tokens=usage_ev["totalTokens"],
            endpoint=endpoint,
            file_id=metadata.get("fileId"),
            session_id=metadata.get("sessionId"),
        )
    yield usage_ev


def _pdf_text_for_claude(data: bytes) -> str:
    """Extract the PDF text layer with page markers.

    Claude bills a PDF sent as a document block as one IMAGE per page
    (~2,000 tokens/page) PLUS its text — a long court filing balloons ~4-5x
    (e.g. a 52k-token document measures 261k) and blows the 200k window.
    Sending the extracted text restores the document's true token size.
    Page markers are kept so page-specific citations still work.
    """
    import io

    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(data))
    pages: list[str] = []
    for i, page in enumerate(reader.pages[:400]):
        try:
            txt = page.extract_text() or ""
        except Exception:
            txt = ""
        pages.append(f"[Page {i + 1}]\n{txt.strip()}")
    return "\n\n".join(pages)


# A PDF whose extracted text has fewer non-whitespace chars than this is
# treated as scanned (no text layer) and sent as a document block instead.
_CLAUDE_PDF_TEXT_MIN_CHARS = 800
# Text beyond this cannot fit Claude's 200k context anyway — fall to Gemini.
_CLAUDE_TEXT_MAX_CHARS = 640_000


def _claude_file_blocks(gcs_uris: list[str]) -> list[dict[str, Any]]:
    """Anthropic content blocks for GCS documents.

    PDFs with a text layer are sent as extracted TEXT (true token size, with
    page markers); scanned PDFs go as document blocks so Claude reads the page
    images. Raises for oversized or unreadable files so the caller's fallback
    loop moves on to a Gemini model.
    """
    from app.services.gcs_service import download_object_buffer, parse_gcs_uri

    blocks: list[dict[str, Any]] = []
    for uri in gcs_uris:
        parsed = parse_gcs_uri(uri)
        if not parsed:
            continue
        bucket, path = parsed
        data = download_object_buffer(bucket, path)
        mime = mime_from_path(path)
        filename = path.rsplit("/", 1)[-1]
        if mime == "application/pdf":
            try:
                text = _pdf_text_for_claude(data)
            except Exception:
                text = ""
            if len(re.sub(r"\s+", "", text)) >= _CLAUDE_PDF_TEXT_MIN_CHARS:
                if len(text) > _CLAUDE_TEXT_MAX_CHARS:
                    raise RuntimeError(
                        "Document text exceeds Claude's context window — falling back"
                    )
                blocks.append({"type": "text", "text": f"DOCUMENT: {filename}\n\n{text}"})
            else:
                # Scanned PDF — no usable text layer; Claude must see the pages.
                blocks.append(
                    {
                        "type": "document",
                        "source": {
                            "type": "base64",
                            "media_type": "application/pdf",
                            "data": base64.b64encode(data).decode("ascii"),
                        },
                    }
                )
        elif mime.startswith("text/") or mime in ("application/json", "application/xml"):
            blocks.append({"type": "text", "text": data.decode("utf-8", "ignore")[:_CLAUDE_TEXT_MAX_CHARS]})
        else:
            raise RuntimeError(f"Claude cannot read {mime} directly — falling back")
    return blocks


async def _stream_claude_chat(
    *,
    model: str,
    system_instruction: str,
    user_content: Any,
    llm_config: dict[str, Any],
    metadata: dict[str, Any],
    endpoint: str,
    client: Any = None,
) -> AsyncIterator[dict[str, Any]]:
    """Claude chat streaming — no caching, DB max_output_tokens applied.

    MAX_TOKENS continuation uses assistant prefill: the partial answer is sent
    back as the final assistant message, so Claude resumes exactly at the cut
    point (no repeated text, no overlap trimming needed). Thinking is disabled
    (chat runs at minimum thinking) and no sampling params are sent — Sonnet 5 /
    Opus 4.8 reject non-default temperature/top_p.
    """
    if client is None:
        from anthropic import AsyncAnthropic

        api_key = _anthropic_api_key()
        if not api_key:
            raise RuntimeError(
                "ANTHROPIC_API_KEY is not set — add it to Backend/agentic-chat-service/.env "
                "to use Claude chat models"
            )
        client = AsyncAnthropic(api_key=api_key)

    mot = max(1, int(llm_config.get("max_output_tokens") or 64000))
    mot = min(mot, _claude_output_cap(model))
    attempts = continuation_attempts()
    t0 = time.monotonic()
    full = ""
    agg_in = agg_out = 0
    finish: str | None = None
    truncated = False
    rounds_run = 0
    messages: list[dict[str, Any]] = [{"role": "user", "content": user_content}]

    for round_i in range(attempts + 1):
        msgs = list(messages)
        if round_i > 0:
            full = full.rstrip()  # prefill must not end with trailing whitespace
            msgs.append({"role": "assistant", "content": full})
            yield {
                "type": "status",
                "status": "continuing",
                "message": f"Completing truncated answer ({round_i}/{attempts})...",
            }
            logger.info(
                "Claude answer hit max_tokens — prefill continuation %s/%s model=%s chars=%s",
                round_i,
                attempts,
                model,
                len(full),
            )

        guard = _RepetitionGuard()
        degenerate = False
        round_text = ""
        final = None
        async with client.messages.stream(
            model=model,
            max_tokens=mot,
            thinking={"type": "disabled"},
            system=system_instruction,
            messages=msgs,
        ) as stream:
            async for text in stream.text_stream:
                if not text:
                    continue
                round_text += text
                yield {"type": "chunk", "text": text}
                if guard.feed(text):
                    degenerate = True
                    logger.warning("Degenerate repetition in Claude stream — aborting round.")
                    break
            if not degenerate:
                final = await stream.get_final_message()

        rounds_run += 1
        full += round_text
        if final is not None:
            usage = getattr(final, "usage", None)
            # Output is additive; Input is latest/max.
            agg_in = max(agg_in, int(getattr(usage, "input_tokens", 0) or 0))
            agg_out += int(getattr(usage, "output_tokens", 0) or 0)
            stop = getattr(final, "stop_reason", None) or ""
            finish = "MAX_TOKENS" if stop == "max_tokens" else str(stop)
            truncated = stop == "max_tokens"
        else:
            agg_out += max(1, len(round_text) // 4)
            finish = None
            truncated = degenerate
        if degenerate:
            break
        if not truncated or not full.strip():
            break
        if round_i > 0 and not round_text.strip():
            break
        budget = continuation_time_budget()
        if budget and (time.monotonic() - t0) > budget:
            logger.info("Claude continuation time budget (%.0fs) exhausted.", budget)
            break

    usage_ev: dict[str, Any] = {
        "type": "usage",
        "inputTokens": agg_in,
        "outputTokens": agg_out,
        "totalTokens": agg_in + agg_out,
        "finishReason": finish,
        "outputTruncated": truncated,
        "modelName": model,
    }
    if rounds_run > 1:
        usage_ev["continuationRounds"] = rounds_run - 1
    if metadata.get("userId"):
        await log_llm_usage(
            user_id=int(metadata["userId"]),
            model_name=model,
            input_tokens=agg_in,
            output_tokens=agg_out,
            total_tokens=agg_in + agg_out,
            endpoint=endpoint,
            file_id=metadata.get("fileId"),
            session_id=metadata.get("sessionId"),
        )
    yield usage_ev


async def stream_llm_with_gcs(
    *,
    question: str,
    gcs_uris: list[str],
    llm_config: dict[str, Any],
    system_instruction: str,
    model_name: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> AsyncIterator[dict[str, Any]]:
    """Stream document Q&A with inline GCS file parts (non-cache fallback)."""
    from google.genai import types as gt

    meta = metadata or {}
    file_parts = _inline_file_parts(gcs_uris)
    if not file_parts:
        yield {"type": "error", "message": "Could not load document content for processing"}
        return

    contents = [gt.Content(role="user", parts=[*file_parts, gt.Part(text=question)])]
    client = _get_vertex_client()
    endpoint = meta.get("endpoint", "/api/chat/ask/stream")
    last_err: Exception | None = None
    claude_blocks: list[dict[str, Any]] | None = None  # downloaded once, reused
    skip_claude = False  # set when the doc can never fit ANY Claude model

    for model in build_model_list(llm_config, model_name):
        if skip_claude and _is_claude_model(model):
            continue
        try:
            meta["modelName"] = model
            if _is_claude_model(model):
                # Claude document chat — no caching; PDF sent as a document
                # block, DB max_output_tokens applied (capped per family).
                logger.info("Document chat via Claude model=%s (no cache)", model)
                if claude_blocks is None:
                    claude_blocks = _claude_file_blocks(gcs_uris)
                async for ev in _stream_claude_chat(
                    model=model,
                    system_instruction=system_instruction,
                    user_content=[*claude_blocks, {"type": "text", "text": question}],
                    llm_config=llm_config,
                    metadata=meta,
                    endpoint=endpoint,
                ):
                    yield ev
                return
            # Per-model config: thinking is set to each family's minimum.
            gen_cfg = _build_generation_config(llm_config, model)
            config_kwargs: dict[str, Any] = {
                "system_instruction": system_instruction,
                "temperature": gen_cfg["temperature"],
                "max_output_tokens": gen_cfg["max_output_tokens"],
            }
            if gen_cfg.get("thinking_config") is not None:
                config_kwargs["thinking_config"] = gen_cfg["thinking_config"]
            config = gt.GenerateContentConfig(**config_kwargs)
            logger.info(
                "Document chat (GCS fallback) model=%s max_output_tokens=%s temperature=%.2f",
                model,
                gen_cfg["max_output_tokens"],
                gen_cfg["temperature"],
            )

            async for ev in _stream_with_continuation(
                client=client,
                model=model,
                contents=contents,
                config=config,
                metadata=meta,
                endpoint=endpoint,
            ):
                yield ev
            return
        except Exception as exc:
            last_err = exc
            msg = str(exc).lower()
            if _is_claude_model(model) and (
                "prompt is too long" in msg or "cannot read" in msg or "exceeds claude" in msg
            ):
                # Context limit / unreadable file type is identical across the
                # whole Claude family — do not retry the other Claude models.
                skip_claude = True
                logger.warning(
                    "Document exceeds Claude limits (%s) — switching to Gemini for this file", exc
                )
                yield {
                    "type": "status",
                    "status": "generating",
                    "message": "Document too large for Claude — switching to Gemini...",
                }
            else:
                logger.warning("Document model %s failed: %s", model, exc)

    yield {"type": "error", "message": f"All document models failed: {last_err}"}


async def stream_llm_general(
    *,
    prompt_text: str,
    llm_config: dict[str, Any],
    system_instruction: str,
    model_name: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> AsyncIterator[dict[str, Any]]:
    from google.genai import types as gt

    meta = metadata or {}
    client = _get_client()
    contents = [gt.Content(role="user", parts=[gt.Part(text=prompt_text)])]

    last_err = None
    skip_claude = False
    for model in build_model_list(llm_config, model_name):
        if skip_claude and _is_claude_model(model):
            continue
        try:
            meta["modelName"] = model
            if _is_claude_model(model):
                logger.info("General chat via Claude model=%s (no cache)", model)
                async for ev in _stream_claude_chat(
                    model=model,
                    system_instruction=system_instruction,
                    user_content=prompt_text,
                    llm_config=llm_config,
                    metadata=meta,
                    endpoint=meta.get("endpoint", "/api/chat/ask/general/stream"),
                ):
                    yield ev
                return
            # Per-model config: thinking is set to each family's minimum.
            gen_cfg = _build_generation_config(llm_config, model)
            config_kwargs: dict[str, Any] = {
                "system_instruction": system_instruction,
                "temperature": gen_cfg["temperature"],
                "max_output_tokens": gen_cfg["max_output_tokens"],
            }
            if gen_cfg.get("thinking_config") is not None:
                config_kwargs["thinking_config"] = gen_cfg["thinking_config"]
            config = gt.GenerateContentConfig(**config_kwargs)
            logger.info(
                "General chat model=%s max_output_tokens=%s temperature=%.2f",
                model,
                gen_cfg["max_output_tokens"],
                gen_cfg["temperature"],
            )
            async for ev in _stream_with_continuation(
                client=client,
                model=model,
                contents=contents,
                config=config,
                metadata=meta,
                endpoint=meta.get("endpoint", "/api/chat/ask/general/stream"),
            ):
                yield ev
            return
        except Exception as exc:
            last_err = exc
            if _is_claude_model(model) and "prompt is too long" in str(exc).lower():
                skip_claude = True
                logger.warning("Prompt exceeds Claude context — switching to Gemini: %s", exc)
                yield {
                    "type": "status",
                    "status": "generating",
                    "message": "Prompt too large for Claude — switching to Gemini...",
                }
            else:
                logger.warning("General model %s failed: %s", model, exc)
    raise RuntimeError(f"All general models failed: {last_err}")


def _run_count_tokens(client: Any, model: str, parts: list[Any]) -> Any:
    from google.genai import types as gt

    return client.models.count_tokens(model=model, contents=[gt.Content(role="user", parts=parts)])


async def count_tokens_from_gcs(gcs_uris: list[str], model_name: str | None = None) -> dict[str, Any]:
    """Count tokens for GCS files via Vertex (download inline — avoids URI fetch issues)."""
    model = model_name or resolve_vertex_model_id({"llm_model": get_settings().adk_model}) or get_settings().adk_model or "gemini-2.5-pro"
    inline = _inline_file_parts(gcs_uris)
    if not inline:
        return {"totalTokens": 0, "promptTokenCount": 0}

    loop = asyncio.get_event_loop()
    client = _get_vertex_client()
    result = await loop.run_in_executor(None, lambda: _run_count_tokens(client, model, inline))
    total = int(getattr(result, "total_tokens", 0) or getattr(result, "total_token_count", 0) or 0)
    return {"totalTokens": total, "promptTokenCount": total}
