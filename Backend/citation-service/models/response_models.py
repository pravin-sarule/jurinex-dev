from pydantic import BaseModel


class CitationReportResponse(BaseModel):
    success: bool
    report_id: str | None = None
    run_id: str
    status: str
    report_format: dict | None = None
