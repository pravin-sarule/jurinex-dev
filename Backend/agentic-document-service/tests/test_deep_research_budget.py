from __future__ import annotations

import threading
import unittest

from app.services.deep_research.budget import (
    BudgetExceededError,
    BudgetTracker,
    InvalidReservationError,
    PricingPolicy,
    ReservationExceededError,
    UnknownPricingError,
)


def _pricing(*, include_search: bool = True) -> PricingPolicy:
    return PricingPolicy(
        usd_to_inr=100.0,
        model_rates_usd_per_million={
            "test-model": (1.0, 2.0),
            "test-model-pro": (3.0, 4.0),
        },
        tool_rates_usd_per_use=(
            {"google_search": 0.01, "url_fetch": 0.002}
            if include_search
            else {}
        ),
        model_cost_usd=None,
    )


class PricingPolicyTests(unittest.TestCase):
    def test_quote_includes_input_output_and_search_queries(self) -> None:
        tracker = BudgetTracker(limit_inr=10.0, pricing=_pricing())

        cost = tracker.estimate_call_cost_inr(
            "test-model", 1_000, 2_000, search_queries=2
        )

        # Tokens: ($0.001 + $0.004) * ₹100 = ₹0.50.
        # Search: 2 * $0.01 * ₹100 = ₹2.00.
        self.assertAlmostEqual(cost, 2.50)

    def test_longest_model_prefix_wins(self) -> None:
        tracker = BudgetTracker(limit_inr=1_000.0, pricing=_pricing())

        cost = tracker.estimate_call_cost_inr(
            "test-model-pro-preview", 1_000_000, 0
        )

        self.assertAlmostEqual(cost, 300.0)

    def test_unknown_model_and_tool_prices_fail_closed(self) -> None:
        tracker = BudgetTracker(limit_inr=100.0, pricing=_pricing(include_search=False))

        with self.assertRaises(UnknownPricingError):
            tracker.reserve_call("unknown-model", 1, 1)
        with self.assertRaises(UnknownPricingError):
            tracker.reserve_call(
                "test-model", 1, 1, max_search_queries=1
            )

        self.assertEqual(tracker.active_reservations, 0)
        self.assertEqual(tracker.reserved_inr, 0.0)


class ReservationTests(unittest.TestCase):
    def test_reserve_blocks_call_that_cannot_fully_fit(self) -> None:
        tracker = BudgetTracker(limit_inr=2.49, pricing=_pricing())

        with self.assertRaises(BudgetExceededError) as raised:
            tracker.reserve_call(
                "test-model",
                1_000,
                2_000,
                "search round",
                max_search_queries=2,
            )

        self.assertAlmostEqual(raised.exception.required_inr, 2.50)
        self.assertAlmostEqual(raised.exception.available_inr, 2.49)
        self.assertEqual(tracker.active_reservations, 0)

    def test_settlement_commits_actual_cost_and_releases_surplus(self) -> None:
        tracker = BudgetTracker(limit_inr=3.0, pricing=_pricing())
        reservation = tracker.reserve_call(
            "test-model",
            1_000,
            2_000,
            "round 1",
            max_search_queries=2,
        )

        self.assertAlmostEqual(tracker.reserved_inr, 2.50)
        self.assertAlmostEqual(tracker.remaining_inr, 0.50)
        self.assertFalse(tracker.can_afford_round(0.50))
        with self.assertRaises(BudgetExceededError):
            tracker.reserve_call(
                "test-model", 1_000, 0, max_search_queries=1
            )

        actual = tracker.settle_call(
            reservation, 500, 1_000, search_queries=1
        )

        self.assertAlmostEqual(actual, 1.25)
        self.assertAlmostEqual(tracker.spent_inr, 1.25)
        self.assertAlmostEqual(tracker.reserved_inr, 0.0)
        self.assertAlmostEqual(tracker.remaining_inr, 1.75)
        self.assertEqual(tracker.calls, 1)
        self.assertEqual(tracker.input_tokens, 500)
        self.assertEqual(tracker.output_tokens, 1_000)
        self.assertEqual(tracker.search_queries, 1)
        self.assertAlmostEqual(tracker.tool_cost_inr, 1.0)
        self.assertAlmostEqual(tracker.steps[0]["reserved_inr"], 2.50)
        self.assertAlmostEqual(tracker.steps[0]["cost_inr"], 1.25)

    def test_reported_usage_cannot_exceed_reservation(self) -> None:
        tracker = BudgetTracker(limit_inr=10.0, pricing=_pricing())
        reservation = tracker.reserve_call("test-model", 100, 100)

        with self.assertRaises(ReservationExceededError):
            tracker.settle_call(reservation, 101, 100)

        self.assertEqual(tracker.calls, 0)
        self.assertEqual(tracker.spent_inr, 0.0)
        self.assertEqual(tracker.active_reservations, 1)
        tracker.cancel_reservation(reservation)
        self.assertEqual(tracker.remaining_inr, 10.0)

    def test_cancel_releases_funds_and_handle_cannot_be_reused(self) -> None:
        tracker = BudgetTracker(limit_inr=10.0, pricing=_pricing())
        reservation = tracker.reserve_call(
            "test-model", 1_000, 2_000, max_search_queries=1
        )

        released = tracker.cancel_reservation(reservation)

        self.assertAlmostEqual(released, 1.50)
        self.assertAlmostEqual(tracker.remaining_inr, 10.0)
        with self.assertRaises(InvalidReservationError):
            tracker.cancel_reservation(reservation)

    def test_concurrent_reservations_cannot_double_spend(self) -> None:
        tracker = BudgetTracker(limit_inr=2.50, pricing=_pricing())
        barrier = threading.Barrier(2)
        outcomes: list[str] = []

        def reserve() -> None:
            barrier.wait()
            try:
                tracker.reserve_call(
                    "test-model", 1_000, 2_000, max_search_queries=2
                )
                outcomes.append("reserved")
            except BudgetExceededError:
                outcomes.append("rejected")

        threads = [threading.Thread(target=reserve) for _ in range(2)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=2.0)

        self.assertEqual(sorted(outcomes), ["rejected", "reserved"])
        self.assertEqual(tracker.active_reservations, 1)
        self.assertAlmostEqual(tracker.reserved_inr, 2.50)
        self.assertAlmostEqual(tracker.remaining_inr, 0.0)


