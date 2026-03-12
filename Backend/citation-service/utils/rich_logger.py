"""
Rich Console Logger for Citation Pipeline.

Provides beautiful, structured logging for agent execution, dataflow, and prompt resolution.
Falls back to standard logging if `rich` is not installed.
"""

from __future__ import annotations

import logging
import time
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

# ── Try to import rich; graceful fallback ────────────────────────────────────

_RICH_AVAILABLE = False
try:
    from rich.console import Console
    from rich.panel import Panel
    from rich.table import Table
    from rich.text import Text
    _RICH_AVAILABLE = True
except ImportError:
    pass

# Source labels & colors
_SOURCE_STYLES = {
    "database": ("DATABASE 🟢", "bold green"),
    "file":     ("FILE 🔵",     "bold blue"),
    "default":  ("DEFAULT 🟡",  "bold yellow"),
    "error":    ("ERROR 🔴",    "bold red"),
    "n/a":      ("N/A",         "dim"),
}

# Agent emoji map
_AGENT_ICONS = {
    "KeywordExtractor":    "🔑",
    "Watchdog":            "🐕",
    "Fetcher":             "📥",
    "Clerk":               "📋",
    "Librarian":           "📚",
    "Auditor":             "🔍",
    "ReportBuilder":       "📊",
    "CitationAgent":       "🤖",
    "TreatmentExtractor":  "🔬",
}


class PipelineConsole:
    """Rich console wrapper for structured pipeline logging."""

    def __init__(self):
        if _RICH_AVAILABLE:
            self._console = Console(stderr=False, force_terminal=True)
        else:
            self._console = None
        self._timers: Dict[str, float] = {}

    def log_pipeline_start(self, query: str, user_id: str, run_id: str = "", case_id: str = "") -> None:
        msg = (
            f"🚀 CITATION PIPELINE STARTED\n"
            f"  Query: {query[:120]}{'…' if len(query) > 120 else ''}\n"
            f"  User: {user_id}"
        )
        if case_id:
            msg += f" | Case: {case_id}"
        if run_id:
            msg += f"\n  Run: {run_id}"

        if self._console:
            self._console.print(Panel(msg, title="Pipeline", border_style="bold cyan"))
        else:
            logger.info(msg.replace("\n", " | "))

    def log_pipeline_end(self, status: str, citation_count: int = 0, duration: float = 0) -> None:
        msg = f"✅ PIPELINE {status.upper()} — {citation_count} citations ({duration:.1f}s)"
        if self._console:
            style = "bold green" if status == "completed" else "bold yellow"
            self._console.print(Panel(msg, title="Pipeline Done", border_style=style))
        else:
            logger.info(msg)

    def log_agent_start(
        self,
        agent_name: str,
        prompt_source: str = "n/a",
        prompt_name: str = "",
        model_name: str = "",
        temperature: float = 0,
        max_tokens: int = 0,
        warnings: Optional[List[str]] = None,
        duration: Optional[float] = None,
    ) -> None:
        self._timers[agent_name] = time.time()
        icon = _AGENT_ICONS.get(agent_name, "⚙️")
        source_label, source_style = _SOURCE_STYLES.get(prompt_source, ("???", "white"))

        if self._console:
            table = Table(show_header=False, box=None, padding=(0, 1))
            table.add_column(style="bold", width=14)
            table.add_column()
            if prompt_name:
                table.add_row("Prompt Key:", prompt_name)
            table.add_row("Source:", Text(source_label, style=source_style))
            if model_name:
                table.add_row("Model:", model_name)
            if temperature or max_tokens:
                parts = []
                if temperature:
                    parts.append(f"temp={temperature}")
                if max_tokens:
                    parts.append(f"max_tokens={max_tokens}")
                table.add_row("Config:", " | ".join(parts))
            if warnings:
                for w in warnings:
                    table.add_row("⚠️ Warning:", Text(w, style="yellow"))
            if duration is not None:
                table.add_row("Runtime:", f"{duration:.2f}s")

            self._console.print(Panel(
                table,
                title=f"{icon} {agent_name}",
                border_style="cyan",
            ))
        else:
            logger.info(
                "[%s %s] key=%s source=%s model=%s temp=%.2f",
                icon, agent_name, prompt_name or "—", prompt_source, model_name or "—", temperature,
            )
            if warnings:
                for w in warnings:
                    logger.warning("[%s] ⚠️ %s", agent_name, w)

    def log_agent_end(self, agent_name: str, result_summary: str = "") -> None:
        duration = time.time() - self._timers.pop(agent_name, time.time())
        icon = _AGENT_ICONS.get(agent_name, "⚙️")
        msg = f"{icon} {agent_name} done ({duration:.1f}s)"
        if result_summary:
            msg += f" — {result_summary}"

        if self._console:
            self._console.print(f"  └─ {msg}", style="dim")
        else:
            logger.info(msg)

    def log_dataflow(self, from_agent: str, to_agent: str, data_desc: str = "") -> None:
        arrow = f"  ↓ {data_desc}" if data_desc else "  ↓"
        if self._console:
            self._console.print(arrow, style="bold blue")
        else:
            logger.info("[FLOW] %s → %s: %s", from_agent, to_agent, data_desc or "→")

    def log_fallback_warning(self, agent_name: str, reason: str) -> None:
        msg = f"⚠️ {agent_name}: {reason}"
        if self._console:
            self._console.print(Panel(msg, border_style="yellow", title="Fallback"))
        else:
            logger.warning(msg)


# Module-level singleton
pipeline_console = PipelineConsole()
