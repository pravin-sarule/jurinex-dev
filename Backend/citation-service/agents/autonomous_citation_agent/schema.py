"""All Pydantic schemas for the Autonomous Citation Research Agent."""
from __future__ import annotations
from typing import Dict, List, Optional
from pydantic import BaseModel, Field


# ── Research decomposition models ─────────────────────────────────────────────

class ResearchQuestion(BaseModel):
    type: str = Field(
        description="LIABILITY | BURDEN_PROOF | STATUTORY | PRECEDENT | DEFENSE | CONSTITUTIONAL | PROCEDURAL"
    )
    question: str = Field(description="Complete research question ending with ?")
    key_terms: List[str] = Field(default_factory=list, description="3-5 search terms for this question")
    statutes: List[str] = Field(default_factory=list, description="Relevant acts/sections")
    priority: int = Field(default=2, description="1=critical 2=important 3=optional")


class DeepResearchPlan(BaseModel):
    research_questions: List[ResearchQuestion] = Field(
        description="5-7 typed research questions covering all legal dimensions of the case"
    )


# ── Case analysis models ───────────────────────────────────────────────────────

class LegalIssue(BaseModel):
    issue_title: str = Field(description="Short title, max 6 words")
    proposition: str = Field(description="Legal proposition, max 25 words")
    acts_involved: List[str] = Field(default_factory=list)
    fact_summary: str = Field(default="", description="One-line factual description")


class CaseAnalysis(BaseModel):
    parties: dict = Field(default_factory=dict, description="{petitioner, respondent}")
    case_type: str = Field(default="", description="e.g. writ petition, civil appeal")
    jurisdiction: str = Field(default="", description="Court name")
    case_fact_summary: str = Field(description="2-3 sentence factual matrix")
    issues: List[LegalIssue] = Field(description="Up to 4 legal issues")
    primary_statutes: List[str] = Field(default_factory=list)
    dispute_nature: str = Field(default="", description="property/criminal/service/constitutional/commercial")


# ── Search / query models ──────────────────────────────────────────────────────

class QueryPlanOutput(BaseModel):
    queries: List[str] = Field(description="Targeted search queries for Indian court judgments")


# ── Search result model ────────────────────────────────────────────────────────

class SearchResult(BaseModel):
    uri: str = Field(description="Full URL of the result")
    title: str = Field(default="", description="Page title")
    snippet: str = Field(default="", description="Short excerpt from the page")
    authority_tier: str = Field(default="T2", description="T1 / T2 / T3 authority tier")


# ── Citation models ────────────────────────────────────────────────────────────

class CitationDict(BaseModel):
    parties: str = Field(default="", description="Case parties e.g. 'State of Maharashtra v. Ramesh Kumar'")
    court: str = Field(default="", description="Court name e.g. 'Supreme Court of India'")
    year: str = Field(default="", description="Year of judgment e.g. '2022'")
    citation_no: str = Field(default="", description="Official citation e.g. '(2022) 5 SCC 123'")
    ratio: str = Field(default="", description="Ratio decidendi — the core legal holding")
    how_helps: str = Field(default="", description="How this judgment supports the legal issue")
    source_url: str = Field(default="", description="URL where the judgment was found")
    source_name: str = Field(default="", description="Source site name")
    authority_tier: str = Field(default="", description="T1 (official) / T2 (reporter) / T3 (secondary)")
    confidence: str = Field(default="", description="HIGH / MEDIUM / BLOCKED after verification")
    verification_status: str = Field(default="unverified", description="verified / unverified / blocked")
    official_citation: str = Field(default="", description="Resolved official SCC/SCR/neutral citation")
    legal_issue: str = Field(default="", description="Which legal issue this citation addresses")


class CitationListOutput(BaseModel):
    citations: List[CitationDict] = Field(default_factory=list, description="Extracted citation candidates")
