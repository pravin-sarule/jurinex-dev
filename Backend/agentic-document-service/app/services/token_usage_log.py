from __future__ import annotations

import logging
import threading
import uuid
from contextvars import ContextVar
from typing import Any

logger = logging.getLogger("agentic_document_service.token_usage")

_session_key_var: ContextVar[str | None] = ContextVar("token_usage_session_key", default=None)
_thread_local = threading.local()
_accumulators: dict[str, list[dict[str, Any]]] = {}
_flushed_session_keys: set[str] = set()

# ── Pricing ──────────────────────────────────────────────────────────────────
# USD per 1,000,000 tokens as (input, output). Matched by LONGEST model-id prefix,
# so "claude-opus-4-8" resolves via "claude-opus-4". Unknown models cost 0 (shown as
# "-"). EDIT THESE when rates change; preview/estimate rates are flagged.
_MODEL_PRICING: dict[str, tuple[float, float]] = {
    "claude-opus-4":     (5.00, 25.00),
    "claude-sonnet-5":   (3.00, 15.00),
    "claude-sonnet-4":   (3.00, 15.00),
    "claude-haiku-4":    (1.00, 5.00),
    "claude-fable-5":    (10.00, 50.00),
    "claude-mythos":     (10.00, 50.00),
    "gemini-3.1-pro":    (2.50, 15.00),   # preview — estimate, update on GA
    "gemini-3-pro":      (2.50, 15.00),   # estimate
    "gemini-3.6-flash":  (1.50, 7.50),    # official (AI Studio, rel. 21 Jul 2026)
    "gemini-3.5-flash":  (1.50, 9.00),
    "gemini-2.5-pro":    (1.25, 10.00),
    "gemini-2.5-flash":  (0.30, 2.50),
    "gemini-2.0-flash":  (0.10, 0.40),
    "gemini-embedding":  (0.15, 0.00),
    "text-embedding":    (0.15, 0.00),
    "embedding":         (0.15, 0.00),
    "gemma-4":           (0.00, 0.00),    # free developer tier
    "gemma-3":           (0.00, 0.00),
    "gemma":             (0.00, 0.00),
}
_USD_TO_INR = 96.0  # display-only FX for the ₹ line; edit to taste


def _price_for_model(model: str | None) -> tuple[float, float] | None:
    """(input, output) USD per 1M for a model id, matched by the longest key prefix."""
    m = (model or "").strip().lower()
    if not m:
        return None
    best: tuple[float, float] | None = None
    best_len = -1
    for prefix, rate in _MODEL_PRICING.items():
        if m.startswith(prefix) and len(prefix) > best_len:
            best, best_len = rate, len(prefix)
    return best


def _model_cost_usd(model: str | None, input_tokens: int, output_tokens: int) -> float | None:
    """Billed USD for a model's token counts, or None when the rate is unknown."""
    rate = _price_for_model(model)
    if rate is None:
        return None
    in_rate, out_rate = rate
    return (input_tokens / 1_000_000.0) * in_rate + (output_tokens / 1_000_000.0) * out_rate


def _fmt_usd(value: float | None) -> str:
    if value is None:
        return "-"
    if value == 0:
        return "$0.00"
    if value < 0.01:
        return f"${value:.4f}"
    return f"${value:,.4f}"


def record_embedding_usage(*, model_name: str, input_tokens: int, provider: str = "gemini") -> None:
    """Record RAG/query embedding tokens into the ACTIVE draft session ONLY.

    Silent when no session is bound — this keeps bulk ingestion (thousands of embed calls)
    from spamming the log, while a draft's per-section retrieval embeds ARE folded into the
    one per-draft token table. Embeddings are input-only (output = 0)."""
    key = _active_session_key()
    if not key or key in _flushed_session_keys or key not in _accumulators:
        return
    toks = input_tokens or 0
    if toks <= 0:
        return
    _accumulators[key].append(_normalize_usage({
        "provider": provider,
        "model": model_name or "embedding",
        "context": "rag_embedding",
        "inputTokens": toks,
        "outputTokens": 0,
        "totalTokens": toks,
    }))


