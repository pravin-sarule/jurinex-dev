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

    # Load system prompt
    system_prompt = ""
    if system_prompt_override and system_prompt_override.strip():
        system_prompt = system_prompt_override.strip()
    else:
        try:
            from pathlib import Path
            instr_path = Path(__file__).parent.parent.parent / "instructions" / "critic.txt"
            if instr_path.exists():
                system_prompt = instr_path.read_text(encoding="utf-8").strip()
        except Exception:
            pass
    
    if not system_prompt:
        system_prompt = "You are a legal document auditor. Review the content for accuracy and quality."

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
