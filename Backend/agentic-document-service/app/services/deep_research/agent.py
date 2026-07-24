"""The Deep Research orchestration loop.

    plan  ->  [ search -> read sources -> gap check ] x N rounds  ->  synthesize (stream)

`run_deep_research(...)` is an async generator of SSE strings, drop-in for the
intelligent_chat_stream generator: the route just re-yields whatever it produces. Every
model call is metered against a hard rupee budget (default INR 10); when the budget nears
its limit the loop stops opening new rounds but always still writes the final report.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from datetime import datetime
from typing import Any, AsyncGenerator

from app.core.config import get_settings
from app.services import citation_verification
from app.services.grounding_links import resolve_grounding_links

from . import events, gemini, prompts, report
from .budget import BudgetTracker
from .config import DeepResearchConfig

logger = logging.getLogger(__name__)


# ── parsing helpers ─────────────────────────────────────────────────────────────────

def _parse_plan(text: str, fallback: str, max_rounds: int) -> list[str]:
    """Extract the sub-question list from the planner's JSON reply, defensively."""
    if text:
        match = re.search(r"\[.*\]", text, re.DOTALL)
        if match:
            try:
                arr = json.loads(match.group(0))
                subqs = [str(x).strip() for x in arr if str(x).strip()]
                if subqs:
                    return subqs[:max_rounds]
            except Exception:
                pass
    return [fallback]


def _parse_gap(text: str) -> str | None:
    """Return None when coverage is sufficient (DONE), else the follow-up query."""
    line = (text or "").strip().splitlines()[0].strip() if (text or "").strip() else ""
    if not line:
        return None
    if line.upper().startswith("DONE"):
        return None
    return line.strip().strip('"').strip()


def _dedupe_citations(citations: list[dict[str, str]]) -> list[dict[str, str]]:
    seen: set[str] = set()
    out: list[dict[str, str]] = []
    for c in citations:
        uri = c.get("uri")
        if not uri or uri in seen:
            continue
        seen.add(uri)
        out.append(c)
    return out


# ── entrypoint ──────────────────────────────────────────────────────────────────────

