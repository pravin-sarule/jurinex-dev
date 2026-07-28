"""Hard-cap cost control for one Deep Research run.

The controller uses a reserve/settle lifecycle:

1. Quote the maximum input, output, and tool usage for a provider call.
2. Reserve that worst-case amount before the call starts.
3. Settle the reservation with the provider's actual usage, releasing any surplus.

Because committed spend plus active reservations may never exceed ``limit_inr``, two
concurrent callers cannot both spend the same remaining budget. Pricing is injected
through :class:`PricingPolicy`; the app-wide token calculator remains the compatibility
default, while search/tool prices must be supplied explicitly and therefore cannot be
silently treated as free.
"""

from __future__ import annotations

import math
import threading
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from decimal import Decimal
from types import MappingProxyType
from typing import Any

try:  # Keep existing token accounting aligned with the rest of the application.
    from app.services.token_usage_log import (
        _USD_TO_INR as _SHARED_USD_TO_INR,
        _model_cost_usd as _shared_model_cost_usd,
    )
except Exception:  # pragma: no cover - defensive if the shared module moves.
    _shared_model_cost_usd = None
    _SHARED_USD_TO_INR = 96.0


ModelCostCalculator = Callable[[str, int, int], float | None]
ToolUses = Mapping[str, int]

_ZERO = Decimal("0")
_ONE_MILLION = Decimal("1000000")
_SEARCH_TOOL = "google_search"


class BudgetError(RuntimeError):
    """Base class for Deep Research budget failures."""


class BudgetExceededError(BudgetError):
    """Raised before a call when its reservation would exceed available budget."""

    def __init__(self, *, required_inr: float, available_inr: float, label: str = "") -> None:
        self.required_inr = required_inr
        self.available_inr = available_inr
        self.label = label
        prefix = f"{label}: " if label else ""
        super().__init__(
            f"{prefix}requires ₹{required_inr:.6f}, but only ₹{available_inr:.6f} "
            "is available"
        )


class UnknownPricingError(BudgetError):
    """Raised when a hard-cap quote cannot price every requested unit."""


class InvalidReservationError(BudgetError):
    """Raised for a reservation that is unknown, cancelled, or already settled."""


class ReservationExceededError(BudgetError):
    """Raised when reported usage exceeds the reservation's declared maximum."""


def _decimal_amount(value: Any, *, name: str, allow_zero: bool = True) -> Decimal:
    """Convert a public numeric input into a finite, non-negative Decimal."""
    if isinstance(value, bool):
        raise TypeError(f"{name} must be a number, not bool")
    try:
        amount = Decimal(str(value))
    except Exception as exc:
        raise TypeError(f"{name} must be numeric") from exc
    if not amount.is_finite():
        raise ValueError(f"{name} must be finite")
    if amount < _ZERO or (not allow_zero and amount == _ZERO):
        comparator = "positive" if not allow_zero else "non-negative"
        raise ValueError(f"{name} must be {comparator}")
    return amount


def _non_negative_int(value: Any, *, name: str) -> int:
    """Validate token/query counts without accepting ``True`` as one unit."""
    if value is None:
        return 0
    if isinstance(value, bool):
        raise TypeError(f"{name} must be an integer, not bool")
    try:
        integer = int(value)
    except (TypeError, ValueError, OverflowError) as exc:
        raise TypeError(f"{name} must be an integer") from exc
    if isinstance(value, float) and (not math.isfinite(value) or not value.is_integer()):
        raise ValueError(f"{name} must be a whole, finite number")
    if not isinstance(value, (int, str, float)):
        try:
            if value != integer:
                raise ValueError(f"{name} must be a whole number")
        except TypeError as exc:
            raise TypeError(f"{name} must be an integer") from exc
    if integer < 0:
        raise ValueError(f"{name} must be non-negative")
    return integer


