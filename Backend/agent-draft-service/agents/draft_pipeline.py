"""
HTML Draft Pipeline — 3-agent orchestration with self-repair loop.

Pipeline:
  1. Librarian Agent  — retrieves chunks + fetches template
  2. Draft Generator  — 2-pass LLM (template analysis → content generation)
  3. Critic Agent     — 5-dimension confidence report
  Repair loop         — re-runs generator up to MAX_RETRIES times on non-"approved" verdict

Entry point: run_html_draft_pipeline(request: HtmlDraftRequest) -> DraftResponse
"""

from __future__ import annotations

import logging
import re
from typing import Any, Dict, List, Optional

from pydantic import BaseModel

logger = logging.getLogger(__name__)

MAX_RETRIES = 3


# ── Request / Response schemas ────────────────────────────────────────────────

class HtmlDraftRequest(BaseModel):
    # Retrieval
    user_id: int
    query: str                          # RAG query for Librarian
    file_ids: Optional[List[str]] = None
    top_k: int = 30
    template_url: str                   # Required — the template to fill

    # Generation
    section_title: str
    section_prompt: str
    model: Optional[str] = None
    temperature: float = 0.4


class DraftResponse(BaseModel):
    html: str                           # complete renderable HTML
    critic_report: Dict[str, Any]       # CriticReport fields
    retries_used: int
    gaps: List[str]                     # extracted draft-gap descriptions
    template_url: str
    status: str                         # "approved" | "needs_revision" | "rejected"
    validation: Optional[Dict[str, Any]] = None  # HTMLValidation from last pass
    error: Optional[str] = None


# ── Gap extraction helper ─────────────────────────────────────────────────────

def _extract_gap_markers(html: str) -> List[str]:
    """Return text content of all <div class="draft-gap"> elements."""
    gaps: List[str] = []
    pattern = re.compile(
        r'<div[^>]*class=["\'][^"\']*draft-gap[^"\']*["\'][^>]*>([\s\S]*?)</div>',
        re.IGNORECASE,
    )
    for m in pattern.finditer(html):
        inner = re.sub(r'<[^>]+>', ' ', m.group(1)).strip()
        inner = re.sub(r'\s+', ' ', inner)
        if inner:
            gaps.append(inner)
    return gaps


# ── Pipeline ──────────────────────────────────────────────────────────────────

