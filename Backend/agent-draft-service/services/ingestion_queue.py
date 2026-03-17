"""
Ingestion queue: draft job (1 per upload batch) + N document jobs processed by parallel workers.

Flow:
  User uploads N documents
    → Create 1 Draft Job (parent)
    → Create N Document Jobs (queue)
    → Worker pool (parallel) processes each document: OCR, chunking, embeddings, store chunks
    → When ALL document jobs complete → mark Draft Job COMPLETE
  Frontend polls draft job status; when complete, all chunks are available for draft generation.

Uses in-memory queue and a thread pool—no Redis. Job state is lost on server restart.
"""

from __future__ import annotations

import logging
import queue
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

# Number of parallel workers for document processing (OCR, chunk, embed, store)
WORKER_POOL_SIZE = 4

# Document job state: job_id -> { status, result?, error?, draft_job_id?, created_at?, ended_at? }
_job_states: Dict[str, Dict[str, Any]] = {}
_states_lock = threading.Lock()

# Draft job (parent): draft_job_id -> { draft_id, user_id, document_job_ids[], status, created_at, updated_at }
_draft_jobs: Dict[str, Dict[str, Any]] = {}
_draft_jobs_lock = threading.Lock()

# Queue of (job_id, payload, draft_job_id)
_job_queue: queue.Queue = queue.Queue()
_worker_pool: Optional[ThreadPoolExecutor] = None
_worker_start_lock = threading.Lock()


def _worker_loop() -> None:
    """Single worker: pull document jobs from queue, run OCR → chunk → embed → store."""
    from workers.ingestion_worker import process_ingestion_job

    while True:
        try:
            item = _job_queue.get(timeout=30.0)
            if item is None:
                break
            job_id, payload, draft_job_id = item
            with _states_lock:
                _job_states[job_id]["status"] = "started"
            try:
                result = process_ingestion_job(payload)
                with _states_lock:
                    _job_states[job_id].update({
                        "status": "finished",
                        "file_id": result.get("file_id"),
                        "raw_text_length": result.get("raw_text_length"),
                        "chunks_count": result.get("chunks_count"),
                        "embeddings_count": result.get("embeddings_count"),
                        "draft_id": result.get("draft_id"),
                        "ended_at": time.time(),
                    })
                logger.info("Document job %s finished, file_id=%s", job_id, result.get("file_id"))
            except Exception as e:
                logger.exception("Document job %s failed: %s", job_id, e)
                with _states_lock:
                    _job_states[job_id].update({
                        "status": "failed",
                        "error": str(e),
                        "ended_at": time.time(),
                    })
            finally:
                _on_document_job_done(job_id, draft_job_id)
                _job_queue.task_done()
        except queue.Empty:
            continue
        except Exception as e:
            logger.exception("Worker loop error: %s", e)


def _run_autopopulation_background(payload: Dict[str, Any]) -> None:
    """Run autopopulation agent with all file_ids once all documents in a draft job are ingested."""
    try:
        from agents.ingestion.autopopulation_agent import run_autopopulation_agent
        file_count = len(payload.get("file_ids") or [])
        logger.info(
            "[ingestion_queue] Running autopopulation for draft_session_id=%s with %d file(s)",
            payload.get("draft_session_id"), file_count,
        )
        result = run_autopopulation_agent(payload)
        logger.info(
            "[ingestion_queue] Autopopulation complete: status=%s, filled=%d fields",
            result.get("status"),
            len(result.get("extracted_fields") or {}),
        )
    except Exception as e:
        logger.warning("[ingestion_queue] Autopopulation failed (non-blocking): %s", e)


