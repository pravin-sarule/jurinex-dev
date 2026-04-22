from __future__ import annotations

import logging
import sys
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

try:
    from rich.logging import RichHandler
    from rich.console import Console

    _console = Console(stderr=True)
    _rich_available = True
except ImportError:
    _rich_available = False


def get_logger(name: str = "citation-v1") -> logging.Logger:
    logger = logging.getLogger(name)
    if logger.handlers:
        return logger

    logger.setLevel(logging.INFO)

    if _rich_available:
        handler = RichHandler(
            console=_console,
            show_time=True,
            show_path=False,
            markup=True,
            rich_tracebacks=True,
        )
        handler.setFormatter(logging.Formatter("%(message)s", datefmt="[%X]"))
    else:
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(
            logging.Formatter("%(asctime)s | %(levelname)s | %(name)s | %(message)s")
        )

    logger.addHandler(handler)
    logger.propagate = False
    return logger


# ---------------------------------------------------------------------------
# Structured pipeline log entries stored in run state
# ---------------------------------------------------------------------------

_pipeline_logs: Dict[str, List[Dict[str, Any]]] = {}


def pipeline_log(run_id: str, agent: str, message: str, level: str = "info") -> None:
    entry = {
        "ts": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "agent": agent,
        "message": message,
        "level": level,
    }
    _pipeline_logs.setdefault(run_id, []).append(entry)
    logger = get_logger(f"pipeline.{agent}")
    getattr(logger, level, logger.info)(f"[{run_id[:8]}] {message}")


def get_pipeline_logs(run_id: str, since_time: Optional[str] = None) -> List[Dict[str, Any]]:
    logs = _pipeline_logs.get(run_id, [])
    if since_time:
        logs = [l for l in logs if l["ts"] > since_time]
    return logs


def clear_pipeline_logs(run_id: str) -> None:
    _pipeline_logs.pop(run_id, None)