def _normalise_tool_uses(
    tool_uses: ToolUses | None,
    *,
    search_queries: int = 0,
) -> tuple[tuple[str, int], ...]:
    """Return a deterministic, immutable tool-usage representation."""
    normalised: dict[str, int] = {}
    for raw_name, raw_count in (tool_uses or {}).items():
        name = str(raw_name or "").strip().lower()
        if not name:
            raise ValueError("tool name must not be empty")
        count = _non_negative_int(raw_count, name=f"tool_uses[{name!r}]")
        if count:
            normalised[name] = normalised.get(name, 0) + count

    searches = _non_negative_int(search_queries, name="search_queries")
    if searches:
        normalised[_SEARCH_TOOL] = normalised.get(_SEARCH_TOOL, 0) + searches
    return tuple(sorted(normalised.items()))


def _longest_prefix_rate(
    model: str,
    rates: Mapping[str, tuple[float, float]],
) -> tuple[float, float] | None:
    model_id = (model or "").strip().lower()
    best: tuple[float, float] | None = None
    best_length = -1
    for prefix, rate in rates.items():
        if model_id.startswith(prefix) and len(prefix) > best_length:
            best = rate
            best_length = len(prefix)
    return best


@dataclass(frozen=True, slots=True)
class PricingPolicy:
    """Configurable prices used for both reservation and settlement.

    ``model_rates_usd_per_million`` uses longest-prefix model matching. A supplied
    ``model_cost_usd`` callback is a fallback for models absent from that map. Tool
    rates are USD per use; for Google grounding, configure ``"google_search"`` and
    pass the maximum/actual query count through ``search_queries``.
    """

    usd_to_inr: float = field(default_factory=lambda: float(_SHARED_USD_TO_INR))
    model_rates_usd_per_million: Mapping[str, tuple[float, float]] = field(
        default_factory=dict
    )
    tool_rates_usd_per_use: Mapping[str, float] = field(default_factory=dict)
    model_cost_usd: ModelCostCalculator | None = field(
        default=_shared_model_cost_usd,
        repr=False,
        compare=False,
    )

    def __post_init__(self) -> None:
        _decimal_amount(self.usd_to_inr, name="usd_to_inr", allow_zero=False)

        model_rates: dict[str, tuple[float, float]] = {}
        for raw_prefix, raw_rate in self.model_rates_usd_per_million.items():
            prefix = str(raw_prefix or "").strip().lower()
            if not prefix:
                raise ValueError("model pricing prefix must not be empty")
            if len(raw_rate) != 2:
                raise ValueError(f"model rate for {prefix!r} must contain input and output")
            input_rate = _decimal_amount(
                raw_rate[0], name=f"input rate for {prefix!r}"
            )
            output_rate = _decimal_amount(
                raw_rate[1], name=f"output rate for {prefix!r}"
            )
            model_rates[prefix] = (float(input_rate), float(output_rate))

        tool_rates: dict[str, float] = {}
        for raw_name, raw_rate in self.tool_rates_usd_per_use.items():
            name = str(raw_name or "").strip().lower()
            if not name:
                raise ValueError("tool pricing name must not be empty")
            rate = _decimal_amount(raw_rate, name=f"tool rate for {name!r}")
            tool_rates[name] = float(rate)

        object.__setattr__(
            self, "model_rates_usd_per_million", MappingProxyType(model_rates)
        )
        object.__setattr__(
            self, "tool_rates_usd_per_use", MappingProxyType(tool_rates)
        )

    def model_tokens_usd(self, model: str, input_tokens: int, output_tokens: int) -> Decimal:
        """Price model tokens, failing closed when no applicable price exists."""
        if input_tokens == 0 and output_tokens == 0:
            return _ZERO

        rate = _longest_prefix_rate(model, self.model_rates_usd_per_million)
        if rate is not None:
            input_rate = Decimal(str(rate[0]))
            output_rate = Decimal(str(rate[1]))
            return (
                Decimal(input_tokens) * input_rate
                + Decimal(output_tokens) * output_rate
            ) / _ONE_MILLION

        if self.model_cost_usd is None:
            raise UnknownPricingError(f"no token pricing configured for model {model!r}")
        quoted = self.model_cost_usd(model, input_tokens, output_tokens)
        if quoted is None:
            raise UnknownPricingError(f"no token pricing configured for model {model!r}")
        return _decimal_amount(quoted, name=f"token cost for model {model!r}")

    def tools_usd(self, tool_uses: tuple[tuple[str, int], ...]) -> Decimal:
        """Price all tool uses, failing if even one tool lacks a configured rate."""
        total = _ZERO
        for name, count in tool_uses:
            rate = self.tool_rates_usd_per_use.get(name)
            if rate is None:
                raise UnknownPricingError(f"no per-use pricing configured for tool {name!r}")
            total += Decimal(count) * Decimal(str(rate))
        return total

    def quote_inr(
        self,
        model: str,
        input_tokens: int,
        output_tokens: int,
        tool_uses: tuple[tuple[str, int], ...],
    ) -> "_CostQuote":
        token_inr = self.model_tokens_usd(model, input_tokens, output_tokens) * Decimal(
            str(self.usd_to_inr)
        )
        tool_inr = self.tools_usd(tool_uses) * Decimal(str(self.usd_to_inr))
        return _CostQuote(token_inr=token_inr, tool_inr=tool_inr)


