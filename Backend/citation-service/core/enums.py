from enum import Enum


class Classification(str, Enum):
    SUPPORTING = "SUPPORTING"
    ADVERSE = "ADVERSE"
    DISTINGUISHABLE = "DISTINGUISHABLE"
    WEAK_CONTEXTUAL = "WEAK_CONTEXTUAL"
    IRRELEVANT = "IRRELEVANT"


class CitationStatus(str, Enum):
    SUGGESTED_FOR_REVIEW = "SUGGESTED_FOR_REVIEW"
    NEEDS_REVIEW = "NEEDS_REVIEW"
    ADVERSE = "ADVERSE"
    REJECTED = "REJECTED"
    NO_RELIABLE_CITATION_FOUND = "NO_RELIABLE_CITATION_FOUND"


class Authority(str, Enum):
    SUPREME_COURT = "SUPREME_COURT"
    SAME_HIGH_COURT = "SAME_HIGH_COURT"
    OTHER_HIGH_COURT = "OTHER_HIGH_COURT"
    TRIBUNAL = "TRIBUNAL"
    LOWER_COURT = "LOWER_COURT"
    UNKNOWN = "UNKNOWN"


class Disposition(str, Enum):
    """Final operative outcome of a judgment (what the court actually ordered)."""
    ALLOWED = "ALLOWED"
    DISMISSED = "DISMISSED"
    PARTLY_ALLOWED = "PARTLY_ALLOWED"
    REMANDED = "REMANDED"
    UNKNOWN = "UNKNOWN"


class WinningParty(str, Enum):
    """Which side prevailed in the operative order."""
    PETITIONER = "PETITIONER"
    RESPONDENT = "RESPONDENT"
    UNCLEAR = "UNCLEAR"
