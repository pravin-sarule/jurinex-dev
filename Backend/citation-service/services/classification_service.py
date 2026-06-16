from core.enums import Classification
from models.citation_models import Candidate


def classify(candidates: list[Candidate]) -> tuple[list[Candidate], list[Candidate], list[Candidate]]:
    ranked = sorted(candidates, key=lambda item: (item.confidence, item.authority_score), reverse=True)
    supporting = [c for c in ranked if c.classification == Classification.SUPPORTING][:5]
    adverse = [c for c in ranked if c.classification == Classification.ADVERSE][:3]
    caution = [c for c in ranked if c.classification in {Classification.DISTINGUISHABLE, Classification.WEAK_CONTEXTUAL}][:3]
    return supporting, adverse, caution
