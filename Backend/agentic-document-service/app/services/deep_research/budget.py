"""Rupee budget tracking + enforcement for a Deep Research run.

Accumulates token spend across every model call (plan, each search round, gap checks,
synthesis) and converts it to rupees using the SAME pricing table the rest of the app
bills with (`token_usage_log`), so the INR figure shown to the user matches the token
report everywhere else. The tracker is a *soft ceiling on new rounds*: once spend nears
the limit the loop stops starting rounds, but the already-in-flight synthesis still runs
so the user is never left with nothing after paying.
"""

from __future__ import annotations

from dataclasses import dataclass

try:  # reuse the app-wide pricing so the rupee figure is consistent everywhere
    from app.services.token_usage_log import _model_cost_usd, _USD_TO_INR
except Exception:  # pragma: no cover - defensive; keeps the loop usable if the import moves
    _model_cost_usd = None
    _USD_TO_INR = 96.0


@dataclass
class BudgetTracker:
    limit_inr: float
    spent_inr: float = 0.0
    input_tokens: int = 0
    output_tokens: int = 0
    calls: int = 0

    def add(self, model: str, input_tokens: int, output_tokens: int) -> float:
        """Record one model call's usage; returns the rupee cost of THIS call."""
        it = max(0, int(input_tokens or 0))
        ot = max(0, int(output_tokens or 0))
        self.input_tokens += it
        self.output_tokens += ot
        self.calls += 1

        inr = 0.0
        if _model_cost_usd is not None:
            usd = _model_cost_usd(model, it, ot)
            if usd is not None:
                inr = usd * float(_USD_TO_INR)
        self.spent_inr += inr
        return inr

    @property
    def remaining_inr(self) -> float:
        return max(0.0, self.limit_inr - self.spent_inr)

    def exceeded(self) -> bool:
        return self.spent_inr >= self.limit_inr

    def can_afford_round(self, reserve_inr: float) -> bool:
        """True while there is still budget left ABOVE the synthesis reserve."""
        return self.remaining_inr > reserve_inr

    def summary(self) -> dict:
        return {
            "budget_inr": round(self.limit_inr, 2),
            "spent_inr": round(self.spent_inr, 2),
            "remaining_inr": round(self.remaining_inr, 2),
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "model_calls": self.calls,
        }
