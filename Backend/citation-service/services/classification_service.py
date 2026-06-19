from core.config import settings
from core.enums import Classification
from models.citation_models import Candidate


def classify(candidates: list[Candidate]) -> tuple[list[Candidate], list[Candidate], list[Candidate]]:
    ranked = sorted(candidates, key=lambda item: (item.confidence, item.authority_score), reverse=True)
    supporting = [c for c in ranked if c.classification == Classification.SUPPORTING][:settings.max_recommended_citations]
    adverse = [c for c in ranked if c.classification == Classification.ADVERSE][:settings.max_adverse_citations]
    caution = [c for c in ranked if c.classification in {Classification.DISTINGUISHABLE, Classification.WEAK_CONTEXTUAL}][:settings.max_caution_citations]
    return supporting, adverse, caution
