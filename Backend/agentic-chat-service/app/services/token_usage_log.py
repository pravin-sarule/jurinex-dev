from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)


def _fmt_int(value: Any) -> str:
    try:
        return f"{int(value):,}"
    except (TypeError, ValueError):
        return str(value or "—")


def _fmt_cost(value: Any) -> str:
    try:
        return f"${float(value):.6f}"
    except (TypeError, ValueError):
        return str(value or "—")


def format_table(title: str, headers: list[str], rows: list[list[Any]]) -> str:
    """Render a generic multi-column ASCII table for console/log output."""
    headers = [str(h) for h in headers]
    str_rows = [[str(c) if c is not None else "-" for c in row] for row in rows]
    cols = len(headers)
    widths = [len(headers[i]) for i in range(cols)]
    for row in str_rows:
        for i in range(cols):
            if i < len(row):
                widths[i] = max(widths[i], len(row[i]))

    def fmt_row(cells: list[str]) -> str:
        padded = [(cells[i] if i < len(cells) else "").ljust(widths[i]) for i in range(cols)]
        return "| " + " | ".join(padded) + " |"

    border = "+" + "+".join("-" * (w + 2) for w in widths) + "+"
    lines = ["", f" {title}", border, fmt_row(headers), border]
    lines.extend(fmt_row(r) for r in str_rows)
    lines.append(border)
    lines.append("")
    return "\n".join(lines)


def log_table(title: str, headers: list[str], rows: list[list[Any]]) -> None:
    """Log a generic multi-column ASCII table at INFO level."""
    if not rows:
        return
    logger.info(format_table(title, headers, rows))


def _build_rows(
    usage: dict[str, Any] | None,
    *,
    model_name: str | None = None,
    endpoint: str | None = None,
    session_id: str | None = None,
    user_id: str | None = None,
    answer_length: int | None = None,
    chunks_received: int | None = None,
    cache_mechanism: str | None = None,
) -> list[tuple[str, str]]:
    usage = usage or {}
    resolved_model = (
        model_name
        or usage.get("modelName")
        or usage.get("model_name")
        or "—"
    )

    input_tokens = usage.get("inputTokens") or usage.get("input_tokens") or 0
    output_tokens = usage.get("outputTokens") or usage.get("output_tokens") or 0
    total_tokens = usage.get("totalTokens") or usage.get("total_tokens")
    if total_tokens is None:
        try:
            total_tokens = int(input_tokens) + int(output_tokens)
        except (TypeError, ValueError):
            total_tokens = 0

    rows: list[tuple[str, str]] = [
        ("Model", str(resolved_model)),
    ]
    if endpoint:
        rows.append(("Endpoint", endpoint))
    if user_id:
        rows.append(("User ID", str(user_id)))
    if session_id:
        rows.append(("Session ID", str(session_id)))
    if cache_mechanism or usage.get("cacheMechanism"):
        rows.append(("Cache", str(cache_mechanism or usage.get("cacheMechanism"))))

    rows.extend(
        [
            ("Input Tokens", _fmt_int(input_tokens)),
            ("Output Tokens", _fmt_int(output_tokens)),
            ("Total Tokens", _fmt_int(total_tokens)),
        ]
    )

    cached = usage.get("cachedTokens") or usage.get("cached_tokens")
    new_prompt = usage.get("newPromptTokens") or usage.get("new_prompt_tokens")
    if cached is not None:
        rows.append(("Cached Tokens", _fmt_int(cached)))
    if new_prompt is not None:
        rows.append(("New Prompt Tokens", _fmt_int(new_prompt)))

    query_cost = usage.get("queryCost") or usage.get("query_cost")
    if query_cost is not None:
        rows.append(("Query Cost", _fmt_cost(query_cost)))

    if answer_length is not None:
        rows.append(("Answer Length", _fmt_int(answer_length)))
    if chunks_received is not None:
        rows.append(("Chunks Received", _fmt_int(chunks_received)))

    return rows


def format_token_usage_table(
    usage: dict[str, Any] | None,
    *,
    title: str = "TOKEN USAGE SUMMARY",
    model_name: str | None = None,
    endpoint: str | None = None,
    session_id: str | None = None,
    user_id: str | None = None,
    answer_length: int | None = None,
    chunks_received: int | None = None,
    cache_mechanism: str | None = None,
) -> str:
    rows = _build_rows(
        usage,
        model_name=model_name,
        endpoint=endpoint,
        session_id=session_id,
        user_id=user_id,
        answer_length=answer_length,
        chunks_received=chunks_received,
        cache_mechanism=cache_mechanism,
    )

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


def log_token_usage_table(
    *,
    context: str,
    usage: dict[str, Any] | None,
    model_name: str | None = None,
    endpoint: str | None = None,
    session_id: str | None = None,
    user_id: str | None = None,
    answer_length: int | None = None,
    chunks_received: int | None = None,
    cache_mechanism: str | None = None,
) -> None:
    """Log input/output/total token usage in a readable ASCII table after response completion."""
    table = format_token_usage_table(
        usage,
        title=f"TOKEN USAGE - {context} (response complete)",
        model_name=model_name,
        endpoint=endpoint,
        session_id=session_id,
        user_id=user_id,
        answer_length=answer_length,
        chunks_received=chunks_received,
        cache_mechanism=cache_mechanism,
    )
    logger.info(table)