def _fmt_int(value: Any) -> str:
    try:
        return f"{int(value):,}"
    except (TypeError, ValueError):
        return str(value or "-")


def _normalize_usage(usage: dict[str, Any] | None) -> dict[str, int | str]:
    usage = usage or {}
    input_tokens = int(
        usage.get("inputTokens")
        or usage.get("input_tokens")
        or usage.get("prompt_tokens")
        or usage.get("promptTokens")
        or 0
    )
    output_tokens = int(
        usage.get("outputTokens")
        or usage.get("output_tokens")
        or usage.get("completion_tokens")
        or usage.get("completionTokens")
        or 0
    )
    total_tokens = int(usage.get("totalTokens") or usage.get("total_tokens") or 0)
    if total_tokens <= 0 and (input_tokens or output_tokens):
        total_tokens = input_tokens + output_tokens
    return {
        "provider": str(usage.get("provider") or "-"),
        "model": str(usage.get("model") or usage.get("modelName") or usage.get("model_name") or "-"),
        "context": str(usage.get("context") or "-"),
        "inputTokens": input_tokens,
        "outputTokens": output_tokens,
        "totalTokens": total_tokens,
    }


def begin_token_usage_session(session_key: str | None = None) -> str:
    key = session_key or uuid.uuid4().hex[:12]
    _accumulators[key] = []
    _flushed_session_keys.discard(key)
    _session_key_var.set(key)
    _thread_local.session_key = key
    return key


def bind_token_usage_session(session_key: str) -> None:
    _thread_local.session_key = session_key


def unbind_token_usage_session() -> None:
    if hasattr(_thread_local, "session_key"):
        delattr(_thread_local, "session_key")


def _active_session_key() -> str | None:
    return getattr(_thread_local, "session_key", None) or _session_key_var.get()


def record_token_usage(
    *,
    context: str,
    usage: dict[str, Any] | None,
    provider: str | None = None,
    model_name: str | None = None,
) -> None:
    """Record usage into the active session; falls back to immediate log if no session."""
    key = _active_session_key()
    normalized = _normalize_usage(
        {
            **(usage or {}),
            "provider": provider or (usage or {}).get("provider"),
            "model": model_name or (usage or {}).get("model") or (usage or {}).get("modelName"),
            "context": context,
        }
    )
    if key and key not in _flushed_session_keys and key in _accumulators:
        _accumulators[key].append(normalized)
        return
    if key in _flushed_session_keys:
        return
    log_token_usage_table(
        context=context,
        usage=usage,
        provider=provider,
        model_name=model_name,
    )


def _format_table(rows: list[tuple[str, str]], *, title: str) -> str:
    label_width = max(len(label) for label, _ in rows)
    label_width = max(label_width, len("Metric"))
    value_width = max(len(value) for _, value in rows)
    value_width = max(value_width, len("Value"))
    border = "+" + "-" * (label_width + 2) + "+" + "-" * (value_width + 2) + "+"
    header = f"| {'Metric':<{label_width}} | {'Value':<{value_width}} |"
    body_lines = [f"| {label:<{label_width}} | {value:<{value_width}} |" for label, value in rows]
    return "\n".join(
        [
            "",
            "=" * (len(border) - 2),
            f" {title}",
            "=" * (len(border) - 2),
            border,
            header,
            border,
            *body_lines,
            border,
            "",
        ]
    )


