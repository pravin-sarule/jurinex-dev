"""ASCII progress + token tables for auto-fill / chronology. Logged as one MESSAGE block."""
from __future__ import annotations

import logging
from typing import Any, Sequence

from app.schemas.chronology import ChronologyTree
from app.services.token_usage_log import _fmt_int, _fmt_usd, _model_cost_usd, get_last_usage

logger = logging.getLogger("agentic_document_service.chronology")

_H = "-"
_V = "|"
_CORNER = "+"


def _message_width() -> int:
    try:
        from app.core.logging import log_message_width

        return log_message_width()
    except Exception:
        return 56


def _clip(text: Any, width: int) -> str:
    value = str(text if text is not None else "")
    width = max(int(width), 0)
    if len(value) <= width:
        return value.ljust(width)
    if width <= 3:
        return value[:width]
    return value[: width - 3] + "..."


def _wrap(text: Any, width: int) -> list[str]:
    value = str(text if text is not None else "")
    width = max(int(width), 1)
    if not value:
        return [""]
    if len(value) <= width:
        return [value]
    parts: list[str] = []
    rest = value
    while rest:
        if len(rest) <= width:
            parts.append(rest)
            break
        cut = rest.rfind(" ", 0, width)
        if cut < max(4, width // 3):
            parts.append(rest[:width])
            rest = rest[width:]
        else:
            parts.append(rest[:cut])
            rest = rest[cut + 1 :]
    return parts or [""]


def _rule(widths: Sequence[int]) -> str:
    return _CORNER + _CORNER.join(_H * (w + 2) for w in widths) + _CORNER


def _row(cells: Sequence[str], widths: Sequence[int]) -> str:
    body = _V.join(f" {_clip(cells[i] if i < len(cells) else '', widths[i])} " for i in range(len(widths)))
    return f"{_V}{body}{_V}"


def _box_width(widths: Sequence[int]) -> int:
    return sum(widths) + 3 * len(widths) + 1


def _fit_widths(preferred: Sequence[int], max_width: int, mins: Sequence[int]) -> list[int]:
    widths = [max(int(w), int(m)) for w, m in zip(preferred, mins)]
    while _box_width(widths) > max_width and any(w > m for w, m in zip(widths, mins)):
        i = max(range(len(widths)), key=lambda idx: widths[idx] - mins[idx])
        if widths[i] <= mins[i]:
            break
        widths[i] -= 1
    return widths


def kv_table(title: str, rows: Sequence[tuple[str, Any]], *, max_width: int | None = None) -> str:
    pairs = [(str(k), str(v if v is not None else "-")) for k, v in rows]
    if not pairs:
        pairs = [("status", "empty")]
    width = max(40, int(max_width or _message_width()))
    label_w = min(max(max(len(k) for k, _ in pairs), 8), 16)
    value_w = max(12, width - label_w - 7)
    widths = _fit_widths((label_w, value_w), width, (8, 12))
    label_w, value_w = widths
    lines = [
        _rule(widths),
        f"{_V} {_clip(title, label_w + value_w + 3)} {_V}",
        _rule(widths),
    ]
    for key, value in pairs:
        chunks = _wrap(value, value_w)
        lines.append(_row([key, chunks[0]], widths))
        for extra in chunks[1:]:
            lines.append(_row(["", extra], widths))
    lines.append(_rule(widths))
    return "\n".join(lines)


def grid_table(
    title: str,
    headers: Sequence[str],
    rows: Sequence[Sequence[Any]],
    *,
    max_width: int | None = None,
) -> str:
    cols = [str(h) for h in headers]
    body = [[str(cell if cell is not None else "") for cell in row] for row in rows]
    width = max(40, int(max_width or _message_width()))
    preferred = [len(h) for h in cols]
    for row in body:
        for i, cell in enumerate(row):
            if i < len(preferred):
                preferred[i] = max(preferred[i], min(len(cell), 24))
    while len(preferred) < len(cols):
        preferred.append(8)
    mins = [4] * len(cols)
    lowered = [c.lower() for c in cols]
    if lowered == ["date", "page", "event"]:
        preferred = [11, 8, max(12, width - 10 - 11 - 8)]
        mins = [11, 6, 10]
    elif lowered == ["date", "phase", "event"]:
        preferred = [11, 14, max(12, width - 10 - 11 - 14)]
        mins = [11, 8, 10]
    elif len(cols) >= 3:
        mins = [11, 8, 10][: len(cols)] + [4] * max(0, len(cols) - 3)
    widths = _fit_widths(preferred, width, mins)
    inner = sum(widths) + 3 * (len(widths) - 1)
    lines = [
        _rule(widths),
        f"{_V} {_clip(title, inner)} {_V}",
        _rule(widths),
        _row(cols, widths),
        _rule(widths),
    ]
    if not body:
        lines.append(_row(["-"] * len(widths), widths))
    for row in body:
        padded = list(row) + [""] * len(cols)
        first = _wrap(padded[0], widths[0]) if widths else [""]
        # Only wrap the last column; keep other cells on the first line.
        last_idx = len(widths) - 1
        last_chunks = _wrap(padded[last_idx], widths[last_idx]) if last_idx > 0 else first
        lead = [_clip(padded[i], widths[i]) for i in range(last_idx)]
        lines.append(_row(lead + [last_chunks[0]], widths))
        for extra in last_chunks[1:]:
            lines.append(_row([""] * last_idx + [extra], widths))
    lines.append(_rule(widths))
    return "\n".join(lines)


def progress_bar(step: int, total: int, label: str, width: int = 16) -> str:
    total = max(int(total or 1), 1)
    step = max(0, min(int(step), total))
    filled = int(round(width * step / total))
    bar = "#" * filled + "-" * (width - filled)
    pct = int(round(100 * step / total))
    return f"[{bar}]  {step}/{total}  {pct:3d}%  {label}"


def tree_diagram(tree: ChronologyTree, *, max_dates: int = 12, max_width: int | None = None) -> str:
    if not tree.dates:
        return "  (no grounded dates yet)"
    width = max(32, int(max_width or _message_width()))
    lines: list[str] = []
    phases = tree.phases or []
    shown = 0
    for p_i, phase in enumerate(phases):
        last_phase = p_i == len(phases) - 1
        phase_branch = "`-" if last_phase else "|-"
        lines.append(_clip(f"  {phase_branch} {phase.label}", width).rstrip())
        dates = phase.dates or []
        for d_i, node in enumerate(dates):
            if shown >= max_dates:
                remaining = sum(len(p.dates) for p in phases[p_i:]) - d_i
                pad = "   " if last_phase else "  |"
                lines.append(_clip(f"{pad}  `- ... {remaining} more date(s)", width).rstrip())
                return "\n".join(lines)
            last_date = d_i == len(dates) - 1
            pad = "   " if last_phase else "  |"
            date_branch = "`-" if last_date else "|-"
            title = node.events[0].title if node.events else node.summary
            lines.append(_clip(f"{pad}  {date_branch} {node.displayDate}  {title}", width).rstrip())
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
    model = str(usage.get("model") or "-")
    provider = str(usage.get("provider") or "-")
    input_tokens = int(usage.get("inputTokens") or 0)
    output_tokens = int(usage.get("outputTokens") or 0)
    total_tokens = int(usage.get("totalTokens") or (input_tokens + output_tokens))
    cost = _model_cost_usd(model, input_tokens, output_tokens)
    width = _message_width()

    summary = kv_table(
        "AUTO-FILL + CHRONOLOGY",
        [
            ("stage", stage),
            ("case", case_id),
            ("document", document_name),
            ("ocr_chars", f"{chars:,}"),
            ("elapsed", f"{elapsed_s:.1f}s"),
            ("agent", "form_population_agent"),
            ("provider", provider),
            ("model", model),
            ("in_tokens", _fmt_int(input_tokens)),
            ("out_tokens", _fmt_int(output_tokens)),
            ("tokens", _fmt_int(total_tokens)),
            ("est_usd", _fmt_usd(cost)),
            ("fields", f"{fields_filled}  {', '.join(field_names[:6]) or '-'}"),
            ("events", f"kept {kept_events}  dropped {dropped_events}"),
            ("dates", str(len(tree.dates))),
            ("phases", str(len(tree.phases))),
        ],
        max_width=width,
    )
    reason_rows = [(k, v) for k, v in sorted((drop_reasons or {}).items()) if v]
    reason_table = ""
    if reason_rows:
        reason_table = "\n" + grid_table(
            "DROPPED EVENTS",
            ["reason", "count"],
            reason_rows,
            max_width=width,
        )
    date_rows = [
        [node.displayDate, node.phase, (node.events[0].title if node.events else "")]
        for node in tree.dates[:10]
    ]
    dates_table = "\n" + grid_table(
        "UNIQUE DATES (earliest first)",
        ["date", "phase", "event"],
        date_rows or [["-", "-", "none"]],
        max_width=width,
    )
    diagram = "\nCHRONOLOGY  phase -> date -> summary\n" + tree_diagram(tree, max_width=width)
    logger.info(
        "[AutoFill] model=%s\n%s%s%s%s",
        model,
        summary,
        reason_table,
        dates_table,
        diagram,
    )
