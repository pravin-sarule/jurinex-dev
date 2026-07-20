from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from core.budgets import BudgetTracker
from models.citation_models import Candidate
from models.issue_models import IssueCard
from models.run_models import CaseProfile


@dataclass
class PipelineContext:
    run_id: str
    query: str
    user_id: str
    case_id: str | None
    perspective: str
    case_context: str
    # FAILURE 3 — the resolved represented side after multi-signal detection. Mirrors
    # `perspective` (kept identical); both are corrected together so every stage
    # (scoring, evaluator, disposition) classifies for the same party.
    represented_side: str = ""
    custom_keywords: list[str] = field(default_factory=list)
    # Source-document exclusion (FAILURE 2): IK doc_ids and titles of the user's own
    # uploaded/source documents, which must never be returned as citation candidates.
    case_title: str = ""
    excluded_doc_ids: set[str] = field(default_factory=set)
    excluded_titles: list[str] = field(default_factory=list)
    budget: BudgetTracker = field(default_factory=BudgetTracker)
    case_profile: CaseProfile = field(default_factory=CaseProfile)
    issues: list[IssueCard] = field(default_factory=list)
    queries: list[dict[str, Any]] = field(default_factory=list)
    candidates: list[Candidate] = field(default_factory=list)
    rejected: list[Candidate] = field(default_factory=list)
    shortlisted: list[Candidate] = field(default_factory=list)
    timings: dict[str, float] = field(default_factory=dict)
