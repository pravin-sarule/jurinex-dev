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
    )
    # Print directly so the final totals table is easy to spot in the uvicorn console.
    print(table, flush=True)
    logger.info(table)
    return totals


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
