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

    def to_dict(self) -> dict:
        return asdict(self)
