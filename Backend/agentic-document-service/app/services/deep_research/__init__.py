"""Deep Research — a bounded, agentic web-research loop for Jurinex.

Unlike the single-pass "Research" mode (one grounded gemini-2.5-pro call that lets
Google decide the searches internally), Deep Research runs an EXPLICIT loop that this
service controls:

    plan  ->  [ search -> read sources -> check gaps ] x N rounds  ->  synthesize

Every step is a real model call, every round can follow up on what the previous round
found, and the whole run is capped by a hard rupee budget (default INR 10) so it can
never run away. It streams the same SSE event shapes as the rest of intelligent_chat
(`status` / `thinking` / `chunk` / `done`), so the existing frontend renders it with no
special handling.

Public entrypoint: `run_deep_research(...)` — an async generator of SSE strings.
"""

from .agent import run_deep_research

__all__ = ["run_deep_research"]