@dataclass(frozen=True, slots=True)
class _CostQuote:
    token_inr: Decimal
    tool_inr: Decimal

    @property
    def total_inr(self) -> Decimal:
        return self.token_inr + self.tool_inr


@dataclass(frozen=True, slots=True)
class BudgetReservation:
    """Opaque handle proving that worst-case funds were reserved for one call."""

    reservation_id: int
    model: str
    label: str
    max_input_tokens: int
    max_output_tokens: int
    max_tool_uses: tuple[tuple[str, int], ...]
    reserved_inr: float
    _reserved_amount: Decimal = field(repr=False, compare=False)


class BudgetTracker:
    """Thread-safe, reservation-based hard-cap controller.

    The first six constructor parameters mirror the former dataclass for compatibility.
    New code should pass ``pricing`` and use ``reserve_call`` before provider I/O.
    """

    def __init__(
        self,
        limit_inr: float,
        spent_inr: float = 0.0,
        input_tokens: int = 0,
        output_tokens: int = 0,
        calls: int = 0,
        steps: list[dict[str, Any]] | None = None,
        *,
        pricing: PricingPolicy | None = None,
    ) -> None:
        self._limit = _decimal_amount(limit_inr, name="limit_inr")
        self._spent = _decimal_amount(spent_inr, name="spent_inr")
        if self._spent > self._limit:
            raise ValueError("spent_inr cannot exceed limit_inr")

        self.limit_inr = float(self._limit)
        self.input_tokens = _non_negative_int(input_tokens, name="input_tokens")
        self.output_tokens = _non_negative_int(output_tokens, name="output_tokens")
        self.calls = _non_negative_int(calls, name="calls")
        self.steps = list(steps or [])
        self.search_queries = 0
        self.tool_uses: dict[str, int] = {}
        self.tool_cost_inr = 0.0

        self.pricing = pricing or PricingPolicy()
        self._reserved = _ZERO
        self._active: dict[int, BudgetReservation] = {}
        self._next_reservation_id = 1
        self._lock = threading.RLock()

    @property
    def spent_inr(self) -> float:
        return float(self._spent)

    @property
    def reserved_inr(self) -> float:
        with self._lock:
            return float(self._reserved)

    @property
    def remaining_inr(self) -> float:
        """Budget still available after committed spend and active reservations."""
        with self._lock:
            return float(max(_ZERO, self._limit - self._spent - self._reserved))

    @property
    def active_reservations(self) -> int:
        with self._lock:
            return len(self._active)

    def estimate_call_cost_inr(
        self,
        model: str,
        input_tokens: int,
        output_tokens: int,
        *,
        search_queries: int = 0,
        tool_uses: ToolUses | None = None,
    ) -> float:
        """Return a price quote without reserving budget."""
        input_count = _non_negative_int(input_tokens, name="input_tokens")
        output_count = _non_negative_int(output_tokens, name="output_tokens")
        tools = _normalise_tool_uses(tool_uses, search_queries=search_queries)
        return float(
            self.pricing.quote_inr(model, input_count, output_count, tools).total_inr
        )

    def max_affordable_output_tokens(
        self,
        model: str,
        input_tokens: int,
        max_output_tokens: int,
        *,
        search_queries: int = 0,
        tool_uses: ToolUses | None = None,
        keep_back_inr: float = 0.0,
    ) -> int:
        """Return the largest output cap that fits the currently available budget.

        ``input_tokens`` and tool counts must be conservative maxima for the proposed
        call. ``keep_back_inr`` protects money for later work. This is an advisory
        calculation; callers must still use :meth:`reserve_call` atomically before
        provider I/O because another concurrent reservation may consume funds in between.

        Pricing errors propagate instead of returning an unsafe token count. The pricing
        policy's token-cost function must be monotonic in output tokens; the built-in
        shared calculator and explicit per-million rates satisfy that requirement.
        """
        input_count = _non_negative_int(input_tokens, name="input_tokens")
        output_ceiling = _non_negative_int(
            max_output_tokens, name="max_output_tokens"
        )
        tools = _normalise_tool_uses(tool_uses, search_queries=search_queries)
        keep_back = _decimal_amount(keep_back_inr, name="keep_back_inr")

        with self._lock:
            available = self._limit - self._spent - self._reserved - keep_back
            if available < _ZERO:
                return 0

            # Price the fixed input/tool portion even when no output can fit. This is
            # what makes unknown pricing fail closed rather than looking like a zero cap.
            base_quote = self.pricing.quote_inr(
                model, input_count, 0, tools
            ).total_inr
            if base_quote > available or output_ceiling == 0:
                return 0

            full_quote = self.pricing.quote_inr(
                model, input_count, output_ceiling, tools
            ).total_inr
            if full_quote <= available:
                return output_ceiling

            low = 0
            high = output_ceiling
            while low < high:
                midpoint = (low + high + 1) // 2
                quote = self.pricing.quote_inr(
                    model, input_count, midpoint, tools
                ).total_inr
                if quote <= available:
                    low = midpoint
                else:
                    high = midpoint - 1
            return low

    def reserve_call(
        self,
        model: str,
        max_input_tokens: int,
        max_output_tokens: int,
        label: str = "",
        *,
        max_search_queries: int = 0,
        max_tool_uses: ToolUses | None = None,
    ) -> BudgetReservation:
        """Atomically reserve a call's worst-case cost before provider I/O.

        Raises :class:`BudgetExceededError` without changing state if the full quote
        does not fit. Unknown model or tool pricing also fails closed.
        """
        input_count = _non_negative_int(max_input_tokens, name="max_input_tokens")
        output_count = _non_negative_int(max_output_tokens, name="max_output_tokens")
        tools = _normalise_tool_uses(
            max_tool_uses, search_queries=max_search_queries
        )
        quote = self.pricing.quote_inr(model, input_count, output_count, tools)

        with self._lock:
            available = self._limit - self._spent - self._reserved
            if quote.total_inr > available:
                raise BudgetExceededError(
                    required_inr=float(quote.total_inr),
                    available_inr=float(max(_ZERO, available)),
                    label=label,
                )

            reservation = BudgetReservation(
                reservation_id=self._next_reservation_id,
                model=model,
                label=label or f"call {self.calls + len(self._active) + 1}",
                max_input_tokens=input_count,
                max_output_tokens=output_count,
                max_tool_uses=tools,
                reserved_inr=float(quote.total_inr),
                _reserved_amount=quote.total_inr,
            )
            self._next_reservation_id += 1
            self._active[reservation.reservation_id] = reservation
            self._reserved += quote.total_inr
            return reservation

    def try_reserve_call(
        self,
        model: str,
        max_input_tokens: int,
        max_output_tokens: int,
        label: str = "",
        *,
        max_search_queries: int = 0,
        max_tool_uses: ToolUses | None = None,
    ) -> BudgetReservation | None:
        """Return ``None`` for insufficient funds; pricing/configuration errors propagate."""
        try:
            return self.reserve_call(
                model,
                max_input_tokens,
                max_output_tokens,
                label,
                max_search_queries=max_search_queries,
                max_tool_uses=max_tool_uses,
            )
        except BudgetExceededError:
            return None

    def settle_call(
        self,
        reservation: BudgetReservation,
        input_tokens: int,
        output_tokens: int,
        *,
        search_queries: int = 0,
        tool_uses: ToolUses | None = None,
        label: str | None = None,
    ) -> float:
        """Commit actual usage and release the unused part of a reservation."""
        input_count = _non_negative_int(input_tokens, name="input_tokens")
        output_count = _non_negative_int(output_tokens, name="output_tokens")
        tools = _normalise_tool_uses(tool_uses, search_queries=search_queries)

        with self._lock:
            active = self._require_active_locked(reservation)
            if input_count > active.max_input_tokens:
                raise ReservationExceededError(
                    f"{active.label}: input usage {input_count} exceeds reserved "
                    f"maximum {active.max_input_tokens}"
                )
            if output_count > active.max_output_tokens:
                raise ReservationExceededError(
                    f"{active.label}: output usage {output_count} exceeds reserved "
                    f"maximum {active.max_output_tokens}"
                )

            maxima = dict(active.max_tool_uses)
            for name, count in tools:
                if count > maxima.get(name, 0):
                    raise ReservationExceededError(
                        f"{active.label}: {name} usage {count} exceeds reserved "
                        f"maximum {maxima.get(name, 0)}"
                    )

            quote = self.pricing.quote_inr(
                active.model, input_count, output_count, tools
            )
            if quote.total_inr > active._reserved_amount:
                # This indicates mutable/dynamic pricing or a non-monotonic calculator.
                # Keep the reservation active so the invariant cannot be violated.
                raise ReservationExceededError(
                    f"{active.label}: actual cost ₹{float(quote.total_inr):.6f} "
                    f"exceeds reserved ₹{active.reserved_inr:.6f}"
                )

            del self._active[active.reservation_id]
            self._reserved -= active._reserved_amount
            self._record_call_locked(
                model=active.model,
                input_tokens=input_count,
                output_tokens=output_count,
                tools=tools,
                quote=quote,
                label=label or active.label,
                reserved_inr=active.reserved_inr,
            )
            return float(quote.total_inr)

    def cancel_reservation(self, reservation: BudgetReservation) -> float:
        """Release a reservation for a call that did not incur billable usage."""
        with self._lock:
            active = self._require_active_locked(reservation)
            del self._active[active.reservation_id]
            self._reserved -= active._reserved_amount
            return active.reserved_inr

    # Readable alias for callers that use "release" terminology.
    release_reservation = cancel_reservation

    def add(
        self,
        model: str,
        input_tokens: int,
        output_tokens: int,
        label: str = "",
        *,
        search_queries: int = 0,
        tool_uses: ToolUses | None = None,
        reservation: BudgetReservation | None = None,
    ) -> float:
        """Record one call, preserving the former API.

        New provider calls should pass a prior ``reservation``. The unreserved form is
        retained for compatibility, but it still refuses to commit a cost that would
        exceed the hard cap or consume funds held by another call.
        """
        if reservation is not None:
            if model != reservation.model:
                raise InvalidReservationError(
                    f"reservation model {reservation.model!r} does not match {model!r}"
                )
            return self.settle_call(
                reservation,
                input_tokens,
                output_tokens,
                search_queries=search_queries,
                tool_uses=tool_uses,
                label=label or reservation.label,
            )

        input_count = _non_negative_int(input_tokens, name="input_tokens")
        output_count = _non_negative_int(output_tokens, name="output_tokens")
        tools = _normalise_tool_uses(tool_uses, search_queries=search_queries)
        quote = self.pricing.quote_inr(model, input_count, output_count, tools)

        with self._lock:
            available = self._limit - self._spent - self._reserved
            if quote.total_inr > available:
                raise BudgetExceededError(
                    required_inr=float(quote.total_inr),
                    available_inr=float(max(_ZERO, available)),
                    label=label,
                )
            self._record_call_locked(
                model=model,
                input_tokens=input_count,
                output_tokens=output_count,
                tools=tools,
                quote=quote,
                label=label or f"call {self.calls + 1}",
                reserved_inr=None,
            )
            return float(quote.total_inr)

    def exceeded(self) -> bool:
        """Return whether committed/reserved funds have exhausted the hard cap."""
        return self.remaining_inr <= 0.0

    def can_afford_round(self, reserve_inr: float) -> bool:
        """Compatibility check that includes funds held by active reservations."""
        reserve = _decimal_amount(reserve_inr, name="reserve_inr")
        with self._lock:
            available = self._limit - self._spent - self._reserved
            return available > reserve

    def summary(self) -> dict[str, int | float]:
        with self._lock:
            remaining = max(_ZERO, self._limit - self._spent - self._reserved)
            return {
                "budget_inr": round(self.limit_inr, 2),
                "spent_inr": round(float(self._spent), 2),
                "reserved_inr": round(float(self._reserved), 2),
                "remaining_inr": round(float(remaining), 2),
                "input_tokens": self.input_tokens,
                "output_tokens": self.output_tokens,
                "model_calls": self.calls,
                "search_queries": self.search_queries,
                "tool_cost_inr": round(self.tool_cost_inr, 2),
                "active_reservations": len(self._active),
            }

    def _require_active_locked(
        self, reservation: BudgetReservation
    ) -> BudgetReservation:
        active = self._active.get(getattr(reservation, "reservation_id", None))
        # Identity prevents a reservation from another tracker (or a reconstructed
        # dataclass with the same integer id) from settling this tracker's funds.
        if active is not reservation:
            raise InvalidReservationError(
                "reservation is unknown, cancelled, or already settled"
            )
        return active

    def _record_call_locked(
        self,
        *,
        model: str,
        input_tokens: int,
        output_tokens: int,
        tools: tuple[tuple[str, int], ...],
        quote: _CostQuote,
        label: str,
        reserved_inr: float | None,
    ) -> None:
        new_spent = self._spent + quote.total_inr
        if new_spent + self._reserved > self._limit:
            # All public paths preflight this invariant. Keep this assertion close to
            # mutation so future call paths cannot accidentally weaken the hard cap.
            raise AssertionError("budget invariant violated")
        self._spent = new_spent

        self.input_tokens += input_tokens
        self.output_tokens += output_tokens
        self.calls += 1
        tool_map = dict(tools)
        for name, count in tools:
            self.tool_uses[name] = self.tool_uses.get(name, 0) + count
        self.search_queries += tool_map.get(_SEARCH_TOOL, 0)
        self.tool_cost_inr += float(quote.tool_inr)

        step: dict[str, Any] = {
            "label": label,
            "model": model,
            "input": input_tokens,
            "output": output_tokens,
            "total": input_tokens + output_tokens,
            "search_queries": tool_map.get(_SEARCH_TOOL, 0),
            "tool_uses": tool_map,
            "token_cost_inr": float(quote.token_inr),
            "tool_cost_inr": float(quote.tool_inr),
            "cost_inr": float(quote.total_inr),
        }
        if reserved_inr is not None:
            step["reserved_inr"] = reserved_inr
        self.steps.append(step)
