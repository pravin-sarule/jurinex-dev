"""ASCII progress + token tables for auto-fill / chronology. Logged as one MESSAGE block."""
from __future__ import annotations

import logging
from typing import Any, Sequence

from app.schemas.chronology import ChronologyTree
from app.services.token_usage_log import _fmt_int, _fmt_usd, _model_cost_usd, get_last_usage

logger = logging.getLogger("agentic_document_service.chronology")

_H = "─"
_V = "│"
_TL, _TR, _BL, _BR = "┌", "┐", "└", "┘"
_ML, _MR, _TM, _BM, _C = "├", "┤", "┬", "┴", "┼"


def _clip(text: Any, width: int) -> str:
    value = str(text if text is not None else "")
    if len(value) <= width:
        return value.ljust(width)
    if width <= 1:
        return value[:width]
    return value[: width - 1] + "…"


def _rule(widths: Sequence[int], left: str, mid: str, right: str) -> str:
    return left + mid.join(_H * (w + 2) for w in widths) + right


def kv_table(title: str, rows: Sequence[tuple[str, Any]]) -> str:
    pairs = [(str(k), str(v if v is not None else "—")) for k, v in rows]
    if not pairs:
        pairs = [("status", "empty")]
    label_w = max(len(k) for k, _ in pairs)
    value_w = max(len(v) for _, v in pairs)
    label_w = max(label_w, 8)
    value_w = max(min(value_w, 72), 12)
    widths = (label_w, value_w)
    lines = [
        _rule(widths, _TL, _TM, _TR),
        f"{_V} {_clip(title, label_w + value_w + 3)} {_V}",
        _rule(widths, _ML, _C, _MR),
    ]
    for key, value in pairs:
        lines.append(f"{_V} {_clip(key, label_w)} {_V} {_clip(value, value_w)} {_V}")
    lines.append(_rule(widths, _BL, _BM, _BR))
    return "\n".join(lines)


def grid_table(title: str, headers: Sequence[str], rows: Sequence[Sequence[Any]]) -> str:
    cols = [str(h) for h in headers]
    body = [[str(cell if cell is not None else "") for cell in row] for row in rows]
    widths = [len(h) for h in cols]
    for row in body:
        for i, cell in enumerate(row):
            if i < len(widths):
                widths[i] = min(max(widths[i], len(cell)), 36)
    while len(widths) < len(cols):
        widths.append(10)
    lines = [
        _rule(widths, _TL, _TM, _TR),
        f"{_V} {_clip(title, sum(widths) + 3 * (len(widths) - 1))} {_V}",
        _rule(widths, _ML, _C, _MR),
        _V + _V.join(f" {_clip(cols[i], widths[i])} " for i in range(len(cols))) + _V,
        _rule(widths, _ML, _C, _MR),
    ]
    if not body:
        lines.append(_V + _V.join(f" {_clip('—', widths[i])} " for i in range(len(cols))) + _V)
    for row in body:
        padded = list(row) + [""] * len(cols)
        lines.append(_V + _V.join(f" {_clip(padded[i], widths[i])} " for i in range(len(cols))) + _V)
    lines.append(_rule(widths, _BL, _BM, _BR))
    return "\n".join(lines)


def progress_bar(step: int, total: int, label: str, width: int = 16) -> str:
    total = max(int(total or 1), 1)
    step = max(0, min(int(step), total))
    filled = int(round(width * step / total))
    bar = "#" * filled + "-" * (width - filled)
    pct = int(round(100 * step / total))
    return f"[{bar}]  {step}/{total}  {pct:3d}%  {label}"


def tree_diagram(tree: ChronologyTree, *, max_dates: int = 12) -> str:
    if not tree.dates:
        return "  (no grounded dates yet)"
    lines: list[str] = []
    phases = tree.phases or []
    shown = 0
    for p_i, phase in enumerate(phases):
        last_phase = p_i == len(phases) - 1
        phase_branch = "└─" if last_phase else "├─"
        lines.append(f"  {phase_branch} {phase.label}")
        dates = phase.dates or []
        for d_i, node in enumerate(dates):
            if shown >= max_dates:
                remaining = sum(len(p.dates) for p in phases[p_i:]) - d_i
                pad = "   " if last_phase else "  │"
                lines.append(f"{pad}  └─ … {remaining} more date(s)")
                return "\n".join(lines)
            last_date = d_i == len(dates) - 1
            pad = "   " if last_phase else "  │"
            date_branch = "└─" if last_date else "├─"
            title = node.events[0].title if node.events else node.summary
            lines.append(f"{pad}  {date_branch} {node.displayDate}  {title}")
            shown += 1
    return "\n".join(lines) if lines else "  (no grounded dates yet)"


def log_progress(step: int, total: int, label: str, **detail: Any) -> None:
    extra = "  ".join(f"{k}={v}" for k, v in detail.items() if v not in (None, ""))
    message = progress_bar(step, total, label)
    if extra:
        message = f"{message}  {extra}"
    logger.info("[AutoFill] %s", message)


def log_run_report(
    *,
    stage: str,
    case_id: str,
    document_name: str,
    chars: int,
    elapsed_s: float,
    fields_filled: int,
    field_names: Sequence[str],
    kept_events: int,
    dropped_events: int,
    drop_reasons: dict[str, int] | None,
    tree: ChronologyTree,
    usage: dict[str, Any] | None = None,
) -> None:
    usage = usage or get_last_usage()
    model = str(usage.get("model") or "—")
    provider = str(usage.get("provider") or "—")
    input_tokens = int(usage.get("inputTokens") or 0)
    output_tokens = int(usage.get("outputTokens") or 0)
    total_tokens = int(usage.get("totalTokens") or (input_tokens + output_tokens))
    cost = _model_cost_usd(model, input_tokens, output_tokens)

    summary = kv_table(
        f"AUTO-FILL + CHRONOLOGY  ·  {stage}",
        [
            ("case", case_id),
            ("document", document_name),
            ("ocr_chars", f"{chars:,}"),
            ("elapsed", f"{elapsed_s:.1f}s"),
            ("agent", "form_population_agent"),
            ("provider", provider),
            ("model", model),
            ("input_tokens", _fmt_int(input_tokens)),
            ("output_tokens", _fmt_int(output_tokens)),
            ("total_tokens", _fmt_int(total_tokens)),
            ("est_cost_usd", _fmt_usd(cost)),
            ("form_fields", str(fields_filled)),
            ("fields", ", ".join(field_names[:8]) or "—"),
            ("events_kept", str(kept_events)),
            ("events_dropped", str(dropped_events)),
            ("unique_dates", str(len(tree.dates))),
            ("phases", str(len(tree.phases))),
        ],
    )
    reason_rows = [(k, v) for k, v in sorted((drop_reasons or {}).items()) if v]
    reason_table = ""
    if reason_rows:
        reason_table = "\n" + grid_table(
            "UNVERIFIABLE EVENTS DROPPED",
            ["reason", "count"],
            reason_rows,
        )
    date_rows = [
        [node.displayDate, node.phase, (node.events[0].title if node.events else "")[:36]]
        for node in tree.dates[:10]
    ]
    dates_table = "\n" + grid_table(
        "UNIQUE DATES (earliest first)",
        ["date", "phase", "event"],
        date_rows or [["—", "—", "none"]],
    )
    diagram = (
        "\n"
        + kv_table("CHRONOLOGY TREE", [("shape", "phase → unique date → summary")])
        + "\n"
        + tree_diagram(tree)
    )
    logger.info(
        "[AutoFill] model=%s\n%s%s%s%s",
        model,
        summary,
        reason_table,
        dates_table,
        diagram,
    )
