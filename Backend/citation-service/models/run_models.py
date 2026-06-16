from dataclasses import dataclass, field
from typing import Any


@dataclass
class CaseProfile:
    case_type: str = ""
    court: str = ""
    jurisdiction: str = ""
    represented_side: str = ""
    opposite_side: str = ""
    relief_sought: str = ""
    statutes: list[str] = field(default_factory=list)
    procedural_stage: str = ""
    important_facts: list[str] = field(default_factory=list)
    legal_issues: list[str] = field(default_factory=list)


@dataclass
class PipelineResult:
    report_id: str | None
    report_format: dict[str, Any] | None
    run_id: str
    status: str
    error: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return self.__dict__.copy()
