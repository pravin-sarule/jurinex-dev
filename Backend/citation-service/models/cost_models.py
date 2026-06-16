from dataclasses import dataclass


@dataclass
class CostRecord:
    run_id: str
    provider: str
    operation_type: str
    estimated_cost: float
    success: bool = True
    candidate_doc_id: str = ""
    issue_id: str = ""
