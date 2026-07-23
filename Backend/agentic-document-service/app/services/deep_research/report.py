"""End-of-run token & cost table for a Deep Research run.

Renders a per-step breakdown (plan, each search round, gap checks, synthesis) with input/
output/total tokens and rupee cost, plus a TOTAL row — in the same house style as the
service's other usage tables (reusing `_multicol_table` from token_usage_log). Printed to
the uvicorn console and logged, exactly like `flush_aggregated_token_usage_table` and
`log_draft_token_usage`.
"""

from __future__ import annotations

import logging

from .budget import BudgetTracker
from .config import DeepResearchConfig

logger = logging.getLogger("app.services.deep_research")


def _fmt(n: int) -> str:
    return f"{int(n):,}"


def render_usage_table(
    budget: BudgetTracker,
    cfg: DeepResearchConfig,
    *,
    rounds: int,
    session_id: str = "",
    answer_length: int = 0,
    sources: int = 0,
    user_id: str | int | None = None,
    request_id: str | None = None,
) -> str:
    headers = ["Step", "Model", "Input", "Output", "Total", "Cost ₹"]
    rows: list[list[str]] = [
        [
            s["label"], s["model"],
            _fmt(s["input"]), _fmt(s["output"]), _fmt(s["total"]),
            f"{s['cost_inr']:.2f}",
        ]
        for s in budget.steps
    ]
    rows.append([
        "TOTAL", f"{rounds} round(s) · {budget.calls} calls",
        _fmt(budget.input_tokens), _fmt(budget.output_tokens),
        _fmt(budget.input_tokens + budget.output_tokens),
        f"{budget.spent_inr:.2f}",
    ])

    remaining = max(0.0, cfg.budget_inr - budget.spent_inr)
    subtitle = [
        f"Budget: ₹{cfg.budget_inr:.0f}   spent ₹{budget.spent_inr:.2f}   remaining ₹{remaining:.2f}",
        f"Rounds: {rounds}   Sources: {sources}   Answer: {_fmt(answer_length)} chars",
    ]
    meta: list[str] = []
    if session_id:
        meta.append(f"Session: {session_id}")
    if user_id is not None:
        meta.append(f"User: {user_id}")
    if request_id:
        meta.append(f"Request: {request_id}")
    if meta:
        subtitle.append("   ".join(meta))

    try:
        from app.services.token_usage_log import _multicol_table
        return _multicol_table(
            headers, rows,
            title="DEEP RESEARCH — TOKEN USAGE & COST (₹)",
            subtitle_lines=subtitle,
            right_align_from=2,
        )
    except Exception:
        # Fallback if the shared renderer moves: a single-line summary is better than nothing.
        return (
            "DEEP RESEARCH TOTAL "
            f"rounds={rounds} calls={budget.calls} "
            f"in={budget.input_tokens} out={budget.output_tokens} "
            f"total={budget.input_tokens + budget.output_tokens} spent=₹{budget.spent_inr:.2f}"
        )


def log_usage_table(budget: BudgetTracker, cfg: DeepResearchConfig, **kwargs) -> None:
    """Render and emit the table — print (easy to spot in the console) + logger."""
    table = render_usage_table(budget, cfg, **kwargs)
    try:
        print(table, flush=True)
    except Exception:
        pass
    logger.info(table)
