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
    # Outcome-aware adverse detection (disposition service). disposition / winning_party
    # use the core.enums string values; default "" / UNKNOWN until detect_dispositions runs.
    disposition: str = ""
    winning_party: str = ""
    operative_quote: str = ""
    outcome_confidence: float = 0.0
    outcome_source: str = ""
    outcome_overridden: bool = False
    # Opposition bundle (PART 6) + arithmetic reranking (PART 8).
    counter_argument_hint: str = ""
    rerank_score: float = 0.0
    # Direction-aware principle detection (FAILURE 3): "" / PRINCIPLE_REVERSED / PRINCIPLE_ALIGNED.
    direction_flag: str = ""
    # Usage analysis memo (500-600 words, category-aware) + relevance gate signals.
    # usage_analysis is a list of {"heading", "body"} sections; relevance_verdict is one of
    # RELEVANT / PARTIALLY_RELEVANT / NOT_RELEVANT and drives the report-time relevance gate.
    usage_analysis: list = field(default_factory=list)
    usage_verdict: str = ""
    relevance_verdict: str = ""
    relevance_reason: str = ""
