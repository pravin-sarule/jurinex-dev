"""
Critic Agent Tools - Google ADK powered.

Contains implementation for legal draft validation using Gemini.
"""

from __future__ import annotations

import json
import logging
import os
import re
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field

from google import genai
from google.genai import types

logger = logging.getLogger(__name__)

DEFAULT_MODEL = "models/gemini-2.5-pro"

class CriticReview(BaseModel):
    status: str = Field(..., pattern="^(PASS|FAIL)$")
    score: int = Field(..., ge=0, le=100)
    feedback: str
    issues: List[str] = Field(default_factory=list)
    suggestions: List[str] = Field(default_factory=list)
    sources: List[str] = Field(default_factory=list)

def review_section(
    section_content: str,
    section_key: str,
    rag_context: str,
    field_values: Dict[str, Any],
    section_prompt: str,
    model: str = DEFAULT_MODEL,
    system_prompt_override: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Review a generated section for legal accuracy and quality.
    """
    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        return {"error": "API Key not found"}

    # Load system prompt — priority: DB override → critic.txt file → hardcoded fallback
    system_prompt = ""
    if system_prompt_override and system_prompt_override.strip():
        system_prompt = system_prompt_override.strip()
        prompt_source = f"DB override ({len(system_prompt)} chars)"
    else:
        try:
            from pathlib import Path
            instr_path = Path(__file__).parent.parent.parent / "instructions" / "critic.txt"
            if instr_path.exists():
                system_prompt = instr_path.read_text(encoding="utf-8").strip()
                prompt_source = f"instructions/critic.txt ({len(system_prompt)} chars)"
            else:
                prompt_source = "critic.txt NOT FOUND"
        except Exception:
            prompt_source = "critic.txt read error"

    if not system_prompt:
        system_prompt = "You are a legal document auditor. Review the content for accuracy and quality."
        prompt_source = "DEFAULT hardcoded fallback (1 line)"

    logger.info(
        "[Critic][LLM] section=%r | model=%r | prompt_source=%s | system=%d chars",
        section_key, model, prompt_source, len(system_prompt),
    )

    try:
        from services.llm_service import call_llm
        
        prompt = ""
        if system_prompt:
            prompt += f"System Instructions:\n{system_prompt}\n\n"
        
        prompt += f"""You are a legal document auditor. Review this content for "{section_key}". Target confidence 90+ when the draft follows the template, uses sources, and has no critical errors.

**Generated Content:**
{section_content}

**Original Prompt:** {section_prompt}

**Context (RAG):**
{rag_context if rag_context else 'No context.'}

**Field Data:**
{field_values}

**Instructions:**
- If the draft matches template structure, uses RAG/field data correctly, and has no factual/legal errors, assign score 92-98 (high confidence).
- Be concise. Output ONLY JSON.

**Format:**
{{
  "status": "PASS" | "FAIL",
  "score": 0-100,
  "feedback": "string",
  "issues": ["string"],
  "suggestions": ["string"],
  "sources": ["string"]
}}
"""
        response_text = call_llm(
            prompt=prompt,
            model=model,
            response_mime_type="application/json"
        )

        if not response_text:
            return {"status": "error", "error_message": "LLM returned no content"}
            
        # Clean potential markdown (though llm_service handles it partly, Claude might wrap it)
        cleaned_json = re.sub(r"^```(?:json)?\s*", "", response_text.strip())
        cleaned_json = re.sub(r"\s*```$", "", cleaned_json).strip()

        review_json = json.loads(cleaned_json)
        # Validate with pydantic
        review = CriticReview(**review_json)
        
        return {
            "status": "success",
            "review": review.model_dump()
        }

    except Exception as e:
        logger.exception("Critic tool failed")
        return {"status": "error", "error_message": str(e)}


# ── HTML Draft Critic (5-dimension confidence report) ────────────────────────

from typing import List as _List


class CriticReport(BaseModel):
    scores: dict               # { factual_grounding, completeness, template_fidelity, content_quality, technical_correctness }
    overall_confidence: float
    verdict: str               # "approved" | "needs_revision" | "rejected"
    critical_issues: _List[str]
    one_line_summary: str


_HTML_CRITIC_SYSTEM = """You are a strict quality assurance critic for document drafts.
You receive a generated HTML draft and the source chunks it was built from.
Your job: validate whether the draft is accurate, complete, and well-structured.
Evaluate on exactly these 5 dimensions. Score each 0.0 to 1.0:

factual_grounding — Are all factual claims traceable to a source chunk?
  Deduct for any claim with no <!-- CHUNK-N --> comment or that contradicts a chunk.
completeness — Does the draft cover what the section prompt asked for?
  Deduct for <div class="draft-gap"> markers or sections that feel thin relative to available chunks.
template_fidelity — Does the HTML preserve the original template's structure, classes, and visual intent?
  Deduct for restructured layouts or missing classes.
content_quality — Is the writing clear, professional, and properly formatted?
  Deduct for awkward sentences, misaligned text, broken tables, or raw data dumps.
technical_correctness — Do JS components (charts, tabs) appear correctly implemented?
  Deduct for obvious syntax errors, missing Chart.js initialisations, or broken logic.

Verdict rules:
  overall_confidence >= 0.82 → "approved"
  overall_confidence >= 0.60 → "needs_revision"
  overall_confidence < 0.60  → "rejected"

Return ONLY this JSON:
{
  "scores": {
    "factual_grounding": 0.0,
    "completeness": 0.0,
    "template_fidelity": 0.0,
    "content_quality": 0.0,
    "technical_correctness": 0.0
  },
  "overall_confidence": 0.0,
  "verdict": "approved",
  "critical_issues": [],
  "one_line_summary": "< 15 words"
}
Return ONLY valid JSON. No explanation outside the JSON."""


def review_html_draft(
    generated_html: str,
    chunks: list,
    section_prompt: str,
    model: str = DEFAULT_MODEL,
) -> Dict[str, Any]:
    """
    One-shot LLM review of a complete HTML draft against 5 quality dimensions.

    Returns { status: "success", report: CriticReport } or { status: "error", error_message }
    """
    if not generated_html:
        return {"status": "error", "error_message": "generated_html is required"}

    # Format chunks
    chunks_text_parts = []
    for i, chunk in enumerate(chunks[:40], 1):  # cap at 40 for prompt length
        text = (chunk.get("content") or chunk.get("text") or "").strip()
        if text:
            doc = chunk.get("file_id") or chunk.get("doc_id") or "?"
            pg = chunk.get("page_start") or chunk.get("page") or "?"
            chunks_text_parts.append(f"[CHUNK-{i}] doc:{doc} page:{pg}\n{text[:600]}")
    chunks_formatted = "\n\n".join(chunks_text_parts) or "[No source chunks provided]"

    # Truncate HTML for prompt (keep under ~12K chars to avoid hitting model limits)
    html_for_prompt = generated_html[:12000]
    if len(generated_html) > 12000:
        html_for_prompt += "\n... [HTML truncated for review — full document was generated]"

    user_msg = (
        f"SECTION PROMPT (what the draft was supposed to cover):\n{section_prompt}\n\n"
        f"SOURCE CHUNKS USED:\n{chunks_formatted}\n\n"
        f"GENERATED HTML DRAFT:\n{html_for_prompt}\n\n"
        "Evaluate the draft. Return your JSON confidence report."
    )

    try:
        from services.llm_service import call_llm

        response_text = call_llm(
            prompt=user_msg,
            system_prompt=_HTML_CRITIC_SYSTEM,
            model=model,
            temperature=0.1,
            response_mime_type="application/json",
        )
        if not response_text:
            return {"status": "error", "error_message": "Critic LLM returned no content"}

        cleaned = re.sub(r'^```(?:json)?\s*', '', response_text.strip())
        cleaned = re.sub(r'\s*```$', '', cleaned).strip()

        report_json = json.loads(cleaned)

        # Enforce verdict rule based on overall_confidence
        conf = float(report_json.get("overall_confidence", 0))
        if conf >= 0.82:
            report_json["verdict"] = "approved"
        elif conf >= 0.60:
            report_json["verdict"] = "needs_revision"
        else:
            report_json["verdict"] = "rejected"

        # Ensure scores dict has all 5 keys
        scores = report_json.get("scores", {})
        for dim in ("factual_grounding", "completeness", "template_fidelity", "content_quality", "technical_correctness"):
            scores.setdefault(dim, 0.0)

        # Cap critical_issues at 3
        report_json["critical_issues"] = (report_json.get("critical_issues") or [])[:3]

        report = CriticReport(
            scores=scores,
            overall_confidence=conf,
            verdict=report_json["verdict"],
            critical_issues=report_json["critical_issues"],
            one_line_summary=str(report_json.get("one_line_summary", ""))[:100],
        )

        return {"status": "success", "report": report.model_dump()}

    except Exception as e:
        logger.exception("HTML Critic tool failed")
        return {"status": "error", "error_message": str(e)}
