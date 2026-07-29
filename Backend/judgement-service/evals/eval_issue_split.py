"""
Live eval for Stage 1 issue splitting (costs Gemini tokens).

Pass criterion per fixture: correct issue COUNT — not merged into one
vague issue, not split into rephrasings (spec Section 12).

Run:  venv\\Scripts\\python.exe -m evals.eval_issue_split
"""

import asyncio
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from agents import build_issue_split_agent, run_agent_once  # noqa: E402
from schemas import IssueList  # noqa: E402

FIXTURES = os.path.join(os.path.dirname(__file__), "fixtures", "issue_split.json")


async def main() -> int:
    with open(FIXTURES, encoding="utf-8") as fh:
        fixtures = json.load(fh)["fixtures"]

    failures = 0
    for fixture in fixtures:
        out = await run_agent_once(build_issue_split_agent(), fixture["case_summary"], ["issues"])
        issues = IssueList.model_validate(out.get("issues") or {"issues": []}).issues
        ok = len(issues) == fixture["expected_issue_count"]
        print(f"\n[{fixture['name']}] expected {fixture['expected_issue_count']} issues, "
              f"got {len(issues)} → {'PASS' if ok else 'FAIL'}")
        for issue in issues:
            print(f"   {issue.id}. {issue.issue}")
        if not ok:
            failures += 1
    print(f"\n{'ALL PASS' if failures == 0 else f'{failures} FAILURE(S)'}")
    return failures


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
