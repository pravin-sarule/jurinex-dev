"""
Generic in-process background job queue with worker threads.

No Redis required. Jobs live in memory for the process lifetime.
"""

from __future__ import annotations

import logging
import queue
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable, Dict, Optional

logger = logging.getLogger(__name__)

JOB_WORKER_POOL_SIZE = 4

_job_queue: queue.Queue = queue.Queue()
_job_states: Dict[str, Dict[str, Any]] = {}
_job_events: Dict[str, threading.Event] = {}
_latest_scope_jobs: Dict[str, str] = {}

_states_lock = threading.Lock()
_worker_start_lock = threading.Lock()
_worker_pool: Optional[ThreadPoolExecutor] = None


def _format_ts(ts: Optional[float]) -> Optional[str]:
    if not ts:
        return None
    import datetime

    return datetime.datetime.fromtimestamp(ts).isoformat()


def _worker_loop() -> None:
    while True:
        try:
            item = _job_queue.get(timeout=30.0)
            if item is None:
                break

            job_id, handler = item
            with _states_lock:
                state = _job_states.get(job_id)
                if not state:
                    _job_queue.task_done()
                    continue
                state["status"] = "started"
                state["started_at"] = time.time()

            try:
                result = handler()
                with _states_lock:
                    state = _job_states.get(job_id, {})
                    state["status"] = "finished"
                    state["result"] = result
                    state["ended_at"] = time.time()
            except Exception as exc:
                logger.exception("Background job %s failed", job_id)
                with _states_lock:
                    state = _job_states.get(job_id, {})
                    state["status"] = "failed"
                    state["error"] = str(exc)
                    state["ended_at"] = time.time()
            finally:
                event = _job_events.get(job_id)
                if event:
                    event.set()
                _job_queue.task_done()
        except queue.Empty:
            continue
        except Exception:
            logger.exception("Background job worker loop failed")


def _ensure_workers_started() -> None:
    global _worker_pool

    with _worker_start_lock:
        if _worker_pool is not None:
            return
        _worker_pool = ThreadPoolExecutor(
            max_workers=JOB_WORKER_POOL_SIZE,
            thread_name_prefix="background-job-worker",
        )
        for _ in range(JOB_WORKER_POOL_SIZE):
            _worker_pool.submit(_worker_loop)
        logger.info(
            "Background job queue started (%s worker threads, in-process, no Redis)",
            JOB_WORKER_POOL_SIZE,
        )


def enqueue_job(
    *,
    job_type: str,
    scope_key: str,
    fingerprint: Optional[str],
    payload: Dict[str, Any],
    handler: Callable[[], Dict[str, Any]],
    dedupe_active: bool = True,
) -> Dict[str, Any]:
    _ensure_workers_started()

    with _states_lock:
        if dedupe_active:
            existing_job_id = _latest_scope_jobs.get(scope_key)
            existing_state = _job_states.get(existing_job_id) if existing_job_id else None
            if (
                existing_state
                and existing_state.get("status") in {"queued", "started"}
                and existing_state.get("fingerprint")
                and existing_state.get("fingerprint") == fingerprint
            ):
                return {
                    "job_id": existing_job_id,
                    "status": existing_state["status"],
                    "scope_key": scope_key,
                    "deduped": True,
                    "queued": existing_state["status"] == "queued",
                }

        job_id = str(uuid.uuid4())
        _job_states[job_id] = {
            "job_id": job_id,
            "job_type": job_type,
            "scope_key": scope_key,
            "fingerprint": fingerprint,
            "payload": payload,
            "status": "queued",
            "created_at": time.time(),
        }
        _job_events[job_id] = threading.Event()
        _latest_scope_jobs[scope_key] = job_id

    _job_queue.put((job_id, handler))
    return {
        "job_id": job_id,
        "status": "queued",
        "scope_key": scope_key,
        "deduped": False,
        "queued": True,
    }


def get_job_status(job_id: str) -> Dict[str, Any]:
    with _states_lock:
        state = dict(_job_states.get(job_id) or {})
    if not state:
        return {"job_id": job_id, "status": "unknown", "error": "Job not found"}

    state["created_at"] = _format_ts(state.get("created_at"))
    state["started_at"] = _format_ts(state.get("started_at"))
    state["ended_at"] = _format_ts(state.get("ended_at"))
    if state.get("payload") is not None:
        state["payload"] = {
            "draft_id": state["payload"].get("draft_id"),
            "section_key": state["payload"].get("section_key"),
        }
    return state


def get_latest_job_for_scope(scope_key: str) -> Optional[Dict[str, Any]]:
    with _states_lock:
        job_id = _latest_scope_jobs.get(scope_key)
    if not job_id:
        return None
    return get_job_status(job_id)


def wait_for_job(job_id: str, timeout_seconds: float) -> Dict[str, Any]:
    with _states_lock:
        event = _job_events.get(job_id)
    if not event:
        return get_job_status(job_id)

    event.wait(timeout_seconds)
    return get_job_status(job_id)
