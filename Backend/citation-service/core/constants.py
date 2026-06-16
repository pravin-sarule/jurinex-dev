SUPPORTED_PERSPECTIVES = {
    "petitioner", "respondent", "appellant", "accused", "complainant",
    "plaintiff", "defendant", "state", "applicant", "opposite_party", "neutral",
}

PERSPECTIVE_ALIASES = {
    "all": "neutral",
    "court": "neutral",
    "appellee": "respondent",
    "prosecution": "state",
    "opposite party": "opposite_party",
}

STOP_WORDS = {
    "about", "after", "against", "before", "being", "between", "case", "court",
    "from", "have", "into", "judgment", "legal", "that", "their", "there",
    "these", "this", "under", "what", "when", "where", "which", "with",
}
