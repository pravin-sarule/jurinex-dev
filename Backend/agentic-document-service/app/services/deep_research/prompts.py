"""Prompt templates for each Deep Research step.

Kept in one place so the agent's behaviour is auditable at a glance. Every prompt keeps
the same anti-hallucination contract as single-pass Research mode: never invent a
source, URL, quote, date, or holding; prefer primary authoritative sources; separate
document-supported from web-supported claims.
"""

from __future__ import annotations

from typing import Any


def _clip(text: str, limit: int) -> str:
    text = text or ""
    if len(text) <= limit:
        return text
    return text[:limit] + "\n…[context truncated to control cost]…"


def format_findings(findings: list[dict[str, Any]]) -> str:
    """Render accumulated round findings into a compact text block for later steps."""
    if not findings:
        return "(none yet)"
    blocks: list[str] = []
    for i, f in enumerate(findings, 1):
        cites = f.get("citations") or []
        src = "\n".join(f"    - {c.get('title') or c.get('uri')} ({c.get('uri')})" for c in cites)
        blocks.append(
            f"[Round {i}] Sub-question: {f.get('query', '')}\n"
            f"Findings: {f.get('text', '').strip()}\n"
            f"Sources:\n{src if src else '    - (none reported)'}"
        )
    return "\n\n".join(blocks)


def planner(question: str, max_rounds: int, context: str, ctx_chars: int) -> str:
    return (
        "You are the planning module of Jurinex Deep Research, a legal & factual research agent.\n"
        "Decompose the RESEARCH QUESTION into an ordered list of focused, standalone web-search "
        "sub-questions that, answered in sequence, fully resolve it. Earlier sub-questions should "
        "establish facts that later ones build on. Use the PRIVATE CASE CONTEXT only to make the "
        "sub-questions specific (parties, statutes, sections, dates, jurisdiction) — do NOT try to "
        "answer from it.\n"
        f"Return AT MOST {max_rounds} sub-questions as a JSON array of strings, and NOTHING else.\n\n"
        f"=== PRIVATE CASE CONTEXT (for specificity only) ===\n{_clip(context, ctx_chars)}\n\n"
        f"=== RESEARCH QUESTION ===\n{question}\n\n"
        "JSON array:"
    )


def round_search(question: str, subq: str, findings: list[dict[str, Any]], context: str, ctx_chars: int) -> str:
    return (
        "You are Jurinex Research Agent. Use Google Search to answer the CURRENT SUB-QUESTION with "
        "current, externally verifiable facts. Prefer primary authoritative sources such as courts, "
        "legislation, regulators, and government publications. Never invent a source, URL, quotation, "
        "date, or holding. Report concise findings with the key facts and the URLs you actually used. "
        "If reliable sources conflict, say so. Do not treat a search snippet alone as conclusive.\n\n"
        f"=== PRIVATE CASE CONTEXT ===\n{_clip(context, ctx_chars)}\n\n"
        f"=== ORIGINAL RESEARCH QUESTION ===\n{question}\n\n"
        f"=== FINDINGS SO FAR ===\n{format_findings(findings)}\n\n"
        f"=== CURRENT SUB-QUESTION ===\n{subq}\n\n"
        "=== FINDINGS ==="
    )


def gap_check(question: str, findings: list[dict[str, Any]]) -> str:
    return (
        "You are the coverage checker for a deep-research agent. Given the ORIGINAL QUESTION and the "
        "FINDINGS gathered so far, decide whether another web-search round is genuinely needed.\n"
        "If the findings are already sufficient to write a complete, well-sourced answer, reply with "
        "exactly: DONE\n"
        "Otherwise reply with ONE single follow-up web-search query (a plain question, no prefix) "
        "targeting the single most important missing piece.\n"
        "Reply with either DONE or one query line — nothing else.\n\n"
        f"=== ORIGINAL QUESTION ===\n{question}\n\n"
        f"=== FINDINGS SO FAR ===\n{format_findings(findings)}\n\n"
        "Decision:"
    )


def synthesis(question: str, findings: list[dict[str, Any]], context: str, ctx_chars: int) -> str:
    return (
        "You are Jurinex Research Agent writing the FINAL research report. Synthesize the FINDINGS "
        "into a well-structured, decision-useful answer to the RESEARCH QUESTION. Clearly distinguish "
        "document-supported claims from web-supported claims. Never invent a source, URL, quotation, "
        "date, holding, or case fact — use ONLY what appears in the findings and the case context. "
        "Prefer primary authoritative sources. For material current claims include inline Markdown "
        "links. Finish with a \"## Sources\" section listing the most important links you relied on. "
        "State the research date.\n\n"
        f"=== PRIVATE CASE DOCUMENTS ===\n{_clip(context, ctx_chars)}\n\n"
        f"=== RESEARCH FINDINGS (from live web-search rounds) ===\n{format_findings(findings)}\n\n"
        f"=== RESEARCH QUESTION ===\n{question}\n\n"
        "=== FINAL RESEARCH REPORT ==="
    )