async def run_deep_research(
    *,
    question: str,
    document_context: str,
    session_id: str,
    llm_config: dict | None = None,
    on_result=None,
) -> AsyncGenerator[str, None]:
    """Yields SSE strings for the whole run. If `on_result` is given it is AWAITED with
    (answer, citations) right BEFORE the terminal `done` event is emitted — so the caller can
    persist the chat to history before the client sees `done` (and refreshes its session list)."""
    settings = get_settings()
    cfg = DeepResearchConfig.from_settings(settings, llm_config)
    budget = BudgetTracker(limit_inr=cfg.budget_inr)
    # Current date anchors the prompts (e.g. "23 July 2026") so the models can flag
    # renumbered/replaced provisions (IPC/CrPC/Evidence Act -> BNS/BNSS/BSA) and state
    # what is currently in force. Non-zero-padded day to match the template example.
    _now = datetime.now()
    today = f"{_now.day} {_now:%B %Y}"

    question = (question or "").strip()
    if not question:
        yield events.error("Deep Research needs a question.")
        return

    # A run always needs the synthesis model; if the key is missing we cannot proceed.
    if not gemini.client_available(cfg.synthesis_model):
        yield events.error("Deep Research is unavailable: the Gemini API key is not configured.")
        return

    yield events.status("researching", f"Deep Research started · budget ₹{cfg.budget_inr:.0f}")
    yield events.thinking(
        f"Deep Research mode: I will plan the question, run up to {cfg.max_rounds} live web-search "
        f"round(s), read the sources, then synthesize a cited report. Hard budget ₹{cfg.budget_inr:.0f} "
        "— I stop searching before it runs out."
    )

    # ── 1. PLAN ──────────────────────────────────────────────────────────────────
    try:
        plan_text, it, ot = await asyncio.to_thread(
            gemini.reason, cfg.reasoning_model,
            prompts.planner(question, cfg.max_rounds, document_context, cfg.plan_context_chars, today),
            temperature=0.1, max_output_tokens=1024,
        )
        _cost = budget.add(cfg.reasoning_model, it, ot, label="Plan")
        logger.info("[DeepResearch] plan · model=%s · in=%d out=%d · ₹%.2f",
                    cfg.reasoning_model, it, ot, _cost)
    except Exception as exc:  # planning is best-effort; fall back to the raw question
        logger.warning("[DeepResearch] planning failed: %s", exc)
        plan_text = ""

    queue = _parse_plan(plan_text, fallback=question, max_rounds=cfg.max_rounds)
    yield events.thinking(
        "Research plan:\n" + "\n".join(f"  {i}. {q}" for i, q in enumerate(queue, 1))
    )

    # ── 2. ROUNDS: search -> read sources -> gap check ───────────────────────────
    findings: list[dict[str, Any]] = []
    all_citations: list[dict[str, str]] = []
    reserve = cfg.synthesis_reserve_inr
    round_no = 0

    while queue and round_no < cfg.max_rounds:
        if not budget.can_afford_round(reserve):
            yield events.thinking(
                f"Budget nearly reached (₹{budget.spent_inr:.2f} of ₹{cfg.budget_inr:.0f}) — "
                "stopping searches and moving to synthesis."
            )
            break

        subq = queue.pop(0)
        round_no += 1
        yield events.status("researching", f"Deep research round {round_no}/{cfg.max_rounds}")
        yield events.thinking(f"Round {round_no}: searching the live web for — {subq}")

        try:
            text, cites, it, ot = await asyncio.to_thread(
                gemini.search, cfg.search_model,
                prompts.round_search(question, subq, findings, document_context, cfg.round_context_chars, today),
                temperature=cfg.temperature, max_output_tokens=min(cfg.max_output_tokens, 8192),
            )
        except Exception as exc:
            logger.warning("[DeepResearch] round %d search failed: %s", round_no, exc)
            yield events.thinking(f"Round {round_no}: search failed ({exc}); continuing.")
            continue

        _cost = budget.add(cfg.search_model, it, ot, label=f"Round {round_no} search")
        logger.info(
            "[DeepResearch] round %d search · model=%s · in=%d out=%d · ₹%.2f · "
            "cumulative in=%d out=%d ₹%.2f",
            round_no, cfg.search_model, it, ot, _cost,
            budget.input_tokens, budget.output_tokens, budget.spent_inr,
        )
        findings.append({"query": subq, "text": text, "citations": cites})
        all_citations.extend(cites)
        yield events.thinking(
            f"Round {round_no} complete · {len(cites)} source(s) found · "
            f"₹{budget.spent_inr:.2f} spent so far."
        )

        # Gap check — only worth doing if another round could still run.
        if round_no < cfg.max_rounds and budget.can_afford_round(reserve):
            try:
                gap_text, it, ot = await asyncio.to_thread(
                    gemini.reason, cfg.reasoning_model,
                    prompts.gap_check(question, findings, round_no, cfg.max_rounds),
                    temperature=0.0, max_output_tokens=256,
                )
                _cost = budget.add(cfg.reasoning_model, it, ot, label=f"Round {round_no} gap-check")
                logger.info("[DeepResearch] round %d gap-check · model=%s · in=%d out=%d · ₹%.2f",
                            round_no, cfg.reasoning_model, it, ot, _cost)
            except Exception as exc:
                logger.warning("[DeepResearch] gap check failed: %s", exc)
                gap_text = "DONE"

            follow_up = _parse_gap(gap_text)
            if not follow_up:
                yield events.thinking("Coverage looks sufficient — no further searches needed.")
                break
            queue.insert(0, follow_up)
            yield events.thinking(f"Identified a gap — next: {follow_up}")

    # ── 3. QUOTE VERIFICATION ───────────────────────────────────────────────────
    # A model can write a plausible "verbatim quote" next to a citation without that text
    # actually being on the page. Fetch each cited page once and mechanically check the
    # quoted spans — no extra LLM call, since a model asked "is this verified?" can
    # hallucinate a confident yes just as easily as it hallucinated the quote. Findings get
    # a verification badge that the synthesis prompt is instructed to respect. Pure network
    # I/O — no token/₹ cost, so it doesn't touch the budget.
    if findings:
        yield events.thinking("Verifying quoted passages against their cited sources...")
        try:
            _all_urls = [c.get("uri") for f in findings for c in (f.get("citations") or []) if c.get("uri")]
            _pages = await citation_verification.fetch_pages(_all_urls)
            _v_checked = _v_confirmed = _v_warned = _v_unchecked = 0
            for f in findings:
                quotes = citation_verification.extract_quotes(f.get("text") or "")
                if not quotes:
                    continue
                urls = [c.get("uri") for c in (f.get("citations") or []) if c.get("uri")]
                pages_for_f = {u: _pages.get(u, "") for u in urls}
                v = citation_verification.verify_quotes(quotes, pages_for_f)
                f["verification"] = v
                _v_checked += 1
                if v["status"] == "verified":
                    _v_confirmed += 1
                elif v["status"] == "unchecked":
                    _v_unchecked += 1
                elif v["status"] in ("partially_verified", "unverified"):
                    # A REAL red flag: the source page loaded fine but didn't contain the
                    # quote — distinct from "unchecked" (couldn't reach the page at all).
                    _v_warned += 1
            if _v_checked:
                yield events.thinking(
                    f"Checked {_v_checked} finding(s) with quoted material · {_v_confirmed} fully confirmed"
                    + (f" · {_v_warned} flagged (quote not found on the cited page)" if _v_warned else "")
                    + (f" · {_v_unchecked} could not be checked (source unreachable)" if _v_unchecked else "")
                    + "."
                )
                logger.info(
                    "[DeepResearch] quote verification · checked=%d confirmed=%d flagged=%d unchecked=%d",
                    _v_checked, _v_confirmed, _v_warned, _v_unchecked,
                )
        except Exception as _verify_exc:
            logger.warning("[DeepResearch] quote verification failed: %s", _verify_exc)

    # ── 4. SYNTHESIS (streamed) ──────────────────────────────────────────────────
    yield events.status("researching", "Synthesizing the final report…")
    yield events.thinking(
        f"Writing the cited report from {len(findings)} round(s) of findings "
        f"({len(_dedupe_citations(all_citations))} unique source(s))…"
    )

    answer_parts: list[str] = []
    last_it = last_ot = 0
    try:
        # Build the generator (no network yet) and drive it one chunk at a time off the
        # event loop. The generator keeps the genai client alive for the whole stream.
        it_stream = gemini.synthesis_stream(
            cfg.synthesis_model,
            prompts.synthesis(question, findings, document_context, cfg.synth_context_chars, today),
            temperature=cfg.synthesis_temperature,
            max_output_tokens=cfg.max_output_tokens,
            thinking_level=cfg.synthesis_thinking_level,
        )
        while True:
            chunk = await asyncio.to_thread(next, it_stream, None)
            if chunk is None:
                break
            delta, cin, cout = gemini.chunk_text_and_usage(chunk)
            if cin:
                last_it = cin
            if cout:
                last_ot = cout
            for c in gemini.chunk_citations(chunk):
                all_citations.append(c)
            if delta:
                answer_parts.append(delta)
                yield events.chunk(delta)
    except Exception as exc:
        logger.warning("[DeepResearch] synthesis failed: %s", exc)
        if not answer_parts:
            yield events.error(f"Deep Research synthesis failed: {exc}")
            return

    _cost = budget.add(cfg.synthesis_model, last_it, last_ot, label="Synthesis")
    logger.info("[DeepResearch] synthesis · model=%s · in=%d out=%d · ₹%.2f",
                cfg.synthesis_model, last_it, last_ot, _cost)
    answer = "".join(answer_parts).strip()
    citations_payload = _dedupe_citations(all_citations)

    # Every "## Sources" link the model wrote is a Gemini grounding-redirect wrapper, not a
    # real publisher URL — these are known to be dead/expired sometimes ("click and nothing
    # is there"). Resolve them to their real destination now, while freshly valid, and drop
    # any that don't resolve rather than ship a dead link.
    if answer:
        try:
            yield events.thinking("Verifying source links...")
            answer, _link_stats = await resolve_grounding_links(answer)
        except Exception as _link_exc:
            logger.warning("[DeepResearch] grounding link resolution failed: %s", _link_exc)

    # ── Per-step token & cost table for this Deep Research run (console + logs) ───
    report.log_usage_table(
        budget, cfg,
        rounds=round_no,
        session_id=session_id or "",
        answer_length=len(answer),
        sources=len(citations_payload),
    )

    _record_usage_best_effort(cfg, budget)

    # Persist the chat BEFORE emitting `done` (the client refreshes its session list on
    # `done`, so the row must already exist). Without this the run streams but is never saved.
    if on_result is not None and answer:
        try:
            await on_result(answer, citations_payload)
        except Exception as exc:
            logger.warning("[DeepResearch] on_result persist hook failed: %s", exc)

    yield events.thinking(
        f"Done · {round_no} search round(s) · ₹{budget.spent_inr:.2f} of ₹{cfg.budget_inr:.0f} spent."
    )
    yield events.done(
        session_id=session_id or "",
        method="deep_research",
        routing_decision="deep_research_agent",
        answer=answer,
        citations=citations_payload,
        used_chunk_ids=[],
        deep_research=budget.summary() | {"rounds": round_no},
    )


def _record_usage_best_effort(cfg: DeepResearchConfig, budget: BudgetTracker) -> None:
    """Fold the run's aggregate token usage into the app-wide accounting. Best effort:
    any signature drift is swallowed so it can never break the user-facing stream."""
    try:
        from app.services.token_usage_log import record_token_usage
        record_token_usage(
            context="deep_research_stream",
            usage={
                "provider": "gemini",
                "model": cfg.synthesis_model,
                "inputTokens": budget.input_tokens,
                "outputTokens": budget.output_tokens,
                "totalTokens": budget.input_tokens + budget.output_tokens,
            },
            provider="gemini",
            model_name=cfg.synthesis_model,
        )
    except Exception:
        pass
