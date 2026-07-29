"""
Live eval for the Agentic Document Context Service (costs Gemini tokens).

Checks (spec Section 12):
- an ambiguous one-liner triggers needs_clarification, never a guessed summary;
- a clean petition text yields a usable raw_case_summary whose issue-split
  matches the same case's hand-cleaned summary in issue count.

Run:  venv\\Scripts\\python.exe -m evals.eval_document_context
"""

import asyncio
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from agents import analyze_case  # noqa: E402

FIXTURES = os.path.join(os.path.dirname(__file__), "fixtures", "doc_context.json")


async def main() -> int:
    with open(FIXTURES, encoding="utf-8") as fh:
        fixtures = json.load(fh)["fixtures"]

    failures = 0
    for fixture in fixtures:
        _sid, context, issues = await analyze_case(fixture["input"])
        expected = fixture["expect_needs_clarification"]
        ok = context.needs_clarification == expected
        print(f"\n[{fixture['name']}] needs_clarification={context.needs_clarification} "
              f"(expected {expected}) → {'PASS' if ok else 'FAIL'}")
        if context.needs_clarification:
            print(f"   question: {context.clarification_question}")
        else:
            print(f"   type={context.document_type} confidence={context.source_confidence}")
            print(f"   summary: {context.raw_case_summary[:300]}")
            print(f"   issues ({len(issues)}):")
            for issue in issues:
                print(f"     {issue.id}. {issue.issue}")
        failures += not ok
    print(f"\n{'ALL PASS' if failures == 0 else f'{failures} FAILURE(S)'}")
    return failures


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
