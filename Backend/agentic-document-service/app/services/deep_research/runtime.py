"""Runtime controls for Deep Research.

This module is intentionally isolated from the normal Research path.  It provides:

* a fair, bounded concurrency limiter shared by all event loops in one Python process;
* a separate timeout for waiting in the capacity queue;
* a monotonic deadline for the work performed after capacity is acquired; and
* stable exceptions that the API layer can translate into predictable SSE errors.

The limiter is process-scoped, not cluster-scoped.  Every ASGI worker therefore gets
its own allowance.  Deployments that need a cluster-wide cap should put a distributed
admission controller in front of this guard; the local guard remains useful for
protecting each worker.
"""

from __future__ import annotations

import asyncio
import inspect
import math
import threading
import time
from collections import deque
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Generic, Literal, TypeVar


_T = TypeVar("_T")
_WaiterState = Literal["waiting", "granted", "claimed", "cancelled"]


def _positive_seconds(value: float, field_name: str) -> float:
    """Return a validated, finite, positive timeout."""

    if isinstance(value, bool):
        raise TypeError(f"{field_name} must be a number, not bool")
    try:
        parsed = float(value)
    except (TypeError, ValueError) as exc:
        raise TypeError(f"{field_name} must be a number") from exc
    if not math.isfinite(parsed) or parsed <= 0:
        raise ValueError(f"{field_name} must be finite and greater than zero")
    return parsed


def _positive_integer(value: int, field_name: str) -> int:
    """Return a validated positive integer without accepting bool as int."""

    if isinstance(value, bool) or not isinstance(value, int):
        raise TypeError(f"{field_name} must be an integer")
    if value <= 0:
        raise ValueError(f"{field_name} must be greater than zero")
    return value


class DeepResearchRuntimeError(RuntimeError):
    """Base class for stable Deep Research runtime failures."""

    code = "deep_research_runtime_error"

    def as_dict(self) -> dict[str, object]:
        """Return a safe payload suitable for logs or an SSE error event."""

        return {"code": self.code, "message": str(self)}


class DeepResearchBusy(DeepResearchRuntimeError):
    """Raised when no local Deep Research slot becomes available in time."""

    code = "deep_research_busy"

    def __init__(self, *, queue_timeout_s: float, max_concurrency: int) -> None:
        self.queue_timeout_s = queue_timeout_s
        self.max_concurrency = max_concurrency
        super().__init__(
            "Deep Research is at capacity; no execution slot became available "
            f"within {queue_timeout_s:g} seconds."
        )

    def as_dict(self) -> dict[str, object]:
        payload = super().as_dict()
        payload.update(
            {
                "queue_timeout_s": self.queue_timeout_s,
                "max_concurrency": self.max_concurrency,
            }
        )
        return payload


class DeepResearchTimeout(DeepResearchRuntimeError):
    """Raised when a Deep Research stage exhausts its effective deadline."""

    code = "deep_research_timeout"

    def __init__(self, *, stage: str, timeout_s: float) -> None:
        self.stage = stage
        self.timeout_s = max(0.0, float(timeout_s))
        super().__init__(
            f"Deep Research stage '{stage}' exceeded its "
            f"{self.timeout_s:g}-second deadline."
        )

    def as_dict(self) -> dict[str, object]:
        payload = super().as_dict()
        payload.update({"stage": self.stage, "timeout_s": self.timeout_s})
        return payload


@dataclass(slots=True)
class _Waiter:
    loop: asyncio.AbstractEventLoop
    future: asyncio.Future[None]
    state: _WaiterState = "waiting"


class _ConcurrencyLease:
    """An idempotently releasable concurrency slot."""

    __slots__ = ("_limiter", "_release_lock", "_released")

    def __init__(self, limiter: "DeepResearchConcurrencyLimiter") -> None:
        self._limiter = limiter
        self._release_lock = threading.Lock()
        self._released = False

    @property
    def released(self) -> bool:
        with self._release_lock:
            return self._released

    def release(self) -> None:
        """Return the slot exactly once, even if cleanup paths overlap."""

        with self._release_lock:
            if self._released:
                return
            self._released = True
        self._limiter._release()


