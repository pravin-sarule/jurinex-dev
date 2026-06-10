from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class BatchSessionCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = Field(None, max_length=500)


class BatchSessionInfo(BaseModel):
    session_id: str
    name: str
    description: Optional[str] = None
    job_count: int = 0
    completed_count: int = 0
    total_tokens: int = 0
    created_at: datetime
    updated_at: datetime


class BatchFileUploadRequest(BaseModel):
    filename: str
    content_type: str = "application/pdf"


class BatchFileUploadResponse(BaseModel):
    file_id: str
    upload_url: str
    gcs_path: str
    expires_in_seconds: int = 900


class BatchFileCompleteRequest(BaseModel):
    file_id: str
    gcs_path: str
    filename: str
    file_size_bytes: int = 0


class BatchFileInfo(BaseModel):
    file_id: str
    status: str
    original_filename: str
    is_scanned: bool = False
    page_count: int = 0
    file_size_bytes: int = 0
    gemini_file_name: Optional[str] = None
    error_message: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class BatchJobCreateRequest(BaseModel):
    display_name: str = Field(..., min_length=1, max_length=200)
    queries: list[str] = Field(..., min_length=1, max_length=200000, description="List of queries, up to 200,000")
    file_id: Optional[str] = Field(None, description="Optional uploaded batch file ID for document context")
    model: str = Field(default="gemini-2.0-flash", description="Gemini model to use")
    system_instruction: Optional[str] = Field(None, max_length=8000, description="Optional system instruction for all requests")
    session_id: Optional[str] = Field(None, description="Optional session ID to group jobs")


class BatchJobInfo(BaseModel):
    job_id: str
    display_name: Optional[str]
    status: str
    request_count: int
    model: Optional[str] = None
    batch_file_id: Optional[str] = None
    original_filename: Optional[str] = None
    session_id: Optional[str] = None
    gemini_job_name: Optional[str] = None
    error_message: Optional[str] = None
    total_input_tokens: int = 0
    total_output_tokens: int = 0
    total_tokens: int = 0
    created_at: datetime
    updated_at: datetime
    completed_at: Optional[datetime] = None


class BatchJobConfigResponse(BaseModel):
    job_id: str
    display_name: Optional[str]
    model: str
    system_instruction: Optional[str] = None
    request_count: int
    queries: list[str] = []
    batch_file_id: Optional[str] = None
    file_info: Optional[dict] = None
    status: Optional[str] = None
    total_input_tokens: int = 0
    total_output_tokens: int = 0
    total_tokens: int = 0


class BatchJobResult(BaseModel):
    request_key: str
    query_text: Optional[str] = None
    response_text: Optional[str] = None
    status: str = "completed"
    input_tokens: int = 0
    output_tokens: int = 0
    query_truncated: bool = False
    response_truncated: bool = False
    query_length: int = 0
    response_length: int = 0


class BatchJobResultsResponse(BaseModel):
    job_id: str
    display_name: Optional[str]
    status: str
    model: Optional[str] = None
    request_count: int
    total_count: int = 0
    caching: bool = False
    total_input_tokens: int = 0
    total_output_tokens: int = 0
    total_tokens: int = 0
    results: list[BatchJobResult] = []
