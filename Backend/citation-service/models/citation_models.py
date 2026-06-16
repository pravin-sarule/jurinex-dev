from __future__ import annotations

from dataclasses import dataclass, field

from core.enums import Authority, Classification


@dataclass
class Candidate:
    doc_id: str
    title: str = ""
    headline: str = ""
    docsource: str = ""
    publishdate: str = ""
    matched_issue_id: str = ""
    matched_query: str = ""
    metadata: dict = field(default_factory=dict)
    fragment: str = ""
    full_text: str = ""
    relevance_score: float = 0.0
    favorability_score: float = 0.0
    authority_score: float = 0.0
    fact_similarity_score: float = 0.0
    risk_score: float = 0.0
    confidence: float = 0.0
    authority: Authority = Authority.UNKNOWN
    classification: Classification = Classification.IRRELEVANT
    supports_selected_side: bool = False
    adverse_to_selected_side: bool = False
    reason: str = ""
    use_in_argument: str = ""
    risk_note: str = ""
    rejection_reason: str = ""
