from __future__ import annotations

import uuid
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class AuditStatus(str, Enum):
    VERIFIED = "VERIFIED"
    VERIFIED_WITH_WARNINGS = "VERIFIED_WITH_WARNINGS"
    NEEDS_REVIEW = "NEEDS_REVIEW"
    QUARANTINED = "QUARANTINED"


class VerificationStatus(str, Enum):
    GREEN = "GREEN"
    YELLOW = "YELLOW"
    RED = "RED"


# ---------------------------------------------------------------------------
# Sub-models
# ---------------------------------------------------------------------------

class PartyArguments(BaseModel):
    appellant: List[str] = []
    respondent: List[str] = []
    court: str = ""


class TreatmentInfo(BaseModel):
    followedList: List[Dict[str, Any]] = []
    distinguishedList: List[Dict[str, Any]] = []
    overruledList: List[Dict[str, Any]] = []


class SearchResult(BaseModel):
    title: str = ""
    url: str = ""
    snippet: str = ""
    date: str = ""
    source: str = "serper"  # "serper" | "indian_kanoon"
    full_text: Optional[str] = None
    doc_id: Optional[str] = None


# ---------------------------------------------------------------------------
# Core citation model — matches frontend CitationsPanel / RedesignedCitationReportDoc expectations
# ---------------------------------------------------------------------------

class Citation(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    caseName: str = ""
    primaryCitation: str = ""
    court: str = ""
    date: str = ""
    statutes: List[str] = []
    excerptText: str = ""
    ratio: str = ""
    source: str = "serper"
    auditStatus: AuditStatus = AuditStatus.NEEDS_REVIEW
    verificationStatus: VerificationStatus = VerificationStatus.YELLOW
    argumentParty: str = "neutral"
    partyArguments: PartyArguments = Field(default_factory=PartyArguments)
    dimensionId: str = "1"
    dimensionName: str = ""
    sourceUrl: Optional[str] = None
    canonical_id: Optional[str] = None
    relevanceScore: float = 0.0
    treatment: TreatmentInfo = Field(default_factory=TreatmentInfo)
    ikCiteList: List[Dict[str, Any]] = []
    ikCitedByList: List[Dict[str, Any]] = []
    sourceCitations: List[str] = []
    _dimension_id: str = "group_1"


class LegalDimension(BaseModel):
    dimension_id: str = "1"
    name: str = ""
    reasoning: str = ""
    citations: List[str] = []


class ReportMetadata(BaseModel):
    query: str
    user_id: str
    case_id: Optional[str] = None
    run_id: str
    status: str = "completed"
    citation_count: int = 0
    generated_at: str = Field(default_factory=_now_iso)
    service_version: str = "v1-adk"
    coverage: Dict[str, Any] = Field(default_factory=dict)


class ReportFormat(BaseModel):
    citations: List[Citation] = []
    generatedAt: str = Field(default_factory=_now_iso)
    perspective: str = "all"
    dimensions: List[LegalDimension] = []
    dimensionGroups: List[Dict[str, Any]] = []
    metadata: ReportMetadata


# ---------------------------------------------------------------------------
# API request / response models
# ---------------------------------------------------------------------------

class PipelineRequest(BaseModel):
    query: str
    user_id: str = "anonymous"
    case_id: Optional[str] = None
    case_file_context: Optional[List[Dict[str, Any]]] = None
    perspective: str = "all"
    retrieval_method: str = "serper"
    use_pipeline: bool = True


class StartReportResponse(BaseModel):
    run_id: str
    status: str = "running"


class RunStatus(BaseModel):
    run_id: str
    status: str  # "running" | "completed" | "failed"
    report_id: Optional[str] = None
    report_format: Optional[ReportFormat] = None
    error: Optional[str] = None
    progress: int = 0


class StoredReport(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    case_id: Optional[str] = None
    query: str
    report_format: ReportFormat
    created_at: str = Field(default_factory=_now_iso)
    run_id: str = ""
    shared_with: List[str] = []


# ---------------------------------------------------------------------------
# Internal pipeline context shared between agents via ADK session state
# ---------------------------------------------------------------------------

class AgentRunContext(BaseModel):
    run_id: str
    query: str
    user_id: str
    case_id: Optional[str] = None
    perspective: str = "all"
    case_context: Dict[str, Any] = {}
    search_results: List[Dict[str, Any]] = []
    raw_citations: List[Dict[str, Any]] = []
    ranked_citations: List[Dict[str, Any]] = []
    report_format: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
