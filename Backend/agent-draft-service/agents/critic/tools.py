"""
Critic Agent Tools - Google ADK powered.

Contains implementation for legal draft validation using Gemini.
"""

from __future__ import annotations

import json
import logging
import os
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
) -> Dict[str, Any]:
    """
    Review a generated section for legal accuracy and quality.
    """
    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        return {"error": "API Key not found"}

    # Load system prompt
    system_prompt = ""
    try:
        from pathlib import Path
        instr_path = Path(__file__).parent.parent.parent / "instructions" / "critic.txt"
        if instr_path.exists():
            system_prompt = instr_path.read_text(encoding="utf-8").strip()
    except Exception:
        pass

    try:
        client = genai.Client(api_key=api_key)
        
        prompt = ""
        if system_prompt:
            prompt += f"System Instructions:\n{system_prompt}\n\n"
        
        prompt += f"""You are a legal document auditor. Review this content for "{section_key}".

**Generated Content:**
{section_content}

**Original Prompt:** {section_prompt}

**Context (RAG):**
{rag_context if rag_context else 'No context.'}

**Field Data:**
{field_values}

**Instructions:**
- Be concise (bulleted points).
- Total feedback < 150 words.
- Identify all sources (filenames/cases) used.
- Output ONLY JSON.

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
        response = client.models.generate_content(
            model=model,
            contents=prompt,
            config=types.GenerateContentConfig(response_mime_type="application/json"),
        )

        review_json = json.loads(response.text)
        # Validate with pydantic
        review = CriticReview(**review_json)
        
        return {
            "status": "success",
            "review": review.model_dump()
        }

    except Exception as e:
        logger.exception("Critic tool failed")
        return {"status": "error", "error_message": str(e)}
