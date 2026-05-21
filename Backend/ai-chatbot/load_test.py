"""
Load test -- sends 1000 concurrent fake requests to verify the chatbot
server handles them without crashes, pool exhaustion, or timeouts.

Test breakdown:
  Phase 1: 1000 concurrent GET /health          -- raw server capacity
  Phase 2:  500 concurrent GET /api/demo-slots  -- DB pool stress (read)
  Phase 3:   30 concurrent POST /api/chat       -- full Gemini + DB stack
  Phase 4:   25 rapid POST /api/chat same IP    -- rate-limit enforcement

Run: python load_test.py
"""
from __future__ import annotations

import asyncio
import sys
import time
from collections import Counter

import httpx

# Force UTF-8 on Windows so progress symbols don't crash
if sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

BASE_URL  = "http://localhost:8095"
TIMEOUT   = 60.0   # Gemini can take up to 30 s

# ---------------------------------------------------------------------------

async def fire_one(
    client: httpx.AsyncClient,
    method: str,
    url: str,
    **kwargs,
) -> tuple[int, float]:
    """Returns (status_code, elapsed_seconds). -1 on network error."""
    t0 = time.perf_counter()
    try:
        resp = await client.request(method, url, **kwargs)
        return resp.status_code, time.perf_counter() - t0
    except Exception:
        return -1, time.perf_counter() - t0


def _report(label: str, results: list[tuple[int, float]]) -> None:
    statuses = Counter(s for s, _ in results)
    times    = sorted(t for _, t in results)
    total    = len(times)

    def pct(n: int) -> str:
        return f"{n / total * 100:.1f}%" if total else "0%"

    ok       = statuses.get(200, 0)
    rate_429 = statuses.get(429, 0)
    errors   = statuses.get(-1, 0)

    print(f"\n{'='*58}")
    print(f"  {label}")
    print(f"{'='*58}")
    print(f"  Total requests : {total}")
    print(f"  200 OK         : {ok}  ({pct(ok)})")
    if rate_429:
        print(f"  429 Rate-limit : {rate_429}  ({pct(rate_429)})  [PASS - limiter works]")
    if errors:
        print(f"  Errors/crash   : {errors}  ({pct(errors)})  [FAIL]")
    other = {k: v for k, v in statuses.items() if k not in (200, 429, -1)}
    if other:
        print(f"  Other statuses : {other}")
    if times:
        def p(q: float) -> str:
            return f"{times[min(int(total * q), total - 1)]:.3f}s"
        print(f"  p50  latency   : {p(0.50)}")
        print(f"  p95  latency   : {p(0.95)}")
        print(f"  p99  latency   : {p(0.99)}")
        print(f"  min / max      : {times[0]:.3f}s / {times[-1]:.3f}s")

    if errors == 0:
        print(f"  Verdict        : PASS")
    else:
        print(f"  Verdict        : FAIL ({errors} server-side errors)")
    print(f"{'='*58}")


async def run_concurrent(
    label: str,
    method: str,
    url: str,
    n: int,
    concurrency: int = 100,
    **req_kwargs,
) -> list[tuple[int, float]]:
    """Fire n requests, at most `concurrency` in-flight at once."""
    print(f"\n>> {label}")
    print(f"   {n} requests | concurrency={concurrency} ...")
    sem      = asyncio.Semaphore(concurrency)
    results: list[tuple[int, float]] = []
    t_start  = time.perf_counter()

    async with httpx.AsyncClient(
        base_url=BASE_URL,
        timeout=TIMEOUT,
        limits=httpx.Limits(
            max_connections=concurrency + 20,
            max_keepalive_connections=concurrency,
        ),
    ) as client:

        async def _bounded(i: int) -> None:
            async with sem:
                r = await fire_one(client, method, url, **req_kwargs)
                results.append(r)
                if (i + 1) % 100 == 0:
                    done = i + 1
                    ok   = sum(1 for s, _ in results if s == 200)
                    print(f"   -> {done:4d}/{n} done  | ok={ok}  err={done - ok}")

        await asyncio.gather(*(_bounded(i) for i in range(n)))

    elapsed = time.perf_counter() - t_start
    rps     = n / elapsed
    print(f"   Finished in {elapsed:.1f}s  ({rps:.0f} req/s)")
    _report(label, results)
    return results


# ---------------------------------------------------------------------------
# Phase 1 - 1000 health checks
# ---------------------------------------------------------------------------

async def phase1_health_1000() -> list[tuple[int, float]]:
    return await run_concurrent(
        "Phase 1: 1000 x GET /health  [raw server capacity]",
        "GET", "/health",
        n=1000, concurrency=200,
    )


