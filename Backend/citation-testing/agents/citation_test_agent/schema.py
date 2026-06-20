"""Pydantic schemas for Citation Testing Agent."""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class SearchResult(BaseModel):
    uri: str = Field(description="Full URL of the result")
    title: str = Field(default="")
    snippet: str = Field(default="")
    authority_tier: str = Field(default="T2", description="T1 / T2 / T3")


class CitationDict(BaseModel):
    parties: str = Field(default="")
    court: str = Field(default="")
    year: str = Field(default="")
    citation_no: str = Field(default="")
    ratio: str = Field(default="")
    how_helps: str = Field(default="")
    source_url: str = Field(default="")
    source_name: str = Field(default="")
    authority_tier: str = Field(default="")
    confidence: str = Field(default="MEDIUM")
    verification_status: str = Field(default="unverified")
    legal_issue: str = Field(default="")
    is_overruled: bool = Field(default=False, description="True if the ratio has been overruled by a later SC judgment")
    overruled_by: str = Field(default="", description="Name/citation of the SC judgment that overruled this case, if known")


class CitationListOutput(BaseModel):
    citations: List[CitationDict] = Field(default_factory=list)


class QueryPlanOutput(BaseModel):
    queries: List[str] = Field(description="Targeted search queries for Indian court judgments")


class LegalIssue(BaseModel):
    issue_title: str = Field(default="", description="Short title, max 6 words")
    proposition: str = Field(default="", description="Legal proposition, max 25 words")
    acts_involved: List[str] = Field(default_factory=list)
    fact_summary: str = Field(default="", description="One-line factual description")


class CaseAnalysis(BaseModel):
    parties: Any = Field(default_factory=dict, description="Party names — dict or string")
    case_type: str = Field(default="")
    jurisdiction: str = Field(default="")
    case_fact_summary: str = Field(default="")
    issues: List[LegalIssue] = Field(default_factory=list)
    primary_statutes: List[str] = Field(default_factory=list)
    dispute_nature: str = Field(default="")
    key_facts: List[str] = Field(default_factory=list)


class ResearchQuestion(BaseModel):
    type: str = Field(default="PRECEDENT_FACT")
    question: str = Field(default="")
    key_terms: List[str] = Field(default_factory=list)
    fact_anchors: List[str] = Field(default_factory=list)
    statutes: List[str] = Field(default_factory=list)
    priority: int = Field(default=2)


class DeepResearchPlan(BaseModel):
    research_questions: List[ResearchQuestion] = Field(default_factory=list)
