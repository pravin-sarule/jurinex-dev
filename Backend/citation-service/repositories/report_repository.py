from typing import Any


def save_report(report_id: str, user_id: str, query: str, report: dict, case_id: str | None, run_id: str) -> None:
    from db.client import report_insert
    report_insert(
        report_id, user_id, query, report, "completed", case_id=case_id, run_id=run_id,
        citations_approved_count=len(report.get("recommended_citations") or []),
        citations_quarantined_count=len(report.get("adverse_citations") or []) + len(report.get("use_with_caution") or []),
    )
