from pydantic import BaseModel, Field


class CitationReportRequest(BaseModel):
    query: str = Field(min_length=1)
    user_id: str = "anonymous"
    case_id: str | None = None
    perspective: str = "neutral"
