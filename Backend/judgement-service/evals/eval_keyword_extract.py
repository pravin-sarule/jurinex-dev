"""
Live eval for Stage 2 keyword extraction (costs Gemini tokens).

Temperature is non-zero (0.25), so each fixture runs 5× and we report a
PASS RATE, not a single eyeballed run (spec Section 12). Anchors:
must_include terms must appear (substring, case-insensitive, any axis;
'|' separates alternatives), must_not_include must never appear.

Run:  venv\\Scripts\\python.exe -m evals.eval_keyword_extract
"""

import asyncio
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from agents import build_keyword_extract_agent, run_agent_once  # noqa: E402
from schemas import KeywordSet  # noqa: E402

FIXTURES = os.path.join(os.path.dirname(__file__), "fixtures", "keyword_axes.json")


def _contains(terms: list[str], anchor: str) -> bool:
    alternatives = [a.strip().lower() for a in anchor.split("|")]
    joined = " || ".join(t.lower() for t in terms)
    return any(a in joined for a in alternatives)


async def run_fixture(fixture: dict, runs: int) -> float:
    passes = 0
    for attempt in range(runs):
        out = await run_agent_once(build_keyword_extract_agent(),
                                   f"Legal issue to generate search terms for:\n{fixture['issue']}",
                                   ["keywords"])
        keywords = KeywordSet.model_validate(out.get("keywords") or {})
        terms = keywords.all_terms()
        n = len(terms)
        include_ok = all(_contains(terms, a) for a in fixture["must_include"])
        exclude_ok = not any(_contains(terms, a) for a in fixture["must_not_include"])
        count_ok = 12 <= n <= 16
        ok = include_ok and exclude_ok and count_ok
        passes += ok
        print(f"  run {attempt + 1}: {n} terms | include={include_ok} "
              f"exclude={exclude_ok} count={count_ok} → {'pass' if ok else 'FAIL'}")
        if not ok:
            print(f"    terms: {terms}")
    return passes / runs


async def main() -> int:
    with open(FIXTURES, encoding="utf-8") as fh:
        data = json.load(fh)
    runs = data.get("runs_per_fixture", 5)
    failures = 0
    for fixture in data["fixtures"]:
        print(f"\n[{fixture['name']}] ({runs} runs)")
        rate = await run_fixture(fixture, runs)
        print(f"  pass rate: {rate:.0%}")
        if rate < 0.8:
            failures += 1
    print(f"\n{'ALL PASS' if failures == 0 else f'{failures} fixture(s) below 80% pass rate'}")
    return failures


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