class CompatibilityAndSizingTests(unittest.TestCase):
    def test_legacy_add_shape_is_preserved_but_cap_is_enforced(self) -> None:
        tracker = BudgetTracker(limit_inr=0.50, pricing=_pricing())

        cost = tracker.add("test-model", 1_000, 2_000, label="legacy")

        self.assertAlmostEqual(cost, 0.50)
        self.assertEqual(tracker.steps[0]["label"], "legacy")
        self.assertEqual(tracker.steps[0]["total"], 3_000)
        with self.assertRaises(BudgetExceededError):
            tracker.add("test-model", 0, 1)
        self.assertEqual(tracker.calls, 1)
        self.assertAlmostEqual(tracker.spent_inr, 0.50)

    def test_add_can_settle_an_existing_reservation(self) -> None:
        tracker = BudgetTracker(limit_inr=2.0, pricing=_pricing())
        reservation = tracker.reserve_call("test-model", 1_000, 2_000)

        cost = tracker.add(
            "test-model", 500, 1_000, "settled", reservation=reservation
        )

        self.assertAlmostEqual(cost, 0.25)
        self.assertEqual(tracker.steps[0]["label"], "settled")
        self.assertEqual(tracker.active_reservations, 0)

    def test_max_affordable_output_tokens_honours_tools_and_keep_back(self) -> None:
        tracker = BudgetTracker(limit_inr=2.50, pricing=_pricing())

        without_keep_back = tracker.max_affordable_output_tokens(
            "test-model",
            1_000,
            10_000,
            search_queries=1,
        )
        with_keep_back = tracker.max_affordable_output_tokens(
            "test-model",
            1_000,
            10_000,
            search_queries=1,
            keep_back_inr=0.50,
        )

        self.assertEqual(without_keep_back, 7_000)
        self.assertEqual(with_keep_back, 4_500)

    def test_max_affordable_output_tokens_accounts_active_reservations(self) -> None:
        tracker = BudgetTracker(limit_inr=2.0, pricing=_pricing())
        tracker.reserve_call("test-model", 1_000, 2_000)

        affordable = tracker.max_affordable_output_tokens(
            "test-model", 1_000, 10_000
        )

        # ₹1.50 remains. Fixed input is ₹0.10, then output costs ₹0.0002/token.
        self.assertEqual(affordable, 7_000)

    def test_max_affordable_output_tokens_fails_closed_for_unknown_model(self) -> None:
        tracker = BudgetTracker(limit_inr=10.0, pricing=_pricing())

        with self.assertRaises(UnknownPricingError):
            tracker.max_affordable_output_tokens("unknown-model", 0, 100)

    def test_summary_keeps_legacy_keys_and_adds_reservation_state(self) -> None:
        tracker = BudgetTracker(limit_inr=10.0, pricing=_pricing())
        tracker.reserve_call("test-model", 1_000, 2_000)

        summary = tracker.summary()

        for key in (
            "budget_inr",
            "spent_inr",
            "remaining_inr",
            "input_tokens",
            "output_tokens",
            "model_calls",
        ):
            self.assertIn(key, summary)
        self.assertEqual(summary["active_reservations"], 1)
        self.assertAlmostEqual(summary["reserved_inr"], 0.50)


if __name__ == "__main__":
    unittest.main()
