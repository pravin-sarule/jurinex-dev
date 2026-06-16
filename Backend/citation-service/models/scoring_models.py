from dataclasses import dataclass


@dataclass
class ScoreBreakdown:
    relevance_score: float
    favorability_score: float
    authority_score: float
    fact_similarity_score: float
    risk_score: float
    confidence: float
