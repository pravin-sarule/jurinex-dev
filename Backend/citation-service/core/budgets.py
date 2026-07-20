from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field

from core.config import Settings, settings
from core.exceptions import BudgetExceeded
from utils.pricing import IK_DOCUMENT_INR, IK_FRAGMENT_INR, IK_META_INR, IK_SEARCH_INR


_COSTS = {
    "ik_search": IK_SEARCH_INR,
    "ik_fragment": IK_FRAGMENT_INR,
    "ik_meta": IK_META_INR,
    "ik_full_doc": IK_DOCUMENT_INR,
}


@dataclass
class BudgetTracker:
    config: Settings = settings
    started_at: float = field(default_factory=time.monotonic)
    counts: dict[str, int] = field(default_factory=dict)
    estimated_cost_inr: float = 0.0
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    def consume(self, operation: str, count: int = 1, estimated_cost: float | None = None) -> None:
        with self._lock:
            limits = {
                "ik_search": self.config.max_ik_search_calls,
                "ik_fragment": self.config.max_ik_fragment_calls,
                "ik_meta": self.config.max_ik_meta_calls,
                "ik_full_doc": self.config.max_ik_full_doc_calls,
                "ai": self.config.max_ai_calls,
            }
            next_count = self.counts.get(operation, 0) + count
            if operation in limits and next_count > limits[operation]:
                raise BudgetExceeded(f"{operation} budget exceeded")
            added = estimated_cost if estimated_cost is not None else _COSTS.get(operation, 0.0) * count
            if self.estimated_cost_inr + added > self.config.max_total_estimated_cost:
                raise BudgetExceeded("estimated cost budget exceeded")
            if time.monotonic() - self.started_at > self.config.max_runtime_seconds:
                raise BudgetExceeded("runtime budget exceeded")
            self.counts[operation] = next_count
            self.estimated_cost_inr += added