def _on_document_job_done(job_id: str, draft_job_id: Optional[str]) -> None:
    """When a document job finishes or fails, check if all docs in this draft job are done.
    If so, mark draft job complete and trigger autopopulation with ALL collected file_ids."""
    if not draft_job_id:
        return

    trigger_autopopulation = False
    autopopulation_payload: Optional[Dict[str, Any]] = None

    with _draft_jobs_lock:
        draft = _draft_jobs.get(draft_job_id)
        if not draft:
            return
        doc_ids = draft.get("document_job_ids") or []
        with _states_lock:
            statuses = [_job_states.get(jid, {}).get("status") for jid in doc_ids]
        done_statuses = ("finished", "failed", "canceled", "unknown")
        if all(s in done_statuses for s in statuses):
            draft["status"] = "complete"
            draft["updated_at"] = time.time()
            logger.info("Draft job %s complete: all %s document jobs finished", draft_job_id, len(doc_ids))

            # Build autopopulation payload if we have what we need
            template_id = draft.get("template_id")
            draft_id = draft.get("draft_id")
            user_id = draft.get("user_id")
            if template_id and draft_id and user_id:
                with _states_lock:
                    all_file_ids = [
                        _job_states[jid]["file_id"]
                        for jid in doc_ids
                        if _job_states.get(jid, {}).get("status") == "finished"
                        and _job_states[jid].get("file_id")
                    ]
                if all_file_ids:
                    trigger_autopopulation = True
                    autopopulation_payload = {
                        "template_id": template_id,
                        "user_id": user_id,
                        "draft_session_id": draft_id,
                        "file_ids": all_file_ids,
                    }

    # Run autopopulation outside the lock — it's a long-running LLM call
    if trigger_autopopulation and autopopulation_payload:
        threading.Thread(
            target=_run_autopopulation_background,
            args=(autopopulation_payload,),
            daemon=True,
        ).start()


def _ensure_workers_started() -> None:
    """Start the worker pool on first use."""
    global _worker_pool
    with _worker_start_lock:
        if _worker_pool is not None:
            return
        _worker_pool = ThreadPoolExecutor(max_workers=WORKER_POOL_SIZE, thread_name_prefix="ingestion-worker")
        for i in range(WORKER_POOL_SIZE):
            _worker_pool.submit(_worker_loop)
        logger.info("Ingestion worker pool started (%s parallel workers, in-process, no Redis)", WORKER_POOL_SIZE)


def is_queue_available() -> bool:
    return True