def format_aggregated_token_usage_table(
    entries: list[dict[str, Any]],
    *,
    title: str = "FINAL AGGREGATED TOKEN USAGE (response complete)",
    endpoint: str | None = None,
    session_id: str | None = None,
    user_id: str | int | None = None,
    request_id: str | None = None,
    model_name: str | None = None,
    answer_length: int | None = None,
    routing: str | None = None,
    retrieved_chunks: int | None = None,
) -> str:
    total_input = sum(int(e.get("inputTokens") or 0) for e in entries)
    total_output = sum(int(e.get("outputTokens") or 0) for e in entries)
    total_tokens = sum(int(e.get("totalTokens") or 0) for e in entries)
    if total_tokens <= 0:
        total_tokens = total_input + total_output

    models = sorted({str(e.get("model") or "-") for e in entries if e.get("model")})
    providers = sorted({str(e.get("provider") or "-") for e in entries if e.get("provider")})

    rows: list[tuple[str, str]] = []
    if endpoint:
        rows.append(("Endpoint", endpoint))
    if routing:
        rows.append(("Routing", routing))
    if user_id is not None:
        rows.append(("User ID", str(user_id)))
    if session_id:
        rows.append(("Session ID", str(session_id)))
    if request_id:
        rows.append(("Request ID", str(request_id)))
    if model_name:
        rows.append(("Primary Model", model_name))
    elif len(models) == 1:
        rows.append(("Model", models[0]))
    elif models:
        rows.append(("Models", ", ".join(models)))
    if providers and providers != ["-"]:
        rows.append(("Providers", ", ".join(providers)))
    rows.extend(
        [
            ("Input Tokens (total)", _fmt_int(total_input)),
            ("Output Tokens (total)", _fmt_int(total_output)),
            ("Total Tokens (total)", _fmt_int(total_tokens)),
            ("LLM Calls", _fmt_int(len(entries))),
        ]
    )
    if answer_length is not None:
        rows.append(("Answer Length", _fmt_int(answer_length)))
    if retrieved_chunks is not None:
        rows.append(("Retrieved Chunks (RAG)", _fmt_int(retrieved_chunks)))

    return _format_table(rows, title=title)


def flush_aggregated_token_usage_table(
    session_key: str,
    *,
    endpoint: str | None = None,
    session_id: str | None = None,
    user_id: str | int | None = None,
    request_id: str | None = None,
    model_name: str | None = None,
    answer_length: int | None = None,
    routing: str | None = None,
    retrieved_chunks: int | None = None,
) -> dict[str, int] | None:
    """Log one final table with summed input/output/total tokens for the whole request."""
    entries = _accumulators.pop(session_key, [])
    _flushed_session_keys.add(session_key)
    if _session_key_var.get() == session_key:
        _session_key_var.set(None)
    if hasattr(_thread_local, "session_key") and _thread_local.session_key == session_key:
        unbind_token_usage_session()

    if not entries:
        return None

    totals = {
        "inputTokens": sum(int(e.get("inputTokens") or 0) for e in entries),
        "outputTokens": sum(int(e.get("outputTokens") or 0) for e in entries),
        "totalTokens": sum(int(e.get("totalTokens") or 0) for e in entries),
    }
    if totals["totalTokens"] <= 0:
        totals["totalTokens"] = totals["inputTokens"] + totals["outputTokens"]

    table = format_aggregated_token_usage_table(
        entries,
        endpoint=endpoint,
        session_id=session_id,
        user_id=user_id,
        request_id=request_id,
        model_name=model_name,
        answer_length=answer_length,
        routing=routing,
        retrieved_chunks=retrieved_chunks,
    )
    # Print directly so the final totals table is easy to spot in the uvicorn console.
    print(table, flush=True)
    logger.info(table)
    return totals


def usage_entry_count(session_key: str | None) -> int:
    """Number of usage entries currently accumulated for a session (0 if none) — used to
    mark the start of a sub-phase (e.g. one draft) so its slice can be reported later."""
    if not session_key:
        return 0
    return len(_accumulators.get(session_key, []))


