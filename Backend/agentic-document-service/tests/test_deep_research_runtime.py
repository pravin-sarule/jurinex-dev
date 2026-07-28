from __future__ import annotations

import asyncio
import threading
import unittest

from app.services.deep_research.runtime import (
    DeepResearchBusy,
    DeepResearchConcurrencyLimiter,
    DeepResearchDeadline,
    DeepResearchRuntime,
    DeepResearchTimeout,
)


class _FakeClock:
    def __init__(self, now: float = 100.0) -> None:
        self.now = now

    def __call__(self) -> float:
        return self.now


class DeepResearchRuntimeTests(unittest.IsolatedAsyncioTestCase):
    async def test_capacity_timeout_is_stable_and_releases_holder(self) -> None:
        limiter = DeepResearchConcurrencyLimiter(
            max_concurrency=1,
            queue_timeout_s=0.05,
        )

        async with limiter.slot():
            self.assertEqual(limiter.in_use, 1)
            with self.assertRaises(DeepResearchBusy) as raised:
                async with limiter.slot(timeout_s=0.01):
                    self.fail("an over-capacity caller must not enter")

            self.assertEqual(raised.exception.code, "deep_research_busy")
            self.assertEqual(raised.exception.max_concurrency, 1)
            self.assertEqual(limiter.queued, 0)

        self.assertEqual(limiter.in_use, 0)

    async def test_context_releases_slot_after_body_exception(self) -> None:
        limiter = DeepResearchConcurrencyLimiter(
            max_concurrency=1,
            queue_timeout_s=0.05,
        )

        with self.assertRaisesRegex(ValueError, "boom"):
            async with limiter.slot():
                raise ValueError("boom")

        self.assertEqual(limiter.in_use, 0)
        async with limiter.slot(timeout_s=0.01):
            self.assertEqual(limiter.in_use, 1)

    async def test_cancelled_queued_waiter_does_not_leak_capacity(self) -> None:
        limiter = DeepResearchConcurrencyLimiter(
            max_concurrency=1,
            queue_timeout_s=1.0,
        )
        holder = await limiter.acquire()
        waiter = asyncio.create_task(limiter.acquire())

        for _ in range(20):
            if limiter.queued == 1:
                break
            await asyncio.sleep(0)
        self.assertEqual(limiter.queued, 1)

        waiter.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await waiter
        self.assertEqual(limiter.queued, 0)

        holder.release()
        self.assertEqual(limiter.in_use, 0)
        async with limiter.slot(timeout_s=0.01):
            pass
        self.assertEqual(limiter.in_use, 0)

    async def test_cancellation_inside_context_releases_slot(self) -> None:
        limiter = DeepResearchConcurrencyLimiter(
            max_concurrency=1,
            queue_timeout_s=1.0,
        )
        entered = asyncio.Event()

        async def worker() -> None:
            async with limiter.slot():
                entered.set()
                await asyncio.Event().wait()

        task = asyncio.create_task(worker())
        await entered.wait()
        self.assertEqual(limiter.in_use, 1)

        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task
        self.assertEqual(limiter.in_use, 0)

    async def test_limit_is_shared_across_different_event_loops(self) -> None:
        limiter = DeepResearchConcurrencyLimiter(
            max_concurrency=1,
            queue_timeout_s=1.0,
        )
        acquired = threading.Event()
        release = threading.Event()

        def run_holder_on_another_loop() -> None:
            async def holder() -> None:
                async with limiter.slot():
                    acquired.set()
                    await asyncio.to_thread(release.wait)

            asyncio.run(holder())

        holder_task = asyncio.create_task(
            asyncio.to_thread(run_holder_on_another_loop)
        )
        acquired_ok = await asyncio.to_thread(acquired.wait, 1.0)
        self.assertTrue(acquired_ok)

        try:
            with self.assertRaises(DeepResearchBusy):
                async with limiter.slot(timeout_s=0.01):
                    self.fail("the process-wide slot is already in use")
        finally:
            release.set()
            await holder_task

        self.assertEqual(limiter.in_use, 0)

    async def test_deadline_caps_stage_timeout_with_monotonic_remaining(self) -> None:
        clock = _FakeClock()
        deadline = DeepResearchDeadline(10.0, _clock=clock)

        self.assertEqual(deadline.started_at, 100.0)
        self.assertEqual(deadline.stage_timeout(stage="plan", timeout_s=20), 10.0)

        clock.now += 3.0
        self.assertEqual(deadline.elapsed_s, 3.0)
        self.assertEqual(deadline.remaining_s, 7.0)
        self.assertEqual(deadline.stage_timeout(stage="search", timeout_s=2), 2.0)

        clock.now += 7.0
        self.assertTrue(deadline.expired)
        with self.assertRaises(DeepResearchTimeout) as raised:
            deadline.check(stage="synthesis")
        self.assertEqual(raised.exception.stage, "synthesis")
        self.assertEqual(raised.exception.code, "deep_research_timeout")

    async def test_wait_for_times_out_and_cancels_stage(self) -> None:
        deadline = DeepResearchDeadline(1.0)
        cleaned_up = asyncio.Event()

        async def slow_stage() -> None:
            try:
                await asyncio.sleep(60)
            finally:
                cleaned_up.set()

        with self.assertRaises(DeepResearchTimeout) as raised:
            await deadline.wait_for(
                slow_stage(),
                stage="source_validation",
                timeout_s=0.01,
            )

        self.assertTrue(cleaned_up.is_set())
        self.assertEqual(raised.exception.stage, "source_validation")

    async def test_wait_for_preserves_provider_timeout_error(self) -> None:
        deadline = DeepResearchDeadline(1.0)

        async def provider_call() -> None:
            raise TimeoutError("provider socket timeout")

        with self.assertRaisesRegex(TimeoutError, "provider socket timeout"):
            await deadline.wait_for(
                provider_call(),
                stage="search",
                timeout_s=0.5,
            )

    async def test_runtime_starts_deadline_only_after_capacity_is_acquired(self) -> None:
        clock = _FakeClock()
        runtime = DeepResearchRuntime(
            max_concurrency=1,
            queue_timeout_s=0.02,
            run_timeout_s=30,
            clock=clock,
        )

        async with runtime.run() as deadline:
            self.assertEqual(deadline.started_at, 100.0)
            clock.now = 105.0
            self.assertEqual(deadline.remaining_s, 25.0)
            with self.assertRaises(DeepResearchBusy):
                async with runtime.run(queue_timeout_s=0.01):
                    self.fail("a second run must not enter")

        self.assertEqual(runtime.limiter.in_use, 0)

    async def test_invalid_limits_and_timeouts_fail_fast(self) -> None:
        with self.assertRaises(TypeError):
            DeepResearchConcurrencyLimiter(
                max_concurrency=True,
                queue_timeout_s=1,
            )
        with self.assertRaises(ValueError):
            DeepResearchConcurrencyLimiter(
                max_concurrency=1,
                queue_timeout_s=0,
            )
        with self.assertRaises(ValueError):
            DeepResearchDeadline(float("inf"))


if __name__ == "__main__":
    unittest.main()