def run_html_draft_pipeline(request: HtmlDraftRequest) -> DraftResponse:
    """
    Execute the full 3-agent HTML draft pipeline with self-repair loop.

    Steps:
      1. Librarian: retrieve chunks + fetch template
      2. Draft Generator: 2-pass LLM → complete HTML
      3. Programmatic HTML validation
      4. Critic: 5-dimension confidence report
      5. Repair loop (up to MAX_RETRIES) if verdict != "approved"
      6. Return DraftResponse
    """
    from agents.librarian.agent import run_librarian_agent
    from agents.drafter.agent import run_html_draft_generator
    from agents.critic.agent import run_html_draft_critic

    # ── Step 1: Librarian ─────────────────────────────────────────────────────
    logger.info("[Pipeline] Step 1 — Librarian (query=%r, template_url=%r)", request.query[:80], request.template_url)
    librarian_payload: Dict[str, Any] = {
        "user_id": request.user_id,
        "query": request.query,
        "top_k": request.top_k,
        "template_url": request.template_url,
    }
    if request.file_ids is not None:
        librarian_payload["file_ids"] = request.file_ids

    librarian_output = run_librarian_agent(librarian_payload)

    chunks: List[Dict[str, Any]] = librarian_output.get("chunks", [])
    template_raw_html: str = librarian_output.get("template_raw_html", "")

    logger.info(
        "[Pipeline] Librarian returned %d chunks, template_html=%d chars",
        len(chunks), len(template_raw_html),
    )

    if not template_raw_html:
        return DraftResponse(
            html="",
            critic_report={},
            retries_used=0,
            gaps=[],
            template_url=request.template_url,
            status="rejected",
            error="Could not fetch template HTML from provided URL",
        )

    # ── Step 2: Initial Draft Generation ─────────────────────────────────────
    logger.info("[Pipeline] Step 2 — Draft Generator (section=%r)", request.section_title)
    generator_payload: Dict[str, Any] = {
        "section_title": request.section_title,
        "section_prompt": request.section_prompt,
        "template_raw_html": template_raw_html,
        "chunks": chunks,
        "model": request.model,
        "temperature": request.temperature,
    }
    generator_result = run_html_draft_generator(generator_payload)

    if generator_result.get("status") == "error":
        err = generator_result.get("error_message", "Draft generation failed")
        logger.error("[Pipeline] Draft generator failed: %s", err)
        return DraftResponse(
            html="",
            critic_report={},
            retries_used=0,
            gaps=[],
            template_url=request.template_url,
            status="rejected",
            error=err,
        )

    draft_html: str = generator_result["html"]
    validation: Dict[str, Any] = generator_result.get("validation", {})

    # ── Step 3: Critic ────────────────────────────────────────────────────────
    logger.info("[Pipeline] Step 3 — Critic (html_len=%d)", len(draft_html))
    critic_payload: Dict[str, Any] = {
        "generated_html": draft_html,
        "chunks": chunks,
        "section_prompt": request.section_prompt,
        "model": request.model,
    }
    critic_result = run_html_draft_critic(critic_payload)
    critic_report: Dict[str, Any] = critic_result.get("report", {})
    verdict: str = critic_report.get("verdict", "needs_revision")

    logger.info(
        "[Pipeline] Critic verdict=%r confidence=%.2f",
        verdict, critic_report.get("overall_confidence", 0),
    )

    # ── Step 4: Self-Repair Loop ──────────────────────────────────────────────
    retry_count = 0
    while verdict != "approved" and retry_count < MAX_RETRIES:
        retry_count += 1
        critical_issues = critic_report.get("critical_issues", [])
        confidence = critic_report.get("overall_confidence", 0)

        repair_instruction = (
            f"The previous draft was rated: {verdict}\n"
            f"Overall confidence: {confidence:.2f}\n"
            f"Critical issues found:\n"
            + "\n".join(f"  - {issue}" for issue in critical_issues)
            + "\n\nFix ONLY these issues. Do not change parts of the draft that were correct.\n"
            "Preserve all CSS classes, layout, and template structure.\n"
            "Return the complete corrected HTML."
        )

        logger.info(
            "[Pipeline] Repair attempt %d/%d — verdict=%r confidence=%.2f",
            retry_count, MAX_RETRIES, verdict, confidence,
        )

        repair_payload: Dict[str, Any] = {
            "section_title": request.section_title,
            "section_prompt": request.section_prompt,
            "template_raw_html": template_raw_html,
            "chunks": chunks,
            "model": request.model,
            "temperature": request.temperature,
            "repair_context": repair_instruction,
            "previous_draft": draft_html,
        }
        repair_result = run_html_draft_generator(repair_payload)

        if repair_result.get("status") == "error":
            logger.warning("[Pipeline] Repair attempt %d failed: %s", retry_count, repair_result.get("error_message"))
            break  # keep previous draft, stop retrying

        draft_html = repair_result["html"]
        validation = repair_result.get("validation", {})

        # Re-evaluate
        critic_payload["generated_html"] = draft_html
        critic_result = run_html_draft_critic(critic_payload)
        critic_report = critic_result.get("report", {})
        verdict = critic_report.get("verdict", "needs_revision")

        logger.info(
            "[Pipeline] After repair %d: verdict=%r confidence=%.2f",
            retry_count, verdict, critic_report.get("overall_confidence", 0),
        )

    # ── Step 5: Build Response ────────────────────────────────────────────────
    gaps = _extract_gap_markers(draft_html)
    logger.info(
        "[Pipeline] Complete — verdict=%r retries=%d gaps=%d",
        verdict, retry_count, len(gaps),
    )

    return DraftResponse(
        html=draft_html,
        critic_report=critic_report,
        retries_used=retry_count,
        gaps=gaps,
        template_url=request.template_url,
        status=verdict,
        validation=validation,
    )