def _multicol_table(headers: list[str], rows: list[list[str]], *, title: str,
                    subtitle_lines: list[str] | None = None, right_align_from: int = 2) -> str:
    widths = [
        max(len(str(headers[i])), *( [len(str(r[i])) for r in rows] or [0] ))
        for i in range(len(headers))
    ]
    def _row(cells: list[Any]) -> str:
        parts = [
            (str(c).rjust(widths[i]) if i >= right_align_from else str(c).ljust(widths[i]))
            for i, c in enumerate(cells)
        ]
        return "| " + " | ".join(parts) + " |"
    border = "+" + "+".join("-" * (w + 2) for w in widths) + "+"
    out = ["", "=" * len(border), f" {title}", "=" * len(border)]
    for s in (subtitle_lines or []):
        out.append(f" {s}")
    out += [border, _row(headers), border, *[_row(r) for r in rows], border, ""]
    return "\n".join(out)


def log_draft_token_usage(
    session_key: str | None,
    start_index: int = 0,
    *,
    draft_id: str | None = None,
    draft_model: str | None = None,
    guardian_model: str | None = None,
    session_id: str | None = None,
    user_id: str | int | None = None,
    request_id: str | None = None,
    answer_length: int | None = None,
) -> dict[str, Any] | None:
    """Log a PER-MODEL token-burn table for ONE draft — the exact end-to-end cost of a single
    draft, broken down by the model that did each part. A draft legitimately uses several:
    Gemini for template structure, the selected engine for drafting, Opus as guardian, the
    Gemini EMBEDDING model for every RAG retrieval, and (on a pipeline failure) a single-call
    fallback. Reports only the accumulator slice [start_index:] so it counts exactly this
    draft. Only models that ACTUALLY ran appear (a configured guardian that never fired is
    NOT listed).

    Token accounting is made consistent and cost‑accurate: a model's reported total token
    count can exceed input+output because of hidden thinking/reasoning tokens (billed at the
    output rate), so Output is reconciled to (Total − Input). Thus every row satisfies
    Total = Input + Output. Cost is Input×in_rate + Output×out_rate from _MODEL_PRICING; a
    model with no known rate shows "-" and the TOTAL is flagged with "+" (a lower bound)."""
    if not session_key:
        return None
    entries = _accumulators.get(session_key, [])[start_index:]
    if not entries:
        return None
    order: list[str] = []
    by_model: dict[str, dict[str, Any]] = {}
    for e in entries:
        m = str(e.get("model") or "-")
        if m not in by_model:
            by_model[m] = {"provider": str(e.get("provider") or "-"), "in": 0, "out": 0, "calls": 0}
            order.append(m)
        agg = by_model[m]
        i_tok = int(e.get("inputTokens") or 0)
        o_tok = int(e.get("outputTokens") or 0)
        t_tok = int(e.get("totalTokens") or 0)
        if t_tok < i_tok + o_tok:            # missing / inconsistent → derive
            t_tok = i_tok + o_tok
        agg["in"] += i_tok
        agg["out"] += (t_tok - i_tok)         # fold thinking tokens into output; Total = In + Out
        agg["calls"] += 1

    t_in = sum(int(a["in"]) for a in by_model.values())
    t_out = sum(int(a["out"]) for a in by_model.values())
    t_calls = sum(int(a["calls"]) for a in by_model.values())

    # Per-model billed cost (USD); None when the model's rate is unknown.
    model_cost: dict[str, float | None] = {
        m: _model_cost_usd(m, int(by_model[m]["in"]), int(by_model[m]["out"])) for m in order
    }
    total_cost = sum(c for c in model_cost.values() if c is not None)
    any_unknown = any(c is None for c in model_cost.values())

    headers = ["Model", "Provider", "Calls", "Input", "Output", "Total", "Cost (USD)"]
    rows: list[list[str]] = [
        [m, str(by_model[m]["provider"]), _fmt_int(by_model[m]["calls"]),
         _fmt_int(by_model[m]["in"]), _fmt_int(by_model[m]["out"]),
         _fmt_int(int(by_model[m]["in"]) + int(by_model[m]["out"])),
         _fmt_usd(model_cost[m])]
        for m in order
    ]
    rows.append(["TOTAL (1 draft)", "", _fmt_int(t_calls), _fmt_int(t_in), _fmt_int(t_out),
                 _fmt_int(t_in + t_out), _fmt_usd(total_cost) + ("+" if any_unknown else "")])

    subtitle: list[str] = []
    if draft_id:
        subtitle.append(f"Draft ID: {draft_id}")
    if draft_model:
        subtitle.append(f"Selected draft engine: {draft_model}")
    cost_line = f"End-to-end cost: {_fmt_usd(total_cost)}"
    if any_unknown:
        cost_line += " + unpriced model(s)"
    cost_line += f"   ≈ ₹{total_cost * _USD_TO_INR:,.2f}"
    subtitle.append(cost_line)
    meta = []
    if answer_length is not None:
        meta.append(f"Draft length: {_fmt_int(answer_length)} chars")
    if session_id:
        meta.append(f"Session: {session_id}")
    if request_id:
        meta.append(f"Request: {request_id}")
    if user_id is not None:
        meta.append(f"User: {user_id}")
    if meta:
        subtitle.append("   ".join(meta))

    table = _multicol_table(
        headers, rows,
        title="TOKEN USAGE - DRAFT COMPLETE (per model, one draft)",
        subtitle_lines=subtitle,
        right_align_from=2,
    )
    print(table, flush=True)
    logger.info(table)
    return {"inputTokens": t_in, "outputTokens": t_out, "totalTokens": t_in + t_out,
            "costUsd": round(total_cost, 6), "draftId": draft_id}