def enqueue_draft_job(
    draft_id: str,
    user_id: int,
    payloads: List[Dict[str, Any]],
    template_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Create one Draft Job and N Document Jobs. Each payload is one document (user_id, file_content base64, etc.).
    Document jobs are processed in parallel by the worker pool. When all document jobs complete,
    the draft job is marked complete.

    Returns: { "draft_job_id": str, "job_ids": List[str], "draft_id": str, "total": int }
    """
    if not payloads:
        raise ValueError("At least one document payload is required")

    _ensure_workers_started()
    draft_job_id = str(uuid.uuid4())
    job_ids: List[str] = []

    with _draft_jobs_lock:
        _draft_jobs[draft_job_id] = {
            "draft_job_id": draft_job_id,
            "draft_id": draft_id,
            "user_id": user_id,
            "template_id": template_id,  # needed for post-completion autopopulation
            "document_job_ids": [],
            "status": "processing",
            "created_at": time.time(),
            "updated_at": time.time(),
        }

    for payload in payloads:
        jid = str(uuid.uuid4())
        with _states_lock:
            _job_states[jid] = {
                "job_id": jid,
                "status": "queued",
                "draft_job_id": draft_job_id,
                "batch_id": draft_job_id,
                "created_at": time.time(),
            }
        payload.setdefault("draft_id", draft_id)
        if template_id:
            payload.setdefault("template_id", template_id)
        _job_queue.put((jid, payload, draft_job_id))
        job_ids.append(jid)

    with _draft_jobs_lock:
        _draft_jobs[draft_job_id]["document_job_ids"] = job_ids

    logger.info(
        "Draft job %s created: draft_id=%s, %s document job(s) enqueued",
        draft_job_id, draft_id, len(job_ids),
    )
    return {
        "draft_job_id": draft_job_id,
        "job_ids": job_ids,
        "batch_id": draft_job_id,
        "draft_id": draft_id,
        "total": len(job_ids),
        "queued": True,
    }


def enqueue_ingestion_job(
    payload: Dict[str, Any],
    batch_id: Optional[str] = None,
    job_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Enqueue a single document job (legacy/single-doc). For multi-doc use enqueue_draft_job.
    batch_id here is stored as draft_job_id for completion checking if provided.
    """
    _ensure_workers_started()
    jid = job_id or str(uuid.uuid4())
    draft_job_id = batch_id
    with _states_lock:
        _job_states[jid] = {
            "job_id": jid,
            "status": "queued",
            "draft_job_id": draft_job_id,
            "batch_id": batch_id,
            "created_at": time.time(),
        }
    _job_queue.put((jid, payload, draft_job_id))
    return {
        "job_id": jid,
        "batch_id": batch_id,
        "queued": True,
    }


def get_draft_job_status(draft_job_id: str) -> Dict[str, Any]:
    """
    Return status of the draft job (parent): status (processing | complete | failed),
    document_job_ids, per-job statuses, file_ids from completed docs, all_done.
    """
    with _draft_jobs_lock:
        draft = _draft_jobs.get(draft_job_id)
    if not draft:
        return {
            "draft_job_id": draft_job_id,
            "status": "unknown",
            "error": "Draft job not found (or expired after restart)",
        }
    doc_ids = draft.get("document_job_ids") or []
    jobs = [get_job_status(jid) for jid in doc_ids]
    statuses = [j.get("status") for j in jobs]
    all_done = all(s in ("finished", "failed", "canceled", "unknown") for s in statuses)
    finished = [j for j in jobs if j.get("status") == "finished"]
    failed = [j for j in jobs if j.get("status") == "failed"]
    file_ids = [j["file_id"] for j in finished if j.get("file_id")]
    out = {
        "draft_job_id": draft_job_id,
        "draft_id": draft.get("draft_id"),
        "user_id": draft.get("user_id"),
        "status": draft.get("status", "processing"),
        "document_job_ids": doc_ids,
        "jobs": jobs,
        "all_done": all_done,
        "finished_count": len(finished),
        "failed_count": len(failed),
        "file_ids": file_ids,
        "total": len(doc_ids),
        "created_at": _format_ts(draft["created_at"]) if draft.get("created_at") else None,
        "updated_at": _format_ts(draft["updated_at"]) if draft.get("updated_at") else None,
    }
    return out


def get_job_status(job_id: str) -> Dict[str, Any]:
    """Return status of a single document job."""
    with _states_lock:
        state = _job_states.get(job_id)
    if not state:
        return {"job_id": job_id, "status": "unknown", "error": "Job not found (or expired after restart)"}
    out = dict(state)
    if out.get("created_at"):
        out["created_at"] = _format_ts(out["created_at"])
    if out.get("ended_at"):
        out["ended_at"] = _format_ts(out["ended_at"])
    return out


def _format_ts(ts: float) -> str:
    try:
        import datetime
        return datetime.datetime.utcfromtimestamp(ts).isoformat() + "Z"
    except Exception:
        return str(ts)


def get_batch_status(batch_id: str) -> Dict[str, Any]:
    """Batch id is draft_job_id; return draft job status."""
    return get_draft_job_status(batch_id)


def get_batch_status_for_job_ids(batch_id: str, job_ids: List[str]) -> Dict[str, Any]:
    """Return batch/draft job status for the given document job_ids (backward compatible)."""
    draft_status = get_draft_job_status(batch_id)
    if draft_status.get("status") == "unknown":
        # Fallback: no draft job record, compute from job_ids only
        jobs = [get_job_status(jid) for jid in job_ids]
        statuses = [j.get("status") for j in jobs]
        all_done = all(s in ("finished", "failed", "canceled", "unknown") for s in statuses)
        finished = [j for j in jobs if j.get("status") == "finished"]
        failed = [j for j in jobs if j.get("status") == "failed"]
        file_ids = [j["file_id"] for j in finished if j.get("file_id")]
        return {
            "batch_id": batch_id,
            "draft_job_id": batch_id,
            "job_ids": job_ids,
            "jobs": jobs,
            "all_done": all_done,
            "finished_count": len(finished),
            "failed_count": len(failed),
            "file_ids": file_ids,
            "total": len(job_ids),
        }
    return draft_status
