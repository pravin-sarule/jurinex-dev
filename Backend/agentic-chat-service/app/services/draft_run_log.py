"""Per-run audit trail for the 4-stage drafting pipeline.

Every generation run gets a run ID; every stage's raw input/output (digest,
grounded field JSON, draft text, discrepancy report, review packet, …) is
written as a timestamped JSON file under ``DRAFT_RUN_LOG_DIR`` (default
``logs/draft_runs/<run_id>/``). This is a legal-adjacent system — the audit
trail matters as much as accuracy.

Logging never breaks a draft: every write failure degrades to a warning.
"""
from __future__ import annotations

import json
import logging
import os
import time
import uuid
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

_DEFAULT_DIR = "logs/draft_runs"


def _now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


class DraftRunLogger:
    """One instance per generation run; ``log_stage`` appends stage artifacts."""

    def __init__(self, session_id: str, base_dir: str | None = None) -> None:
        self.session_id = session_id
        self.run_id = (
            time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
            + "-" + uuid.uuid4().hex[:8]
        )
        self._seq = 0
        self._dir: Path | None = None
        try:
            base = Path(base_dir or os.environ.get("DRAFT_RUN_LOG_DIR", _DEFAULT_DIR))
            self._dir = base / self.run_id
            self._dir.mkdir(parents=True, exist_ok=True)
            self.log_stage("run_start", {"session_id": session_id})
        except Exception as exc:
            logger.warning("Draft run log dir unavailable (%s) — file audit trail off", exc)
            self._dir = None

    def log_stage(self, stage: str, payload: Any, kind: str = "output") -> None:
        """Write one stage artifact: {run_id, session_id, stage, kind, ts, payload}."""
        self._seq += 1
        record = {
            "run_id": self.run_id,
            "session_id": self.session_id,
            "stage": stage,
            "kind": kind,
            "seq": self._seq,
            "ts": _now_iso(),
            "payload": payload,
        }
        logger.info(
            "Draft pipeline run=%s stage=%s kind=%s seq=%s",
            self.run_id, stage, kind, self._seq,
        )
        if self._dir is None:
            return
        try:
            safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in stage)[:48]
            path = self._dir / f"{self._seq:02d}_{safe}_{kind}.json"
            path.write_text(
                json.dumps(record, ensure_ascii=False, indent=2, default=str),
                encoding="utf-8",
            )
        except Exception as exc:
            logger.warning("Draft run log write failed (stage=%s): %s", stage, exc)