def format_token_usage_table(
    usage: dict[str, Any] | None,
    *,
    title: str = "TOKEN USAGE SUMMARY",
    provider: str | None = None,
    model_name: str | None = None,
    endpoint: str | None = None,
    session_id: str | None = None,
    user_id: str | int | None = None,
    request_id: str | None = None,
    answer_length: int | None = None,
    routing: str | None = None,
) -> str:
    normalized = _normalize_usage(
        {
            **(usage or {}),
            "provider": provider or (usage or {}).get("provider"),
            "model": model_name or (usage or {}).get("model") or (usage or {}).get("modelName"),
        }
    )
    rows: list[tuple[str, str]] = []
    if endpoint:
        rows.append(("Endpoint", endpoint))
    if routing:
        rows.append(("Routing", routing))
    if user_id is not None:
        rows.append(("User ID", str(user_id)))
    if session_id:
        rows.append(("Session ID", str(session_id)))
    if request_id:
        rows.append(("Request ID", str(request_id)))
    rows.extend(
        [
            ("Provider", str(normalized["provider"])),
            ("Model", str(normalized["model"])),
            ("Input Tokens", _fmt_int(normalized["inputTokens"])),
            ("Output Tokens", _fmt_int(normalized["outputTokens"])),
            ("Total Tokens", _fmt_int(normalized["totalTokens"])),
        ]
    )
    if answer_length is not None:
        rows.append(("Answer Length", _fmt_int(answer_length)))
    return _format_table(rows, title=title)


def log_token_usage_table(
    *,
    context: str,
    usage: dict[str, Any] | None,
    provider: str | None = None,
    model_name: str | None = None,
    endpoint: str | None = None,
    session_id: str | None = None,
    user_id: str | int | None = None,
    request_id: str | None = None,
    answer_length: int | None = None,
    routing: str | None = None,
) -> None:
    """Log immediately, or accumulate when a request session is active."""
    if _active_session_key() and _active_session_key() not in _flushed_session_keys:
        record_token_usage(
            context=context,
            usage=usage,
            provider=provider,
            model_name=model_name,
        )
        return
    table = format_token_usage_table(
        usage,
        title=f"TOKEN USAGE - {context} (response complete)",
        provider=provider,
        model_name=model_name,
        endpoint=endpoint,
        session_id=session_id,
        user_id=user_id,
        request_id=request_id,
        answer_length=answer_length,
        routing=routing,
    )
    logger.info(table)
