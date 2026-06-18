from __future__ import annotations

from dataclasses import asdict, dataclass, field


@dataclass
class IssueCard:
    issue_id: str
    legal_issue: str
    represented_side: str
    favorable_position_for_selected_side: str
    likely_opposite_position: str
    statutes: list[str] = field(default_factory=list)
    must_have_terms: list[str] = field(default_factory=list)
    phrase_terms: list[str] = field(default_factory=list)
    optional_synonyms: list[str] = field(default_factory=list)
    negative_terms: list[str] = field(default_factory=list)
    preferred_courts: list[str] = field(default_factory=list)
    expected_citation_use: str = ""
    # Richer issue model (tender/procurement prompt redesign — PART 3).
    doctrines: list[str] = field(default_factory=list)
    is_main_issue: bool = False
    landmark_cases: list[str] = field(default_factory=list)
    outcome_sought: str = ""
    # Opponent modelling — drives adverse-authority queries + the opposition bundle.
    opponent_arguments: list[str] = field(default_factory=list)
    opponent_doctrines: list[str] = field(default_factory=list)
    opponent_phrase_terms: list[str] = field(default_factory=list)
    # Phase 2 — fact-grounded querying. fact_terms are this case's OWN salient short
    # phrases (forfeiture, "change of user", "non-utilisation"…) injected into precision
    # + recall queries so they stop collapsing to "doctrine ANDD quashed". outcome_terms
    # are relief/result words ("quashed", "set aside", "allowed"). ai_query_recipes are
    # ready-to-run FLAT IK strings the extractor may author (validated before use).
    # All in-memory only; serialised into the existing report JSONB — no schema change.
    fact_terms: list[str] = field(default_factory=list)
    outcome_terms: list[str] = field(default_factory=list)
    ai_query_recipes: list[dict] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)