class DeepResearchConcurrencyLimiter:
    """A FIFO concurrency limiter shared safely across event loops.

    Unlike ``asyncio.Semaphore``, the internal admission state is protected by a
    thread lock and is not bound to the first event loop that uses it.  Waiters are
    notified on their owning loop using ``call_soon_threadsafe``.  This matters for
    tests, management commands, and servers that use more than one loop in a process.
    """

    def __init__(self, *, max_concurrency: int, queue_timeout_s: float) -> None:
        self._max_concurrency = _positive_integer(max_concurrency, "max_concurrency")
        self._queue_timeout_s = _positive_seconds(queue_timeout_s, "queue_timeout_s")
        self._lock = threading.Lock()
        self._waiters: deque[_Waiter] = deque()
        self._in_use = 0

    @property
    def max_concurrency(self) -> int:
        return self._max_concurrency

    @property
    def queue_timeout_s(self) -> float:
        return self._queue_timeout_s

    @property
    def in_use(self) -> int:
        with self._lock:
            return self._in_use

    @property
    def queued(self) -> int:
        with self._lock:
            return sum(waiter.state == "waiting" for waiter in self._waiters)

    async def acquire(self, *, timeout_s: float | None = None) -> _ConcurrencyLease:
        """Acquire a slot or raise :class:`DeepResearchBusy`.

        Cancellation and timeout races are handled explicitly.  If a slot has already
        been transferred to a waiter when that waiter is cancelled, it is immediately
        transferred again or returned to the pool.
        """

        queue_timeout_s = (
            self._queue_timeout_s
            if timeout_s is None
            else _positive_seconds(timeout_s, "timeout_s")
        )
        loop = asyncio.get_running_loop()
        waiter = _Waiter(loop=loop, future=loop.create_future())

        with self._lock:
            if self._in_use < self._max_concurrency:
                self._in_use += 1
                waiter.state = "claimed"
                return _ConcurrencyLease(self)
            self._waiters.append(waiter)

        try:
            # Shield the private future so wait_for cannot cancel it behind the
            # limiter's state machine.  _abandon_waiter performs the coordinated
            # cancellation and returns any slot that raced with the timeout.
            await asyncio.wait_for(
                asyncio.shield(waiter.future),
                timeout=queue_timeout_s,
            )
        except TimeoutError as exc:
            self._abandon_waiter(waiter)
            raise DeepResearchBusy(
                queue_timeout_s=queue_timeout_s,
                max_concurrency=self._max_concurrency,
            ) from exc
        except asyncio.CancelledError:
            self._abandon_waiter(waiter)
            raise

        with self._lock:
            if waiter.state != "granted":
                # This is an invariant failure rather than user-facing overload.
                raise RuntimeError(
                    f"Deep Research limiter granted an invalid waiter state: {waiter.state}"
                )
            waiter.state = "claimed"
        return _ConcurrencyLease(self)

    @asynccontextmanager
    async def slot(
        self,
        *,
        timeout_s: float | None = None,
    ) -> AsyncIterator[_ConcurrencyLease]:
        """Hold one concurrency slot and always release it on exit."""

        lease = await self.acquire(timeout_s=timeout_s)
        try:
            yield lease
        finally:
            # A task cancellation is delivered at an await point.  release() is
            # synchronous, idempotent, and therefore cannot be interrupted here.
            lease.release()

    def _abandon_waiter(self, waiter: _Waiter) -> None:
        transferred_slot = False
        with self._lock:
            if waiter.state == "waiting":
                waiter.state = "cancelled"
                try:
                    self._waiters.remove(waiter)
                except ValueError:
                    # A concurrent release may already have removed it.  Its state
                    # transition is resolved by the branch below on that thread.
                    pass
            elif waiter.state == "granted":
                waiter.state = "cancelled"
                transferred_slot = True

        if not waiter.future.done():
            # acquire() always invokes this method on the future's owning loop.
            waiter.future.cancel()
        if transferred_slot:
            self._release()

    def _release(self) -> None:
        """Return or transfer one slot.

        This method may be called from any thread.  ``_in_use`` is deliberately not
        decremented when a slot is transferred directly to a queued waiter.
        """

        while True:
            waiter: _Waiter | None = None
            with self._lock:
                if self._in_use <= 0:
                    raise RuntimeError("Deep Research concurrency limiter over-release")

                while self._waiters:
                    candidate = self._waiters.popleft()
                    if candidate.state == "waiting":
                        candidate.state = "granted"
                        waiter = candidate
                        break

                if waiter is None:
                    self._in_use -= 1
                    return

            try:
                waiter.loop.call_soon_threadsafe(self._deliver_grant, waiter)
                return
            except RuntimeError:
                # The owning loop closed between queuing and delivery.  Keep the
                # transferred slot in use and offer it to the next waiter.
                with self._lock:
                    if waiter.state == "granted":
                        waiter.state = "cancelled"

    def _deliver_grant(self, waiter: _Waiter) -> None:
        """Complete a waiter on its owning event loop."""

        return_slot = False
        with self._lock:
            if waiter.state != "granted":
                return
            if waiter.future.cancelled():
                waiter.state = "cancelled"
                return_slot = True
            elif not waiter.future.done():
                waiter.future.set_result(None)

        if return_slot:
            self._release()