# ---------------------------------------------------------------------------
# Phase 2 - 500 demo-slot reads (exercises DB connection pool)
# ---------------------------------------------------------------------------

async def phase2_demo_slots_500() -> list[tuple[int, float]]:
    return await run_concurrent(
        "Phase 2: 500 x GET /api/demo-slots  [DB pool test]",
        "GET", "/api/demo-slots",
        n=500, concurrency=100,
    )


# ---------------------------------------------------------------------------
# Phase 3 - 30 real chat requests (Gemini + DB)
# ---------------------------------------------------------------------------

async def phase3_chat_30() -> list[tuple[int, float]]:
    messages = [
        "What is JuriNex?",
        "How do I upload a document?",
        "What is the BNS act?",
        "How to create a case?",
        "What is BNSS?",
    ]
    bodies = [
        {"message": messages[i % len(messages)], "session_id": None}
        for i in range(30)
    ]

    print(f"\n>> Phase 3: 30 x POST /api/chat  [Gemini + DB full stack]")
    print( "   30 requests | concurrency=10 ...")

    sem     = asyncio.Semaphore(10)
    results: list[tuple[int, float]] = []

    async with httpx.AsyncClient(
        base_url=BASE_URL,
        timeout=TIMEOUT,
        limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
    ) as client:

        async def _one(body: dict, i: int) -> None:
            async with sem:
                s, t = await fire_one(client, "POST", "/api/chat", json=body)
                results.append((s, t))
                ok = "OK" if s == 200 else f"FAIL({s})"
                print(f"   [{i+1:02d}/30] {ok:<10}  {t:.2f}s  msg={body['message']!r}")

        await asyncio.gather(*(_one(bodies[i], i) for i in range(30)))

    _report("Phase 3: 30 x POST /api/chat", results)
    return results


# ---------------------------------------------------------------------------
# Phase 4 - 25 rapid-fire chat requests (rate-limit verification)
# ---------------------------------------------------------------------------

async def phase4_rate_limit() -> list[tuple[int, float]]:
    """
    Fire 25 requests simultaneously from the same IP.
    Rate limit is 20/minute by default, so at least 5 should get 429.
    """
    print(f"\n>> Phase 4: 25 simultaneous POST /api/chat  [rate-limit test]")
    print( "   Expecting: first ~20 = 200 OK, remaining = 429")

    body  = {"message": "ping test", "session_id": None}
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=TIMEOUT) as client:
        tasks   = [fire_one(client, "POST", "/api/chat", json=body) for _ in range(25)]
        results = list(await asyncio.gather(*tasks))

    statuses = Counter(s for s, _ in results)
    print(f"   Statuses: {dict(statuses)}")
    _report("Phase 4: rate-limit enforcement", results)
    return results


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

async def main() -> None:
    print("=" * 58)
    print("  AI Chatbot - 1000-Request Load Test")
    print("=" * 58)

    # Verify server is reachable
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=5) as client:
        try:
            r    = await client.get("/health")
            data = r.json()
            db   = "connected" if data.get("db") else "NOT connected"
            print(f"\n  Server  : {BASE_URL}")
            print(f"  Status  : {data.get('status')}")
            print(f"  DB pool : {db}")
        except Exception as exc:
            print(f"\n  Server not reachable: {exc}")
            print("  Start it first:  python main.py")
            return

    t_total = time.perf_counter()

    p1 = await phase1_health_1000()
    p2 = await phase2_demo_slots_500()
    p3 = await phase3_chat_30()
    p4 = await phase4_rate_limit()

    total_elapsed = time.perf_counter() - t_total
    all_results   = p1 + p2 + p3 + p4
    total_reqs    = len(all_results)
    total_errors  = sum(1 for s, _ in all_results if s == -1)
    total_200     = sum(1 for s, _ in all_results if s == 200)
    total_429     = sum(1 for s, _ in all_results if s == 429)

    print(f"\n{'='*58}")
    print(f"  FINAL SUMMARY")
    print(f"{'='*58}")
    print(f"  Total requests fired : {total_reqs}")
    print(f"  200 OK               : {total_200}")
    print(f"  429 Rate-limited     : {total_429}")
    print(f"  Errors / crashes     : {total_errors}")
    print(f"  Total elapsed        : {total_elapsed:.1f}s")
    print(f"  Overall verdict      : {'PASS - server handled all requests' if total_errors == 0 else 'FAIL - check errors above'}")
    print(f"{'='*58}\n")


if __name__ == "__main__":
    asyncio.run(main())
