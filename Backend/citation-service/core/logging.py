from __future__ import annotations

import json
import logging
import sys
import time
from contextlib import contextmanager
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Any, Iterator

_CONFIGURED = False
_LOG_DIR = Path(__file__).resolve().parents[1] / "logs"


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "timestamp": self.formatTime(record),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        details = getattr(record, "details", None)
        if isinstance(details, dict):
            payload.update(details)
        if record.exc_info:
            payload["stacktrace"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str, ensure_ascii=True)


def configure_structured_logging() -> None:
    global _CONFIGURED
    if _CONFIGURED:
        return
    _LOG_DIR.mkdir(parents=True, exist_ok=True)
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    formatter = JsonFormatter()
    for logger_name in ("citation", "pipeline", "integrations.indian_kanoon", "services"):
        logging.getLogger(logger_name).setLevel(logging.DEBUG)

    # Console (stdout) handler so the full pipeline dataflow is visible in the terminal,
    # not only in logs/*.log. Replace any pre-existing console handler (from main.py's
    # basicConfig or uvicorn --reload) with exactly one known-good stdout handler — this
    # guarantees pipeline logs reach the terminal without double-printing every line.
    for h in list(root.handlers):
        if isinstance(h, logging.StreamHandler) and not isinstance(h, logging.FileHandler):
            root.removeHandler(h)
    console = logging.StreamHandler(sys.stdout)
    console.setLevel(logging.INFO)
    console.setFormatter(logging.Formatter(
        "%(asctime)s  %(levelname)-7s [%(name)s] %(message)s", datefmt="%H:%M:%S",
    ))
    root.addHandler(console)
    for name, level in (("application.log", logging.INFO), ("error.log", logging.ERROR), ("debug.log", logging.DEBUG)):
        handler = RotatingFileHandler(_LOG_DIR / name, maxBytes=10_000_000, backupCount=5)
        handler.setLevel(level)
        handler.setFormatter(formatter)
        root.addHandler(handler)
    audit = logging.getLogger("citation.audit")
    audit_handler = RotatingFileHandler(_LOG_DIR / "audit.log", maxBytes=10_000_000, backupCount=5)
    audit_handler.setFormatter(formatter)
    audit.addHandler(audit_handler)
    audit.setLevel(logging.INFO)
    _CONFIGURED = True


@contextmanager
def stage_span(run_id: str, stage: str, input_count: int = 0, **details: Any) -> Iterator[dict[str, Any]]:
    logger = logging.getLogger(f"citation.pipeline.{stage}")
    started = time.monotonic()
    meta = {"run_id": run_id, "stage": stage, "event": "START_STAGE", "input_count": input_count, **details}
    logger.info("START_STAGE=%s", stage, extra={"details": meta})
    try:
        yield meta
    except Exception:
        logger.exception("STAGE_FAILED=%s", stage, extra={"details": meta})
        raise
    finally:
        duration = round(time.monotonic() - started, 4)
        end = {**meta, "event": "END_STAGE", "duration_seconds": duration}
        logger.info("END_STAGE=%s", stage, extra={"details": end})
        try:
            from db.client import agent_log_insert
            agent_log_insert(run_id, None, "citation_v2", stage, "INFO", f"{stage} completed in {duration}s", end)
        except Exception:
            logger.debug("DB stage log unavailable", exc_info=True)