@dataclass(frozen=True, slots=True)
class DeepResearchDeadline:
    """A monotonic overall deadline with per-stage timeout capping."""

    timeout_s: float
    _clock: Callable[[], float] = field(default=time.monotonic, repr=False, compare=False)
    started_at: float = field(init=False)
    deadline_at: float = field(init=False)

    def __post_init__(self) -> None:
        timeout_s = _positive_seconds(self.timeout_s, "timeout_s")
        started_at = float(self._clock())
        if not math.isfinite(started_at):
            raise ValueError("clock must return a finite monotonic value")
        object.__setattr__(self, "timeout_s", timeout_s)
        object.__setattr__(self, "started_at", started_at)
        object.__setattr__(self, "deadline_at", started_at + timeout_s)

    @property
    def elapsed_s(self) -> float:
        return max(0.0, float(self._clock()) - self.started_at)

    @property
    def remaining_s(self) -> float:
        return max(0.0, self.deadline_at - float(self._clock()))

    @property
    def expired(self) -> bool:
        return self.remaining_s <= 0

    def stage_timeout(
        self,
        *,
        stage: str,
        timeout_s: float | None = None,
    ) -> float:
        """Return the smaller of a stage timeout and the overall time left."""

        stage_name = str(stage).strip() or "unknown"
        requested = (
            None if timeout_s is None else _positive_seconds(timeout_s, "timeout_s")
        )
        remaining = self.remaining_s
        if remaining <= 0:
            raise DeepResearchTimeout(stage=stage_name, timeout_s=0.0)
        return remaining if requested is None else min(requested, remaining)

    def check(self, *, stage: str) -> None:
        """Raise immediately if no overall runtime remains."""

        self.stage_timeout(stage=stage)

    async def wait_for(
        self,
        awaitable: Awaitable[_T],
        *,
        stage: str,
        timeout_s: float | None = None,
    ) -> _T:
        """Await one stage under both its local and the overall deadline.

        ``asyncio.wait`` is used instead of catching ``asyncio.wait_for``'s
        ``TimeoutError``.  This preserves a provider coroutine's own TimeoutError
        rather than incorrectly relabelling it as a Deep Research deadline.
        """

        stage_name = str(stage).strip() or "unknown"
        try:
            effective_timeout_s = self.stage_timeout(
                stage=stage_name,
                timeout_s=timeout_s,
            )
        except BaseException:
            # Avoid "coroutine was never awaited" warnings when callers construct a
            # coroutine before discovering that the overall deadline has expired.
            if inspect.iscoroutine(awaitable):
                awaitable.close()
            raise

        task = asyncio.ensure_future(awaitable)
        try:
            done, _pending = await asyncio.wait(
                {task},
                timeout=effective_timeout_s,
                return_when=asyncio.FIRST_COMPLETED,
            )
        except asyncio.CancelledError:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
            raise

        if task not in done:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
            raise DeepResearchTimeout(
                stage=stage_name,
                timeout_s=effective_timeout_s,
            )
        return await task


class DeepResearchRuntime:
    """Compose process-local admission control with a per-run deadline."""

    def __init__(
        self,
        *,
        max_concurrency: int,
        queue_timeout_s: float,
        run_timeout_s: float,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._limiter = DeepResearchConcurrencyLimiter(
            max_concurrency=max_concurrency,
            queue_timeout_s=queue_timeout_s,
        )
        self._run_timeout_s = _positive_seconds(run_timeout_s, "run_timeout_s")
        self._clock = clock

    @property
    def limiter(self) -> DeepResearchConcurrencyLimiter:
        return self._limiter

    @property
    def run_timeout_s(self) -> float:
        return self._run_timeout_s

    @asynccontextmanager
    async def run(
        self,
        *,
        queue_timeout_s: float | None = None,
        run_timeout_s: float | None = None,
    ) -> AsyncIterator[DeepResearchDeadline]:
        """Acquire local capacity, then start and yield the workload deadline."""

        effective_run_timeout_s = (
            self._run_timeout_s
            if run_timeout_s is None
            else _positive_seconds(run_timeout_s, "run_timeout_s")
        )
        async with self._limiter.slot(timeout_s=queue_timeout_s):
            yield DeepResearchDeadline(
                effective_run_timeout_s,
                _clock=self._clock,
            )


__all__ = [
    "DeepResearchBusy",
    "DeepResearchConcurrencyLimiter",
    "DeepResearchDeadline",
    "DeepResearchRuntime",
    "DeepResearchRuntimeError",
    "DeepResearchTimeout",
]
