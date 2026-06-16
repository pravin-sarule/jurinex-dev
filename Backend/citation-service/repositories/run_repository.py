import logging

logger = logging.getLogger(__name__)


def ensure_run(run_id: str, user_id: str, query: str, case_id: str | None) -> None:
    from db.client import pipeline_run_insert
    try:
        pipeline_run_insert(run_id, user_id, query, case_id=case_id)
    except Exception as exc:
        if "duplicate" not in str(exc).lower() and "unique" not in str(exc).lower():
            logger.warning("Unable to seed run %s: %s", run_id, exc)


def complete_run(run_id: str, report_id: str, fetched: int, approved: int, quarantined: int) -> None:
    from db.client import pipeline_run_update
    pipeline_run_update(
        run_id, "completed", report_id=report_id, citations_fetched_count=fetched,
        citations_approved_count=approved, citations_quarantined_count=quarantined,
    )


def fail_run(run_id: str, error: str) -> None:
    from db.client import pipeline_run_update
    pipeline_run_update(run_id, "failed", error_message=error)
